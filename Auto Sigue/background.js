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

// v3.4: reserva atomica por turno; la bitacora permanece tras reiniciar Chrome.
const continueLocks = new Set();
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || !['CONTINUE_RESERVE','CONTINUE_CLICKED','CONTINUE_RESULT','CONTINUE_RELEASE','CONTINUE_RECONCILE'].includes(msg.type)) return;
  (async () => {
    const chatKey = String(msg.chatKey || '');
    const turn = String(msg.turn || '');
    const tabId = sender.tab?.id;
    const url = sender.tab?.url || '';
    const match = url.match(/^https:\/\/(?:chatgpt\.com|chat\.openai\.com)\/(?:[^?#]*\/)?c\/([^/?#]+)/);
    if (!Number.isInteger(tabId) || !match || chatKey !== 'c:' + match[1] || !turn || turn.length > 150)
      return {ok:false,error:'Origen o turno no autorizado'};
    if (continueLocks.has(chatKey)) return {ok:false,error:'Otro envio esta cambiando de estado'};
    continueLocks.add(chatKey);
    try {
      const store = await chrome.storage.local.get({autosigueContinueLedger:{}});
      const all = {...store.autosigueContinueLedger};
      const records = {...(all[chatKey]?.records || {})};
      const before = records[turn];
      const now = Date.now();
      if (msg.type === 'CONTINUE_RESERVE') {
        if (before && ['clicked','uncertain','sent'].includes(before.state))
          return {ok:false,state:before.state,error:'Turno enviado o en comprobacion automatica'};
        if (before && before.state === 'reserved' && now-(before.at||0)<120000)
          return {ok:false,state:'reserved',error:'Envio reservado por otra pestaña'};
        const token = crypto.randomUUID();
        records[turn] = {state:'reserved',token,tabId,at:now};
        const last = Object.entries(records).sort((a,b)=>(b[1].at||0)-(a[1].at||0)).slice(0,30);
        all[chatKey]={records:Object.fromEntries(last),updatedAt:now};
        await chrome.storage.local.set({autosigueContinueLedger:all});
        return {ok:true,token};
      }
      const token = String(msg.token||'');
      // La comprobacion de un marcador visible es valida tras reiniciar Chrome,
      // cuando la pestaña recuperada recibe un ID distinto.
      const recovering=msg.type === 'CONTINUE_RECONCILE';
      if (!before || before.token !== token || (!recovering && before.tabId !== tabId))
        return {ok:false,error:'Reserva no coincide con la pestaña y turno'};
      if (msg.type === 'CONTINUE_CLICKED' && before.state === 'reserved') {
        records[turn]={...before,state:'clicked',at:now};
      } else if (msg.type === 'CONTINUE_RECONCILE' &&
                 ['clicked','uncertain'].includes(before.state) && msg.confirmed===true) {
        records[turn]={...before,state:'sent',at:now,reconciled:true};
      } else if (msg.type === 'CONTINUE_RELEASE' && before.state === 'reserved') {
        delete records[turn];
      } else if (msg.type === 'CONTINUE_RESULT' && before.state === 'clicked') {
        records[turn]={...before,state:msg.confirmed===true?'sent':'uncertain',at:now};
      } else return {ok:false,error:'Transicion de envio no permitida',state:before.state};
      all[chatKey]={records,updatedAt:now};
      await chrome.storage.local.set({autosigueContinueLedger:all});
      return {ok:true,state:records[turn]?.state||'released'};
    } finally { continueLocks.delete(chatKey); }
  })().then(reply).catch(e=>reply({ok:false,error:String(e?.message||e)}));
  return true;
});

// Los avisos de alarma son de mantenimiento: no fuerzan el envio cuando la web esta cerrada.
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('autosigue-check', {periodInMinutes:1}).catch(()=>{});
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('autosigue-check', {periodInMinutes:1}).catch(()=>{});
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name!=='autosigue-check') return;
  chrome.tabs.query({url:['https://chatgpt.com/*','https://chat.openai.com/*']}).then(async tabs=>{
    const {enabledChats={},enabled=true} = await chrome.storage.local.get({enabledChats:{},enabled:true});
    if(!enabled) return;
    for(const tab of tabs) {
      const m=String(tab.url||'').match(/\/c\/([^/?#]+)/);
      if(!m || !enabledChats['c:'+m[1]] || !Number.isInteger(tab.id)) continue;
      if(tab.discarded) continue; // No recargar una pestaña con operaciones en curso.
      chrome.tabs.update(tab.id,{autoDiscardable:false}).catch(()=>{});
      chrome.tabs.sendMessage(tab.id,{type:'WAKE_SCAN'}).catch(()=>{});
    }
  }).catch(()=>{});
});
