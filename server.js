require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');
const { OpenAI } = require('openai');
const puppeteer = require('puppeteer');
const { Storage } = require('@google-cloud/storage');
const { v4: uuidv4 } = require('uuid');
const { Feed } = require('feed');
const { isUniqueJoke } = require('./joke-utils');
const { getTeaserClip } = require('./preview-utils');

const app = express();
const PORT = process.env.PORT || 3000;
const AUTO_GENERATE_INTERVAL_MS = 8 * 60 * 60 * 1000;
const USE_GCS_STORAGE = process.env.USE_GCS_STORAGE === 'true';
const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME || '';
const GCS_PUBLIC_BASE_URL = (process.env.GCS_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const GCS_ENABLED = USE_GCS_STORAGE && Boolean(GCS_BUCKET_NAME);
const ENABLE_INTERNAL_SOCIAL_POSTS = process.env.ENABLE_INTERNAL_SOCIAL_POSTS === 'true';
const MAKE_WEBHOOK_URL = (process.env.MAKE_WEBHOOK_URL || '').trim();
const ENABLE_IN_PROCESS_SCHEDULER = process.env.ENABLE_IN_PROCESS_SCHEDULER === 'true';
const CRON_TRIGGER_KEY = (process.env.CRON_TRIGGER_KEY || '').trim();
const MEME_DATA_OBJECT = 'data/memes-data.json';
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Europe/Bucharest';
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const storage = GCS_ENABLED ? new Storage() : null;
const bucket = GCS_ENABLED ? storage.bucket(GCS_BUCKET_NAME) : null;
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
  if (GCS_ENABLED && !bucket) {
    throw new Error('GCS storage is enabled but GCS_BUCKET_NAME is missing.');
  }
}

function buildGcsPublicUrl(objectPath) {
  if (GCS_PUBLIC_BASE_URL) {
    return `${GCS_PUBLIC_BASE_URL}/${objectPath}`;
  }
  return `https://storage.googleapis.com/${GCS_BUCKET_NAME}/${objectPath}`;
}

function getCurrentWeekdayName() {
  const weekday = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: APP_TIMEZONE
  }).format(new Date());
  return WEEKDAYS.includes(weekday) ? weekday : 'Monday';
}

function normalizeWeekdayReferences(text, currentWeekday) {
  if (!text) return '';
  const dayRegex = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;
  return String(text).replace(dayRegex, (match) => {
    if (match[0] === match[0].toLowerCase()) {
      return currentWeekday.toLowerCase();
    }
    return currentWeekday;
  });
}

function buildHalfTeaserText(body = '', closing = '') {
  const full = cleanText(`${body} ${closing}`);
  if (!full) return 'Click the link for the full meme.';

  const words = full.split(' ').filter(Boolean);
  const teaserCount = Math.max(8, Math.floor(words.length / 2));
  const teaser = words.slice(0, teaserCount).join(' ');
  return `${teaser}... Click the link for the full meme.`;
}

function parseJsonSafe(text = '') {
  const normalized = String(text).replace(/^\uFEFF/, '');
  return JSON.parse(normalized);
}

async function generateMemeText() {
  const todayWeekday = getCurrentWeekdayName();
  const creativitySeed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const prompt = `You write short English jokes with an Eastern-European "banc" rhythm: simple setup, instant punchline, no explanation.
Goal:
Make people laugh in one read.

Style direction:
- Keep it short, clear, and punchy.
- Use absurd but relatable logic.
- Jokes should feel like old-school "Bula-style" timing (in English), but do NOT copy known jokes.
- Heavily prefer these formats:
  1) Q/A joke ("Why ...? Because ...")
  2) Very short mini-story ending in a hard twist
- Avoid observational format unless the punchline is very strong.

Rules:
- Output exactly 3 lines using this format only.
- Write everything in natural, fluent English.
- No explanations of the joke.
- No moral lessons, no motivational tone, no corporate wording.
- Avoid dark, hateful, sexual, or graphic content.
- Keep the punchline immediately understandable.
- If you mention a weekday, you MUST use today: ${todayWeekday}.
- Creativity seed for this request: ${creativitySeed}

Output format:
---
Title: [short title, max 7 words]
Punchline: [the core joke line]
End: [very short final kicker]`;

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 1.05
    });
    return res.choices[0].message.content;
  } catch (err) {
    console.error('⚠️ OpenAI unavailable, using fallback meme text:', err.message);
    const fallback = [
      {
        title: 'Frozen Coffee Logic',
        body: 'Why do Eskimos never drink coffee outside? Because by the time they sit down, it is iced forever.',
        end: 'Their espresso has winter tires.'
      },
      {
        title: 'Weekend Car Report',
        body: 'I told my friend my weekend was peaceful. Then one car died on the highway and the second one hit a stop sign like it owed money.',
        end: 'My mechanic now answers with "new number, who dis?"'
      },
      {
        title: 'Tiny Lemon Problem',
        body: 'Why do tiny lemons scare me? Because my mouth makes the sour face before I even take a bite.',
        end: 'My cheeks panic faster than my brain.'
      },
      {
        title: 'Question With A Trap',
        body: 'Why did I open my bank app on Friday? To confirm that hope is not a payment method.',
        end: 'My card laughed first.'
      },
      {
        title: 'Morning Genius',
        body: 'Why do I set alarms every five minutes? So I can fail in smaller chapters.',
        end: 'Consistency matters.'
      },
      {
        title: 'Diet Negotiation',
        body: 'I started a diet today and celebrated with cake so my body knows I am serious.',
        end: 'Motivation tastes like chocolate.'
      },
      {
        title: 'Gym Membership Philosophy',
        body: 'Why do I keep my gym card in my wallet? Cardio. I carry it everywhere.',
        end: 'Fitness is a mindset.'
      },
      {
        title: 'Shopping Strategy',
        body: 'I went out for toothpaste and came home with candles, socks, and emotional damage.',
        end: 'The toothpaste was optional.'
      },
      {
        title: 'Sleep Schedule',
        body: 'Why can I stay awake at 2 AM but die at 2 PM? My body follows vampire office hours.',
        end: 'HR is confused.'
      },
      {
        title: 'Meeting Survival',
        body: 'In meetings I nod so confidently that people think I understand the spreadsheet.',
        end: 'I barely understand my name.'
      },
      {
        title: 'Phone Battery Drama',
        body: 'My phone at 20 percent acts like it is writing a will.',
        end: 'Mine too, honestly.'
      },
      {
        title: 'Laundry Economics',
        body: 'Why do I wait to do laundry? I am giving my clothes one last chance to clean themselves.',
        end: 'Teamwork is dead.'
      },
      {
        title: 'Traffic Wisdom',
        body: 'I was patient in traffic until someone honked and unlocked my inner philosopher.',
        end: 'My speech was not family-friendly.'
      },
      {
        title: 'Cooking Confidence',
        body: 'I followed a recipe exactly and still invented a new emergency.',
        end: 'Fire alarm gave it five stars.'
      },
      {
        title: 'Weekend Budget',
        body: 'Why does money disappear faster on weekends? Because my wallet also wants to have fun.',
        end: 'We are both irresponsible.'
      },
      {
        title: 'Social Battery',
        body: 'I said yes to one plan and now I need three business days to recover.',
        end: 'My extrovert trial expired.'
      },
      {
        title: 'Haircut Timing',
        body: 'Why do barbers ask if I like it before they turn the mirror?',
        end: 'Because lies are quicker.'
      },
      {
        title: 'Online Delivery Faith',
        body: 'Package said "out for delivery" since morning, so now I live by the window.',
        end: 'I blink in shifts.'
      },
      {
        title: 'Weather Expert',
        body: 'I checked the forecast, ignored it, and got dressed like optimism.',
        end: 'Rain educated me.'
      },
      {
        title: 'Fridge Psychology',
        body: 'Why do I open the fridge ten times? I am waiting for new content.',
        end: 'Season two is delayed.'
      },
      {
        title: 'Password Situation',
        body: 'I changed my password to "incorrect" so the computer reminds me when I forget.',
        end: 'Now we argue daily.'
      },
      {
        title: 'Bus Timing',
        body: 'I arrive one minute late and the bus leaves; I arrive early and the bus is philosophical.',
        end: 'Public transport teaches humility.'
      },
      {
        title: 'Friendship Loan',
        body: 'Why do friends return money in memories? Inflation hit promises first.',
        end: 'I am rich in stories.'
      }
    ];
    const pick = fallback[Math.floor(Math.random() * fallback.length)];
    return `Title: ${pick.title}\nPunchline: ${pick.body}\nEnd: ${pick.end}`;
  }
}

function parseMemeText(text) {
  const todayWeekday = getCurrentWeekdayName();
  return {
    title: normalizeWeekdayReferences(text.match(/Title:\s*(.*)/)?.[1] || 'Funny Meme 😂', todayWeekday),
    body: normalizeWeekdayReferences(text.match(/Punchline:\s*(.*)/)?.[1] || 'Something relatable that made you smile!', todayWeekday),
    closing: normalizeWeekdayReferences(text.match(/End:\s*(.*)/)?.[1] || '', todayWeekday)
  };
}

function getRandomBackground() {
  const bgs = [
    // office / work chaos
    'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=800&q=80',
    // coffee / morning
    'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=800&q=80',
    // gym / fitness
    'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=800&q=80',
    // couch / lazy day
    'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=800&q=80',
    // phone addiction
    'https://images.unsplash.com/photo-1512428559087-560fa5ceab42?auto=format&fit=crop&w=800&q=80',
    // shopping / money
    'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?auto=format&fit=crop&w=800&q=80',
    // night / 3am
    'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?auto=format&fit=crop&w=800&q=80',
    // food / pizza
    'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=800&q=80',
    // sleep / bed
    'https://images.unsplash.com/photo-1520206183501-b80df61043c2?auto=format&fit=crop&w=800&q=80',
    // meeting / laptop
    'https://images.unsplash.com/photo-1588196749597-9ff075ee6b5b?auto=format&fit=crop&w=800&q=80',
    // grocery store
    'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=800&q=80',
    // stressed / overthinking
    'https://images.unsplash.com/photo-1541199249251-f713e6145474?auto=format&fit=crop&w=800&q=80'
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
  // Teaser shows only the upper half so full meme requires click-through.
  const teaser = await page.screenshot({
    type: 'png',
    clip: getTeaserClip(800, 800)
  });
  await browser.close();
  return { img, teaser };
}

async function ensureDataFile() {
  if (GCS_ENABLED) {
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
  if (GCS_ENABLED) {
    const [contents] = await bucket.file(MEME_DATA_OBJECT).download();
    return parseJsonSafe(contents.toString('utf8'));
  }
  return parseJsonSafe(await fs.readFile('memes-data.json', 'utf8'));
}

async function writeMemes(memes) {
  const json = JSON.stringify(memes, null, 2);
  if (GCS_ENABLED) {
    await bucket.file(MEME_DATA_OBJECT).save(json, {
      contentType: 'application/json; charset=utf-8',
      resumable: false
    });
    return;
  }
  await fs.writeFile('memes-data.json', json);
}

async function saveGeneratedImage(imageBuffer, fileName, folder = 'memes') {
  if (GCS_ENABLED) {
    ensureGcsConfigured();
    const objectPath = `${folder}/${fileName}`;
    await bucket.file(objectPath).save(imageBuffer, {
      contentType: 'image/png',
      resumable: false,
      metadata: {
        cacheControl: 'public, max-age=31536000, immutable'
      }
    });
    return buildGcsPublicUrl(objectPath);
  }

  const dirPath = path.join(__dirname, 'public', folder);
  await fs.mkdir(dirPath, { recursive: true });
  const filePath = path.join(dirPath, fileName);
  await fs.writeFile(filePath, imageBuffer);
  return `/${folder}/${fileName}`;
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
  const teaser = buildHalfTeaserText(meme.body, meme.closing);
  const message = `${title}\n${teaser}\n\n${shareUrl}`;

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

async function notifyMakeWebhook(meme) {
  if (!MAKE_WEBHOOK_URL) {
    return;
  }

  await axios.post(MAKE_WEBHOOK_URL, {
    event: 'meme.generated',
    siteUrl: getSiteUrl(),
    meme
  });

  console.log(`🔗 Make webhook notified for ${meme.slug}`);
}

async function generateAndSaveMeme(source = 'manual') {
  await ensureDataFile();
  const existingMemes = await readMemes();
  let generated = null;
  let attempts = 0;

  while (!generated && attempts < 20) {
    attempts += 1;
    const parsed = parseMemeText(await generateMemeText());
    const candidate = {
      title: parsed.title,
      body: parsed.body,
      closing: parsed.closing
    };

    if (isUniqueJoke(candidate, existingMemes)) {
      generated = candidate;
    }
  }

  if (!generated) {
    throw new Error('Could not generate a unique joke after several attempts.');
  }

  const { title, body, closing } = generated;
  const bg = getRandomBackground();
  const html = `
  <html><body style="margin:0;padding:40px;background:url('${bg}') center/cover;min-height:800px;display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif;color:white;text-shadow:2px 2px 4px rgba(0,0,0,0.8);">
    <div style="background:rgba(0,0,0,0.6);padding:40px;border-radius:15px;text-align:center;max-width:700px;">
      <h2 style="font-size:42px;margin:0 0 25px;color:#ffd700;">${title}</h2>
      <p style="font-size:32px;line-height:1.5;margin:0 0 20px;">${body}</p>
    </div>
  </body></html>`;

  const { img: imgBuffer, teaser: teaserBuffer } = await generateImage(html);
  const imgName = `${uuidv4()}.png`;
  const imageUrl = await saveGeneratedImage(imgBuffer, imgName);
  const teaserName = `${imgName.replace('.png', '')}-teaser.png`;
  const teaserUrl = await saveGeneratedImage(teaserBuffer, teaserName, 'memes/teasers');

  const now = Date.now();
  const newMeme = {
    id: now,
    slug: `meme-${now}`,
    title,
    body,
    closing,
    imageUrl,
    teaserUrl,
    createdAt: new Date().toISOString()
  };

  const all = await readMemes();
  all.push(newMeme);
  await writeMemes(all);

  try {
    await notifyMakeWebhook(newMeme);
  } catch (err) {
    console.error('❌ Make webhook notify failed:', err.message);
  }

  if (!ENABLE_INTERNAL_SOCIAL_POSTS) {
    console.log('ℹ️ Internal social auto-posting disabled (ENABLE_INTERNAL_SOCIAL_POSTS is not true).');
    console.log(`✅ Meme generated (${source}): ${newMeme.slug}`);
    return newMeme;
  }

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
  if (!ENABLE_IN_PROCESS_SCHEDULER) {
    console.log('⏲️ In-process auto-generation scheduler disabled. Use Cloud Scheduler trigger.');
    return;
  }

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
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path.endsWith('.js') || req.path.endsWith('.css')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});
app.use(express.static('public'));

// Landing page for social crawlers (Open Graph preview + click-through link)
app.get('/m/:slug', async (req, res) => {
  const memes = await readMemes();
  const meme = memes.find(m => m.slug === req.params.slug);
  if (!meme) {
    return res.status(404).send('Meme not found');
  }

  const siteUrl = getSiteUrl();
  const previewImageUrl = getPublicImageUrl(meme.teaserUrl || meme.imageUrl);
  const canonicalUrl = `${siteUrl}/m/${meme.slug}`;
  const title = cleanText(meme.title) || 'Daily Laffs Meme';
  const description = buildHalfTeaserText(meme.body, meme.closing);

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} | Daily Laffs</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="google-adsense-account" content="ca-pub-3528838516008000">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Daily Laffs">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${escapeHtml(previewImageUrl)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(previewImageUrl)}">
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
    description: buildHalfTeaserText(m.body, m.closing),
    date: new Date(m.createdAt),
    image: getPublicImageUrl(m.imageUrl)
  }));
  res.set('Content-Type', 'application/rss+xml');
  res.send(feed.rss2());
});

app.get('/sitemap.xml', async (req, res) => {
  const siteUrl = getSiteUrl();
  const memes = await readMemes();
  const staticUrls = [
    { loc: `${siteUrl}/`, lastmod: new Date().toISOString() },
    { loc: `${siteUrl}/privacy.html`, lastmod: new Date().toISOString() },
    { loc: `${siteUrl}/terms.html`, lastmod: new Date().toISOString() }
  ];
  const memeUrls = memes.map((meme) => ({
    loc: `${siteUrl}/m/${meme.slug}`,
    lastmod: meme.createdAt || new Date().toISOString()
  }));
  const urls = [...staticUrls, ...memeUrls];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((item) => `  <url>
    <loc>${escapeHtml(item.loc)}</loc>
    <lastmod>${escapeHtml(new Date(item.lastmod).toISOString())}</lastmod>
  </url>`).join('\n')}
</urlset>`;

  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.send(xml);
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

app.post('/internal/auto-generate', async (req, res) => {
  if (!CRON_TRIGGER_KEY) {
    return res.status(503).json({ success: false, error: 'CRON_TRIGGER_KEY is not configured.' });
  }

  const providedKey = String(req.get('x-cron-key') || req.query.key || '').trim();
  if (!providedKey || providedKey !== CRON_TRIGGER_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized trigger.' });
  }

  try {
    const newMeme = await enqueueGeneration('cloud-scheduler-8h');
    res.json({ success: true, meme: newMeme });
  } catch (err) {
    console.error('❌ Cloud Scheduler generation failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Daily Laffs pornit pe http://localhost:${PORT}`);
  if (USE_GCS_STORAGE && !GCS_ENABLED) {
    console.warn('⚠️ USE_GCS_STORAGE=true but GCS_BUCKET_NAME is missing. Falling back to local filesystem.');
  }
  if (GCS_ENABLED) {
    console.log(`☁️ Storage mode: Google Cloud Storage (${GCS_BUCKET_NAME})`);
  } else {
    console.log('💾 Storage mode: local filesystem');
  }
  if (ENABLE_INTERNAL_SOCIAL_POSTS) {
    console.log('📣 Internal social auto-posting: enabled');
  } else {
    console.log('📣 Internal social auto-posting: disabled');
  }
  startAutoGenerationScheduler();
});