(() => {
  'use strict';
  if (window.__CGPT_V62_DETECTOR__) return;
  window.__CGPT_V62_DETECTOR__ = true;

  const NET_EVENT = '__cgpt_v62_network__';
  const NAV_EVENT = '__cgpt_v62_navigation__';
  const PAGE_SESSION = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const NO_EVIDENCE_TIMEOUT_MS = 60 * 1000;
  const MAX_ACTIVE_MS = 30 * 60 * 1000;

  const S = {
    ready: false,
    dead: false,
    active: false,
    seq: 0,
    requestId: '',
    source: '',
    startedAt: 0,
    finishedAt: 0,
    lastUserIntentAt: 0,
    lastExplicitStartAt: 0,
    assistantStartFp: '',
    assistantChanged: false,
    lastAssistantFp: '',
    busySeen: false,
    busyNow: false,
    busyEndedAt: 0,
    networkSeen: false,
    networkActive: new Set(),
    evidenceSeen: false,
    lastEvidenceAt: 0,
    lastAssistantChangeAt: 0,
    lastStateSendAt: 0,
    stateTimer: null,
    evaluateTimer: null,
    monitorTimer: null,
    observer: null,
    titleTimer: null,
    originalTitle: '',
    doneVisualTimer: null,
    doneFaviconObserver: null,
    doneVisualBaseTitle: '',
    normalFaviconHref: '',
    currentUrl: location.href,
    currentRoute: '',
    cycleStartRoute: '',
    restoredPreview: ''
  };

  const norm = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const text = value => String(value || '').replace(/\s+/g, ' ').trim();

  function runtimeAvailable() {
    try {
      const r = globalThis.chrome?.runtime;
      return !!r?.id && typeof r.sendMessage === 'function';
    } catch (_) { return false; }
  }

  function isContextError(err) {
    return /extension context invalidated|receiving end does not exist|message port closed|cannot read propert/i
      .test(String(err?.message || err || ''));
  }

  function die() {
    if (S.dead) return;
    S.dead = true;
    clearTimeout(S.stateTimer);
    clearTimeout(S.evaluateTimer);
    clearTimeout(S.monitorTimer);
    clearInterval(S.titleTimer);
    clearInterval(S.doneVisualTimer);
    try { S.doneFaviconObserver?.disconnect(); } catch (_) {}
    try { S.observer?.disconnect(); } catch (_) {}
  }

  async function send(message) {
    if (S.dead || !runtimeAvailable()) { die(); return null; }
    try { return await globalThis.chrome.runtime.sendMessage(message); }
    catch (err) { if (isContextError(err) || !runtimeAvailable()) die(); return null; }
  }

  async function getSettings(defaults) {
    if (S.dead || !runtimeAvailable()) return defaults;
    try {
      const sync = globalThis.chrome?.storage?.sync;
      if (!sync?.get) return defaults;
      return await sync.get(defaults);
    } catch (err) {
      if (isContextError(err)) die();
      return defaults;
    }
  }

  function routeKey(rawUrl = location.href) {
    try {
      const u = new URL(String(rawUrl || location.href), location.href);
      return `${u.origin}${u.pathname.replace(/\/+$/, '') || '/'}`;
    } catch (_) { return String(rawUrl || '').split(/[?#]/)[0]; }
  }

  function isConversationRoute(route) {
    try { return /\/c\/[^/]+/i.test(new URL(route).pathname); }
    catch (_) { return /\/c\/[^/]+/i.test(String(route || '')); }
  }

  function visible(el) {
    if (!(el instanceof Element)) return false;
    try {
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 || r.height > 0;
    } catch (_) { return false; }
  }

  function assistantSnapshot() {
    const nodes = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    const last = nodes[nodes.length - 1];
    const t = text(last?.innerText || last?.textContent || '');
    return { count: nodes.length, value: t, fp: `${nodes.length}:${t.length}:${t.slice(-350)}` };
  }

  function preview(max = 700) {
    const nodes = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    for (let i = nodes.length - 1; i >= 0; i--) {
      const t = text(nodes[i]?.innerText || nodes[i]?.textContent || '');
      if (t) return t.length > max ? `${t.slice(0, max - 1)}…` : t;
    }
    return '';
  }

  function cleanTitle(raw) {
    let t = text(raw).replace(/^\s*\[LISTO\]\s*/i, '').replace(/^\s*[✓●•]\s*/, '');
    t = t.replace(/\s*[|\-–—]\s*ChatGPT\s*$/i, '').replace(/^ChatGPT\s*[|\-–—:]\s*/i, '').trim();
    if (!t || /^(chatgpt|nuevo chat|new chat)$/i.test(t)) return '';
    return t.slice(0, 100);
  }

  function chatTitle() {
    const fromDocument = cleanTitle(document.title);
    if (fromDocument) return fromDocument;
    const selectors = [
      '[data-testid="conversation-title"]',
      'nav a[aria-current="page"]',
      'a[data-sidebar-item="true"][aria-current="page"]'
    ];
    for (const sel of selectors) {
      try {
        const t = text(document.querySelector(sel)?.textContent || '');
        if (t && t.length < 120) return t;
      } catch (_) {}
    }
    return 'ChatGPT';
  }

  function busyDom() {
    const selectors = [
      'button[data-testid*="stop" i]',
      'button[aria-label*="stop" i]',
      'button[aria-label*="detener" i]',
      'button[title*="stop" i]',
      'button[title*="detener" i]'
    ];
    for (const sel of selectors) {
      try {
        for (const el of document.querySelectorAll(sel)) if (visible(el)) return true;
      } catch (_) {}
    }
    for (const el of document.querySelectorAll('button')) {
      if (!visible(el)) continue;
      const t = norm(`${el.textContent || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`);
      if (/\b(stop|detener|cancelar|cancel)\b/.test(t)) return true;
    }
    return false;
  }

  function activityText() {
    const re = /pensando|thinking|buscando|searching|leyendo|reading|analizando|analyzing|analysing|razonando|reasoning|navegando|browsing|ejecutando|running|generando|generating|escribiendo|writing|investigando|researching|trabajando|working/i;
    const selectors = [
      '[role="status"]', '[aria-live="polite"]', '[aria-live="assertive"]',
      '[data-testid*="status" i]', '[data-testid*="think" i]',
      '[data-testid*="search" i]', '[data-testid*="progress" i]'
    ];
    for (const sel of selectors) {
      try {
        for (const el of document.querySelectorAll(sel)) {
          if (!visible(el)) continue;
          const t = text(el.textContent || '');
          if (t.length >= 2 && t.length <= 180 && re.test(t)) return t.slice(0, 180);
        }
      } catch (_) {}
    }
    if (S.active) {
      if (S.busyNow) return 'Generando respuesta…';
      if (S.networkActive.size) return 'Recibiendo respuesta…';
      return 'Trabajando…';
    }
    return S.finishedAt ? 'Respuesta terminada' : 'En espera';
  }

  function makeRequestId() {
    S.seq += 1;
    return `${PAGE_SESSION}:${S.seq}:${Date.now().toString(36)}`;
  }

  function markEvidence() {
    S.evidenceSeen = true;
    S.lastEvidenceAt = Date.now();
  }

  function statusPayload() {
    return {
      type: 'V62_TAB_STATE',
      requestId: S.requestId || '',
      status: S.active ? 'working' : (S.finishedAt ? 'done' : 'idle'),
      chatTitle: chatTitle(),
      preview: preview(),
      activityText: activityText(),
      startedAt: S.startedAt || null,
      finishedAt: S.finishedAt || null,
      evidenceSeen: !!S.evidenceSeen,
      lastEvidenceAt: S.lastEvidenceAt || null,
      chatKey: S.currentRoute || routeKey(location.href),
      url: location.href
    };
  }

  function sendState(force = false) {
    if (S.dead || !S.ready) return;
    const now = Date.now();
    const go = () => {
      S.stateTimer = null;
      S.lastStateSendAt = Date.now();
      send(statusPayload());
    };
    clearTimeout(S.stateTimer);
    if (force || now - S.lastStateSendAt >= 600) go();
    else S.stateTimer = setTimeout(go, 650);
  }

  function resetLocalIdle(nextUrl = location.href) {
    clearTimeout(S.monitorTimer);
    clearTimeout(S.evaluateTimer);
    S.monitorTimer = null;
    S.evaluateTimer = null;
    S.networkActive.clear();
    S.active = false;
    S.requestId = '';
    S.source = '';
    S.startedAt = 0;
    S.finishedAt = 0;
    S.assistantChanged = false;
    S.busySeen = false;
    S.busyNow = false;
    S.busyEndedAt = 0;
    S.networkSeen = false;
    S.evidenceSeen = false;
    S.lastEvidenceAt = 0;
    S.restoredPreview = '';
    S.currentUrl = String(nextUrl || location.href);
    S.currentRoute = routeKey(S.currentUrl);
    S.cycleStartRoute = S.currentRoute;
    const snap = assistantSnapshot();
    S.assistantStartFp = snap.fp;
    S.lastAssistantFp = snap.fp;
    S.lastAssistantChangeAt = Date.now();
  }

  function startCycle(source) {
    if (S.dead) return;
    const now = Date.now();

    // Click/Enter/submit del mismo envío no crean varios ciclos.
    if (S.active && now - S.startedAt < 2500) return;

    // Si llega una nueva acción explícita cuando un ciclo viejo sigue colgado, se cancela sin avisar.
    if (S.active && S.requestId) cancelCycle('superseded');

    const snap = assistantSnapshot();
    S.active = true;
    S.requestId = makeRequestId();
    S.source = source;
    S.startedAt = now;
    clearDoneTabVisual();
    S.finishedAt = 0;
    S.cycleStartRoute = S.currentRoute || routeKey(location.href);
    S.assistantStartFp = snap.fp;
    S.lastAssistantFp = snap.fp;
    S.assistantChanged = false;
    S.busySeen = false;
    S.busyNow = busyDom();
    S.busyEndedAt = 0;
    S.networkSeen = false;
    S.networkActive.clear();
    S.evidenceSeen = false;
    S.lastEvidenceAt = 0;
    S.lastAssistantChangeAt = now;
    S.restoredPreview = preview();

    if (S.busyNow) {
      S.busySeen = true;
      markEvidence();
    }

    send({
      type: 'V62_REQUEST_STARTED',
      requestId: S.requestId,
      source,
      chatTitle: chatTitle(),
      preview: S.restoredPreview,
      activityText: 'Iniciando…',
      startedAt: now,
      chatKey: S.currentRoute,
      url: location.href
    });
    sendState(true);
    scheduleMonitor(220);
  }

  function markUserIntent(source) {
    const now = Date.now();
    if (now - S.lastExplicitStartAt < 260) return;
    S.lastExplicitStartAt = now;
    S.lastUserIntentAt = now;
    startCycle(source);
  }

  function doneFaviconDataUrl() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#08a35a"/><path d="M17 33.5 27.5 44 48 21" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  function stripDoneMarker(raw) {
    return text(raw).replace(/^\s*\[LISTO\]\s*/i, '').trim();
  }

  function normalFaviconHref() {
    try {
      const links = [...document.querySelectorAll('link[rel]')]
        .filter(link => {
          const rel = String(link.getAttribute('rel') || '').toLowerCase();
          return rel.includes('icon')
            && link.id !== 'ciberip-done-tab-favicon'
            && link.id !== 'ciberip-normal-tab-favicon';
        });
      const href = links.map(link => link.href || link.getAttribute('href') || '').find(Boolean);
      if (href) S.normalFaviconHref = href;
    } catch (_) {}
    return S.normalFaviconHref || `${location.origin}/favicon.ico`;
  }

  function ensureDoneFavicon() {
    try {
      // Si acabamos de restaurar el icono normal, el verde vuelve a ser el último favicon efectivo.
      document.getElementById('ciberip-normal-tab-favicon')?.remove();
      normalFaviconHref();
      let link = document.getElementById('ciberip-done-tab-favicon');
      if (!link) {
        link = document.createElement('link');
        link.id = 'ciberip-done-tab-favicon';
        link.rel = 'icon';
        link.type = 'image/svg+xml';
        (document.head || document.documentElement).appendChild(link);
      }
      const href = doneFaviconDataUrl();
      if (link.getAttribute('href') !== href) link.setAttribute('href', href);
      // Mantenerlo como último favicon para que ChatGPT no lo pise al actualizar su head.
      const parent = document.head || document.documentElement;
      if (parent && parent.lastElementChild !== link) parent.appendChild(link);
    } catch (_) {}
  }

  function startDoneFaviconWatch() {
    try { S.doneFaviconObserver?.disconnect(); } catch (_) {}
    S.doneFaviconObserver = null;
    try {
      const target = document.head || document.documentElement;
      if (!target) return;
      S.doneFaviconObserver = new MutationObserver(() => {
        if (!S.finishedAt || S.active || S.dead) return;
        queueMicrotask(enforceDoneTabVisual);
      });
      S.doneFaviconObserver.observe(target, {
        subtree:true,
        childList:true,
        attributes:true,
        attributeFilter:['href','rel','type']
      });
    } catch (_) {}
  }

  function restoreNormalFavicon() {
    try {
      document.getElementById('ciberip-done-tab-favicon')?.remove();
      const href = normalFaviconHref();
      let link = document.getElementById('ciberip-normal-tab-favicon');
      if (!link) {
        link = document.createElement('link');
        link.id = 'ciberip-normal-tab-favicon';
        link.rel = 'icon';
        (document.head || document.documentElement).appendChild(link);
      }
      // Un enlace normal colocado el último fuerza a Chrome a abandonar inmediatamente el favicon verde.
      link.type = '';
      link.href = href;
      const parent = document.head || document.documentElement;
      if (parent && parent.lastElementChild !== link) parent.appendChild(link);
    } catch (_) {}
  }

  function enforceDoneTabVisual() {
    if (!S.finishedAt || S.active || S.dead) return;
    try {
      const current = stripDoneMarker(document.title);
      if (current && current !== 'ChatGPT ha terminado') S.doneVisualBaseTitle = current;
      const base = S.doneVisualBaseTitle || cleanTitle(document.title) || 'ChatGPT';
      const wanted = `[LISTO] ${base}`;
      if (document.title !== wanted) document.title = wanted;
      ensureDoneFavicon();
    } catch (_) {}
  }

  function applyDoneTabVisual() {
    if (S.dead) return;
    const current = stripDoneMarker(document.title);
    if (current && current !== 'ChatGPT ha terminado') S.doneVisualBaseTitle = current;
    clearInterval(S.doneVisualTimer);
    normalFaviconHref();
    enforceDoneTabVisual();
    startDoneFaviconWatch();
    // Respaldo ante reemplazos completos de <head> o mutaciones que el observer anterior no vea.
    S.doneVisualTimer = setInterval(enforceDoneTabVisual, 350);
  }

  function clearDoneTabVisual() {
    clearInterval(S.doneVisualTimer);
    S.doneVisualTimer = null;
    try { S.doneFaviconObserver?.disconnect(); } catch (_) {}
    S.doneFaviconObserver = null;
    try {
      restoreNormalFavicon();
      const current = stripDoneMarker(document.title);
      document.title = S.doneVisualBaseTitle || current || 'ChatGPT';
    } catch (_) {}
    S.doneVisualBaseTitle = '';
  }

  async function flashTitle() {
    const cfg = await getSettings({ enabled: true, showTitleFlash: true });
    if (S.dead || !cfg.enabled || !cfg.showTitleFlash || !document.hidden) return;
    clearInterval(S.titleTimer);
    S.originalTitle = document.title;
    let flip = false;
    let n = 0;
    S.titleTimer = setInterval(() => {
      if (!document.hidden || ++n > 10) {
        clearInterval(S.titleTimer);
        S.titleTimer = null;
        document.title = S.originalTitle;
        return;
      }
      document.title = flip ? S.originalTitle : '✓ ChatGPT ha terminado';
      flip = !flip;
    }, 500);
  }

  function finishCycle(reason) {
    if (S.dead || !S.active || !S.requestId || !S.evidenceSeen) return;
    const requestId = S.requestId;
    S.active = false;
    S.finishedAt = Date.now();
    S.networkActive.clear();
    clearTimeout(S.monitorTimer);
    S.monitorTimer = null;

    send({
      type: 'V62_REQUEST_FINISHED',
      requestId,
      reason,
      chatTitle: chatTitle(),
      preview: preview(),
      activityText: 'Respuesta terminada',
      startedAt: S.startedAt,
      finishedAt: S.finishedAt,
      evidenceSeen: true,
      lastEvidenceAt: S.lastEvidenceAt || Date.now(),
      chatKey: S.currentRoute || routeKey(location.href),
      url: location.href
    }).then(() => sendState(true));
    applyDoneTabVisual();
  }

  function cancelCycle(reason) {
    if (S.dead || !S.active) return;
    const requestId = S.requestId;
    const oldUrl = location.href;
    S.active = false;
    S.networkActive.clear();
    clearTimeout(S.monitorTimer);
    S.monitorTimer = null;
    send({
      type:'V62_REQUEST_CANCELLED',
      requestId,
      reason,
      chatTitle:chatTitle(),
      chatKey:S.currentRoute || routeKey(oldUrl),
      url:oldUrl
    });
    S.requestId = '';
    S.startedAt = 0;
    S.finishedAt = 0;
    S.evidenceSeen = false;
    S.lastEvidenceAt = 0;
    S.assistantChanged = false;
    S.busySeen = false;
    S.busyNow = false;
    S.networkSeen = false;
    sendState(true);
  }

  function inspectDom() {
    if (!S.active) return;
    const now = Date.now();
    const snap = assistantSnapshot();
    if (snap.fp !== S.assistantStartFp) {
      if (!S.assistantChanged || snap.fp !== S.lastAssistantFp) {
        S.lastAssistantChangeAt = now;
        markEvidence();
      }
      S.assistantChanged = true;
      S.lastAssistantFp = snap.fp;
    }

    const busy = busyDom();
    if (busy) {
      S.busySeen = true;
      S.busyNow = true;
      S.busyEndedAt = 0;
      markEvidence();
    } else if (S.busyNow) {
      S.busyNow = false;
      S.busyEndedAt = now;
    }
  }

  function canFinishNow() {
    if (!S.active || !S.evidenceSeen) return false;
    const now = Date.now();
    inspectDom();
    if (S.busyNow) return false;

    const stableFor = now - Math.max(S.lastAssistantChangeAt || S.startedAt, S.busyEndedAt || 0);
    const age = now - S.startedAt;

    // La ruta primaria: stream terminado + DOM estable.
    if (S.networkActive.size === 0 && stableFor >= 500 && age >= 500) return true;

    // Respaldo importante de v6.2: una petición secundaria de red no puede dejar el HUD
    // eternamente en TRABAJANDO si el botón de detener ya desapareció y el DOM se asentó.
    if (S.networkActive.size > 0 && stableFor >= 1400 && age >= 1800) return true;

    // También cubre respuestas donde no conseguimos observar el stream pero sí hubo UI ocupada.
    if (!S.networkSeen && S.busySeen && stableFor >= 850 && age >= 900) return true;
    return false;
  }

  function scheduleMonitor(delay = 450) {
    if (!S.active || S.dead) return;
    clearTimeout(S.monitorTimer);
    const requestId = S.requestId;
    S.monitorTimer = setTimeout(function probe() {
      if (S.dead || !S.active || S.requestId !== requestId) return;
      const age = Date.now() - S.startedAt;
      inspectDom();

      if (!S.evidenceSeen && age >= NO_EVIDENCE_TIMEOUT_MS) {
        cancelCycle('no-evidence-timeout');
        return;
      }
      if (age >= MAX_ACTIVE_MS) {
        if (S.evidenceSeen && !S.busyNow) finishCycle('max-time');
        else cancelCycle('max-time-no-finish');
        return;
      }
      if (canFinishNow()) {
        finishCycle(S.networkActive.size ? 'dom-stable-network-stuck' : 'settled');
        return;
      }
      sendState();
      S.monitorTimer = setTimeout(probe, age < 5000 ? 350 : 700);
    }, delay);
  }

  function evaluateNow() {
    S.evaluateTimer = null;
    if (S.dead || !S.ready) return;
    if (routeKey(location.href) !== (S.currentRoute || routeKey(S.currentUrl))) {
      resetForNavigation(location.href);
      return;
    }
    if (S.active) {
      inspectDom();
      scheduleMonitor(180);
    }
    sendState();
  }

  function scheduleEvaluate() {
    if (S.dead || !S.ready) return;
    if (S.evaluateTimer) return;
    S.evaluateTimer = setTimeout(evaluateNow, 120);
  }

  function isPromptTarget(target) {
    if (!(target instanceof Element)) return false;
    const editor = target.closest('textarea, [contenteditable="true"]');
    if (!editor) return false;
    const form = editor.closest('form');
    if (form) return true;
    const parentText = norm(editor.parentElement?.parentElement?.textContent || '');
    return !/buscar chats|search chats/.test(parentText);
  }

  function likelySendButton(target) {
    const button = target instanceof Element ? target.closest('button') : null;
    if (!button) return false;
    const t = norm(`${button.getAttribute('data-testid') || ''} ${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''} ${button.textContent || ''}`);
    return /(send|enviar|submit)/.test(t) && !/(stop|detener|cancel)/.test(t);
  }

  function likelyRetryButton(target) {
    const button = target instanceof Element ? target.closest('button') : null;
    if (!button) return false;
    const t = norm(`${button.getAttribute('data-testid') || ''} ${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''} ${button.textContent || ''}`);
    return /(regenerate|regenerar|retry|reintentar|try again|intentar de nuevo|continue generating|continuar generando)/.test(t);
  }

  function resetForNavigation(nextUrl) {
    if (S.dead) return;
    const nextRoute = routeKey(nextUrl);
    const oldRoute = S.currentRoute || routeKey(S.currentUrl);
    if (nextRoute === oldRoute) {
      S.currentUrl = String(nextUrl || location.href);
      return;
    }

    const now = Date.now();
    const materializedNewChat = S.active
      && !isConversationRoute(S.cycleStartRoute || oldRoute)
      && isConversationRoute(nextRoute)
      && now - S.startedAt < 30000;

    S.currentUrl = String(nextUrl || location.href);
    S.currentRoute = nextRoute;

    if (materializedNewChat) {
      S.cycleStartRoute = nextRoute;
      sendState(true);
      return;
    }

    if (S.active) cancelCycle('navigation');
    resetLocalIdle(nextUrl);
    sendState(true);
  }

  function hydrateFromBackground(rawState) {
    const currentRoute = routeKey(location.href);
    S.currentUrl = location.href;
    S.currentRoute = currentRoute;
    S.cycleStartRoute = currentRoute;

    const state = rawState || {};
    if (state.status !== 'working' || !state.requestId || !state.startedAt) {
      if (state.status === 'done' && state.finishedAt) {
        S.active = false;
        S.requestId = String(state.requestId || '');
        S.startedAt = Number(state.startedAt) || 0;
        S.finishedAt = Number(state.finishedAt) || 0;
        S.evidenceSeen = !!state.evidenceSeen;
        S.lastEvidenceAt = Number(state.lastEvidenceAt) || 0;
        applyDoneTabVisual();
      } else {
        clearDoneTabVisual();
        resetLocalIdle(location.href);
      }
      return;
    }

    S.active = true;
    S.requestId = String(state.requestId);
    S.source = 'restored-after-reload';
    S.startedAt = Number(state.startedAt) || Date.now();
    S.finishedAt = 0;
    S.cycleStartRoute = state.chatKey || currentRoute;
    S.evidenceSeen = !!state.evidenceSeen;
    S.lastEvidenceAt = Number(state.lastEvidenceAt) || 0;
    S.restoredPreview = String(state.preview || '');
    S.networkActive.clear();
    S.networkSeen = false;

    const snap = assistantSnapshot();
    S.assistantStartFp = snap.fp;
    S.lastAssistantFp = snap.fp;
    S.assistantChanged = false;
    S.lastAssistantChangeAt = Date.now();
    S.busyNow = busyDom();
    S.busySeen = S.busyNow;
    S.busyEndedAt = 0;
    if (S.busyNow) markEvidence();

    const currentPreview = preview();
    if (currentPreview && currentPreview !== S.restoredPreview) {
      S.assistantChanged = true;
      markEvidence();
    }

    scheduleMonitor(250);
  }

  document.addEventListener('keydown', e => {
    if (S.dead || e.isComposing || e.repeat) return;
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isPromptTarget(e.target)) markUserIntent('enter');
  }, true);

  document.addEventListener('pointerdown', e => {
    if (S.dead) return;
    if (likelySendButton(e.target)) markUserIntent('send-pointer');
    else if (likelyRetryButton(e.target)) markUserIntent('retry-pointer');
  }, true);

  document.addEventListener('click', e => {
    if (S.dead) return;
    if (likelySendButton(e.target)) markUserIntent('send-click');
    else if (likelyRetryButton(e.target)) markUserIntent('retry-click');
  }, true);

  document.addEventListener('submit', e => {
    if (S.dead) return;
    const form = e.target instanceof Element ? e.target : null;
    if (form?.querySelector('textarea, [contenteditable="true"]')) markUserIntent('form-submit');
  }, true);

  window.addEventListener(NAV_EVENT, e => {
    if (S.dead) return;
    resetForNavigation(e?.detail?.url || location.href);
  }, true);
  window.addEventListener('popstate', () => resetForNavigation(location.href), true);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && S.finishedAt && !S.active) enforceDoneTabVisual();
  }, true);
  window.addEventListener('pageshow', () => {
    if (S.finishedAt && !S.active) enforceDoneTabVisual();
  }, true);

  window.addEventListener(NET_EVENT, e => {
    if (S.dead) return;
    const d = e.detail || {};
    const token = String(d.token || '');
    if (!token) return;

    if (d.phase === 'start') {
      // Nunca una petición interna abre un ciclo sola. Solo sirve como respaldo si hubo
      // una acción explícita del usuario hace muy poco.
      if (!S.active && Date.now() - S.lastUserIntentAt < 5000) startCycle('network-after-intent');
      if (!S.active) return;
      S.networkSeen = true;
      S.networkActive.add(token);
      scheduleMonitor(250);
      sendState();
    } else if (d.phase === 'end') {
      if (!S.active) return;
      S.networkActive.delete(token);
      scheduleMonitor(120);
      sendState();
    }
  }, true);

  if (runtimeAvailable()) {
    try {
      globalThis.chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg?.type === 'V613_APPLY_DONE_TAB_VISUAL') {
          applyDoneTabVisual();
          try { sendResponse?.({ ok:true, applied:true }); } catch (_) {}
          return false;
        }
        if (msg?.type === 'V613_CLEAR_DONE_TAB_VISUAL') {
          S.finishedAt = 0;
          clearDoneTabVisual();
          try { sendResponse?.({ ok:true, cleared:true }); } catch (_) {}
          return false;
        }
        return false;
      });
    } catch (_) {}
  }

  async function boot() {
    if (S.dead) return;
    S.currentUrl = location.href;
    S.currentRoute = routeKey(location.href);
    S.cycleStartRoute = S.currentRoute;
    S.ready = true;

    const ready = await send({ type:'V62_DETECTOR_READY', chatTitle:chatTitle(), url:location.href });
    if (S.dead) return;
    hydrateFromBackground(ready?.rawState || null);

    S.observer = new MutationObserver(scheduleEvaluate);
    S.observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-busy', 'aria-label', 'data-testid', 'disabled']
    });
    scheduleEvaluate();
    sendState(true);
  }

  if (document.documentElement) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once:true });
})();
