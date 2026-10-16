(() => {
  'use strict';
  if (window.__CIBERIP_ALT_SHIFT_MAIN_V612__) return;
  window.__CIBERIP_ALT_SHIFT_MAIN_V612__ = true;

  let latched = false;
  let lastFire = 0;

  function fire(e) {
    const now = Date.now();
    if (latched || now - lastFire < 250) return;
    latched = true;
    lastFire = now;
    try {
      window.postMessage({
        __ciberipHudV612: true,
        type: 'ALT_SHIFT_TOGGLE',
        at: now
      }, '*');
    } catch (_) {}
    try { e?.preventDefault?.(); } catch (_) {}
    try { e?.stopPropagation?.(); } catch (_) {}
    try { e?.stopImmediatePropagation?.(); } catch (_) {}
  }

  function onKeyDown(e) {
    if (!e || e.ctrlKey || e.metaKey) return;
    if (!e.altKey || !e.shiftKey) return;
    const k = String(e.key || '');
    const c = String(e.code || '');
    if (k === 'Alt' || k === 'Shift' || /^Alt(Left|Right)$/.test(c) || /^Shift(Left|Right)$/.test(c)) fire(e);
  }
  function onKeyUp(e) {
    const k = String(e?.key || '');
    if (k === 'Alt' || k === 'Shift' || !e?.altKey || !e?.shiftKey) latched = false;
  }
  function reset() { latched = false; }

  // Dos puntos de captura para sobrevivir a webs que instalan manejadores agresivos.
  window.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  document.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', reset, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); }, true);
})();
