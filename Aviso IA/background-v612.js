'use strict';

const DEFAULTS = {
  enabled: true,
  soundEnabled: true,
  soundVolume: 80,
  voiceAnnouncements: true,
  showTitleFlash: true,
  hudShowIdle: true,
  notifyActiveChat: false
};
const AI_BUILTIN_HOSTS = ['chatgpt.com','chat.openai.com','claude.ai','gemini.google.com','aistudio.google.com','grok.com','x.com','perplexity.ai','copilot.microsoft.com','copilot.com','www.deepseek.com','chat.deepseek.com','chat.mistral.ai','poe.com','www.meta.ai','meta.ai','you.com','character.ai','www.character.ai','huggingface.co','notebooklm.google.com','qwen.ai','chat.qwen.ai','kimi.com','www.kimi.com','chat.z.ai','lechat.mistral.ai'];
let customAiRoutes = [];
function validRoute(value) { try { const u = new URL(value); return /^https?:$/.test(u.protocol) && !!u.hostname && !u.username && !u.password; } catch (_) { return false; } }
function isChatUrl(raw) {
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) return false;
    const h = u.hostname.toLowerCase();
    if (h === 'x.com') return /^\/(?:i\/grok|grok)(?:\/|$)/.test(u.pathname);
    if (AI_BUILTIN_HOSTS.includes(h)) return true;
    return customAiRoutes.some(prefix => u.href.startsWith(prefix));
  } catch (_) { return false; }
}
async function refreshAiRoutes() {
  try { const d = await chrome.storage.local.get('aiRoutes'); customAiRoutes = (Array.isArray(d.aiRoutes) ? d.aiRoutes : []).filter(validRoute); } catch (_) {}
}
refreshAiRoutes();
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.aiRoutes) refreshAiRoutes(); });
const HTTP_RE = /^(https?|file):\/\//i;
const HUD_SCRIPT = 'hud-v612.js';
const HUD_KEY = 'v69-hud-visible';
const HUD_TAB_KEY = 'v612-hud-tab-id';
const EXCLUDED_KEY = 'v63-excluded-chats';
const DONE_VISUAL_TAB_PREFIX = 'v614-done-visual-tab-';
const READY_GROUP_WINDOW_PREFIX = 'v615-ready-group-window-';
const LEGACY_DONE_VISUAL_GROUP_PREFIX = 'v614-done-visual-group-';
let hudVisible = false;
let hudTabId = null;
let stateCache = Object.create(null);
let excludedChatsCache = null;
let offscreenCreating = null;
let hudStateHydrated = false;
const groupMetaCache = new Map();

async function hydrateHudVisibility() {
  if (hudStateHydrated) return hudVisible;
  try {
    const data = await chrome.storage.session.get([HUD_KEY, HUD_TAB_KEY]);
    hudVisible = !!data[HUD_KEY];
    const id = Number(data[HUD_TAB_KEY]);
    hudTabId = Number.isFinite(id) && id >= 0 ? id : null;
  } catch (_) {
    hudVisible = false;
    hudTabId = null;
  }
  hudStateHydrated = true;
  return hudVisible;
}

async function persistHudState() {
  try { await chrome.storage.session.set({ [HUD_KEY]:!!hudVisible, [HUD_TAB_KEY]:Number.isFinite(Number(hudTabId)) ? Number(hudTabId) : -1 }); } catch (_) {}
}


function isHudPage(rawUrl) {
  // Chrome no permite inyectar extensiones en chrome://, la Chrome Web Store ni otras páginas internas.
  // En webs normales funciona desde cualquier pestaña; file:// funciona si el usuario habilita acceso a archivos.
  return /^https?:\/\//i.test(String(rawUrl || ''));
}

async function getActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active:true, lastFocusedWindow:true });
    return tab || null;
  } catch (_) { return null; }
}

async function getGroupMeta(groupId) {
  const id = Number(groupId);
  if (!Number.isFinite(id) || id < 0) return { groupId:-1, groupTitle:'', groupColor:'', groupCollapsed:false };
  if (groupMetaCache.has(id)) return groupMetaCache.get(id);
  let meta = { groupId:id, groupTitle:'', groupColor:'', groupCollapsed:false };
  try {
    if (chrome.tabGroups?.get) {
      const g = await chrome.tabGroups.get(id);
      meta = { groupId:id, groupTitle:String(g?.title || ''), groupColor:String(g?.color || ''), groupCollapsed:!!g?.collapsed };
    }
  } catch (_) {}
  groupMetaCache.set(id, meta);
  return meta;
}

async function getTabMetaForHud(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return { ...tab, ...(await getGroupMeta(tab.groupId)) };
  } catch (_) { return null; }
}

function doneVisualTabKey(tabId) { return `${DONE_VISUAL_TAB_PREFIX}${Number(tabId)}`; }
function readyGroupWindowKey(windowId) { return `${READY_GROUP_WINDOW_PREFIX}${Number(windowId)}`; }

async function getDoneVisualMeta(tabId) {
  try {
    const key = doneVisualTabKey(tabId);
    const data = await chrome.storage.session.get(key);
    return data[key] || null;
  } catch (_) { return null; }
}

async function saveDoneVisualMeta(tabId, meta) {
  try { await chrome.storage.session.set({ [doneVisualTabKey(tabId)]: meta }); } catch (_) {}
}

async function getReadyGroupId(windowId) {
  const key = readyGroupWindowKey(windowId);
  try {
    const data = await chrome.storage.session.get(key);
    const id = Number(data[key]);
    if (!Number.isFinite(id) || id < 0) return -1;
    const group = await chrome.tabGroups.get(id).catch(() => null);
    if (!group || Number(group.windowId) !== Number(windowId)) {
      await chrome.storage.session.remove(key).catch(() => {});
      return -1;
    }
    return id;
  } catch (_) { return -1; }
}

async function setReadyGroupId(windowId, groupId) {
  try { await chrome.storage.session.set({ [readyGroupWindowKey(windowId)]:Number(groupId) }); } catch (_) {}
}

async function forgetReadyGroup(windowId, expectedGroupId = -1) {
  const key = readyGroupWindowKey(windowId);
  try {
    if (expectedGroupId >= 0) {
      const data = await chrome.storage.session.get(key);
      if (Number(data[key]) !== Number(expectedGroupId)) return;
    }
    await chrome.storage.session.remove(key);
  } catch (_) {}
}

async function collapseReadyGroup(groupId) {
  const id = Number(groupId);
  if (!Number.isFinite(id) || id < 0) return false;
  try {
    await chrome.tabGroups.update(id, { title:'LISTO', color:'green', collapsed:true });
    groupMetaCache.delete(id);
    return true;
  } catch (_) { return false; }
}

async function consolidateReadyGroupsInWindow(windowId) {
  const wid = Number(windowId);
  if (!Number.isFinite(wid) || wid < 0) return -1;
  try {
    const groups = await chrome.tabGroups.query({ windowId:wid });
    const candidates = groups.filter(g => String(g?.title || '').trim().toUpperCase() === 'LISTO' && String(g?.color || '') === 'green');
    let primaryId = await getReadyGroupId(wid);
    if (primaryId < 0 && candidates.length) primaryId = Number(candidates[0].id);
    if (primaryId < 0) return -1;

    await setReadyGroupId(wid, primaryId);
    for (const g of candidates) {
      const gid = Number(g.id);
      if (gid === primaryId) continue;
      const tabs = await chrome.tabs.query({ groupId:gid });
      const ids = tabs.map(t => Number(t.id)).filter(Number.isFinite);
      if (ids.length) {
        try { await chrome.tabs.group({ groupId:primaryId, tabIds:ids }); } catch (_) {}
        for (const tid of ids) {
          const meta = await getDoneVisualMeta(tid);
          if (meta) await saveDoneVisualMeta(tid, { ...meta, readyGroupId:primaryId, mode:'shared-ready-group' });
        }
      }
      groupMetaCache.delete(gid);
    }
    await collapseReadyGroup(primaryId);
    return primaryId;
  } catch (_) { return -1; }
}

async function consolidateAllReadyGroups() {
  try {
    const wins = await chrome.windows.getAll({ populate:false });
    await Promise.allSettled(wins.map(w => consolidateReadyGroupsInWindow(w.id)));
  } catch (_) {}
}


async function ensureReadyGroupForTab(tab) {
  if (!tab || typeof tab.id !== 'number' || typeof tab.windowId !== 'number') return -1;
  const wid = Number(tab.windowId);

  for (let attempt = 0; attempt < 3; attempt++) {
    let liveTab = await chrome.tabs.get(tab.id).catch(() => null);
    if (!liveTab) return -1;

    let groupId = await consolidateReadyGroupsInWindow(wid);
    if (groupId >= 0) {
      if (Number(liveTab.groupId) !== Number(groupId)) {
        try { await chrome.tabs.group({ groupId, tabIds:[liveTab.id] }); } catch (_) {
          await new Promise(r => setTimeout(r, 80 * (attempt + 1)));
          continue;
        }
      }
      await setReadyGroupId(wid, groupId);
      await collapseReadyGroup(groupId);
      if (await verifyReadyGrouping(liveTab.id, groupId)) return Number(groupId);
      await new Promise(r => setTimeout(r, 80 * (attempt + 1)));
      continue;
    }

    try {
      groupId = await chrome.tabs.group({ tabIds:[liveTab.id], createProperties:{ windowId:wid } });
      await setReadyGroupId(wid, groupId);
      await collapseReadyGroup(groupId);
      if (await verifyReadyGrouping(liveTab.id, groupId)) return Number(groupId);
    } catch (_) {}
    await new Promise(r => setTimeout(r, 80 * (attempt + 1)));
  }
  return -1;
}

async function readyGroupHasTabs(groupId) {
  try {
    const tabs = await chrome.tabs.query({ groupId:Number(groupId) });
    return tabs.length > 0;
  } catch (_) { return false; }
}

async function isReadyGroup(groupId, windowId = null) {
  const gid = Number(groupId);
  if (!Number.isFinite(gid) || gid < 0) return false;
  try {
    const g = await chrome.tabGroups.get(gid);
    if (!g) return false;
    if (windowId != null && Number(g.windowId) !== Number(windowId)) return false;
    if (String(g.title || '').trim().toUpperCase() === 'LISTO' && String(g.color || '') === 'green') return true;
    const stored = await getReadyGroupId(g.windowId);
    return Number(stored) === gid;
  } catch (_) { return false; }
}

async function leaveReadyGroup(tabId) {
  const id = Number(tabId);
  if (!Number.isFinite(id)) return false;
  const meta = await getDoneVisualMeta(id);
  if (meta) {
    await clearChromeDoneColor(id).catch(() => {});
    return true;
  }

  const tab = await chrome.tabs.get(id).catch(() => null);
  if (!tab || !(await isReadyGroup(tab.groupId, tab.windowId))) return false;
  const gid = Number(tab.groupId);
  try { await chrome.tabs.ungroup(id); } catch (_) { return false; }
  if (await readyGroupHasTabs(gid)) await collapseReadyGroup(gid);
  else {
    await forgetReadyGroup(tab.windowId, gid);
    groupMetaCache.delete(gid);
  }
  return true;
}

async function verifyReadyGrouping(tabId, groupId) {
  try {
    const tab = await chrome.tabs.get(Number(tabId));
    const group = await chrome.tabGroups.get(Number(groupId));
    return Number(tab.groupId) === Number(groupId)
      && String(group?.title || '').trim().toUpperCase() === 'LISTO'
      && String(group?.color || '') === 'green';
  } catch (_) { return false; }
}

async function applyChromeDoneColor(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || typeof tab.id !== 'number') return false;

    try { await chrome.windows.update(tab.windowId, { drawAttention:true }); } catch (_) {}

    const existingMeta = await getDoneVisualMeta(tabId);
    let originalGroupId = -1;
    if (Number.isFinite(Number(existingMeta?.originalGroupId))) {
      originalGroupId = Number(existingMeta.originalGroupId);
    } else if (existingMeta?.mode === 'existing-group' && Number.isFinite(Number(existingMeta?.groupId))) {
      // Migración v6.14: ese grupo era el grupo original del usuario.
      originalGroupId = Number(existingMeta.groupId);
    } else if (!existingMeta) {
      const currentReady = await getReadyGroupId(tab.windowId);
      if (Number.isFinite(Number(tab.groupId)) && Number(tab.groupId) >= 0 && Number(tab.groupId) !== Number(currentReady)) {
        originalGroupId = Number(tab.groupId);
      }
    }

    const readyGroupId = await ensureReadyGroupForTab(tab);
    if (readyGroupId < 0) return false;
    await saveDoneVisualMeta(tabId, {
      mode:'shared-ready-group',
      readyGroupId,
      originalGroupId,
      originalWindowId:Number(tab.windowId),
      originalIndex:Number(tab.index),
      markedAt:Date.now()
    });
    await collapseReadyGroup(readyGroupId);
    return true;
  } catch (_) { return false; }
}

async function repairPendingDonePresentation(tabId) {
  const id = Number(tabId);
  if (!Number.isFinite(id)) return false;
  const waits = [0, 140, 420, 900];
  for (const wait of waits) {
    if (wait) await new Promise(r => setTimeout(r, wait));
    const state = await loadState(id);
    if (state?.status !== 'done' || !state?.doneUnread) return false;
    if (await isChatActuallyVisible(id)) {
      await acknowledgeDone(id, 'repair-visible');
      return true;
    }

    try { await chrome.tabs.sendMessage(id, { type:'V613_APPLY_DONE_TAB_VISUAL' }); } catch (_) {}
    await applyChromeDoneColor(id).catch(() => {});

    const tab = await chrome.tabs.get(id).catch(() => null);
    if (tab && await isReadyGroup(tab.groupId, tab.windowId)) {
      await collapseReadyGroup(tab.groupId).catch(() => {});
      return true;
    }
  }
  return false;
}

async function clearChromeDoneColor(tabId) {
  const meta = await getDoneVisualMeta(tabId);
  if (!meta) return false;
  const metaKey = doneVisualTabKey(tabId);
  const readyGroupId = Number(meta.readyGroupId);
  const windowId = Number(meta.originalWindowId);

  try {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab && Number(tab.groupId) === readyGroupId) {
      let restored = false;
      const originalGroupId = Number(meta.originalGroupId);
      if (Number.isFinite(originalGroupId) && originalGroupId >= 0 && originalGroupId !== readyGroupId) {
        const originalGroup = await chrome.tabGroups.get(originalGroupId).catch(() => null);
        if (originalGroup && Number(originalGroup.windowId) === Number(tab.windowId)) {
          try {
            await chrome.tabs.group({ groupId:originalGroupId, tabIds:[tabId] });
            restored = true;
          } catch (_) {}
        }
      }
      if (!restored) {
        try { await chrome.tabs.ungroup(tabId); } catch (_) {}
      }
    }

    await chrome.storage.session.remove(metaKey).catch(() => {});

    if (Number.isFinite(readyGroupId) && readyGroupId >= 0) {
      if (await readyGroupHasTabs(readyGroupId)) {
        await collapseReadyGroup(readyGroupId);
      } else {
        await forgetReadyGroup(windowId, readyGroupId);
        groupMetaCache.delete(readyGroupId);
      }
    }
    return true;
  } catch (_) {
    await chrome.storage.session.remove(metaKey).catch(() => {});
    if (Number.isFinite(readyGroupId) && readyGroupId >= 0) {
      if (await readyGroupHasTabs(readyGroupId)) await collapseReadyGroup(readyGroupId);
      else await forgetReadyGroup(windowId, readyGroupId);
    }
    return false;
  }
}

async function clearWindowAttentionForTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.windows.update(tab.windowId, { drawAttention:false });
  } catch (_) {}
}

async function refreshHudSnapshot() {
  if (!hudVisible || !Number.isFinite(Number(hudTabId))) return;
  try { await refreshHudSnapshotForTab(hudTabId); } catch (_) {}
}

function stateSessionKey(tabId) { return `v62-state-${tabId}`; }
function notifSessionKey(id) { return `v62-notif-${id}`; }

function safeTitle(raw) {
  let t = String(raw || '').replace(/^\s*\[LISTO\]\s*/i, '').replace(/^\s*[✓●•]\s*/, '').trim();
  t = t.replace(/\s*[|\-–—]\s*ChatGPT\s*$/i, '').replace(/^ChatGPT\s*[|\-–—:]\s*/i, '').trim();
  if (!t || /^(chatgpt|nuevo chat|new chat|chatgpt ha terminado)$/i.test(t)) return 'ChatGPT';
  return t.slice(0, 100);
}

function chatKey(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ''));
    const p = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.origin}${p}`;
  } catch (_) {
    return String(rawUrl || '').split(/[?#]/)[0];
  }
}

function isConversationKey(key) {
  try { return /\/c\/[^/]+/i.test(new URL(key).pathname); }
  catch (_) { return /\/c\/[^/]+/i.test(String(key || '')); }
}

function exclusionKey(rawKey) {
  try {
    const m = new URL(String(rawKey || '')).pathname.match(/\/c\/([^/]+)/i);
    return m?.[1] ? `chat:${m[1]}` : '';
  } catch (_) {
    const m = String(rawKey || '').match(/\/c\/([^/?#]+)/i);
    return m?.[1] ? `chat:${m[1]}` : '';
  }
}

function normalizeExcluded(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!/^chat:[^\s]+$/i.test(key)) continue;
    const v = value && typeof value === 'object' ? value : {};
    out[key] = {
      key,
      title: safeTitle(v.title || 'ChatGPT'),
      url: typeof v.url === 'string' ? v.url : '',
      excludedAt: Number(v.excludedAt) || 0
    };
  }
  return out;
}

async function getExcludedChats() {
  if (excludedChatsCache) return excludedChatsCache;
  const data = await chrome.storage.local.get(EXCLUDED_KEY);
  excludedChatsCache = normalizeExcluded(data[EXCLUDED_KEY]);
  return excludedChatsCache;
}

async function isExcludedChat(rawKey) {
  const key = exclusionKey(rawKey);
  if (!key) return false;
  const excluded = await getExcludedChats();
  return !!excluded[key];
}

async function saveExcludedChats(next) {
  excludedChatsCache = normalizeExcluded(next);
  await chrome.storage.local.set({ [EXCLUDED_KEY]: excludedChatsCache });
  return excludedChatsCache;
}

function isMaterializedNewChat(oldKey, newKey, startedAt) {
  const age = Date.now() - Number(startedAt || 0);
  return age >= 0 && age < 30000 && !isConversationKey(oldKey) && isConversationKey(newKey);
}

async function getSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
}

async function loadState(tabId) {
  if (typeof tabId !== 'number') return {};
  if (stateCache[tabId]) return stateCache[tabId];
  const key = stateSessionKey(tabId);
  const data = await chrome.storage.session.get(key);
  const state = data[key] || {};
  if (Object.keys(state).length) stateCache[tabId] = state;
  return state;
}

async function setState(tabId, patch, { broadcast = true } = {}) {
  if (typeof tabId !== 'number') return null;
  const prev = await loadState(tabId);
  const next = { ...prev, ...patch, tabId, updatedAt: Date.now() };
  stateCache[tabId] = next;
  await chrome.storage.session.set({ [stateSessionKey(tabId)]: next });
  if (broadcast && hudVisible) {
    if (await isExcludedChat(next.chatKey || next.url || '')) {
      broadcastHud({ type:'V62_HUD_TAB_REMOVED', tabId }).catch(() => {});
    } else {
      // Una fila solo puede existir en el HUD si su pestaña existe realmente ahora mismo.
      getTabMetaForHud(tabId).then(meta => {
        if (!meta || !isChatUrl(meta.url || '')) {
          broadcastHud({ type:'V62_HUD_TAB_REMOVED', tabId }).catch(() => {});
          return;
        }
        broadcastHud({ type:'V62_HUD_TAB_STATE', tab: toHudState(next, meta) }).catch(() => {});
      }).catch(() => {
        broadcastHud({ type:'V62_HUD_TAB_REMOVED', tabId }).catch(() => {});
      });
    }
  }
  return next;
}

async function resetIdle(tabId, meta = {}) {
  const prev = await loadState(tabId);
  return setState(tabId, {
    status: 'idle',
    requestId: '',
    startedAt: null,
    finishedAt: null,
    doneUnread: false,
    evidenceSeen: false,
    lastEvidenceAt: null,
    preview: '',
    activityText: 'En espera',
    chatTitle: safeTitle(meta.chatTitle || prev.chatTitle),
    url: meta.url || prev.url || '',
    chatKey: chatKey(meta.url || prev.url || ''),
    windowId: meta.windowId ?? prev.windowId,
    index: meta.index ?? prev.index
  });
}

function toHudState(s, tabMeta = {}) {
  return {
    tabId: Number(s.tabId ?? tabMeta.id),
    windowId: Number(s.windowId ?? tabMeta.windowId ?? 0),
    index: Number(s.index ?? tabMeta.index ?? 0),
    title: safeTitle(s.chatTitle || tabMeta.title),
    status: s.status || 'idle',
    preview: s.preview || '',
    activityText: s.activityText || '',
    startedAt: s.startedAt || null,
    finishedAt: s.finishedAt || null,
    doneUnread: !!s.doneUnread,
    requestId: s.requestId || '',
    url: s.url || tabMeta.url || '',
    chatKey: s.chatKey || chatKey(s.url || tabMeta.url || ''),
    canExclude: !!exclusionKey(s.chatKey || s.url || tabMeta.url || ''),
    groupId: Number.isFinite(Number(tabMeta.groupId ?? s.groupId)) ? Number(tabMeta.groupId ?? s.groupId) : -1,
    groupTitle: String(tabMeta.groupTitle ?? s.groupTitle ?? ''),
    groupColor: String(tabMeta.groupColor ?? s.groupColor ?? ''),
    groupCollapsed: !!(tabMeta.groupCollapsed ?? s.groupCollapsed)
  };
}

async function getTabsSnapshot() {
  const tabs = (await chrome.tabs.query({})).filter(t => isChatUrl(t.url || ''));
  if (!tabs.length) return [];
  const keys = tabs.map(t => stateSessionKey(t.id));
  const allSession = await chrome.storage.session.get(keys);
  const excluded = await getExcludedChats();

  const groupIds = [...new Set(tabs.map(t => Number(t.groupId)).filter(id => Number.isFinite(id) && id >= 0))];
  await Promise.allSettled(groupIds.map(id => getGroupMeta(id)));

  const list = tabs.map(tab => {
    const s0 = stateCache[tab.id] || allSession[stateSessionKey(tab.id)] || { tabId:tab.id };
    stateCache[tab.id] = s0;
    const liveUrl = tab.url || s0.url || '';
    const liveChatKey = chatKey(liveUrl);
    const groupMeta = groupMetaCache.get(Number(tab.groupId)) || { groupId:tab.groupId, groupTitle:'', groupColor:'', groupCollapsed:false };
    const hud = toHudState({ ...s0, url:liveUrl, chatKey:liveChatKey, windowId:tab.windowId, index:tab.index }, { ...tab, ...groupMeta });
    const key = exclusionKey(liveUrl || liveChatKey || '');
    return key && excluded[key] ? null : hud;
  }).filter(Boolean);
  list.sort((a,b) => (a.windowId-b.windowId) || (a.index-b.index) || (a.tabId-b.tabId));
  return list;
}

async function pingHud(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type:'V69_HUD_PING' });
    return !!r?.ok;
  } catch (_) { return false; }
}

async function ensureHudInTab(tab) {
  if (typeof tab?.id !== 'number' || !isHudPage(tab.url || '')) return false;
  if (await pingHud(tab.id)) return true;
  try {
    await chrome.scripting.executeScript({ target:{ tabId:tab.id }, files:[HUD_SCRIPT] });
  } catch (_) { return false; }
  return await pingHud(tab.id);
}

async function ensureGlobalControlsInTab(tab) {
  if (typeof tab?.id !== 'number' || !isHudPage(tab.url || '')) return false;
  let bridge = false, main = false;
  try {
    await chrome.scripting.executeScript({ target:{ tabId:tab.id, allFrames:true }, files:['shortcut-bridge-v612.js'] });
    bridge = true;
  } catch (_) {
    try { await chrome.scripting.executeScript({ target:{ tabId:tab.id }, files:['shortcut-bridge-v612.js'] }); bridge = true; } catch (_) {}
  }
  try {
    await chrome.scripting.executeScript({ target:{ tabId:tab.id, allFrames:true }, files:['shortcut-main-v612.js'], world:'MAIN' });
    main = true;
  } catch (_) {
    try { await chrome.scripting.executeScript({ target:{ tabId:tab.id }, files:['shortcut-main-v612.js'], world:'MAIN' }); main = true; } catch (_) {}
  }
  return bridge || main;
}

async function ensureRegisteredGlobalScripts() {
  if (!chrome.scripting?.registerContentScripts) return false;
  const ids = ['ciberip-v612-main','ciberip-v612-bridge','ciberip-v612-hud'];
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts();
    const present = new Set(existing.map(x => x.id));
    if (ids.every(id => present.has(id))) return true;
    const remove = existing.filter(x => ids.includes(x.id)).map(x => x.id);
    if (remove.length) await chrome.scripting.unregisterContentScripts({ ids:remove });
    await chrome.scripting.registerContentScripts([
      { id:'ciberip-v612-main', matches:['http://*/*','https://*/*'], js:['shortcut-main-v612.js'], runAt:'document_start', allFrames:true, persistAcrossSessions:true, world:'MAIN' },
      { id:'ciberip-v612-bridge', matches:['http://*/*','https://*/*'], js:['shortcut-bridge-v612.js'], runAt:'document_start', allFrames:true, persistAcrossSessions:true, world:'ISOLATED' },
      { id:'ciberip-v612-hud', matches:['http://*/*','https://*/*'], js:['hud-v612.js'], runAt:'document_start', allFrames:false, persistAcrossSessions:true, world:'ISOLATED' }
    ]);
    return true;
  } catch (_) { return false; }
}

async function sendHudToTab(tabId, message) {
  if (!Number.isFinite(Number(tabId))) return false;
  try { await chrome.tabs.sendMessage(Number(tabId), message); return true; } catch (_) { return false; }
}

async function broadcastHud(message) {
  if (!hudVisible || !Number.isFinite(Number(hudTabId))) return 0;
  return (await sendHudToTab(hudTabId, message)) ? 1 : 0;
}

async function refreshHudSnapshotForTab(tabId = hudTabId) {
  if (!hudVisible || !Number.isFinite(Number(tabId))) return false;
  const tabs = await getTabsSnapshot();
  return sendHudToTab(tabId, { type:'V62_HUD_SNAPSHOT', tabs });
}

async function hideHudInTab(tabId) {
  if (!Number.isFinite(Number(tabId))) return false;
  return sendHudToTab(Number(tabId), { type:'V62_HUD_VISIBILITY', visible:false });
}

async function showHudInTab(tab) {
  if (typeof tab?.id !== 'number' || !isHudPage(tab.url || '')) return { ready:false, physical:null };
  const ready = await ensureHudInTab(tab);
  let physical = null;
  if (ready) {
    try { physical = await chrome.tabs.sendMessage(tab.id, { type:'V69_HUD_FORCE_VISIBLE', visible:true }); } catch (_) {}
  }
  // El snapshot pesado va después del primer pintado; no bloquea la apertura.
  refreshHudSnapshotForTab(tab.id).catch(() => {});
  return { ready:!!ready, physical };
}

async function syncActionEnabledState(enabled) {
  try {
    await chrome.action.setTitle({ title: enabled ? 'ChatGPT HUD y avisos' : 'ChatGPT HUD y avisos · APAGADA' });
    await chrome.action.setBadgeText({ text: enabled ? '' : 'OFF' });
    if (!enabled) await chrome.action.setBadgeBackgroundColor({ color:'#64748B' });
  } catch (_) {}
}

async function ensureOffscreen() {
  try {
    const url = chrome.runtime.getURL('offscreen.html');
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [url]
    });
    if (contexts.length) return true;
    if (!offscreenCreating) {
      offscreenCreating = chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Reproducir el sonido y la voz del aviso cuando termina ChatGPT.'
      }).finally(() => { offscreenCreating = null; });
    }
    await offscreenCreating;
    return true;
  } catch (_) {
    offscreenCreating = null;
    return false;
  }
}

async function focusTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tabId, { active: true });
  } catch (_) {}
}

async function acknowledgeDone(tabId, reason = 'reopened') {
  if (typeof tabId !== 'number') return false;
  const state = await loadState(tabId);
  const wasDone = state.status === 'done';
  const hadVisual = !!(await getDoneVisualMeta(tabId));

  // La limpieza visual y la salida de LISTO no dependen de que el estado interno siga siendo "done".
  // Así también se corrigen estados desincronizados tras recargas, reinicios o actualizaciones.
  try { await chrome.action.setBadgeText({ tabId, text:'' }); } catch (_) {}
  try { await chrome.tabs.sendMessage(tabId, { type:'V613_CLEAR_DONE_TAB_VISUAL', reason }); } catch (_) {}
  await leaveReadyGroup(tabId).catch(() => {});
  await clearWindowAttentionForTab(tabId).catch(() => {});

  if (wasDone) {
    await resetIdle(tabId, {
      url: state.url || '',
      chatTitle: state.chatTitle || 'ChatGPT',
      windowId: state.windowId,
      index: state.index
    });
  }
  if (hudVisible && wasDone) {
    broadcastHud({ type:'V66_HUD_ACK_DONE', tabId, reason }).catch(() => {});
  }
  return wasDone || hadVisual;
}

async function isChatActuallyVisible(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.active || typeof tab.windowId !== 'number') return false;
    const win = await chrome.windows.get(tab.windowId);
    return !!win?.focused;
  } catch (_) { return false; }
}

function notificationId(tabId, requestId) {
  const clean = String(requestId || Date.now()).replace(/[^a-z0-9_-]/gi,'_').slice(-90);
  return `v62-finished-${tabId}-${clean}`;
}

async function showNotification({ tabId, requestId, chatTitle: titleRaw, preview, test = false }) {
  let permission = 'granted';
  try { permission = await chrome.notifications.getPermissionLevel(); } catch (_) {}
  if (permission !== 'granted') {
    if (hudVisible) broadcastHud({ type:'V62_HUD_NOTIFICATION_BLOCKED' }).catch(() => {});
    return '';
  }

  const id = test ? `v62-test-${Date.now()}` : notificationId(tabId, requestId);
  const title = test ? '✓ ChatGPT · prueba' : `✓ ${safeTitle(titleRaw)} ha terminado`;
  const message = test ? 'La notificación, el sonido y la voz están funcionando.' :
    (preview ? String(preview).slice(0, 260) : 'La respuesta ya está lista.');

  try {
    await chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message,
      priority: 2,
      requireInteraction: true,
      silent: true
    });
    await chrome.storage.session.set({ [notifSessionKey(id)]: { tabId, requestId, test } });
    return id;
  } catch (_) { return ''; }
}

async function playAlertSequence({ notificationId: id, tabId, requestId, chatTitle: titleRaw, test = false }) {
  const cfg = await getSettings();
  const title = safeTitle(titleRaw);
  const speechText = test
    ? 'Prueba de avisos de ChatGPT completada.'
    : (title === 'ChatGPT' ? 'ChatGPT ha terminado.' : `El chat ${title} ha terminado.`);

  const ok = await ensureOffscreen();
  if (!ok) {
    setTimeout(() => {
      chrome.notifications.clear(id).catch(() => {});
      if (hudVisible) broadcastHud({ type:'V62_HUD_CLOSE_COMPLETION', requestId }).catch(() => {});
    }, 3000);
    return;
  }

  try {
    await chrome.runtime.sendMessage({
      type: 'V62_PLAY_ALERT', target: 'offscreen',
      notificationId: id, tabId, requestId,
      volume: cfg.soundVolume,
      sound: cfg.soundEnabled,
      speak: cfg.voiceAnnouncements,
      speechText
    });
  } catch (_) {
    setTimeout(() => chrome.notifications.clear(id).catch(() => {}), 3000);
  }
}

async function handleFinished(tabId, msg) {
  if (!msg?.requestId) return { ok:false, ignored:'missing-request-id' };
  const old = await loadState(tabId);
  const incomingKey = chatKey(msg.url || msg.chatKey || '');
  const storedKey = old.chatKey || chatKey(old.url || '');

  // Finales viejos, de otra conversación o sin una petición activa no pueden avisar.
  if (old.status !== 'working') return { ok:true, ignored:'not-working' };
  if (!old.requestId || old.requestId !== msg.requestId) return { ok:true, ignored:'request-mismatch' };
  if (storedKey && incomingKey && storedKey !== incomingKey && !isMaterializedNewChat(storedKey, incomingKey, old.startedAt)) {
    return { ok:true, ignored:'chat-mismatch' };
  }
  if (!(old.evidenceSeen || msg.evidenceSeen)) return { ok:true, ignored:'no-evidence' };
  if (old.lastHandledRequestId === msg.requestId) return { ok:true, ignored:'duplicate' };

  const next = await setState(tabId, {
    requestId: msg.requestId,
    lastHandledRequestId: msg.requestId,
    status: 'done',
    doneUnread: true,
    chatTitle: safeTitle(msg.chatTitle || old.chatTitle),
    preview: msg.preview || old.preview || '',
    activityText: 'Respuesta terminada',
    startedAt: old.startedAt || msg.startedAt || null,
    finishedAt: msg.finishedAt || Date.now(),
    evidenceSeen: true,
    lastEvidenceAt: msg.lastEvidenceAt || old.lastEvidenceAt || Date.now(),
    url: msg.url || old.url || '',
    chatKey: incomingKey || storedKey
  });

  try {
    await chrome.action.setBadgeText({ tabId, text:'' });
  } catch (_) {}

  const cfg = await getSettings();
  if (!cfg.enabled) return { ok:true, notified:false, reason:'disabled' };
  if (await isExcludedChat(next.chatKey || next.url || '')) {
    return { ok:true, notified:false, reason:'excluded-chat' };
  }

  const chatVisible = await isChatActuallyVisible(tabId);
  if (chatVisible) {
    // Si el usuario ya está dentro del chat, nunca lo dejamos atrapado en LISTO ni con favicon verde.
    // notifyActiveChat solo controla si avisamos; el estado visual se reconoce igualmente.
    if (cfg.notifyActiveChat) {
      const id = await showNotification({
        tabId, requestId: msg.requestId, chatTitle: next.chatTitle, preview: next.preview
      });
      if (id) playAlertSequence({ notificationId:id, tabId, requestId:msg.requestId, chatTitle:next.chatTitle });
    }
    await acknowledgeDone(tabId, 'finished-while-open');
    return { ok:true, notified:!!cfg.notifyActiveChat, reason:'active-chat' };
  }

  try { await chrome.tabs.sendMessage(tabId, { type:'V613_APPLY_DONE_TAB_VISUAL' }); } catch (_) {}
  await applyChromeDoneColor(tabId).catch(() => {});
  repairPendingDonePresentation(tabId).catch(() => {});

  const id = await showNotification({
    tabId,
    requestId: msg.requestId,
    chatTitle: next.chatTitle,
    preview: next.preview
  });

  if (hudVisible) {
    broadcastHud({
      type:'V62_HUD_COMPLETION',
      requestId: msg.requestId,
      title: next.chatTitle,
      tab: toHudState(next)
    }).catch(() => {});
  }

  if (id) playAlertSequence({ notificationId:id, tabId, requestId:msg.requestId, chatTitle:next.chatTitle });
  try {
    await setState(tabId, { lastNotifiedRequestId: msg.requestId });
    await chrome.action.setBadgeText({ tabId, text:'✓' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color:'#16A34A' });
    setTimeout(() => chrome.action.setBadgeText({ tabId, text:'' }).catch(() => {}), 4000);
  } catch (_) {}
  return { ok:true, notified:!!id };
}


chrome.runtime.onInstalled.addListener(async details => {
  try {
    await refreshAiRoutes();
    await ensureRegisteredGlobalScripts();
    const stored = await chrome.storage.sync.get(null);
    const missing = {};
    for (const [k,v] of Object.entries(DEFAULTS)) if (!(k in stored)) missing[k] = v;
    if (Object.keys(missing).length) await chrome.storage.sync.set(missing);
    await consolidateAllReadyGroups();
    // Desde v6.10 se conserva la posición/estado del dock entre actualizaciones.
    const cfg = await getSettings();
    await syncActionEnabledState(cfg.enabled);
    hudVisible = false;
    hudTabId = null;
    hudStateHydrated = true;
    await persistHudState();

    // Solo inyecta el detector de Alt+Mayús en pestañas ya abiertas. El HUD completo se monta
    // de forma perezosa al abrirlo, evitando ralentizar todas las webs.
    if (details.reason === 'install' || details.reason === 'update') {
      const tabs = (await chrome.tabs.query({})).filter(tab => typeof tab.id === 'number' && isHudPage(tab.url || ''));
      await Promise.allSettled(tabs.map(tab => ensureGlobalControlsInTab(tab)));
      // En ChatGPT sí actualizamos el detector sin recargar.
      await Promise.allSettled(tabs.filter(tab => isChatUrl(tab.url || '')).map(async tab => {
        try { await chrome.scripting.executeScript({ target:{ tabId:tab.id }, files:['page-hook-v62.js'], world:'MAIN' }); } catch (_) {}
        try { await chrome.scripting.executeScript({ target:{ tabId:tab.id }, files:['detector-v62.js'] }); } catch (_) {}
      }));
    }
  } catch (_) {}
});

chrome.runtime.onStartup.addListener(async () => {
  refreshAiRoutes().then(() => ensureRegisteredGlobalScripts()).catch(() => {});
  await consolidateAllReadyGroups().catch(() => {});
  // Tras reabrir Chrome, reconoce las pestañas visibles y repara las pendientes en segundo plano.
  try {
    const tabs = (await chrome.tabs.query({})).filter(t => isChatUrl(t.url || ''));
    for (const tab of tabs) {
      if (typeof tab.id !== 'number') continue;
      if (tab.active && await isChatActuallyVisible(tab.id)) {
        await acknowledgeDone(tab.id, 'browser-reopened');
      } else {
        const state = await loadState(tab.id);
        if (state?.status === 'done' && state?.doneUnread) {
          repairPendingDonePresentation(tab.id).catch(() => {});
        }
      }
    }
  } catch (_) {}
  hudVisible = false;
  hudTabId = null;
  hudStateHydrated = true;
  persistHudState().catch(() => {});
  try { await syncActionEnabledState((await getSettings()).enabled); } catch (_) {}
});

ensureRegisteredGlobalScripts().catch(() => {});
hydrateHudVisibility().catch(() => {});
getSettings().then(cfg => syncActionEnabledState(cfg.enabled)).catch(() => {});
// Si el service worker despierta con una pestaña antigua, garantiza solo el detector ligero
// en la pestaña activa. No escanea ni inyecta el HUD en todas las webs.
setTimeout(() => {
  getActiveTab().then(tab => ensureGlobalControlsInTab(tab)).catch(() => {});
}, 50);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === 'offscreen') return false;
  const tabId = sender.tab?.id;

  (async () => {
    switch (msg?.type) {
      case 'V62_DETECTOR_READY': {
        if (typeof tabId !== 'number') { sendResponse({ ok:false }); break; }
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        const nowKey = chatKey(msg.url || tab?.url || '');
        let state = await loadState(tabId);
        const storedKey = state.chatKey || chatKey(state.url || '');

        if (!Object.keys(state).length) {
          state = await resetIdle(tabId, {
            url: msg.url || tab?.url || '', chatTitle: msg.chatTitle || tab?.title,
            windowId: tab?.windowId, index: tab?.index
          });
        } else if (storedKey && nowKey && storedKey !== nowKey) {
          const canCarryWorking = state.status === 'working' && isMaterializedNewChat(storedKey, nowKey, state.startedAt);
          if (canCarryWorking) {
            state = await setState(tabId, {
              url: msg.url || tab?.url || '', chatKey: nowKey,
              chatTitle: safeTitle(msg.chatTitle || state.chatTitle || tab?.title),
              windowId: tab?.windowId, index: tab?.index
            });
          } else {
            state = await resetIdle(tabId, {
              url: msg.url || tab?.url || '', chatTitle: msg.chatTitle || tab?.title,
              windowId: tab?.windowId, index: tab?.index
            });
          }
        } else {
          state = await setState(tabId, {
            url: msg.url || tab?.url || state.url || '', chatKey: nowKey || storedKey,
            chatTitle: safeTitle(msg.chatTitle || state.chatTitle || tab?.title),
            windowId: tab?.windowId, index: tab?.index
          });
        }

        // Una recarga/reapertura de la pestaña activa cuenta como abrir el chat: se reconoce
        // inmediatamente, sale de LISTO y el detector recibe estado idle para restaurar el favicon normal.
        if (state.status === 'done' && await isChatActuallyVisible(tabId)) {
          await acknowledgeDone(tabId, 'detector-ready-visible');
          state = await loadState(tabId);
        }

        sendResponse({ ok:true, state: toHudState(state), rawState: {
          requestId: state.requestId || '', status: state.status || 'idle',
          startedAt: state.startedAt || null, finishedAt: state.finishedAt || null,
          evidenceSeen: !!state.evidenceSeen, lastEvidenceAt: state.lastEvidenceAt || null,
          preview: state.preview || '', chatKey: state.chatKey || nowKey, url: state.url || msg.url || ''
        }});
        break;
      }

      case 'V62_REQUEST_STARTED': {
        if (typeof tabId !== 'number' || !msg.requestId) { sendResponse({ ok:false }); break; }
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        const url = msg.url || tab?.url || '';
        const previous = await loadState(tabId);
        // Si llega la misma petición otra vez por una mutación del DOM, el cronómetro no se reinicia.
        const startedAt = (previous.status === 'working' && previous.requestId === msg.requestId && Number(previous.startedAt))
          ? Number(previous.startedAt)
          : (Number(msg.startedAt) || Date.now());
        await setState(tabId, {
          requestId: msg.requestId,
          status: 'working',
          chatTitle: safeTitle(msg.chatTitle || tab?.title),
          preview: msg.preview || '',
          activityText: msg.activityText || 'Trabajando…',
          startedAt,
          finishedAt: null,
          evidenceSeen: false,
          lastEvidenceAt: null,
          url,
          chatKey: chatKey(url),
          windowId: tab?.windowId,
          index: tab?.index
        });
        try {
          await chrome.action.setBadgeText({ tabId, text:'…' });
          await chrome.action.setBadgeBackgroundColor({ tabId, color:'#0284C7' });
        } catch (_) {}
        sendResponse({ ok:true, startedAt });
        break;
      }

      case 'V62_TAB_STATE': {
        if (typeof tabId !== 'number') { sendResponse({ ok:false }); break; }
        const old = await loadState(tabId);
        if (!old.requestId || !msg.requestId || old.requestId === msg.requestId || msg.status === 'idle') {
          const incomingKey = chatKey(msg.url || old.url || '');
          const oldKey = old.chatKey || chatKey(old.url || '');
          if (old.status === 'working' && msg.requestId && old.requestId !== msg.requestId) {
            sendResponse({ ok:true, ignored:'stale-request' });
            break;
          }
          if (oldKey && incomingKey && oldKey !== incomingKey && old.status === 'working' && !isMaterializedNewChat(oldKey, incomingKey, old.startedAt)) {
            sendResponse({ ok:true, ignored:'stale-chat' });
            break;
          }
          await setState(tabId, {
            requestId: msg.requestId || old.requestId || '',
            status: msg.status || old.status || 'idle',
            chatTitle: safeTitle(msg.chatTitle || old.chatTitle),
            preview: typeof msg.preview === 'string' ? msg.preview : (old.preview || ''),
            activityText: msg.activityText || old.activityText || '',
            startedAt: old.startedAt || msg.startedAt || null,
            finishedAt: msg.finishedAt ?? old.finishedAt ?? null,
            evidenceSeen: !!(old.evidenceSeen || msg.evidenceSeen),
            lastEvidenceAt: msg.lastEvidenceAt || old.lastEvidenceAt || null,
            url: msg.url || old.url || '',
            chatKey: incomingKey || oldKey
          });
        }
        sendResponse({ ok:true });
        break;
      }

      case 'V62_REQUEST_CANCELLED': {
        if (typeof tabId !== 'number') { sendResponse({ ok:false }); break; }
        const old = await loadState(tabId);
        if (!msg.requestId || old.requestId === msg.requestId) {
          await resetIdle(tabId, {
            url: msg.url || old.url || '', chatTitle: msg.chatTitle || old.chatTitle,
            windowId: old.windowId, index: old.index
          });
          try { await chrome.action.setBadgeText({ tabId, text:'' }); } catch (_) {}
        }
        sendResponse({ ok:true });
        break;
      }

      case 'V62_REQUEST_FINISHED': {
        const result = (typeof tabId === 'number' && msg.requestId)
          ? await handleFinished(tabId, msg)
          : { ok:false };
        sendResponse(result);
        break;
      }

      case 'V62_HUD_HELLO':
      case 'V65_HUD_HELLO':
      case 'V66_HUD_HELLO':
      case 'V67_HUD_HELLO':
      case 'V68_HUD_HELLO':
      case 'V612_HUD_HELLO':
      case 'V69_HUD_HELLO': {
        await hydrateHudVisibility();
        const ownTab = Number(sender.tab?.id);
        const ownVisible = !!(hudVisible && Number.isFinite(ownTab) && ownTab === Number(hudTabId));
        sendResponse({ visible:ownVisible, tabs:[] });
        if (ownVisible) refreshHudSnapshotForTab(ownTab).catch(() => {});
        break;
      }

      case 'V64_GET_HUD_STATE':
      case 'V65_GET_HUD_STATE':
      case 'V66_GET_HUD_STATE':
      case 'V67_GET_HUD_STATE':
      case 'V68_GET_HUD_STATE':
      case 'V612_GET_HUD_STATE':
      case 'V69_GET_HUD_STATE': {
        await hydrateHudVisibility();
        const activeTab = sender.tab || await getActiveTab();
        let physical = null;
        const ownsHud = !!(activeTab?.id != null && Number(activeTab.id) === Number(hudTabId));
        if (ownsHud && isHudPage(activeTab?.url || '')) {
          try { physical = await chrome.tabs.sendMessage(activeTab.id, { type:'V69_HUD_PING' }); } catch (_) {}
        }
        sendResponse({
          ok:true,
          visible:!!(hudVisible && ownsHud && physical?.visible && physical?.painted && physical?.onScreen),
          requestedVisible:!!(hudVisible && ownsHud),
          physical,
          enabled:(await getSettings()).enabled,
          activeWebPage:isHudPage(activeTab?.url || ''), activeAiPage:isHudPage(activeTab?.url || ''), activeUrl:activeTab?.url || '',
          hudTabId:Number.isFinite(Number(hudTabId)) ? Number(hudTabId) : null
        });
        break;
      }

      case 'V64_SET_HUD_VISIBILITY':
      case 'V65_SET_HUD_VISIBILITY':
      case 'V66_SET_HUD_VISIBILITY':
      case 'V67_SET_HUD_VISIBILITY':
      case 'V68_SET_HUD_VISIBILITY':
      case 'V612_SET_HUD_VISIBILITY':
      case 'V69_SET_HUD_VISIBILITY': {
        await hydrateHudVisibility();
        const cfg = await getSettings();
        const activeTab = sender.tab || await getActiveTab();
        const wantVisible = !!msg.visible && !!cfg.enabled;
        if (wantVisible && !isHudPage(activeTab?.url || '')) {
          sendResponse({ ok:false, visible:false, enabled:cfg.enabled, reason:'unsupported-page' });
          break;
        }

        const previousTabId = Number.isFinite(Number(hudTabId)) ? Number(hudTabId) : null;
        if (!wantVisible) {
          const targetId = Number.isFinite(Number(sender.tab?.id)) ? Number(sender.tab.id) : previousTabId;
          hudVisible = false; hudTabId = null; hudStateHydrated = true;
          await persistHudState();
          if (targetId != null) hideHudInTab(targetId).catch(() => {});
          sendResponse({ ok:true, visible:false, enabled:cfg.enabled, delivered:targetId != null ? 1 : 0, localReady:true, physical:null });
          break;
        }

        if (previousTabId != null && previousTabId !== activeTab.id) hideHudInTab(previousTabId).catch(() => {});
        ensureGlobalControlsInTab(activeTab).catch(() => {});
        hudVisible = true; hudTabId = activeTab.id; hudStateHydrated = true;
        await persistHudState();
        const shown = await showHudInTab(activeTab);
        sendResponse({ ok:true, visible:true, enabled:cfg.enabled, delivered:shown.ready ? 1 : 0, localReady:shown.ready, physical:shown.physical });
        break;
      }

      case 'V612_PREPARE_CURRENT_TAB': {
        const tab = sender.tab || await getActiveTab();
        if (!tab || !isHudPage(tab.url || '')) { sendResponse({ ok:false, reason:'unsupported-page' }); break; }
        const controls = await ensureGlobalControlsInTab(tab);
        const hud = await ensureHudInTab(tab);
        sendResponse({ ok:!!(controls || hud), controls, hud, tabId:tab.id, url:tab.url || '' });
        break;
      }

      case 'V64_GET_CHAT_MANAGER':
      case 'V65_GET_CHAT_MANAGER':
      case 'V66_GET_CHAT_MANAGER':
      case 'V67_GET_CHAT_MANAGER':
      case 'V68_GET_CHAT_MANAGER':
      case 'V69_GET_CHAT_MANAGER': {
        const openTabs = (await chrome.tabs.query({})).filter(t => isChatUrl(t.url || ''));
        const excluded = await getExcludedChats();
        const chats = [];
        for (const tab of openTabs) {
          if (typeof tab.id !== 'number') continue;
          const state = await loadState(tab.id);
          const liveUrl = tab.url || state.url || '';
          const key = exclusionKey(liveUrl);
          chats.push({
            tabId:tab.id,
            title:safeTitle(tab.title || state.chatTitle || 'ChatGPT'),
            url:liveUrl,
            key,
            canExclude:!!key,
            excluded:!!(key && excluded[key]),
            status:state.status || 'idle'
          });
        }
        chats.sort((a,b) => Number(a.excluded)-Number(b.excluded) || a.title.localeCompare(b.title, 'es'));
        sendResponse({ ok:true, chats });
        break;
      }

      case 'V62_TOGGLE_HUD':
      case 'V65_TOGGLE_HUD':
      case 'V66_TOGGLE_HUD':
      case 'V67_TOGGLE_HUD':
      case 'V68_TOGGLE_HUD':
      case 'V612_TOGGLE_HUD':
      case 'V69_TOGGLE_HUD': {
        await hydrateHudVisibility();
        const triggerTab = sender.tab || await getActiveTab();
        if (!isHudPage(triggerTab?.url || '')) {
          sendResponse({ visible:false, blocked:true, reason:'unsupported-page' });
          break;
        }
        const cfg = await getSettings();
        if (!cfg.enabled) {
          const oldId = hudTabId; hudVisible = false; hudTabId = null; hudStateHydrated = true;
          await persistHudState();
          if (oldId != null) hideHudInTab(oldId).catch(() => {});
          sendResponse({ visible:false, disabled:true });
          break;
        }

        const sameTabVisible = !!(hudVisible && Number(hudTabId) === Number(triggerTab.id));
        if (sameTabVisible) {
          hudVisible = false; const oldId = hudTabId; hudTabId = null; hudStateHydrated = true;
          await persistHudState();
          hideHudInTab(oldId).catch(() => {});
          sendResponse({ visible:false, localReady:true, physical:null });
          break;
        }

        const previousTabId = Number.isFinite(Number(hudTabId)) ? Number(hudTabId) : null;
        if (previousTabId != null && previousTabId !== triggerTab.id) hideHudInTab(previousTabId).catch(() => {});
        ensureGlobalControlsInTab(triggerTab).catch(() => {});
        hudVisible = true; hudTabId = triggerTab.id; hudStateHydrated = true;
        await persistHudState();
        const shown = await showHudInTab(triggerTab);
        sendResponse({ visible:true, localReady:shown.ready, physical:shown.physical });
        break;
      }

      case 'V62_EXCLUDE_CHAT': {
        const targetTabId = Number(msg.tabId);
        if (!Number.isFinite(targetTabId)) { sendResponse({ ok:false, reason:'invalid-tab' }); break; }
        const [state, liveTab] = await Promise.all([
          loadState(targetTabId),
          chrome.tabs.get(targetTabId).catch(() => null)
        ]);
        const liveUrl = liveTab?.url || state.url || state.chatKey || '';
        const key = exclusionKey(liveUrl);
        if (!key) { sendResponse({ ok:false, reason:'not-a-conversation' }); break; }
        const excluded = { ...(await getExcludedChats()) };
        excluded[key] = {
          key,
          title: safeTitle(msg.title || liveTab?.title || state.chatTitle || 'ChatGPT'),
          url: liveUrl,
          excludedAt: Date.now()
        };
        await saveExcludedChats(excluded);
        if (hudVisible) {
          await broadcastHud({ type:'V62_HUD_TAB_REMOVED', tabId:targetTabId });
          await broadcastHud({ type:'V62_HUD_EXCLUDED', title:excluded[key].title });
        }
        sendResponse({ ok:true, excluded:excluded[key] });
        break;
      }

      case 'V62_GET_EXCLUDED_CHATS': {
        const excluded = await getExcludedChats();
        const chats = Object.values(excluded).sort((a,b) => (b.excludedAt || 0) - (a.excludedAt || 0));
        sendResponse({ ok:true, chats });
        break;
      }

      case 'V62_INCLUDE_CHAT': {
        const key = String(msg.key || '');
        const excluded = { ...(await getExcludedChats()) };
        if (key && excluded[key]) delete excluded[key];
        await saveExcludedChats(excluded);
        if (hudVisible) await refreshHudSnapshot();
        sendResponse({ ok:true });
        break;
      }

      case 'V62_CLEAR_EXCLUDED_CHATS': {
        await saveExcludedChats({});
        if (hudVisible) await refreshHudSnapshot();
        sendResponse({ ok:true });
        break;
      }

      case 'V62_FOCUS_TAB':
      case 'V65_FOCUS_TAB':
      case 'V66_FOCUS_TAB':
      case 'V67_FOCUS_TAB':
      case 'V68_FOCUS_TAB': {
        const focusId = Number(msg.tabId);
        await focusTab(focusId);
        await acknowledgeDone(focusId, 'opened-from-hud');
        sendResponse({ ok:true });
        break;
      }

      case 'V65_ACK_DONE':
      case 'V66_ACK_DONE':
      case 'V67_ACK_DONE':
      case 'V68_ACK_DONE': {
        const target = Number(msg.tabId ?? tabId);
        sendResponse({ ok:true, acknowledged:await acknowledgeDone(target, 'opened') });
        break;
      }

      case 'V62_ALERT_CLOSE_NOW': {
        const id = String(msg.notificationId || '');
        if (id) {
          await chrome.notifications.clear(id).catch(() => {});
          await chrome.storage.session.remove(notifSessionKey(id)).catch(() => {});
        }
        if (hudVisible) await broadcastHud({ type:'V62_HUD_CLOSE_COMPLETION', requestId:String(msg.requestId || '') });
        sendResponse({ ok:true });
        break;
      }

      case 'V62_TEST_ALERT': {
        const id = await showNotification({ tabId:null, requestId:`test-${Date.now()}`, chatTitle:'Prueba ChatGPT', preview:'Aviso de prueba.', test:true });
        if (id) await playAlertSequence({ notificationId:id, tabId:-1, requestId:id, chatTitle:'Prueba ChatGPT', test:true });
        sendResponse({ ok:!!id });
        break;
      }

      case 'V62_GET_NOTIFICATION_PERMISSION': {
        let permission = 'unknown';
        try { permission = await chrome.notifications.getPermissionLevel(); } catch (_) {}
        sendResponse({ permission });
        break;
      }

      default:
        sendResponse({ ok:false });
    }
  })().catch(() => sendResponse({ ok:false }));
  return true;
});

chrome.notifications.onClicked.addListener(async id => {
  try {
    const key = notifSessionKey(id);
    const meta = (await chrome.storage.session.get(key))[key];
    if (meta && typeof meta.tabId === 'number' && meta.tabId >= 0) {
      await focusTab(meta.tabId);
      await acknowledgeDone(meta.tabId, 'notification-opened');
    }
    await chrome.notifications.clear(id);
    await chrome.storage.session.remove(key);
  } catch (_) {}
});

if (chrome.webNavigation?.onCommitted) {
  chrome.webNavigation.onCommitted.addListener(details => {
    if (details.frameId !== 0 || !isHudPage(details.url || '')) return;
    chrome.tabs.get(details.tabId).then(tab => ensureGlobalControlsInTab(tab)).catch(() => {});
  });
}

chrome.tabs.onRemoved.addListener(tabId => {
  (async () => {
    // Limpia/restaura el color del grupo incluso si la pestaña se cerró sin abrirse.
    await clearChromeDoneColor(tabId).catch(() => {});
    delete stateCache[tabId];
    await chrome.storage.session.remove(stateSessionKey(tabId)).catch(() => {});
    if (Number(tabId) === Number(hudTabId)) {
      hudVisible = false; hudTabId = null; hudStateHydrated = true;
      persistHudState().catch(() => {});
    } else if (hudVisible) {
      broadcastHud({ type:'V62_HUD_TAB_REMOVED', tabId }).catch(() => {});
      refreshHudSnapshot().catch(() => {});
    }
  })().catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (Object.prototype.hasOwnProperty.call(change, 'groupId')) refreshHudSnapshot().catch(() => {});
  const url = tab.url || change.url || '';
  if (!isChatUrl(url)) return;

  (async () => {
    const old = await loadState(tabId);
    if (!Object.keys(old).length) {
      // Aunque no haya estado, una pestaña que el usuario abre no debe quedarse en LISTO por desincronización.
      if (tab.active) await leaveReadyGroup(tabId).catch(() => {});
      return;
    }

    if (tab.active && await isChatActuallyVisible(tabId)) {
      await acknowledgeDone(tabId, change.status === 'complete' ? 'tab-reloaded' : 'tab-active-update');
    } else if (old.status === 'done' && old.doneUnread
      && (change.status === 'complete' || Object.prototype.hasOwnProperty.call(change, 'groupId'))) {
      // Tras recargas o cambios de grupo en segundo plano, repara automáticamente favicon + LISTO.
      repairPendingDonePresentation(tabId).catch(() => {});
    }

    const liveState = await loadState(tabId);
    if (!Object.keys(liveState).length) return;

    if (change.url) {
      const newKey = chatKey(change.url);
      const oldKey = liveState.chatKey || chatKey(liveState.url || '');
      if (oldKey && newKey && oldKey !== newKey) {
        if (liveState.status === 'working' && isMaterializedNewChat(oldKey, newKey, liveState.startedAt)) {
          await setState(tabId, { url:change.url, chatKey:newKey, windowId:tab.windowId, index:tab.index });
        } else {
          await resetIdle(tabId, {
            url:change.url, chatTitle:tab.title,
            windowId:tab.windowId, index:tab.index
          });
        }
      } else {
        await setState(tabId, { url:change.url, chatKey:newKey || oldKey, windowId:tab.windowId, index:tab.index });
      }
    }

    if (change.title) {
      await setState(tabId, { chatTitle:safeTitle(change.title), windowId:tab.windowId, index:tab.index });
    }
  })().catch(() => {});
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  acknowledgeDone(tabId, 'tab-reopened').catch(() => {});
  (async () => {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || !isHudPage(tab.url || '')) return;
    // Garantiza Alt+Mayús en pestañas antiguas sin cargar el HUD completo.
    ensureGlobalControlsInTab(tab).catch(() => {});
    await hydrateHudVisibility();
    if (hudVisible && Number(hudTabId) === Number(tabId)) {
      await showHudInTab(tab);
    }
  })().catch(() => {});
});

// Recuperación del atajo/HUD en páginas que ya estaban abiertas o que terminaron de navegar.
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status !== 'complete' || !isHudPage(tab?.url || change.url || '')) return;
  (async () => {
    ensureGlobalControlsInTab(tab).catch(() => {});
    if (isChatUrl(tab?.url || change.url || '') && tab?.active && await isChatActuallyVisible(tabId)) {
      await acknowledgeDone(tabId, 'completed-visible');
    }
    await hydrateHudVisibility();
    if (hudVisible && Number(hudTabId) === Number(tabId)) {
      await showHudInTab(tab);
    }
  })().catch(() => {});
});

// Mantiene el HUD sincronizado con la organización real de grupos/pestañas de Chrome.
if (chrome.tabs.onMoved) chrome.tabs.onMoved.addListener(() => { refreshHudSnapshot().catch(() => {}); });
if (chrome.tabs.onAttached) chrome.tabs.onAttached.addListener(() => { refreshHudSnapshot().catch(() => {}); });
if (chrome.tabs.onDetached) chrome.tabs.onDetached.addListener(() => { refreshHudSnapshot().catch(() => {}); });
if (chrome.tabGroups?.onCreated) chrome.tabGroups.onCreated.addListener(group => {
  try {
    const id = Number(group?.id);
    if (Number.isFinite(id) && id >= 0) groupMetaCache.set(id, {
      groupId:id, groupTitle:String(group?.title || ''), groupColor:String(group?.color || ''), groupCollapsed:!!group?.collapsed
    });
  } catch (_) {}
  refreshHudSnapshot().catch(() => {});
});
if (chrome.tabGroups?.onUpdated) chrome.tabGroups.onUpdated.addListener(group => {
  try {
    const id = Number(group?.id);
    if (Number.isFinite(id) && id >= 0) groupMetaCache.set(id, {
      groupId:id, groupTitle:String(group?.title || ''), groupColor:String(group?.color || ''), groupCollapsed:!!group?.collapsed
    });
  } catch (_) {}
  refreshHudSnapshot().catch(() => {});
});
if (chrome.tabGroups?.onMoved) chrome.tabGroups.onMoved.addListener(() => { refreshHudSnapshot().catch(() => {}); });
if (chrome.tabGroups?.onRemoved) chrome.tabGroups.onRemoved.addListener(group => {
  (async () => {
    try {
      const gid = Number(group?.id);
      groupMetaCache.delete(gid);
      const wid = Number(group?.windowId);
      if (Number.isFinite(wid)) await forgetReadyGroup(wid, gid);
    } catch (_) {}
    refreshHudSnapshot().catch(() => {});
  })().catch(() => {});
});

chrome.windows.onFocusChanged.addListener(async windowId => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  try {
    const [tab] = await chrome.tabs.query({ active:true, windowId });
    if (typeof tab?.id === 'number') {
      await acknowledgeDone(tab.id, 'window-reopened');
      if (isHudPage(tab.url || '')) ensureGlobalControlsInTab(tab).catch(() => {});
    }
  } catch (_) {}
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local' && changes[EXCLUDED_KEY]) {
    excludedChatsCache = normalizeExcluded(changes[EXCLUDED_KEY].newValue);
    if (hudVisible) {
      try { await refreshHudSnapshot(); } catch (_) {}
    }
    return;
  }
  if (area !== 'sync' || !changes.enabled) return;
  const enabled = !!changes.enabled.newValue;
  try {
    await syncActionEnabledState(enabled);
    if (!enabled) {
      const oldId = hudTabId;
      hudVisible = false; hudTabId = null; hudStateHydrated = true;
      await persistHudState();
      if (oldId != null) hideHudInTab(oldId).catch(() => {});

      const notifications = await chrome.notifications.getAll().catch(() => ({}));
      await Promise.allSettled(Object.keys(notifications || {}).filter(id => id.startsWith('v62-')).map(id => chrome.notifications.clear(id)));
      try { await chrome.runtime.sendMessage({ type:'V62_CANCEL_ALERTS', target:'offscreen' }); } catch (_) {}
    }
  } catch (_) {}
});
