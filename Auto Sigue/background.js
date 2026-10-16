importScripts('drive_links.js','generic-background.js');
// Serializa el envío de pasos para que dos pestañas del mismo chat no envíen a la vez.
const locks = new Map();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message || !['WORKFLOW_CLAIM', 'WORKFLOW_RELEASE'].includes(message.type)) return;
  const key = String(message.chatKey || '');
  const token = String(message.token || '');
  if (!/^c:[^\s]{3,}$/.test(key) || !token) { respond({ ok: false }); return; }
  const current = locks.get(key);
  if (message.type === 'WORKFLOW_CLAIM') {
    if (current && current.expires > Date.now()) respond({ ok: false });
    else { locks.set(key, { token, expires: Date.now() + 30000 }); respond({ ok: true }); }
  } else {
    if (current?.token === token) locks.delete(key);
    respond({ ok: true });
  }
});

// Sin migración: no se crean, cierran, eliminan ni modifican pestañas desde background.
