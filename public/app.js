// Galerie principală
if (document.getElementById('gallery')) {
  fetch('/api/memes')
    .then(res => res.json())
    .then(memes => {
      const gallery = document.getElementById('gallery');
      if (!memes.length) {
        gallery.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:#888;">No memes yet. Click the button above to generate the first one!</p>`;
        return;
      }
      // Afișează corect imaginea și textul
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
      console.error('Eroare incarcare:', err);
      document.getElementById('gallery').innerHTML = `<p style="color:red;text-align:center;">Eroare la afisare</p>`;
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
        content.innerHTML = `
          <div class="single-meme">
            <img src="${current.imageUrl}" alt="${current.title}" onerror="this.src='https://via.placeholder.com/800x800.png?text=Imagine+incarca'">
            <div class="meme-meta">
              <h2>${current.title.replace(/<[^>]*>/g, '')}</h2>
              <p>${current.body.replace(/<[^>]*>/g, '')}</p>
              ${current.closing ? `<p class="meme-closing">${current.closing.replace(/<[^>]*>/g, '')}</p>` : ''}
            </div>
            <div class="meme-actions">
              <a href="${current.imageUrl}" download class="btn btn-secondary">Descarcă</a>
              <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}" target="_blank" class="btn btn-primary">Distribuie</a>
            </div>
          </div>
        `;
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
        content.innerHTML = '<p style="text-align:center;color:#c53030;">Nu am putut încărca meme-ul.</p>';
      });
  }
}