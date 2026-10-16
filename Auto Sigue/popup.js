'use strict';
const $ = id => document.getElementById(id);
const DEFAULT = Object.freeze({ enabled: true, continueText:'sigue', finishDelaySeconds:3, watchdogEnabled:true, watchdogMinutes:20, maxContinuesPerChat:12, completionPhrase:'HE ACABADO' });
const ROUTE_KEY = AS_ROUTE_KEY;
const DATA_DEFAULTS = { ...DEFAULT, enabledChats:{}, stoppedChats:{}, handoffOptionsByChat:{}, handoffStatusByChat:{}, handoffJobsBySource:{} };
let activeTab = null;
let currentKey = '';
let currentSupported = false;
let routes = [];
let dataSnapshot = null;
let refreshSerial = 0;
let busyAction = false;
const CHATGPT_HOSTS = new Set(['chatgpt.com','chat.openai.com']);

const BUILTIN_AI=new Set(['chatgpt.com','chat.openai.com','claude.ai','gemini.google.com','grok.com','www.perplexity.ai','copilot.microsoft.com','chat.deepseek.com','chat.mistral.ai']);
async function grantRoutePermission(tab){
  const u=safeUrl(tab?.url||'');if(!u)return false;
  if(BUILTIN_AI.has(u.hostname))return true;
  // This call is made synchronously from the selectedChat input event; Chrome asks the user.
  return chrome.permissions.request({origins:[u.origin+'/*']});
}
async function injectCustom(tab){
  const u=safeUrl(tab?.url||'');if(!u||BUILTIN_AI.has(u.hostname))return;
  await chrome.scripting.executeScript({target:{tabId:tab.id},files:['generic-content.js']});
}
function safeUrl(url) { try {const u = new URL(url); return u.protocol==='https:'?u:null;} catch {return null;} }
function chatKey(url) { const u=safeUrl(url); if(!u||!CHATGPT_HOSTS.has(u.hostname)) return '';const m=u.pathname.match(/\/c\/([a-z0-9_-]+)/i);return m?'c:'+m[1]:''; }
function compact(s,max=100) {const t=String(s??'').trim();return t.length>max?t.slice(0,max-1)+'…':t;}
function writeNotice(text,kind='info') {const n=$('notice');n.textContent=String(text||'');n.classList.toggle('error',kind==='error');}
function routeFor(url) {return routes.find(r=>r.enabled!==false && AS_MATCH_ROUTE(r.pattern,url))||null;}
function setBadge(label,mode='off') {const el=$('stateBadge');el.textContent=label;el.dataset.state=mode;}
function renderSteps(stage){const n=stage==='detectado'?0:stage==='escribiendo'||stage==='enviando'?1:stage==='confirmado'?3:-1;document.querySelectorAll('.step').forEach((el,i)=>{el.classList.toggle('done',n===3||i<n);el.classList.toggle('active',n!==3&&i===n);});}
function switchDisabled(id,disabled){$(id).disabled=!!disabled;}
async function sendToChat(type,extra={}){if(!activeTab?.id)return{ok:false,error:'No hay una pestaña activa.'};try{return await chrome.tabs.sendMessage(activeTab.id,{type,...extra})||{ok:false,error:'El chat no respondió.'};}catch(err){return{ok:false,error:'No hay conexión con la extensión en esta pestaña. Recárgala y vuelve a intentarlo.'};}}
async function refresh(){const serial=++refreshSerial;try{
  const [[tab],storage] = await Promise.all([chrome.tabs.query({active:true,currentWindow:true}),chrome.storage.local.get(DATA_DEFAULTS)]);
  if(serial!==refreshSerial)return;
  activeTab=tab||null;dataSnapshot=storage;currentKey=AS_CHAT_KEY(tab);const availableRoute=routeFor(tab?.url||'');currentSupported=!!currentKey && !!availableRoute;
  for(const key of Object.keys(DEFAULT)){const el=$(key);if(!el)continue;const value=storage[key];if(el.type==='checkbox')el.checked=!!value;else if(document.activeElement!==el)el.value=value??DEFAULT[key];}
  const possibleChatGPT=safeUrl(tab?.url||'')&&CHATGPT_HOSTS.has(safeUrl(tab.url).hostname);
  if(currentSupported){$('currentChatTitle').textContent=compact((tab.title||availableRoute.name).replace(/\s*[-|–]\s*ChatGPT\s*$/i,''),92);
    $('currentChatHint').textContent=currentKey.startsWith('c:')?'ChatGPT · continúa en esta conversación.':availableRoute.name+' · continúa en esta conversación.';}
  else if(possibleChatGPT){$('currentChatTitle').textContent='ChatGPT · sin conversación identificada';$('currentChatHint').textContent='Envía un primer mensaje y espera a que la URL contenga /c/ para activar Auto Sigue.';}
  else if(availableRoute){$('currentChatTitle').textContent=availableRoute.name;$('currentChatHint').textContent='Ruta reconocida, pendiente de identificar una conversación estable.';}
  else{$('currentChatTitle').textContent='Ninguna IA compatible detectada';$('currentChatHint').textContent='Abre una IA reconocida o añádela en la pestaña Rutas IA.';}
  const selected=!!storage.enabledChats[currentKey];$('selectedChat').checked=selected;switchDisabled('selectedChat',!currentSupported||!storage.enabled);
  $('handoffNow').disabled=!currentSupported||!selected||!storage.enabled||busyAction;
  $('handoffReset').disabled=!currentSupported||!selected||busyAction;
  renderSteps('');
  $('handoffStatus').textContent='';
  if(!storage.enabled){setBadge('APAGADO');$('statusText').textContent='Auto Sigue está desactivado.';}
  else if(!currentSupported){setBadge(availableRoute?'SIN CHAT':'SIN IA');$('statusText').textContent='Abre una conversación y actívala.';}
  else if(!selected){setBadge('INACTIVO');$('statusText').textContent='Activa Auto Sigue para esta conversación.';}
  else{setBadge('ACTIVO','on');$('statusText').textContent='Conectando con el chat…';}
  if(!currentSupported||!selected||!storage.enabled)return;
  const reply=await sendToChat('GET_STATUS',{chatKey:currentKey});if(serial!==refreshSerial)return;
  if(!reply.ok){setBadge('SIN CONEXIÓN','failed');$('statusText').textContent=reply.error||'Recarga el chat para conectar la extensión.';$('handoffNow').disabled=true;return;}
  const state=reply.status||{};
  const step=state.sendStage||'';
  renderSteps(step);
  if(step==='finalizado'||state.stopped)setBadge('FINALIZADO','on');
  else if(step==='confirmado')setBadge('ENVIADO','on');
  else if(step==='enviando'||step==='escribiendo')setBadge('ENVIANDO','busy');
  else if(state.answering)setBadge('RESPONDIENDO','busy');
  else if(state.stopped)setBadge('DETENIDO');
  else if(state.lastError)setBadge('REVISAR','failed');
  else setBadge('ACTIVO','on');
  $('statusText').textContent=step==='finalizado'?'La IA ha indicado que terminó la tarea.':state.stopped?'Auto Sigue está detenido para esta conversación.':state.lastError?'No se ha confirmado el último envío.':'Esperando a que termine para enviar el mensaje configurado.';
  $('handoffStatus').textContent=state.lastError||state.lastAction||'';
  $('handoffNow').disabled=!!state.answering||!!state.sending||busyAction;
  $('handoffReset').disabled=busyAction;
}catch(e){writeNotice('Error al cargar el panel: '+String(e.message||e),'error');}}
function normalizeValue(id){const el=$(id);if(el.type==='checkbox')return el.checked;if(el.type==='number'){const value=Number(el.value);if(!Number.isFinite(value))throw Error('Introduce un número válido.');const low=Number(el.min),high=Number(el.max);if(value<low||value>high||!Number.isInteger(value))throw Error('El valor debe ser un entero entre '+low+' y '+high+'.');return value;}if((id==='continueText'||id==='completionPhrase')&&!String(el.value).trim())throw Error('El mensaje y la frase de finalización no pueden quedar vacíos.');return el.value.trim();}
for(const id of Object.keys(DEFAULT).filter(x=>!['continueText','completionPhrase'].includes(x))){$(id).addEventListener('change',async()=>{const el=$(id);el.disabled=true;try{await chrome.storage.local.set({[id]:normalizeValue(id)});writeNotice('Ajuste guardado.');}catch(err){writeNotice('No se guardó el ajuste: '+err.message,'error');}finally{el.disabled=false;await refresh();}});}
$('saveMessages').addEventListener('click',async()=>{
  const button=$('saveMessages');button.disabled=true;
  try{
    const text=normalizeValue('continueText');
    const phrase=normalizeValue('completionPhrase');
    await chrome.storage.local.set({continueText:text,completionPhrase:phrase});
    writeNotice('Mensaje e instrucción de finalización guardados.');
  }catch(err){writeNotice('No se ha guardado: '+err.message,'error');}
  finally{button.disabled=false;}
});
$('selectedChat').addEventListener('change',async e=>{
  if(!currentSupported)return;
  const desired=!!e.target.checked;
  // Request at the start of the user gesture. Don't grant all websites without permission.
  const permissionPromise=desired?grantRoutePermission(activeTab):Promise.resolve(true);
  e.target.disabled=true;
  try{
    if(!await permissionPromise)throw new Error('Chrome no ha autorizado el dominio.');
    if(desired)await injectCustom(activeTab);
    const saved=await chrome.storage.local.get({enabledChats:{}});
    const enabledChats={...saved.enabledChats,[currentKey]:desired};
    await chrome.storage.local.set({enabledChats});
    writeNotice(desired?'Auto Sigue activado en esta conversación.':'Auto Sigue desactivado en esta conversación.');
  }catch(err){e.target.checked=!desired;writeNotice('No se pudo activar: '+err.message,'error');}
  await refresh();
});
async function sendNow(){if(busyAction)return;busyAction=true;$('handoffNow').disabled=true;
 const reply=await sendToChat('TEST_SEND',{chatKey:currentKey});
 writeNotice(reply.ok?'Envío confirmado en la conversación actual.':(reply.lastError||reply.error||'No se ha confirmado el envío. No se reintenta para evitar duplicados.'),reply.ok?'info':'error');
 busyAction=false;await refresh();}
$('handoffNow').addEventListener('click',sendNow);
$('handoffReset').addEventListener('click',async()=>{const reply=await sendToChat('RESET_SEND_STATUS',{chatKey:currentKey});writeNotice(reply.ok?'Estado reiniciado.':'No se pudo reiniciar el estado.',reply.ok?'info':'error');await refresh();});
for(const tab of document.querySelectorAll('.navbtn'))tab.addEventListener('click',()=>{for(const btn of document.querySelectorAll('.navbtn')){const active=btn===tab;btn.classList.toggle('active',active);btn.setAttribute('aria-selected',String(active));}for(const page of document.querySelectorAll('.page'))page.classList.toggle('active',page.id==='page-'+tab.dataset.page);});
async function saveRoutes(){await chrome.storage.local.set({[ROUTE_KEY]:routes});}
function routeState(r){return r.engine==='chatgpt'?'Envío en este chat · ChatGPT':'Envío mediante interfaz · según plataforma';}
function paintRoutes(){const list=$('routeList');list.replaceChildren();$('routeCount').textContent=routes.filter(r=>r.enabled!==false).length+' activas';for(const [index,r] of routes.entries()){
  const item=document.createElement('div');item.className='route';const main=document.createElement('div');main.className='route-main';const name=document.createElement('div');name.className='route-name';name.textContent=r.name;const url=document.createElement('small');url.className='route-url';url.textContent=r.pattern;const status=document.createElement('span');status.className='route-state'+' ready';status.textContent=routeState(r);main.append(name,url,status);
  const actions=document.createElement('div');actions.className='route-actions';const label=document.createElement('label');label.className='toggle';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=r.enabled!==false;checkbox.setAttribute('aria-label','Activar ruta '+r.name);const track=document.createElement('span');track.className='track';label.append(checkbox,track);checkbox.addEventListener('change',async()=>{checkbox.disabled=true;const prior=routes[index].enabled;routes[index].enabled=checkbox.checked;try{await saveRoutes();paintRoutes();await refresh();}catch(e){routes[index].enabled=prior;paintRoutes();$('routeMessage').textContent='Error al guardar: '+e.message;}});
  const remove=document.createElement('button');remove.type='button';remove.className='route-remove';remove.textContent='Quitar';remove.setAttribute('aria-label','Quitar ruta '+r.name);remove.addEventListener('click',async()=>{const backup=[...routes];routes.splice(index,1);try{await saveRoutes();paintRoutes();await refresh();}catch(e){routes=backup;paintRoutes();$('routeMessage').textContent='No se pudo eliminar: '+e.message;}});actions.append(label,remove);item.append(main,actions);list.append(item);
}}
async function loadRoutes(){try{const stored=await chrome.storage.local.get(ROUTE_KEY);const values=stored[ROUTE_KEY];routes=Array.isArray(values)?values.filter(r=>r&&typeof r.name==='string'&&AS_VALID_ROUTE(r.pattern)).slice(0,100):AS_DEFAULT_ROUTES.map(r=>({...r}));paintRoutes();}catch(e){$('routeMessage').textContent='No se pudieron cargar las rutas: '+e.message;}}
$('routeAdd').addEventListener('click',async()=>{const name=$('routeName').value.trim().slice(0,60);const pattern=$('routePattern').value.trim();const feedback=$('routeMessage');if(!name||!AS_VALID_ROUTE(pattern)){feedback.textContent='Introduce un nombre y una ruta HTTPS, por ejemplo https://ejemplo.ai/chat/*';return;}if(routes.some(r=>r.pattern.toLowerCase()===pattern.toLowerCase())){feedback.textContent='La ruta ya está registrada.';return;}if(routes.length>=100){feedback.textContent='Límite: 100 rutas.';return;}const add=$('routeAdd');add.disabled=true;routes.push({name,pattern,enabled:true,engine:'pending'});try{await saveRoutes();paintRoutes();await refresh();$('routeName').value='';$('routePattern').value='';feedback.textContent='Ruta guardada. Autoriza el dominio al activar Auto Sigue en su página.';}catch(e){routes.pop();feedback.textContent='No se pudo guardar: '+e.message;}finally{add.disabled=false;}});
// Opciones de ruta primero, para que la página activa se clasifique de forma coherente.
(async()=>{await loadRoutes();await refresh();})();
