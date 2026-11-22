(() => {
  'use strict';
  if(window.__AUTO_SIGUE_GENERIC_V330__) return;
  window.__AUTO_SIGUE_GENERIC_V330__=true;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const send=async message=>{try{return await chrome.runtime.sendMessage(message);}catch(e){return {ok:false,error:String(e.message||e)};}};
  let tabId=null,key='',sending=false,stage='',lastAction='',lastError='',confirmed=0,observedFingerprint='',ready=false;
  let sawGeneration=false,wasBusy=false,finishAt=0,lastSentFingerprint='',ambiguousSend=false,pendingDelivery=null;
  let responseStartedAt=0,timeoutAttempted=false,timeoutInProgress=false,halted=false;
  let lastAssistantChangeAt=Date.now(),lastHandledFingerprint='',nextRetryAt=0,failedAttempts=0;
  const host=location.hostname.toLowerCase();
  const getKey=()=>{const path=location.pathname.replace(/\/+$/,'')||'/'; const query=location.search.slice(0,100);
    const id=path==='/'||/^\/(app|chat|new)$/.test(path)?`tab-${tabId||0}`:encodeURIComponent(path+query).slice(0,250);
    return `ai:${host}:${id}`;};
  const init=async()=>{if(tabId===null)tabId=(await send({type:'AI_GENERIC_TAB_ID'}))?.tabId??0;if(!key)key=getKey();};
  const visible=el=>{if(!el||!el.isConnected)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.visibility!=='hidden'&&s.display!=='none'&&r.width>20&&r.height>8;};
  function editor(){const sels=['[data-testid="chat-input"] [contenteditable="true"]','[data-testid="send-input"] [contenteditable="true"]','[data-testid="composer"] [contenteditable="true"]','[data-testid="composer-input"][contenteditable="true"]','[role="textbox"][contenteditable="true"]','div[contenteditable="true"][data-placeholder]','div[contenteditable="true"].ProseMirror','textarea[placeholder]','textarea'];
    for(const sel of sels)for(const e of document.querySelectorAll(sel)){
      if(!visible(e)||e.closest('[aria-hidden="true"]'))continue;
      if(/search|buscar|rechercher|filter/i.test([e.getAttribute('placeholder'),e.getAttribute('aria-label')].join(' ')))continue;
      return e;
    }return null;}
  const value=el=>String(el?.value??el?.innerText??el?.textContent??'').trim();
  const busy=()=>[...document.querySelectorAll('button[aria-label],button[data-testid],button[title]')].some(b=>visible(b)&&/\b(stop|detener|cancel generation|stop generating|detener respuesta)\b/i.test([b.getAttribute('aria-label'),b.getAttribute('data-testid'),b.getAttribute('title')].join(' ')));
  function sendButton(el){const form=el.closest('form');const sels=['button[data-testid="send-button"]','button[data-testid="send-message-button"]','button[data-testid="composer-submit-button"]','button[data-testid="send-input-button"]','button[aria-label="Send"]','button[aria-label="Send message"]','button[aria-label="Enviar"]','button[aria-label="Enviar mensaje"]','button[title="Send"]','button[type="submit"]'];
    const found=[];
    for(const scope of [form,document].filter(Boolean))for(const sel of sels)for(const b of scope.querySelectorAll(sel)){
      if(!visible(b)||b.disabled||b.getAttribute('aria-disabled')==='true')continue;
      const name=[b.getAttribute('title'),b.getAttribute('aria-label'),b.getAttribute('data-testid')].join(' ');
      if(/stop|cancel|detener|voice|mic|audio|record/i.test(name))continue;
      if(scope===document&&form&&b.closest('form')&&b.closest('form')!==form)continue;
      if(!found.includes(b))found.push(b);
    }
    if(form)return found.find(b=>b.closest('form')===form)??(found.length===1?found[0]:null);
    return found.length===1?found[0]:null;
  }
  function assistantFingerprint(){const sels=['[data-message-author-role="assistant"]','[data-role="assistant"]','[data-testid="assistant-message"]','[data-testid="model-response"]','model-response','.model-response-text','.ds-markdown'];
    for(const sel of sels){const a=[...document.querySelectorAll(sel)].filter(visible);if(a.length){const t=value(a[a.length-1]);if(t.length>10)return sel+':'+a.length+':'+t.length+':'+t.slice(-100);}}return '';}
  function lastAssistantText(){
    const sels=['[data-message-author-role="assistant"]','[data-role="assistant"]','[data-testid="assistant-message"]','[data-testid="model-response"]','model-response','.model-response-text','.ds-markdown'];
    for(const sel of sels){const nodes=[...document.querySelectorAll(sel)].filter(visible);if(nodes.length)return value(nodes[nodes.length-1]);}return '';
  }
  function completedByMarker(text,marker){
    const normalize=x=>String(x||'').trim().replace(/[.!¡!¿?…]+$/g,'').toUpperCase();
    const lines=String(text||'').trim().split(/\r?\n/).map(normalize).filter(Boolean);
    return !!marker&&lines.length>0&&lines[lines.length-1]===normalize(marker);
  }
  function userTurnPending(){
    const select=(s)=>[...document.querySelectorAll(s)].filter(visible);
    const users=select('[data-message-author-role="user"], [data-role="user"], [data-testid="user-message"]');
    const assistants=select('[data-message-author-role="assistant"], [data-role="assistant"], [data-testid="assistant-message"], [data-testid="model-response"], model-response');
    const u=users.at(-1),a=assistants.at(-1);
    return !!u&&(!a||Boolean(a.compareDocumentPosition(u)&Node.DOCUMENT_POSITION_FOLLOWING));
  }
  function userCount(){const sels=['[data-message-author-role="user"]','[data-role="user"]','[data-testid="user-message"]'];for(const sel of sels){const n=document.querySelectorAll(sel).length;if(n)return n;}return 0;}
  async function put(el,text){el.focus();
    if(el instanceof HTMLTextAreaElement||el instanceof HTMLInputElement){const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,text);
      el.dispatchEvent(new InputEvent('input',{bubbles:true,data:text,inputType:'insertText'}));return value(el)===text;}
    const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(el);range.collapse(false);selection.removeAllRanges();selection.addRange(range);
    const ok=document.execCommand('insertText',false,text);el.dispatchEvent(new InputEvent('input',{bubbles:true,data:text,inputType:'insertText'}));return ok&&value(el)===text;
  }
  async function isAllowed(){const d=await chrome.storage.local.get({enabled:true,enabledChats:{}});return d.enabled&&!!d.enabledChats[key]&&!halted;}
  async function perform(manual=false){if(sending)return {ok:false,error:'Ya se está enviando.'};if(ambiguousSend)return {ok:false,pending:true,error:'Comprobando automáticamente el envío anterior sin duplicarlo.'};
    let composed=null,ownText='',clickAttempted=false; sending=true;lastError='';stage='escribiendo';
    try{await init();if(!await isAllowed())throw Error('Activa Auto Sigue en esta conversación.');
      if(busy()||userTurnPending())throw Error('La IA está respondiendo o hay un mensaje pendiente.');
      const el=editor();if(!el)throw Error('No se ha identificado el editor de esta IA.');
      if(value(el))throw Error('Hay un borrador escrito. No lo sobrescribo.');
      const d=await chrome.storage.local.get({continueText:'autosigue',completionPhrase:'HE ACABADO',maxContinuesPerChat:0});
      const base=String(d.continueText||'autosigue').trim();if(!base)throw Error('Mensaje vacío.');
      const marker=String(d.completionPhrase||'HE ACABADO').trim();
      const text=base+' Cuando hayas terminado completamente la tarea, escribe exactamente «'+marker+'» en la última línea de tu respuesta. No lo escribas antes de terminar.';
      composed=el; ownText=text;
      const before=userCount(),beforeAssistantFingerprint=assistantFingerprint();if(!await put(el,text))throw Error('No se pudo introducir el texto de forma verificable.');
      await sleep(220);
      if(value(el)!==text)throw Error('El editor no mantuvo el texto.');
      const btn=sendButton(el);if(!btn)throw Error('No se encontró un botón Enviar único y habilitado. El texto queda como borrador.');
      if(!await isAllowed())throw Error('Se desactivó Auto Sigue antes de pulsar Enviar.');
      stage='enviando';ambiguousSend=true;clickAttempted=true;pendingDelivery={text,before,beforeAssistantFingerprint,lastAttemptAt:Date.now(),retries:0};btn.click();
      const until=Date.now()+12500;let delivered=false;
      while(Date.now()<until){await sleep(160);const current=editor()||el;
        // Dos señales independientes (o una señal fuerte: nuevo mensaje de usuario).
        if(userCount()>before||(value(current)===''&&(busy()||assistantFingerprint()!==observedFingerprint&&!!observedFingerprint))){delivered=true;break;}}
      if(!delivered){stage='pendiente';lastError='';lastAction='Comprobando automáticamente el envío';return {ok:false,pending:true};}
      ambiguousSend=false;pendingDelivery=null;confirmed++;stage='confirmado';lastAction='«'+text+'» enviado y confirmado en este chat.';
      lastSentFingerprint=beforeAssistantFingerprint;lastHandledFingerprint=beforeAssistantFingerprint;finishAt=0;sawGeneration=false;failedAttempts=0;nextRetryAt=0;return {ok:true,status:{sendStage:stage}};
    }catch(e){if(clickAttempted){stage='pendiente';lastError='';lastAction='Comprobando automáticamente el envío';return {ok:false,pending:true};}stage='error';lastError=String(e?.message||e);lastAction='Envío previo al clic fallido';return {ok:false,lastError,error:lastError};}
    finally{
      // Solo retirar borrador propio cuando ni siquiera se pulsó Enviar.
      if(lastError&&!clickAttempted&&composed?.isConnected&&value(composed)===ownText){
        composed.focus();if('value' in composed){composed.value='';composed.dispatchEvent(new Event('input',{bubbles:true}));}
        else{const sel=window.getSelection(),range=document.createRange();range.selectNodeContents(composed);sel.removeAllRanges();sel.addRange(range);document.execCommand('delete',false);}
      }
      sending=false;
    }
  }
  async function tick(){
    await init();const next=getKey();
    if(next!==key){
      key=next;stage='';confirmed=0;observedFingerprint='';ready=false;sawGeneration=false;
      wasBusy=false;finishAt=0;responseStartedAt=0;timeoutAttempted=false;halted=false;
      lastHandledFingerprint='';lastAssistantChangeAt=Date.now();nextRetryAt=0;failedAttempts=0;ambiguousSend=false;pendingDelivery=null;
    }
    const fp=assistantFingerprint(),b=busy(),now=Date.now();
    if(fp!==observedFingerprint){
      observedFingerprint=fp;lastAssistantChangeAt=now;finishAt=0;
    }
    if(!ready){wasBusy=b;responseStartedAt=b?now:0;ready=true;return;}
    if(b){
      if(!responseStartedAt)responseStartedAt=now;
      sawGeneration=true;finishAt=0;
    }else{
      if(wasBusy&&sawGeneration&&fp)lastAssistantChangeAt=now;
      responseStartedAt=0;timeoutAttempted=false;
    }
    wasBusy=b;
    if(sending||halted)return;
    const d=await chrome.storage.local.get({enabled:true,enabledChats:{},finishDelaySeconds:3,maxContinuesPerChat:0,watchdogEnabled:true,watchdogMinutes:20,completionPhrase:'HE ACABADO'});
    if(!d.enabled||!d.enabledChats[key])return;
    if(!b&&fp&&!userTurnPending()&&now-lastAssistantChangeAt>=Math.max(1200,Number(d.finishDelaySeconds||3)*1000)&&completedByMarker(lastAssistantText(),d.completionPhrase)){
      halted=true;finishAt=0;stage='finalizado';lastAction='La IA ha indicado que terminó la tarea.';return;
    }
    // Vigilancia pasiva. No interrumpir respuestas largas ni hacer clic en Detener.
    if(ambiguousSend && pendingDelivery){
      const pending=pendingDelivery, el=editor();
      const confirmedLater=userCount()>pending.before ||
        (el && value(el)==='' && (b || (fp && fp!==pending.beforeAssistantFingerprint)));
      if(confirmedLater){
        ambiguousSend=false;pendingDelivery=null;confirmed++;stage='confirmado';
        lastHandledFingerprint=pending.beforeAssistantFingerprint;
        lastSentFingerprint=pending.beforeAssistantFingerprint;
        lastError='';lastAction='Envío confirmado posteriormente en esta conversación';
        finishAt=0;sawGeneration=false;failedAttempts=0;nextRetryAt=0;
      }else if(!b&&!userTurnPending()&&el&&value(el)===pending.text &&
               now-pending.lastAttemptAt>60000&&pending.retries<2){
        const btn=sendButton(el);
        if(btn){pending.retries++;pending.lastAttemptAt=now;btn.click();
          stage='enviando';lastAction='Reintentando exclusivamente el borrador original';}
      }else{stage='pendiente';lastError='';lastAction='Comprobando el historial sin duplicar';}
      return;
    }
    if(b||!fp||userTurnPending()||fp===lastHandledFingerprint||ambiguousSend)return;
    const delay=Math.max(1200,Number(d.finishDelaySeconds||3)*1000);
    if(now-lastAssistantChangeAt<delay||now<nextRetryAt)return;
    const result=await perform(false);
    if(!result?.ok&&!ambiguousSend){
      failedAttempts++;
      nextRetryAt=Date.now()+Math.min(30000,4000*(2**Math.min(3,failedAttempts-1)));
      lastAction='Envío pendiente: reintento automático cuando el editor esté disponible.';
    }
  }
  chrome.runtime.onMessage.addListener((msg,_sender,respond)=>{if(!msg||!['GET_STATUS','TEST_SEND','RESET_SEND_STATUS','HANDOFF_CONFIGURE','HANDOFF_NOW','HANDOFF_RESET'].includes(msg.type))return;
    (async()=>{await init();if(msg.chatKey&&msg.chatKey!==key)return {ok:false,error:'La conversación ha cambiado. Abre de nuevo el panel.'};
      if(msg.type==='GET_STATUS')return {ok:true,status:{answering:busy(),sending,stopped:halted,sendStage:stage,lastError,lastAction,confirmed}};
      if(msg.type==='TEST_SEND')return perform(true);
      if(msg.type==='RESET_SEND_STATUS'){stage='';lastError='';lastAction='';finishAt=0;ambiguousSend=Boolean(pendingDelivery);halted=false;timeoutAttempted=false;failedAttempts=0;nextRetryAt=0;if(ambiguousSend){stage='pendiente';lastAction='Comprobando el envío anterior';}return {ok:true};}
      if(msg.type==='HANDOFF_CONFIGURE'){const data=await chrome.storage.local.get({handoffOptionsByChat:{}});const opts={...data.handoffOptionsByChat,[key]:{...data.handoffOptionsByChat[key],auto:msg.auto!==false}};await chrome.storage.local.set({handoffOptionsByChat:opts});return {ok:true};}
      return {ok:false,error:'Esta acción ya no está disponible: Auto Sigue trabaja en el mismo chat.'};
    })().then(respond).catch(err=>respond({ok:false,error:String(err?.message||err)}));return true;});
  let tickInProgress=false;
  async function safeTick(){if(tickInProgress)return;tickInProgress=true;try{await tick();}catch(e){lastError=String(e?.message||e);}finally{tickInProgress=false;}}
  (async()=>{await init();setInterval(safeTick,900);safeTick();})();
})();
