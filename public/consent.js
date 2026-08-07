(function () {
  const ADSENSE_SRC = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3528838516008000';
  const CONSENT_STORAGE_KEY = 'dailylaffs-consent-choice';

  function readStoredConsent() {
    try {
      return window.localStorage.getItem(CONSENT_STORAGE_KEY);
    } catch (_err) {
      return null;
    }
  }

  function storeConsent() {
    try {
      window.localStorage.setItem(CONSENT_STORAGE_KEY, 'accepted');
    } catch (_err) {
      // Ignore storage failures.
    }
  }

  function initAds() {
    const adSlots = document.querySelectorAll('.adsbygoogle');
    adSlots.forEach((slot) => {
      if (slot.dataset.adsInitialized === '1') {
        return;
      }
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
        slot.dataset.adsInitialized = '1';
      } catch (_err) {
        // Script may still be loading.
      }
    });
  }

  function loadAdsScriptAndInit() {
    const existing = document.getElementById('adsense-loader-script');
    if (existing) {
      initAds();
      return;
    }

    const script = document.createElement('script');
    script.id = 'adsense-loader-script';
    script.async = true;
    script.src = ADSENSE_SRC;
    script.crossOrigin = 'anonymous';
    script.addEventListener('load', initAds);
    document.head.appendChild(script);
    setTimeout(initAds, 1200);
  }

  function closeBanner() {
    const banner = document.getElementById('consentBanner');
    if (banner) {
      banner.remove();
    }
  }

  function acceptConsent() {
    storeConsent();
    closeBanner();
    loadAdsScriptAndInit();
  }

  function showBanner() {
    if (document.getElementById('consentBanner')) {
      return;
    }

    const banner = document.createElement('section');
    banner.id = 'consentBanner';
    banner.className = 'consent-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-live', 'polite');
    banner.innerHTML = `
      <div class="consent-text">
        <p>Our website uses only strictly necessary technical cookies and non-personalized ads to protect your privacy. By continuing to browse, you agree to their use.</p>
      </div>
      <div class="consent-actions">
        <button type="button" class="btn btn-primary" data-consent-action="accept">Got it</button>
      </div>
    `;

    banner.querySelector('[data-consent-action="accept"]').addEventListener('click', acceptConsent);
    document.body.appendChild(banner);
  }

  function initConsentFlow() {
    const storedConsent = readStoredConsent();
    if (storedConsent === 'accepted') {
      loadAdsScriptAndInit();
      return;
    }

    showBanner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initConsentFlow);
  } else {
    initConsentFlow();
  }
})();
