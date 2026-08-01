require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');
const { OpenAI } = require('openai');
const puppeteer = require('puppeteer');
const { Storage } = require('@google-cloud/storage');
const { v4: uuidv4 } = require('uuid');
const Feed = require('feed');

const app = express();
const PORT = process.env.PORT || 3000;
const AUTO_GENERATE_INTERVAL_MS = 8 * 60 * 60 * 1000;
const USE_GCS_STORAGE = process.env.USE_GCS_STORAGE === 'true';
const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME || '';
const GCS_PUBLIC_BASE_URL = (process.env.GCS_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const MEME_DATA_OBJECT = 'data/memes-data.json';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const storage = USE_GCS_STORAGE ? new Storage() : null;
const bucket = USE_GCS_STORAGE && GCS_BUCKET_NAME ? storage.bucket(GCS_BUCKET_NAME) : null;
let generationQueue = Promise.resolve();
let lastBackgroundIndex = -1;

function getSiteUrl() {
  return process.env.SITE_URL || `http://localhost:${PORT}`;
}

function cleanText(text = '') {
  return String(text)
    .replace(/<[^>]*>/g, '')
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isAbsoluteUrl(value = '') {
  return /^https?:\/\//i.test(String(value));
}

function getPublicImageUrl(imagePath = '') {
  if (isAbsoluteUrl(imagePath)) {
    return imagePath;
  }
  return `${getSiteUrl()}${imagePath}`;
}

function ensureGcsConfigured() {
  if (USE_GCS_STORAGE && !bucket) {
    throw new Error('GCS storage is enabled but GCS_BUCKET_NAME is missing.');
  }
}

function buildGcsPublicUrl(objectPath) {
  if (GCS_PUBLIC_BASE_URL) {
    return `${GCS_PUBLIC_BASE_URL}/${objectPath}`;
  }
  return `https://storage.googleapis.com/${GCS_BUCKET_NAME}/${objectPath}`;
}

async function generateMemeText() {
  const prompt = `Create a SHORT, FUNNY, RELATABLE meme in English, STRICTLY max 3 lines total:
---
Title: [short catchy title + 1 emoji]
Punchline: [1-2 short funny sentences, casual, relatable, max 80 chars total]
End: [short funny/ironic one-liner]
Topic: everyday life, funny situations, relatable moments. Keep it clean, SHORT, funny — NO long paragraphs!`;

  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.9
  });
  return res.choices[0].message.content;
}

function parseMemeText(text) {
  return {
    title: text.match(/Title:\s*(.*)/)?.[1] || 'Funny Meme 😂',
    body: text.match(/Punchline:\s*(.*)/)?.[1] || 'Something relatable that made you smile!',
    closing: text.match(/End:\s*(.*)/)?.[1] || ''
  };
}

function getRandomBackground() {
  const bgs = [
    'https://images.unsplash.com/photo-1518791841217-8f162f1e1131?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1533738363-b7f9aef128ce?auto=format&fit=crop&w=800&q=80'
  ];

  let index = Math.floor(Math.random() * bgs.length);
  if (bgs.length > 1) {
    while (index === lastBackgroundIndex) {
      index = Math.floor(Math.random() * bgs.length);
    }
  }

  lastBackgroundIndex = index;
  const separator = bgs[index].includes('?') ? '&' : '?';
  return `${bgs[index]}${separator}sig=${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function generateImage(html) {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 800 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const img = await page.screenshot({ type: 'png' });
  await browser.close();
  return img;
}

async function ensureDataFile() {
  if (USE_GCS_STORAGE) {
    ensureGcsConfigured();
    const dataFile = bucket.file(MEME_DATA_OBJECT);
    const [exists] = await dataFile.exists();
    if (!exists) {
      await dataFile.save('[]', {
        contentType: 'application/json; charset=utf-8',
        resumable: false
      });
    }
    return;
  }

  try {
    await fs.access('memes-data.json');
  } catch {
    await fs.writeFile('memes-data.json', '[]');
  }
}

async function readMemes() {
  await ensureDataFile();
  if (USE_GCS_STORAGE) {
    const [contents] = await bucket.file(MEME_DATA_OBJECT).download();
    return JSON.parse(contents.toString('utf8'));
  }
  return JSON.parse(await fs.readFile('memes-data.json', 'utf8'));
}

async function writeMemes(memes) {
  const json = JSON.stringify(memes, null, 2);
  if (USE_GCS_STORAGE) {
    await bucket.file(MEME_DATA_OBJECT).save(json, {
      contentType: 'application/json; charset=utf-8',
      resumable: false
    });
    return;
  }
  await fs.writeFile('memes-data.json', json);
}

async function saveGeneratedImage(imageBuffer, fileName) {
  if (USE_GCS_STORAGE) {
    ensureGcsConfigured();
    const objectPath = `memes/${fileName}`;
    await bucket.file(objectPath).save(imageBuffer, {
      contentType: 'image/png',
      resumable: false,
      metadata: {
        cacheControl: 'public, max-age=31536000, immutable'
      }
    });
    return buildGcsPublicUrl(objectPath);
  }

  const filePath = path.join(__dirname, 'public', 'memes', fileName);
  await fs.writeFile(filePath, imageBuffer);
  return `/memes/${fileName}`;
}

async function postMemeToFacebook(meme) {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const pageToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!pageId || !pageToken) {
    console.log('ℹ️ Facebook auto-post skipped (missing FACEBOOK_PAGE_ID or FACEBOOK_PAGE_ACCESS_TOKEN).');
    return;
  }

  const shareUrl = `${getSiteUrl()}/m/${meme.slug}`;
  const title = cleanText(meme.title);
  const body = cleanText(meme.body);
  const message = `${title}\n${body}\n\nClick to see the full meme ⬇️`;

  await axios.post(`https://graph.facebook.com/v20.0/${pageId}/feed`, null, {
    params: {
      message,
      link: shareUrl,
      access_token: pageToken
    }
  });

  console.log(`📣 Facebook auto-post published for ${meme.slug}`);
}

async function postMemeToInstagram(meme) {
  const igUserId = process.env.INSTAGRAM_IG_USER_ID;
  const igAccessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!igUserId || !igAccessToken) {
    console.log('ℹ️ Instagram auto-post skipped (missing INSTAGRAM_IG_USER_ID or INSTAGRAM_ACCESS_TOKEN).');
    return;
  }

  const siteUrl = getSiteUrl();
  const imageUrl = getPublicImageUrl(meme.imageUrl);
  const shareUrl = `${siteUrl}/m/${meme.slug}`;
  const title = cleanText(meme.title);
  const body = cleanText(meme.body);
  const closing = cleanText(meme.closing);
  const caption = [title, body, closing, '', `View more: ${shareUrl}`, '#DailyLaffs #meme #funny']
    .filter(Boolean)
    .join('\n')
    .slice(0, 2200);

  const createContainer = await axios.post(`https://graph.facebook.com/v20.0/${igUserId}/media`, null, {
    params: {
      image_url: imageUrl,
      caption,
      access_token: igAccessToken
    }
  });

  const creationId = createContainer.data?.id;
  if (!creationId) {
    throw new Error('Instagram media container was not created.');
  }

  await axios.post(`https://graph.facebook.com/v20.0/${igUserId}/media_publish`, null, {
    params: {
      creation_id: creationId,
      access_token: igAccessToken
    }
  });

  console.log(`📸 Instagram auto-post published for ${meme.slug}`);
}

async function generateAndSaveMeme(source = 'manual') {
  await ensureDataFile();
  const { title, body, closing } = parseMemeText(await generateMemeText());
  const bg = getRandomBackground();
  const html = `
  <html><body style="margin:0;padding:40px;background:url('${bg}') center/cover;min-height:800px;display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif;color:white;text-shadow:2px 2px 4px rgba(0,0,0,0.8);">
    <div style="background:rgba(0,0,0,0.6);padding:40px;border-radius:15px;text-align:center;max-width:700px;">
      <h2 style="font-size:42px;margin:0 0 25px;color:#ffd700;">${title}</h2>
      <p style="font-size:32px;line-height:1.5;margin:0 0 20px;">${body}</p>
      ${closing ? `<p style="font-size:30px;color:#ff6b6b;margin:0;">${closing}</p>` : ''}
    </div>
  </body></html>`;

  const imgBuffer = await generateImage(html);
  const imgName = `${uuidv4()}.png`;
  const imageUrl = await saveGeneratedImage(imgBuffer, imgName);

  const now = Date.now();
  const newMeme = {
    id: now,
    slug: `meme-${now}`,
    title,
    body,
    closing,
    imageUrl,
    createdAt: new Date().toISOString()
  };

  const all = await readMemes();
  all.push(newMeme);
  await writeMemes(all);

  try {
    await postMemeToFacebook(newMeme);
  } catch (err) {
    console.error('❌ Facebook auto-post failed:', err.message);
  }

  try {
    await postMemeToInstagram(newMeme);
  } catch (err) {
    console.error('❌ Instagram auto-post failed:', err.message);
  }

  console.log(`✅ Meme generated (${source}): ${newMeme.slug}`);
  return newMeme;
}

function enqueueGeneration(source) {
  const task = generationQueue.then(() => generateAndSaveMeme(source));
  // Keep queue alive even if a task fails.
  generationQueue = task.catch(() => {});
  return task;
}

function startAutoGenerationScheduler() {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('⚠️ OPENAI_API_KEY is missing. Auto-generation every 8h is disabled.');
    return;
  }

  setInterval(async () => {
    try {
      await enqueueGeneration('auto-8h');
    } catch (err) {
      console.error('❌ Auto-generation failed:', err.message);
    }
  }, AUTO_GENERATE_INTERVAL_MS);

  console.log('⏰ Auto-generation enabled: one meme every 8 hours.');
}

app.use(express.json());
app.use(express.static('public'));

// Landing page for social crawlers (Open Graph preview + click-through link)
app.get('/m/:slug', async (req, res) => {
  const memes = await readMemes();
  const meme = memes.find(m => m.slug === req.params.slug);
  if (!meme) {
    return res.status(404).send('Meme not found');
  }

  const siteUrl = getSiteUrl();
  const imageUrl = getPublicImageUrl(meme.imageUrl);
  const canonicalUrl = `${siteUrl}/m/${meme.slug}`;
  const title = cleanText(meme.title) || 'Daily Laffs Meme';
  const description = cleanText(`${meme.body} ${meme.closing || ''}`) || 'Funny meme from Daily Laffs';

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} | Daily Laffs</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Daily Laffs">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${escapeHtml(imageUrl)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}">
  <meta http-equiv="refresh" content="0; url=/meme.html?id=${encodeURIComponent(meme.slug)}">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
</head>
<body style="font-family:Arial,sans-serif;padding:24px;text-align:center;">
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(description)}</p>
  <p><a href="/meme.html?id=${encodeURIComponent(meme.slug)}">Open meme</a></p>
</body>
</html>`);
});

// Flux RSS automat
app.get('/rss.xml', async (req, res) => {
  const memes = await readMemes();
  const feed = new Feed({
    title: 'Daily Laffs — Funny Memes',
    description: 'Your daily dose of funny & relatable memes',
    link: getSiteUrl(),
    language: 'en',
    updated: memes.length ? new Date(memes[0].createdAt) : new Date()
  });
  memes.forEach(m => feed.addItem({
    title: m.title,
    link: `${getSiteUrl()}/m/${m.slug}`,
    description: `${m.body}\n${m.closing}`,
    date: new Date(m.createdAt),
    image: getPublicImageUrl(m.imageUrl)
  }));
  res.set('Content-Type', 'application/rss+xml');
  res.send(feed.rss2());
});

// Lista meme-uri
app.get('/api/memes', async (req, res) => {
  const memes = await readMemes();
  res.json(memes.reverse());
});

// Meme individual
app.get('/api/meme/:slug', async (req, res) => {
  const memes = await readMemes();
  const idx = memes.findIndex(m => m.slug === req.params.slug);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  res.json({
    current: memes[idx],
    prev: idx > 0 ? memes[idx - 1] : null,
    next: idx < memes.length - 1 ? memes[idx + 1] : null
  });
});

// Generează meme NOU
app.post('/api/generate-and-post', async (req, res) => {
  try {
    const newMeme = await enqueueGeneration('manual');
    res.json({ success: true, meme: newMeme });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Daily Laffs pornit pe http://localhost:${PORT}`);
  if (USE_GCS_STORAGE) {
    console.log(`☁️ Storage mode: Google Cloud Storage (${GCS_BUCKET_NAME})`);
  } else {
    console.log('💾 Storage mode: local filesystem');
  }
  startAutoGenerationScheduler();
});