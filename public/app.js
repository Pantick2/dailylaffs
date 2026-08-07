if (document.getElementById('gallery')) {
  fetch('/api/memes')
    .then(res => res.json())
    .then(memes => {
      const gallery = document.getElementById('gallery');
      if (!memes.length) {
        gallery.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:#888;">No memes yet. Check back soon for fresh jokes.</p>`;
        return;
      }
      // Render the image and text correctly
      gallery.innerHTML = memes.map(meme => `
        <div class="meme-card" onclick="window.location.href='meme.html?id=${meme.slug}'">
          <img src="${meme.imageUrl}" alt="${meme.title}" loading="lazy" onerror="this.src='https://via.placeholder.com/800x800.png?text=Imagine+incarca'">
          <div class="meme-card-info">
            <div class="meme-card-title">${meme.title.replace(/<[^>]*>/g, '')}</div>
            <div class="meme-date">${new Date(meme.createdAt).toLocaleDateString()}</div>
          </div>
        </div>
      `).join('');
    })
    .catch(err => {
      console.error('Error loading memes:', err);
      document.getElementById('gallery').innerHTML = `<p style="color:red;text-align:center;">Error loading memes</p>`;
    });
}

// Pagina individuala
if (document.getElementById('content')) {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('id');
  const content = document.getElementById('content');

  if (!slug) {
    content.classList.remove('loading');
    content.innerHTML = '<p style="text-align:center;color:#c53030;">Meme missing from URL.</p>';
  } else {
    fetch(`/api/meme/${slug}`)
      .then(res => {
        if (!res.ok) {
          throw new Error('Meme not found');
        }
        return res.json();
      })
      .then(data => {
        const { current, prev, next } = data;
        const shareUrl = `${window.location.origin}/m/${current.slug}`;
        document.title = `Daily Laffs — ${current.title.replace(/<[^>]*>/g, '')}`;
        content.classList.remove('loading');
        const teaserText = `${current.body.replace(/<[^>]*>/g, '').trim()} ${current.closing ? current.closing.replace(/<[^>]*>/g, '').trim() : ''}`.trim();
        const displayText = teaserText ? teaserText.split(' ').slice(0, Math.min(12, teaserText.split(' ').length)).join(' ') + '...' : 'Click the button to reveal the full joke.';
        content.innerHTML = `
          <div class="single-meme">
            <div class="meme-image-wrap">
              <img src="${current.imageUrl}" alt="${current.title}" onerror="this.src='https://via.placeholder.com/800x800.png?text=Imagine+incarca'">
              <div class="meme-overlay" id="memeOverlay" hidden>
                <div class="meme-overlay-text">${current.body.replace(/<[^>]*>/g, '')}${current.closing ? ` ${current.closing.replace(/<[^>]*>/g, '')}` : ''}</div>
              </div>
            </div>
            <div class="meme-meta">
              <h2>${current.title.replace(/<[^>]*>/g, '')}</h2>
              <p class="meme-preview">${displayText}</p>
              <p class="meme-full" hidden>${current.body.replace(/<[^>]*>/g, '')}${current.closing ? ` ${current.closing.replace(/<[^>]*>/g, '')}` : ''}</p>
            </div>
            <div class="meme-actions">
              <button type="button" class="btn btn-secondary" id="revealJokeBtn">Reveal joke</button>
              <a href="${current.imageUrl}" download class="btn btn-secondary">Download</a>
              <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}" target="_blank" class="btn btn-primary">Share</a>
            </div>
          </div>
        `;

        const revealBtn = document.getElementById('revealJokeBtn');
        const previewText = content.querySelector('.meme-preview');
        const fullText = content.querySelector('.meme-full');
        const overlay = content.querySelector('#memeOverlay');
        if (revealBtn && previewText && fullText && overlay) {
          revealBtn.addEventListener('click', () => {
            fullText.hidden = false;
            overlay.hidden = false;
            revealBtn.textContent = 'Joke revealed';
            revealBtn.disabled = true;
          });
        }
        const prevBtn = document.getElementById('prevBtn');
        const nextBtn = document.getElementById('nextBtn');
        const mobileNextWrap = document.getElementById('mobileNextWrap');
        const mobileNextBtn = document.getElementById('mobileNextBtn');
        const goPrev = () => {
          if (prev) {
            location.href = `meme.html?id=${prev.slug}`;
          }
        };
        const goNext = () => {
          if (next) {
            location.href = `meme.html?id=${next.slug}`;
          }
        };
        if (mobileNextWrap) {
          mobileNextWrap.classList.add('nav-hidden');
        }
        if (prev && prevBtn) {
          prevBtn.style.display = 'inline-block';
          prevBtn.onclick = goPrev;
        }
        if (next && nextBtn) {
          nextBtn.style.display = 'inline-block';
          nextBtn.onclick = goNext;
          if (mobileNextWrap && mobileNextBtn) {
            mobileNextWrap.classList.remove('nav-hidden');
            mobileNextBtn.onclick = goNext;
          }
        }

        // Mobile swipe navigation: left -> next, right -> previous.
        const swipeTarget = content.querySelector('.single-meme img') || content.querySelector('.single-meme');
        if (swipeTarget) {
          let touchStartX = null;
          let touchStartY = null;
          const swipeThreshold = 50;
          swipeTarget.addEventListener('touchstart', (e) => {
            const t = e.changedTouches && e.changedTouches[0];
            if (!t) {
              return;
            }
            touchStartX = t.clientX;
            touchStartY = t.clientY;
          }, { passive: true });

          swipeTarget.addEventListener('touchend', (e) => {
            const t = e.changedTouches && e.changedTouches[0];
            if (!t || touchStartX === null || touchStartY === null) {
              return;
            }
            const dx = t.clientX - touchStartX;
            const dy = t.clientY - touchStartY;
            const isHorizontalSwipe = Math.abs(dx) > Math.abs(dy);
            if (!isHorizontalSwipe || Math.abs(dx) < swipeThreshold) {
              touchStartX = null;
              touchStartY = null;
              return;
            }
            if (dx < 0) {
              goNext();
            } else {
              goPrev();
            }
            touchStartX = null;
            touchStartY = null;
          }, { passive: true });
        }
      })
      .catch(err => {
        console.error(err);
        content.classList.remove('loading');
        content.innerHTML = '<p style="text-align:center;color:#c53030;">We could not load the meme.</p>';
      });
  }
}