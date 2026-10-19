/* Chạy sớm trong <head> để chuyển trang và khôi phục Back/Forward nhất quán. */
(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const nativeTransitions = 'CSSViewTransitionRule' in window;
  document.documentElement.dataset.pageMotion = nativeTransitions ? 'native' : 'fallback';

  let exitAnimation;
  let entryAnimation;
  let navigationTimer;
  let recoveryTimer;
  let leaving = false;

  function reset() {
    clearTimeout(navigationTimer);
    clearTimeout(recoveryTimer);
    exitAnimation?.cancel();
    entryAnimation?.cancel();
    leaving = false;
  }

  function isLocalPage(url) {
    return /^https?:$/.test(url.protocol) && url.origin === location.origin &&
      (url.pathname.endsWith('.html') || url.pathname.endsWith('/'));
  }

  function isSamePage(url) {
    return url.pathname === location.pathname && url.search === location.search;
  }

  window.navigateTo = (href, { replace = false } = {}) => {
    const url = new URL(href, location.href);
    const go = () => replace ? location.replace(url.href) : location.assign(url.href);

    if (nativeTransitions || reducedMotion.matches || !isLocalPage(url) ||
        isSamePage(url) || !document.body?.animate) {
      go();
      return;
    }
    if (leaving) return;

    leaving = true;
    entryAnimation?.cancel();
    exitAnimation = document.body.animate(
      [{ opacity: 1 }, { opacity: .35 }],
      { duration: 140, easing: 'ease-out', fill: 'forwards' }
    );
    navigationTimer = setTimeout(go, 140);
    // Nếu tải trang bị huỷ hoặc kết nối chậm, trang hiện tại vẫn dùng được.
    recoveryTimer = setTimeout(reset, 1800);
  };

  document.addEventListener('click', (event) => {
    if (nativeTransitions || reducedMotion.matches || event.defaultPrevented ||
        event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.('a[href]');
    if (!link || link.hasAttribute('download') || link.hasAttribute('data-no-transition') ||
        (link.target && link.target.toLowerCase() !== '_self')) return;
    const url = new URL(link.href, location.href);
    if (!isLocalPage(url) || isSamePage(url)) return;
    event.preventDefault();
    window.navigateTo(url.href);
  });

  window.addEventListener('pageshow', () => {
    reset();
    if (nativeTransitions || reducedMotion.matches || !document.body?.animate) return;
    entryAnimation = document.body.animate(
      [{ opacity: .35 }, { opacity: 1 }],
      { duration: 240, easing: 'ease-out' }
    );
  });
  window.addEventListener('pagehide', reset);
})();
