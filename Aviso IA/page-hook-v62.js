(() => {
  'use strict';
  if (window.__CGPT_V62_NET_HOOK__) return;
  window.__CGPT_V62_NET_HOOK__ = true;

  const EVENT = '__cgpt_v62_network__';
  const NAV_EVENT = '__cgpt_v62_navigation__';
  let seq = 0;

  const absoluteUrl = url => {
    try { return new URL(String(url || ''), location.href).href; }
    catch (_) { return String(url || ''); }
  };

  const likelyConversationRequest = (url, method) => {
    if (String(method || 'GET').toUpperCase() !== 'POST') return false;
    const u = absoluteUrl(url).toLowerCase();
    if (!/\/(?:conversation|responses|chat|messages|completion|generate|stream|api|assistant)(?:\/|\?|$)/.test(u)) return false;
    if (/(?:\/feedback|\/share|\/rename|\/title|\/moderation|\/rating|\/telemetry|\/analytics)/.test(u)) return false;
    return /(?:\/conversation(?:\/|\?|$)|\/responses(?:\/|\?|$)|\/chat(?:\/|\?|$)|\/messages(?:\/|\?|$)|\/completion(?:\/|\?|$)|\/generate(?:\/|\?|$)|\/stream(?:\/|\?|$))/.test(u);
  };

  const emit = (phase, token, url) => {
    try {
      window.dispatchEvent(new CustomEvent(EVENT, {
        detail: { phase, token, url:String(url || '').slice(0, 500), at:Date.now() }
      }));
    } catch (_) {}
  };

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = async function(input, init) {
      const rawUrl = typeof input === 'string' ? input : (input?.url || '');
      const url = absoluteUrl(rawUrl);
      const method = init?.method || input?.method || 'GET';
      if (!likelyConversationRequest(url, method)) return originalFetch.apply(this, arguments);

      const token = `f-${Date.now()}-${++seq}`;
      emit('start', token, url);
      try {
        const response = await originalFetch.apply(this, arguments);
        try {
          const clone = response.clone();
          Promise.resolve(clone.arrayBuffer())
            .then(() => emit('end', token, url))
            .catch(() => emit('end', token, url));
        } catch (_) {
          emit('end', token, url);
        }
        return response;
      } catch (err) {
        emit('end', token, url);
        throw err;
      }
    };
  }

  try {
    const XHR = window.XMLHttpRequest;
    if (XHR?.prototype) {
      const open = XHR.prototype.open;
      const send = XHR.prototype.send;
      XHR.prototype.open = function(method, url) {
        this.__cgptV62 = { method, url:absoluteUrl(url) };
        return open.apply(this, arguments);
      };
      XHR.prototype.send = function() {
        const meta = this.__cgptV62 || {};
        if (!likelyConversationRequest(meta.url, meta.method)) return send.apply(this, arguments);
        const token = `x-${Date.now()}-${++seq}`;
        emit('start', token, meta.url);
        this.addEventListener('loadend', () => emit('end', token, meta.url), { once:true });
        return send.apply(this, arguments);
      };
    }
  } catch (_) {}

  try {
    const emitNav = () => {
      try { window.dispatchEvent(new CustomEvent(NAV_EVENT, { detail:{ url:location.href, at:Date.now() } })); }
      catch (_) {}
    };
    const pushState = history.pushState;
    const replaceState = history.replaceState;
    history.pushState = function() {
      const out = pushState.apply(this, arguments);
      queueMicrotask(emitNav);
      return out;
    };
    history.replaceState = function() {
      const out = replaceState.apply(this, arguments);
      queueMicrotask(emitNav);
      return out;
    };
    window.addEventListener('popstate', emitNav, true);
  } catch (_) {}
})();
