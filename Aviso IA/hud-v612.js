(() => {
  'use strict';

  const VERSION = '6.16.0';
  const HOST_ID = '__cgpt-v612-hud-host';
  const POS_KEY = 'v67-hud-position';
  const COLLAPSED_KEY = 'v67-hud-collapsed';

  try { window.__CGPT_HUD_CONTROLLER__?.destroy?.(); } catch (_) {}
  for (const id of ['__cgpt-v62-hud-host','__cgpt-v64-hud-host','__cgpt-v65-hud-host','__cgpt-v66-hud-host','__cgpt-v67-hud-host','__cgpt-v68-hud-host','__cgpt-v69-hud-host','__cgpt-v610-hud-host','__cgpt-v611-hud-host',HOST_ID]) {
    try { document.getElementById(id)?.remove(); } catch (_) {}
  }

  let dead = false;
  let visibleHud = false;
  let tabs = [];
  let root = null;
  let shadow = null;
  let tick = null;
  let toastTimer = null;
  let completionTimer = null;
  let messageHandler = null;
  let uiPrefsLoaded = false;
  let uiPrefsPromise = null;
  let snapshotLoaded = false;
  let resizeHandler = null;
  let hudPosition = null;
  let collapsed = false;
  let dragging = null;
  let moveArmed = false;
  let dragMoved = false;
  let moveArmTimer = null;
  let completionRequestId = '';
  let completionShownAt = 0;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
  const trim = (s, n) => {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  };
  const statusRank = s => s === 'done' ? 0 : s === 'working' ? 1 : 2;

  function runtimeAvailable() {
    try { return !!globalThis.chrome?.runtime?.id && typeof chrome.runtime.sendMessage === 'function'; }
    catch (_) { return false; }
  }
  function isContextError(err) {
    return /extension context invalidated|receiving end does not exist|message port closed|cannot read propert/i.test(String(err?.message || err || ''));
  }
  async function send(message) {
    if (dead || !runtimeAvailable()) { destroy(); return null; }
    try { return await chrome.runtime.sendMessage(message); }
    catch (err) { if (isContextError(err) || !runtimeAvailable()) destroy(); return null; }
  }

  function elapsed(ts) {
    if (!ts) return '';
    let s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return `${s} s`;
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? `${h} h ${m} min` : `${m} min ${r} s`;
  }
  function duration(start, end) {
    if (!start || !end || end < start) return '';
    let s = Math.max(0, Math.round((end - start) / 1000));
    if (s < 60) return `${s} s`;
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? `${h} h ${m} min` : `${m} min ${r} s`;
  }
  function ago(ts) {
    if (!ts) return '';
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 5) return 'ahora';
    if (s < 60) return `hace ${s} s`;
    const m = Math.floor(s / 60);
    return m < 60 ? `hace ${m} min` : `hace ${Math.floor(m / 60)} h`;
  }

  function sortTabs() {
    tabs.sort((a,b) => statusRank(a.status) - statusRank(b.status)
      || (Number(b.finishedAt || 0) - Number(a.finishedAt || 0))
      || (Number(a.windowId || 0) - Number(b.windowId || 0))
      || (Number(a.index || 0) - Number(b.index || 0))
      || (Number(a.tabId || 0) - Number(b.tabId || 0)));
  }
  function mergeTab(tab) {
    if (!tab || !Number.isFinite(Number(tab.tabId))) return;
    const id = Number(tab.tabId);
    const i = tabs.findIndex(x => Number(x.tabId) === id);
    if (i >= 0) tabs[i] = { ...tabs[i], ...tab };
    else tabs.push({ ...tab, tabId:id });
    sortTabs();
    render();
  }
  function removeTab(tabId) {
    tabs = tabs.filter(t => Number(t.tabId) !== Number(tabId));
    render();
  }

  async function loadUiPrefs() {
    try {
      const data = await chrome.storage.local.get([POS_KEY, COLLAPSED_KEY]);
      const p = data[POS_KEY];
      if (p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))) {
        hudPosition = { x:Number(p.x), y:Number(p.y) };
      }
      collapsed = !!data[COLLAPSED_KEY];
    } catch (_) {}
    uiPrefsLoaded = true;
  }
  function ensureUiPrefs() {
    if (uiPrefsLoaded) return Promise.resolve();
    if (!uiPrefsPromise) uiPrefsPromise = loadUiPrefs().finally(() => { uiPrefsPromise = null; });
    return uiPrefsPromise;
  }
  async function savePosition() {
    try { if (hudPosition) await chrome.storage.local.set({ [POS_KEY]:hudPosition }); } catch (_) {}
  }
  async function saveCollapsed() {
    try { await chrome.storage.local.set({ [COLLAPSED_KEY]:collapsed }); } catch (_) {}
  }

  function applyHostVisibility(show) {
    if (!root) return;
    const css = {
      position:'fixed', inset:'0px', width:'100vw', height:'100vh',
      zIndex:'2147483647', pointerEvents:'none', margin:'0', padding:'0',
      border:'0', overflow:'visible', opacity: show ? '1' : '0',
      display: show ? 'block' : 'none', visibility: show ? 'visible' : 'hidden',
      transform:'none', filter:'none', clip:'auto', clipPath:'none', contain:'none',
      isolation:'isolate'
    };
    for (const [k,v] of Object.entries(css)) {
      try { root.style.setProperty(k.replace(/[A-Z]/g,m=>'-'+m.toLowerCase()), v, 'important'); } catch (_) {}
    }
  }

  function hudHealth() {
    const deck = shadow?.querySelector('.deck');
    const r = deck?.getBoundingClientRect?.();
    const rect = r ? { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom } : null;
    const onScreen = !!(r && r.width > 20 && r.height > 20 && r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight);
    let rootStyle = null;
    try { rootStyle = root ? getComputedStyle(root) : null; } catch (_) {}
    return {
      mounted: !!root?.isConnected && !!deck,
      visible: !!visibleHud,
      painted: !!(rootStyle && rootStyle.display !== 'none' && rootStyle.visibility !== 'hidden' && Number(rootStyle.opacity || 1) > 0),
      onScreen,
      rect
    };
  }

  function repairPhysicalHud({ resetIfOffscreen = false } = {}) {
    if (!visibleHud) { applyHostVisibility(false); return hudHealth(); }
    ensure();
    applyHostVisibility(true);
    const deck = shadow?.querySelector('.deck');
    if (!deck) return hudHealth();
    deck.style.setProperty('display','block','important');
    deck.style.setProperty('visibility','visible','important');
    deck.style.setProperty('opacity','1','important');
    deck.style.setProperty('pointer-events','auto','important');
    let h = hudHealth();
    if (resetIfOffscreen && !h.onScreen) {
      hudPosition = null;
      collapsed = false;
      applyCollapsed();
      applyPosition();
      applyHostVisibility(true);
      try { chrome.storage.local.remove([POS_KEY, COLLAPSED_KEY]); } catch (_) {}
      h = hudHealth();
    }
    return h;
  }

  function ensure() {
    if (dead || root?.isConnected) return;
    root = document.createElement('div');
    root.id = HOST_ID;
    root.setAttribute('data-ciberip-hud', VERSION);
    const parent = document.documentElement || document.body;
    if (!parent) { root = null; setTimeout(() => { if (visibleHud && !dead) { ensure(); render(); } }, 0); return; }
    parent.appendChild(root);
    shadow = root.attachShadow({ mode:'open' });
    applyHostVisibility(false);
    shadow.innerHTML = `
      <style>
        :host{all:initial}*{box-sizing:border-box}
        button{font:inherit}
        .deck{--ink:#111827;--muted:#64748b;--line:#d9e1ec;--violet:#6558f5;--blue:#2563eb;--green:#0a8f5b;position:fixed;z-index:1;top:18px;right:18px;width:520px;max-width:calc(100vw - 24px);pointer-events:auto;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);filter:drop-shadow(0 22px 45px rgba(30,41,59,.18));transition:width .18s ease}
        .deck.collapsed{width:300px}
        .shell{overflow:hidden;border:1px solid rgba(203,213,225,.92);border-radius:24px;background:rgba(247,249,252,.96);backdrop-filter:blur(26px) saturate(1.25);box-shadow:0 20px 55px rgba(15,23,42,.14),inset 0 1px rgba(255,255,255,.95)}
        .grabbar{display:flex;align-items:center;gap:10px;min-height:56px;padding:10px 10px 10px 12px;background:linear-gradient(90deg,#ffffff 0%,#f6f7fb 60%,#eef2ff 100%);border-bottom:1px solid #dce3ec;cursor:default;user-select:none;touch-action:none}.grabbar.moveArmed{cursor:grab;box-shadow:inset 0 -2px #6558f5}.grabbar.dragging{cursor:grabbing}
        .grip{width:18px;height:30px;flex:none;opacity:.58;background-image:radial-gradient(circle,#64748b 1.15px,transparent 1.2px);background-size:6px 6px;background-position:center}
        .identity{min-width:0;display:flex;align-items:center;gap:9px;flex:1}.mark{display:grid;place-items:center;width:34px;height:34px;border-radius:11px;background:#111827;color:#fff;font-size:10px;font-weight:1000;letter-spacing:.06em;box-shadow:0 7px 15px rgba(17,24,39,.18)}.brand{min-width:0}.brand strong{display:block;font-size:13px;font-weight:950;letter-spacing:-.02em}.brand small{display:block;margin-top:2px;color:#7b8799;font-size:9.5px;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .summary{display:flex;align-items:center;gap:5px}.chip{display:flex;align-items:center;gap:5px;padding:6px 8px;border:1px solid #d8e0ea;border-radius:999px;background:#fff;color:#677489;font-size:9px;font-weight:950;white-space:nowrap}.chip i{display:block;width:6px;height:6px;border-radius:50%;background:#94a3b8}.chip.work i{background:#6d5af7;box-shadow:0 0 0 3px rgba(109,90,247,.12)}.chip.done{border-color:#afe2ca;background:#effbf5;color:#087749}.chip.done i{background:#0ba866}
        .iconBtn{appearance:none;display:grid;place-items:center;width:34px;height:34px;flex:none;border:1px solid #d4dde8;border-radius:11px;background:#fff;color:#445268;cursor:pointer;box-shadow:0 3px 8px rgba(30,41,59,.04);transition:.14s}.iconBtn:hover{transform:translateY(-1px);border-color:#bac7d8;color:#111827}.iconBtn.move.active{border-color:#bdb5ff;background:#efedff;color:#5145d8;box-shadow:0 0 0 3px rgba(101,88,245,.10)}.iconBtn.close:hover{border-color:#f1b5b5;background:#fff5f5;color:#b42318}.iconBtn svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
        .body{padding:10px;max-height:min(72vh,720px);overflow:auto;scrollbar-width:thin;transition:max-height .18s ease,padding .18s ease}.deck.collapsed .body{max-height:0;padding-top:0;padding-bottom:0;overflow:hidden}.deck.collapsed .summary{display:none}.deck.collapsed .brand small{display:none}
        .completion{display:none;position:relative;overflow:hidden;margin:0 0 10px;padding:16px 16px 15px 80px;border-radius:18px;background:#0a8f5b;color:#fff;box-shadow:0 14px 30px rgba(10,143,91,.28)}.completion.show{display:block;animation:pop .38s cubic-bezier(.18,.9,.18,1)}.completion:before{content:"✓";position:absolute;left:15px;top:50%;transform:translateY(-50%);display:grid;place-items:center;width:52px;height:52px;border-radius:17px;background:#fff;color:#087749;font-size:30px;font-weight:1000;box-shadow:0 8px 18px rgba(2,80,49,.25)}.completion:after{content:"";position:absolute;right:-35px;top:-45px;width:130px;height:130px;border:20px solid rgba(255,255,255,.12);border-radius:50%}.completion b{position:relative;z-index:1;display:block;font-size:10px;letter-spacing:.16em}.completion strong{position:relative;z-index:1;display:block;margin-top:4px;font-size:20px;line-height:1.05;font-weight:1000;letter-spacing:-.03em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.completion span{position:relative;z-index:1;display:block;margin-top:6px;color:#dcffed;font-size:10.5px;font-weight:800}
        .cards{display:grid;gap:10px}.tabGroup{display:grid;gap:7px}.groupHead{display:flex;align-items:center;gap:8px;padding:3px 4px 1px;color:#64748b;font-size:9px;font-weight:950;letter-spacing:.06em;text-transform:uppercase}.groupDot{width:8px;height:8px;border-radius:50%;background:#94a3b8;box-shadow:0 0 0 3px rgba(148,163,184,.12)}.groupHead b{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#334155}.groupHead span.count{margin-left:auto;padding:2px 6px;border-radius:999px;background:#eef2f7;color:#66758a;font-size:8px}.group-blue .groupDot{background:#2563eb}.group-red .groupDot{background:#ef4444}.group-yellow .groupDot{background:#eab308}.group-green .groupDot{background:#16a34a}.group-pink .groupDot{background:#ec4899}.group-purple .groupDot{background:#8b5cf6}.group-cyan .groupDot{background:#06b6d4}.group-orange .groupDot{background:#f97316}.group-grey .groupDot{background:#64748b}.empty{padding:22px 14px;border:1px dashed #c9d4e2;border-radius:16px;background:#fff;color:#748197;font-size:11.5px;text-align:center}
        .task{position:relative;display:grid;grid-template-columns:44px minmax(0,1fr) auto;align-items:center;gap:10px;min-height:70px;padding:10px 10px 10px 11px;border:1px solid #dce4ee;border-radius:17px;background:#fff;cursor:pointer;transition:.15s ease;box-shadow:0 5px 14px rgba(30,41,59,.04)}.task:hover{transform:translateY(-1px);border-color:#c4d0de;box-shadow:0 9px 22px rgba(30,41,59,.08)}
        .statusBlock{display:grid;place-items:center;width:44px;height:44px;border-radius:14px;background:#f1f4f8;color:#758398;font-size:16px;font-weight:1000}.task.working{border-color:#c7c1ff;background:linear-gradient(110deg,#ffffff 0%,#faf9ff 58%,#f1efff 100%)}.task.working .statusBlock{background:#6558f5;color:#fff;box-shadow:0 7px 18px rgba(101,88,245,.24)}.spinner{width:18px;height:18px;border:2px solid rgba(255,255,255,.34);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite}
        .copy{min-width:0}.title{font-size:12.6px;font-weight:950;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.liveTimer{display:inline-flex;align-items:center;gap:6px;margin-top:6px;padding:4px 7px;border:1px solid #d6d0ff;border-radius:999px;background:#f0eeff;color:#5145d8;font:950 9.5px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.02em}.liveTimer i{width:6px;height:6px;border-radius:50%;background:#6558f5;box-shadow:0 0 0 3px rgba(101,88,245,.12);animation:pulseDot 1.1s ease-in-out infinite}.sub{display:flex;align-items:center;gap:7px;margin-top:5px;color:#7a879a;font-size:9.8px;font-weight:700;white-space:nowrap;overflow:hidden}.sub .activity{overflow:hidden;text-overflow:ellipsis}.time{font:900 9.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:#4e5d73}
        .actions{display:flex;align-items:center;gap:5px}.mini{appearance:none;border:1px solid #d7e0ea;border-radius:9px;background:#fff;color:#59687e;padding:7px 8px;font-size:9px;font-weight:900;cursor:pointer}.mini:hover{border-color:#c1ccda;color:#1f2937}.mini.exclude:hover{border-color:#e6c28b;background:#fff9ee;color:#955a08}
        .progress{position:absolute;left:65px;right:10px;bottom:0;height:2px;overflow:hidden;border-radius:999px;background:transparent}.working .progress{background:#e7e4ff}.working .progress i{display:block;width:32%;height:100%;background:#6558f5;animation:slide 1.2s ease-in-out infinite}
        .task.done{grid-template-columns:74px minmax(0,1fr) auto;min-height:96px;padding:12px 12px 12px 10px;border:0;background:linear-gradient(112deg,#063f31 0%,#08724c 42%,#0ba866 100%);color:#fff;box-shadow:0 12px 30px rgba(6,94,62,.26)}.task.done:hover{box-shadow:0 16px 36px rgba(6,94,62,.33)}.task.done:after{content:"";position:absolute;right:-42px;bottom:-54px;width:150px;height:150px;border:25px solid rgba(255,255,255,.08);border-radius:50%;pointer-events:none}.task.done .statusBlock{position:relative;width:74px;height:72px;border-radius:15px;background:#fff;color:#08784d;box-shadow:0 9px 20px rgba(2,70,45,.24)}.task.done .statusBlock:before{content:"LISTO";position:absolute;left:50%;bottom:7px;transform:translateX(-50%);font-size:8px;letter-spacing:.12em;font-weight:1000}.task.done .check{margin-top:-10px;font-size:27px}.task.done .title{font-size:15px;color:#fff}.task.done .sub{margin-top:7px;color:#d8ffea;font-size:10.2px}.task.done .time{color:#ecfff4}.task.done .mini{position:relative;z-index:2;border-color:rgba(255,255,255,.32);background:rgba(255,255,255,.12);color:#fff}.task.done .mini:hover{background:#fff;color:#076442;border-color:#fff}.doneRibbon{display:inline-flex;align-items:center;gap:5px;margin-bottom:5px;padding:4px 7px;border-radius:999px;background:#d9ffea;color:#05623f;font-size:8.5px;font-weight:1000;letter-spacing:.08em}.task.done .progress{display:none}
        .toast{margin-top:8px;padding:10px 12px;border:1px solid #d8e1eb;border-radius:12px;background:#fff;color:#526074;font-size:10.5px;font-weight:750}.toast[hidden]{display:none}.toast.warn{border-color:#ecd19c;background:#fff8e8;color:#8a590d}
        .screenPulse{display:none;position:fixed;inset:0;pointer-events:none;border:9px solid rgba(11,168,102,.0);box-shadow:inset 0 0 0 0 rgba(11,168,102,0);z-index:0}.screenPulse.on{display:block;animation:screenPulse 1.9s ease-out}
        @keyframes pulseDot{50%{transform:scale(.72);opacity:.58}}@keyframes spin{to{transform:rotate(360deg)}}@keyframes slide{0%{transform:translateX(-120%)}50%{transform:translateX(210%)}100%{transform:translateX(420%)}}@keyframes pop{from{opacity:0;transform:translateY(-8px) scale(.975)}to{opacity:1;transform:none}}@keyframes screenPulse{0%{border-color:rgba(11,168,102,.95);box-shadow:inset 0 0 55px 14px rgba(11,168,102,.28)}100%{border-color:rgba(11,168,102,0);box-shadow:inset 0 0 0 0 rgba(11,168,102,0)}}
        @media(max-width:620px){.deck{width:min(470px,calc(100vw - 16px));top:8px;right:8px}.summary{display:none}.task{grid-template-columns:40px minmax(0,1fr) auto}.statusBlock{width:40px;height:40px}.task.done{grid-template-columns:58px minmax(0,1fr) auto}.task.done .statusBlock{width:58px;height:64px}.mini.exclude{display:none}}

/* Imagen corporativa y aspecto oscuro coral, manteniendo interacción original */
.deck{--ink:#fff7e8;--muted:#b8aab9;--line:#443948;--violet:#ff604e;--blue:#ff604e;--green:#40cc98;filter:drop-shadow(0 24px 46px #0007)}
.shell{background:rgba(26,22,36,.98);border:1px solid #654452;box-shadow:0 20px 55px #100d20aa,inset 0 1px #ffffff18}
.grabbar{background:linear-gradient(105deg,#ff765e,#ff564a);border-bottom-color:#d84b45;color:#191522}
.grip{background-image:radial-gradient(circle,#492d37 1.15px,transparent 1.2px)}
.mark{background:#ff604e url('${chrome.runtime.getURL('icons/icon128.png')}') center/cover no-repeat;color:transparent;border:1px solid #fff2db80;box-shadow:0 6px 15px #19152255}
.brand strong{color:#191522}.brand small{color:#472e37}
.chip{background:#241d2b;color:#fff1e4;border-color:#59424d}.chip.work i{background:#ffcf82;box-shadow:none}.chip.done{background:#174337;color:#adffda;border-color:#327a5c}
.iconBtn{background:#fff2df;color:#241d2b;border-color:#e9bdb3}.iconBtn:hover{background:#fff;border-color:#ff604e}.iconBtn.move.active{background:#ffcebd;color:#241d2b;border-color:#efaf9f}
.body{background:#1a1624}.groupHead,.groupHead b{color:#d6c3d0}.groupHead span.count{background:#372c40;color:#fff2e4}
.empty{background:#241f30;color:#bcb0c2;border-color:#504255}
.task{background:#292333;border-color:#4d3d4b;box-shadow:0 5px 14px #0004}.task:hover{border-color:#ff816e;box-shadow:0 9px 20px #0005}
.statusBlock{background:#403445;color:#e3d2df}.task.working{background:linear-gradient(110deg,#322635,#442d3a);border-color:#dc7467}.task.working .statusBlock{background:#ff604e;color:#201723;box-shadow:0 7px 18px #ff604e44}
.copy .title{color:#fff4e6}.sub{color:#b7abbc}.time{color:#efc4bb}
.liveTimer{background:#4b303a;border-color:#935357;color:#ffc7ad}.liveTimer i{background:#ff604e;box-shadow:0 0 0 3px #ff604e30}
.mini{background:#332a3b;color:#fff4e6;border-color:#645163}.mini:hover{background:#513a47;color:#fff4e6;border-color:#ff604e}
.working .progress{background:#68424a}.working .progress i{background:#ff604e}
.task.done{background:linear-gradient(110deg,#164c40,#167b5e,#20a876);box-shadow:0 12px 30px #102f2588}.task.done .statusBlock{background:#fff5df;color:#126d50}.task.done .sub,.task.done .time{color:#dbffec}.doneRibbon{background:#fff5df;color:#166e50}
.completion{background:linear-gradient(110deg,#164c40,#20a876)}.completion:before{background:#fff5df;color:#166e50}
.toast{background:#2c2436;color:#fff1e5;border-color:#745057}.toast.warn{background:#41322f;color:#ffd7a7;border-color:#916752}
      </style>
      <div class="screenPulse"></div>
      <section class="deck" aria-label="HUD de Aviso IA">
        <div class="shell">
          <div class="grabbar" title="HUD fijado · pulsa Mover para cambiarlo de sitio">
            <div class="grip" aria-hidden="true"></div>
            <div class="identity"><div class="mark" role="img" aria-label="Aviso IA"></div><div class="brand"><strong>Aviso IA</strong><small class="moveStatus">Pulsa Mover para cambiar la posición</small></div></div>
            <div class="summary"><span class="chip work"><i></i><b class="workCount">0</b></span><span class="chip done"><i></i><b class="doneCount">0</b></span></div>
            <button class="iconBtn move" type="button" title="Mover HUD" aria-label="Mover HUD"><svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4"/></svg></button>
            <button class="iconBtn collapse" type="button" title="Contraer HUD" aria-label="Contraer HUD"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>
            <button class="iconBtn close" type="button" title="Ocultar HUD" aria-label="Ocultar HUD"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
          </div>
          <div class="body">
            <div class="completion" role="status"><b>RESPUESTA TERMINADA</b><strong></strong><span></span></div>
            <div class="cards"></div>
            <div class="toast" hidden></div>
          </div>
        </div>
      </section>`;

    const deck = shadow.querySelector('.deck');
    const bar = shadow.querySelector('.grabbar');
    shadow.querySelector('.close').addEventListener('click', e => {
      e.stopPropagation();
      moveArmed = false; applyMoveLock();
      applyVisibleLocal(false); send({ type:'V69_SET_HUD_VISIBILITY', visible:false });
    });
    shadow.querySelector('.move').addEventListener('click', e => {
      e.stopPropagation();
      moveArmed = !moveArmed;
      clearTimeout(moveArmTimer);
      if (moveArmed) moveArmTimer = setTimeout(() => { moveArmed = false; applyMoveLock(); }, 10000);
      applyMoveLock();
    });
    shadow.querySelector('.collapse').addEventListener('click', e => {
      e.stopPropagation();
      collapsed = !collapsed;
      applyCollapsed();
      saveCollapsed();
    });

    bar.addEventListener('pointerdown', e => {
      if (!moveArmed || e.button !== 0 || e.target.closest('button')) return;
      const r = deck.getBoundingClientRect();
      dragging = { pointerId:e.pointerId, dx:e.clientX-r.left, dy:e.clientY-r.top, sx:e.clientX, sy:e.clientY };
      dragMoved = false;
      bar.classList.add('dragging');
      try { bar.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    bar.addEventListener('pointermove', e => {
      if (!dragging || dragging.pointerId !== e.pointerId) return;
      if (Math.hypot(e.clientX-dragging.sx, e.clientY-dragging.sy) >= 4) dragMoved = true;
      const w = deck.offsetWidth || 520, h = deck.offsetHeight || 56;
      const x = Math.max(6, Math.min(window.innerWidth - Math.min(w, window.innerWidth - 12) - 6, e.clientX - dragging.dx));
      const y = Math.max(6, Math.min(window.innerHeight - Math.min(h, window.innerHeight - 12) - 6, e.clientY - dragging.dy));
      hudPosition = { x, y };
      applyPosition();
    });
    const endDrag = e => {
      if (!dragging || (e?.pointerId != null && e.pointerId !== dragging.pointerId)) return;
      dragging = null;
      bar.classList.remove('dragging');
      savePosition();
      // Un movimiento requiere una activación explícita cada vez: al soltar vuelve a quedar fijo.
      if (dragMoved) { clearTimeout(moveArmTimer); moveArmTimer = null; moveArmed = false; dragMoved = false; applyMoveLock(); }
    };
    bar.addEventListener('pointerup', endDrag);
    bar.addEventListener('pointercancel', endDrag);

    resizeHandler = () => clampPosition();
    window.addEventListener('resize', resizeHandler, true);
    applyCollapsed();
    applyPosition();
    applyMoveLock();
  }

  function applyMoveLock() {
    const bar = shadow?.querySelector('.grabbar');
    const btn = shadow?.querySelector('.move');
    const txt = shadow?.querySelector('.moveStatus');
    if (!bar || !btn) return;
    bar.classList.toggle('moveArmed', moveArmed);
    btn.classList.toggle('active', moveArmed);
    btn.title = moveArmed ? 'Movimiento desbloqueado · arrastra la cabecera' : 'Mover HUD';
    bar.title = moveArmed ? 'Arrastra para mover · al soltar volverá a quedar fijo' : 'HUD fijado · pulsa Mover para cambiarlo de sitio';
    if (txt) txt.textContent = moveArmed ? 'Arrastra el panel para colocarlo' : 'Pulsa Mover para cambiar la posición';
  }

  function applyCollapsed() {
    const deck = shadow?.querySelector('.deck');
    if (!deck) return;
    deck.classList.toggle('collapsed', collapsed);
    const btn = shadow.querySelector('.collapse');
    btn.title = collapsed ? 'Expandir HUD' : 'Contraer HUD';
    btn.style.transform = collapsed ? 'rotate(180deg)' : '';
    requestAnimationFrame(clampPosition);
  }
  function applyPosition() {
    const deck = shadow?.querySelector('.deck');
    if (!deck) return;
    if (hudPosition) {
      deck.style.left = `${Math.round(hudPosition.x)}px`;
      deck.style.top = `${Math.round(hudPosition.y)}px`;
      deck.style.right = 'auto';
    } else {
      deck.style.left = '';
      deck.style.top = window.innerWidth <= 620 ? '8px' : '18px';
      deck.style.right = window.innerWidth <= 620 ? '8px' : '18px';
    }
  }
  function clampPosition() {
    const deck = shadow?.querySelector('.deck');
    if (!deck || !hudPosition) return;
    const r = deck.getBoundingClientRect();
    const maxX = Math.max(6, window.innerWidth - Math.min(r.width, window.innerWidth - 12) - 6);
    const maxY = Math.max(6, window.innerHeight - Math.min(r.height, window.innerHeight - 12) - 6);
    hudPosition = { x:Math.max(6, Math.min(maxX, hudPosition.x)), y:Math.max(6, Math.min(maxY, hudPosition.y)) };
    applyPosition();
  }

  function render() {
    if (dead) return;
    ensure();
    if (!root || !shadow) return;
    applyHostVisibility(visibleHud);
    if (!visibleHud) return;
    repairPhysicalHud({ resetIfOffscreen:true });

    sortTabs();
    const cards = shadow.querySelector('.cards');
    const workingCount = tabs.filter(t => t.status === 'working').length;
    const doneCount = tabs.filter(t => t.status === 'done').length;
    shadow.querySelector('.workCount').textContent = String(workingCount);
    shadow.querySelector('.doneCount').textContent = String(doneCount);

    if (!tabs.length) {
      cards.innerHTML = snapshotLoaded
        ? '<div class="empty">No hay chats abiertos.</div>'
        : '<div class="empty">Cargando chats…</div>';
      return;
    }

    const renderCard = t => {
      const status = t.status || 'idle';
      const title = trim(t.title || 'ChatGPT', 100);
      const activity = trim(t.activityText || (status === 'working' ? 'Generando respuesta…' : status === 'done' ? 'Respuesta lista' : 'En espera'), 105);
      const p = trim(t.preview || '', 175);
      const live = status === 'working' ? elapsed(t.startedAt) : '';
      const took = status === 'done' ? duration(t.startedAt, t.finishedAt) : '';
      const when = status === 'done' ? ago(t.finishedAt) : '';
      const icon = status === 'working' ? '<span class="spinner"></span>' : status === 'done' ? '<span class="check">✓</span>' : '·';
      const ribbon = status === 'done' ? '<span class="doneRibbon">RESPUESTA LISTA</span>' : '';
      const liveTimer = live ? `<div class="liveTimer"><i></i>ACTIVO · <strong>${esc(live)}</strong></div>` : '';
      const detail = status === 'done'
        ? `${when}${took ? ` · activo durante ${took}` : ''}${p ? ` · ${p}` : ''}`
        : (p || activity);
      const exclude = t.canExclude ? `<button class="mini exclude" type="button" data-exclude="${Number(t.tabId)}">Excluir</button>` : '';
      return `<article class="task ${esc(status)}" data-tab="${Number(t.tabId)}">
        <div class="statusBlock">${icon}</div>
        <div class="copy">${ribbon}<div class="title">${esc(title)}</div>${liveTimer}<div class="sub"><span class="activity">${esc(detail)}</span></div></div>
        <div class="actions">${exclude}</div><div class="progress"><i></i></div>
      </article>`;
    };

    // Replica la organización real de grupos de pestañas de Chrome.
    const orderedTabs = [...tabs].sort((a,b) => (Number(a.windowId||0)-Number(b.windowId||0)) || (Number(a.index||0)-Number(b.index||0)) || (Number(a.tabId||0)-Number(b.tabId||0)));
    const groups = [];
    const byKey = new Map();
    for (const t of orderedTabs) {
      const gid = Number(t.groupId);
      const key = Number.isFinite(gid) && gid >= 0 ? `g:${gid}` : `u:${Number(t.windowId||0)}`;
      if (!byKey.has(key)) {
        const g = { key, real:Number.isFinite(gid) && gid >= 0, title:String(t.groupTitle || ''), color:String(t.groupColor || 'grey'), tabs:[] };
        byKey.set(key, g); groups.push(g);
      }
      byKey.get(key).tabs.push(t);
    }
    const hasRealGroups = groups.some(g => g.real);
    cards.innerHTML = groups.map(g => {
      const color = /^(blue|red|yellow|green|pink|purple|cyan|orange|grey)$/.test(g.color) ? g.color : 'grey';
      const head = hasRealGroups ? `<div class="groupHead group-${color}"><i class="groupDot"></i><b>${esc(g.real ? (g.title || 'Grupo de pestañas') : 'Sin agrupar')}</b><span class="count">${g.tabs.length}</span></div>` : '';
      return `<section class="tabGroup">${head}${g.tabs.map(renderCard).join('')}</section>`;
    }).join('');

    for (const btn of cards.querySelectorAll('[data-exclude]')) {
      btn.addEventListener('click', async e => {
        e.preventDefault(); e.stopPropagation();
        const tabId = Number(btn.dataset.exclude);
        btn.disabled = true; btn.textContent = '…';
        const r = await send({ type:'V62_EXCLUDE_CHAT', tabId });
        if (r?.ok) {
          removeTab(tabId);
          showToast(`${trim(r.excluded?.title || 'ChatGPT', 70)} ya no aparecerá en el HUD.`, 'info');
        } else {
          btn.disabled = false; btn.textContent = 'Excluir';
          showToast('Ese chat todavía no tiene un ID estable.', 'warn');
        }
      });
    }
    for (const card of cards.querySelectorAll('.task')) {
      card.addEventListener('click', e => {
        if (e.target.closest('button')) return;
        send({ type:'V67_FOCUS_TAB', tabId:Number(card.dataset.tab) });
      });
    }
  }

  function showCompletion(title, requestId = '') {
    if (!visibleHud) return;
    ensure();
    const box = shadow?.querySelector('.completion');
    const pulse = shadow?.querySelector('.screenPulse');
    if (!box) return;
    completionRequestId = String(requestId || '');
    completionShownAt = Date.now();
    box.querySelector('strong').textContent = trim(title || 'ChatGPT', 90);
    box.querySelector('span').textContent = 'Queda marcado como LISTO hasta que abras ese chat.';
    box.classList.remove('show');
    void box.offsetWidth;
    box.classList.add('show');
    if (pulse) {
      pulse.classList.remove('on');
      void pulse.offsetWidth;
      pulse.classList.add('on');
      setTimeout(() => pulse.classList.remove('on'), 2100);
    }
    clearTimeout(completionTimer);
    completionTimer = setTimeout(() => hideCompletion(completionRequestId, true), 12000);
  }
  function hideCompletion(requestId = '', force = false) {
    if (requestId && completionRequestId && requestId !== completionRequestId) return;
    const elapsedMs = Date.now() - completionShownAt;
    if (!force && elapsedMs < 6500) {
      clearTimeout(completionTimer);
      completionTimer = setTimeout(() => hideCompletion(requestId, true), 6500 - elapsedMs);
      return;
    }
    shadow?.querySelector('.completion')?.classList.remove('show');
    completionRequestId = '';
  }
  function showToast(message, kind = 'info') {
    if (!visibleHud) return;
    ensure();
    const el = shadow?.querySelector('.toast');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('warn', kind === 'warn');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (el) el.hidden = true; }, 4200);
  }

  function startTick() {
    if (tick) return;
    tick = setInterval(() => {
      if (!visibleHud) { clearInterval(tick); tick = null; return; }
      if (!root?.isConnected) { root = shadow = null; ensure(); }
      render();
    }, 1000);
  }
  function stopTick() { clearInterval(tick); tick = null; }

  function installMessageHandler() {
    if (!runtimeAvailable()) return destroy();
    messageHandler = (msg, _sender, sendResponse) => {
      if (dead) return false;
      if (msg?.type === 'V69_HUD_PING' || msg?.type === 'V68_HUD_PING' || msg?.type === 'V67_HUD_PING' || msg?.type === 'V66_HUD_PING') {
        try { sendResponse?.({ ok:true, version:VERSION, ...hudHealth() }); } catch (_) {}
        return false;
      }
      switch (msg?.type) {
        case 'V62_HUD_VISIBILITY':
          visibleHud = !!msg.visible;
          if (Array.isArray(msg.tabs)) { tabs = msg.tabs; snapshotLoaded = true; sortTabs(); }
          visibleHud ? startTick() : stopTick();
          render();
          break;
        case 'V69_HUD_FORCE_VISIBLE': {
          if (Array.isArray(msg.tabs)) { tabs = msg.tabs; snapshotLoaded = true; sortTabs(); }
          applyVisibleLocal(true);
          const health = repairPhysicalHud({ resetIfOffscreen:true });
          try { sendResponse?.({ ok:true, ...health }); } catch (_) {}
          return false;
        }
        case 'V62_HUD_SNAPSHOT':
          if (Array.isArray(msg.tabs)) { tabs = msg.tabs; snapshotLoaded = true; }
          sortTabs(); render(); break;
        case 'V62_HUD_TAB_STATE': mergeTab(msg.tab); break;
        case 'V62_HUD_TAB_REMOVED': removeTab(msg.tabId); break;
        case 'V66_HUD_ACK_DONE':
        case 'V67_HUD_ACK_DONE':
        case 'V69_HUD_ACK_DONE':
        case 'V68_HUD_ACK_DONE':
          mergeTab({ tabId:Number(msg.tabId), status:'idle', finishedAt:null, startedAt:null, preview:'', activityText:'En espera' });
          break;
        case 'V62_HUD_COMPLETION':
          if (msg.tab) mergeTab(msg.tab);
          showCompletion(msg.title || msg.tab?.title || 'ChatGPT', String(msg.requestId || ''));
          break;
        case 'V62_HUD_EXCLUDED': showToast(`${trim(msg.title || 'ChatGPT', 70)} se ha excluido.`, 'info'); break;
        case 'V62_HUD_CLOSE_COMPLETION': hideCompletion(String(msg.requestId || ''), false); break;
        case 'V62_HUD_NOTIFICATION_BLOCKED': showToast('Chrome o el sistema tiene bloqueadas las notificaciones.', 'warn'); break;
      }
      return false;
    };
    try { chrome.runtime.onMessage.addListener(messageHandler); } catch (_) { destroy(); }
  }

  function applyVisibleLocal(next) {
    visibleHud = !!next;
    if (visibleHud) {
      ensure();
      applyHostVisibility(true);
      startTick();
      render();
      // Preferencias/posición se leen después de pintar para que abrir el HUD sea inmediato.
      ensureUiPrefs().then(() => {
        if (!visibleHud || dead) return;
        applyCollapsed();
        applyPosition();
        repairPhysicalHud({ resetIfOffscreen:true });
      });
      requestAnimationFrame(() => {
        if (!visibleHud || dead) return;
        repairPhysicalHud({ resetIfOffscreen:true });
      });
    } else {
      stopTick();
      applyHostVisibility(false);
      render();
    }
  }


  function destroy() {
    if (dead) return;
    dead = true;
    clearInterval(tick); tick = null;
    clearTimeout(toastTimer); clearTimeout(completionTimer); clearTimeout(moveArmTimer);
    try { if (resizeHandler) window.removeEventListener('resize', resizeHandler, true); } catch (_) {}
    try { if (messageHandler) chrome.runtime.onMessage.removeListener(messageHandler); } catch (_) {}
    try { root?.remove(); } catch (_) {}
    root = shadow = null;
    if (window.__CGPT_HUD_CONTROLLER__?.destroy === destroy) {
      try { delete window.__CGPT_HUD_CONTROLLER__; } catch (_) {}
    }
  }

  window.__CGPT_HUD_CONTROLLER__ = { version:VERSION, destroy, show(){ applyVisibleLocal(true); }, hide(){ applyVisibleLocal(false); }, toggle(){ applyVisibleLocal(!visibleHud); }, get visible(){ return visibleHud; } };

  // Inicio ultraligero: no crea DOM, no lee storage y no escanea pestañas hasta que el HUD se abre.
  installMessageHandler();
})();
