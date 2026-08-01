(function () {
  const ADSENSE_SRC = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3528838516008000';
  const cfg = window.CMP_SETTINGS || {};

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

  function loadCmpScript() {
    if (!cfg.cmpScriptUrl) {
      return;
    }
    const existing = document.getElementById('cmp-loader-script');
    if (existing) {
      return;
    }
    const script = document.createElement('script');
    script.id = 'cmp-loader-script';
    script.async = true;
    script.src = cfg.cmpScriptUrl;
    document.head.appendChild(script);
  }

  function openCmpPreferences() {
    if (window.googlefc && typeof window.googlefc.showRevocationMessage === 'function') {
      window.googlefc.showRevocationMessage();
      return;
    }
    if (window.__tcfapi) {
      try {
        window.__tcfapi('displayConsentUi', 2, function () {});
        return;
      } catch (_err) {
        // Continue to fallback notice.
      }
    }
    alert('Privacy settings are handled by your CMP. Configure cmpScriptUrl in cmp-config.js.');
  }

  function createManageButton() {
    if (document.getElementById('consentManageBtn')) {
      return;
    }
    const btn = document.createElement('button');
    btn.id = 'consentManageBtn';
    btn.className = 'consent-manage-btn';
    btn.type = 'button';
    btn.textContent = 'Privacy settings';
    btn.addEventListener('click', openCmpPreferences);
    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createManageButton);
  } else {
    createManageButton();
  }

  loadCmpScript();
  loadAdsScriptAndInit();
})();
