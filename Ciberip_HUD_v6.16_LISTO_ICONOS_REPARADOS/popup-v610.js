'use strict';
const DEFAULTS = {
  enabled: true,
  notifyActiveChat: false,
  soundEnabled: true,
  soundVolume: 80,
  voiceAnnouncements: true,
  showTitleFlash: true
};
const ids = Object.keys(DEFAULTS);
const $ = id => document.getElementById(id);

async function send(message) {
  try { return await chrome.runtime.sendMessage(message); } catch (_) { return null; }
}

// Abrir el popup es un gesto del usuario: activeTab permite reparar/injectar el atajo
// en la web actual aunque Chrome haya retenido el acceso global del sitio.
send({ type:'V612_PREPARE_CURRENT_TAB' }).catch(() => {});
function updateVolume() {
  $('volumeValue').textContent = `${Math.round(Number($('soundVolume').value || 0))} %`;
}
function updateMaster() {
  const on = !!$('enabled').checked;
  document.body.classList.toggle('off', !on);
  $('masterState').textContent = on ? 'ACTIVO' : 'APAGADO';
}
function setHudState(visible) {
  const el = $('hudState');
  el.classList.toggle('on', !!visible);
  el.textContent = visible ? 'VISIBLE' : 'OCULTO';
  $('toggleHud').textContent = visible ? 'Ocultar HUD' : 'Mostrar HUD';
}
function statusLabel(status) {
  return status === 'working' ? 'Trabajando' : status === 'done' ? 'Terminado' : 'En espera';
}
function formatDate(ts) {
  if (!ts) return 'Excluido';
  try { return `Excluido ${new Date(ts).toLocaleDateString('es-ES', { day:'2-digit', month:'2-digit' })}`; }
  catch (_) { return 'Excluido'; }
}
function statusIcon(status) {
  return status === 'working' ? '…' : status === 'done' ? '✓' : '·';
}

function switchView(name) {
  for (const tab of document.querySelectorAll('.tab')) tab.classList.toggle('active', tab.dataset.view === name);
  for (const view of document.querySelectorAll('.view')) view.classList.toggle('active', view.id === `view-${name}`);
}
for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => switchView(tab.dataset.view));

async function loadExcluded() {
  const r = await send({ type:'V62_GET_EXCLUDED_CHATS' });
  const chats = Array.isArray(r?.chats) ? r.chats : [];
  $('excludedCount').textContent = String(chats.length);
  $('excludedEmpty').classList.toggle('hidden', chats.length > 0);
  $('clearExcluded').classList.toggle('hidden', chats.length === 0);
  $('excludedList').innerHTML = '';
  for (const chat of chats) {
    const item = document.createElement('div');
    item.className = 'chat excluded';
    item.innerHTML = `<div class="stateMark">×</div><div class="chatCopy"><div class="chatTitle"></div><div class="chatMeta"></div></div>`;
    item.querySelector('.chatTitle').textContent = chat.title || 'ChatGPT';
    item.querySelector('.chatMeta').textContent = formatDate(chat.excludedAt);
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'smallBtn restore'; button.textContent = 'Incluir';
    button.addEventListener('click', async () => {
      button.disabled = true;
      const rr = await send({ type:'V62_INCLUDE_CHAT', key:chat.key });
      $('status').textContent = rr?.ok ? 'Chat restaurado.' : 'No se pudo restaurar.';
      if (rr?.ok) await refreshLists(); else button.disabled = false;
    });
    item.appendChild(button);
    $('excludedList').appendChild(item);
  }
}

async function loadOpenChats() {
  const r = await send({ type:'V69_GET_CHAT_MANAGER' });
  const chats = Array.isArray(r?.chats) ? r.chats : [];
  $('openCount').textContent = String(chats.length);
  $('openEmpty').classList.toggle('hidden', chats.length > 0);
  $('chatList').innerHTML = '';
  for (const chat of chats) {
    const item = document.createElement('div');
    item.className = `chat${chat.excluded ? ' excluded' : ''}`;
    item.dataset.status = chat.status || 'idle';
    item.innerHTML = `<div class="stateMark">${statusIcon(chat.status)}</div><div class="chatCopy"><div class="chatTitle"></div><div class="chatMeta"></div></div>`;
    item.querySelector('.chatTitle').textContent = chat.title || 'ChatGPT';
    item.querySelector('.chatMeta').textContent = chat.excluded ? 'Excluido' : (chat.canExclude ? statusLabel(chat.status) : 'Chat nuevo · todavía sin ID estable');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `smallBtn ${chat.excluded ? 'restore' : 'exclude'}`;
    button.textContent = chat.excluded ? 'Incluir' : 'Excluir';
    button.disabled = !chat.excluded && !chat.canExclude;
    button.addEventListener('click', async () => {
      button.disabled = true;
      const rr = chat.excluded
        ? await send({ type:'V62_INCLUDE_CHAT', key:chat.key })
        : await send({ type:'V62_EXCLUDE_CHAT', tabId:chat.tabId, title:chat.title });
      $('status').textContent = rr?.ok ? (chat.excluded ? 'Chat restaurado.' : 'Chat excluido.') : 'No se pudo cambiar el estado del chat.';
      if (rr?.ok) await refreshLists(); else button.disabled = false;
    });
    item.appendChild(button);
    $('chatList').appendChild(item);
  }
}
async function refreshLists() { await Promise.all([loadOpenChats(), loadExcluded()]); }

async function load() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  for (const id of ids) {
    const el = $(id);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!s[id]; else el.value = s[id];
  }
  updateVolume(); updateMaster();
  const hs = await send({ type:'V612_GET_HUD_STATE' });
  setHudState(!!hs?.visible);
  await refreshLists();
  const p = await send({ type:'V62_GET_NOTIFICATION_PERMISSION' });
  $('status').textContent = `Notificaciones: ${p?.permission || 'desconocido'}`;
}

document.addEventListener('change', async e => {
  const id = e.target?.id;
  if (!id || !(id in DEFAULTS)) return;
  const el = e.target;
  const value = el.type === 'checkbox' ? el.checked : Number(el.value);
  await chrome.storage.sync.set({ [id]:value });
  if (id === 'soundVolume') updateVolume();
  if (id === 'enabled') updateMaster();
});
document.addEventListener('input', e => {
  if (e.target?.id !== 'soundVolume') return;
  updateVolume();
  const value = Math.max(0, Math.min(100, Number(e.target.value) || 0));
  chrome.storage.sync.set({ soundVolume:value }).catch(() => {});
});

$('toggleHud').addEventListener('click', async () => {
  const r = await send({ type:'V612_TOGGLE_HUD' });
  if (r?.disabled) {
    $('status').textContent = 'La extensión está apagada.';
    setHudState(false);
    return;
  }
  if (r?.blocked) {
    $('status').textContent = 'Chrome no permite inyectar el HUD en esta página interna.';
    return;
  }
  setHudState(!!r?.visible);
  $('status').textContent = r?.visible ? 'HUD mostrado.' : 'HUD ocultado.';
});
$('test').addEventListener('click', async () => {
  $('status').textContent = 'Enviando prueba…';
  const currentVolume = Math.max(0, Math.min(100, Number($('soundVolume').value) || 0));
  await chrome.storage.sync.set({ soundVolume:currentVolume });
  const r = await send({ type:'V62_TEST_ALERT' });
  $('status').textContent = r?.ok ? 'Prueba enviada.' : 'No se pudo crear el aviso.';
});
$('clearExcluded').addEventListener('click', async () => {
  const r = await send({ type:'V62_CLEAR_EXCLUDED_CHATS' });
  $('status').textContent = r?.ok ? 'Todos los chats vuelven a estar incluidos.' : 'No se pudieron restaurar.';
  if (r?.ok) await refreshLists();
});

load();
