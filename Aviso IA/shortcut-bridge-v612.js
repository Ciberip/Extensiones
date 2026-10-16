(() => {
  'use strict';
  if (window.__CIBERIP_HUD_BRIDGE_V612__) return;
  window.__CIBERIP_HUD_BRIDGE_V612__ = true;

  let lastTriggerAt = 0;
  let isolatedLatch = false;

  const runtimeOk = () => {
    try { return !!chrome?.runtime?.id && typeof chrome.runtime.sendMessage === 'function'; }
    catch (_) { return false; }
  };
  const send = msg => {
    try { return chrome.runtime.sendMessage(msg); }
    catch (_) { return Promise.resolve(null); }
  };

  function trigger(source) {
    const now = Date.now();
    if (now - lastTriggerAt < 320) return;
    lastTriggerAt = now;
    if (!runtimeOk()) return;

    if (window.top === window) {
      const c = window.__CGPT_HUD_CONTROLLER__;
      if (c && typeof c.show === 'function' && typeof c.hide === 'function') {
        const target = !c.visible;
        try { target ? c.show() : c.hide(); } catch (_) {}
        send({ type:'V612_SET_HUD_VISIBILITY', visible:target, source }).then(r => {
          if (!r || !window.__CGPT_HUD_CONTROLLER__) return;
          if (r.blocked || r.disabled || r.ok === false) {
            try { window.__CGPT_HUD_CONTROLLER__.hide(); } catch (_) {}
            return;
          }
          if (typeof r.visible === 'boolean' && r.visible !== window.__CGPT_HUD_CONTROLLER__.visible) {
            try { r.visible ? window.__CGPT_HUD_CONTROLLER__.show() : window.__CGPT_HUD_CONTROLLER__.hide(); } catch (_) {}
          }
        }).catch(() => {});
        return;
      }
    }

    // Si el HUD aún no está montado o el foco está en un iframe, el background lo monta arriba.
    send({ type:'V612_TOGGLE_HUD', source }).catch(() => {});
  }

  window.addEventListener('message', e => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__ciberipHudV612 !== true || d.type !== 'ALT_SHIFT_TOGGLE') return;
    trigger('main-world-v612');
  }, true);

  // Fallback aislado: si una web/CSP impide el script MAIN, seguimos capturando aquí.
  function onKeyDown(e) {
    if (!runtimeOk() || !e || e.ctrlKey || e.metaKey || isolatedLatch) return;
    if (!e.altKey || !e.shiftKey) return;
    const k = String(e.key || '');
    const c = String(e.code || '');
    if (!(k === 'Alt' || k === 'Shift' || /^Alt(Left|Right)$/.test(c) || /^Shift(Left|Right)$/.test(c))) return;
    isolatedLatch = true;
    trigger('isolated-v612');
  }
  function release(e) {
    const k = String(e?.key || '');
    if (k === 'Alt' || k === 'Shift' || !e?.altKey || !e?.shiftKey) isolatedLatch = false;
  }
  window.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', release, true);
  document.addEventListener('keyup', release, true);
  window.addEventListener('blur', () => { isolatedLatch = false; }, true);
})();
