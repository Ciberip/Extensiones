from pathlib import Path
from playwright.sync_api import sync_playwright
import json, time
SRC=Path(__file__).resolve().parents[1]

def make_page(browser,js='content.js',model=None,initial_answer='Respuesta 1 en desarrollo.',last_user_first=False):
    page=browser.new_page(viewport={'width':1100,'height':850})
    page.set_content('''<!doctype html><style>body{font:16px Arial}form{position:relative;margin-top:28px}#prompt-textarea{min-height:50px;width:420px;border:1px solid black;padding:8px}button{min-width:120px;min-height:40px}</style>
    <main id="conversation"><div data-message-author-role="user">Haz esta tarea.</div><div data-message-author-role="assistant" id="answer"><div class="markdown">__ANSWER__</div></div></main>
    <form id="composer"><div id="prompt-textarea" role="textbox" contenteditable="true" class="ProseMirror"></div><button data-testid="send-button" type="button" id="send">Enviar</button></form>
    <script>window.__sent=[];window.__simulateNext=true;window.__mode='normal'; document.getElementById('send').addEventListener('click',()=>{
      let str=document.getElementById('prompt-textarea').innerText;
      window.__sent.push(str);
      let el=document.createElement('div');el.setAttribute('data-message-author-role','user');el.innerText=str;document.getElementById('conversation').appendChild(el);
      document.getElementById('prompt-textarea').replaceChildren();
      if(window.__simulateNext){
        const pos=window.__sent.length;
        let a=document.createElement('div');a.setAttribute('data-message-author-role','assistant'); a.innerHTML='<div class="markdown">Generando respuesta '+pos+'</div>';
        document.getElementById('conversation').appendChild(a);
        const stop=document.createElement('button');stop.setAttribute('data-testid','stop-button');stop.textContent='Stop';stop.id='stop';document.body.appendChild(stop);
        setTimeout(()=>{a.firstElementChild.innerText=pos===1?'Quedan tareas pendientes.':pos===2?'Todas comprobadas.\\nHE ACABADO':'No debería enviarse';stop.remove()},450);
      }
    });</script>'''.replace('__ANSWER__',initial_answer))
    page.evaluate('''(old) => {
        window.__data={enabled:true,enabledChats:{'c:test-conversation-id-1':true},maxContinuesPerChat:old?12:0,continueText:old?'sigue':'autosigue',completionPhrase:'HE ACABADO',finishDelaySeconds:1,watchdogEnabled:false,stoppedChats:{},autoSigueMigration330:!old};
        window.__storageListeners=[];window.__messageListeners=[];
        window.chrome={storage:{local:{get:async defaults=>({...defaults,...window.__data}),set:async val=>{const changes=Object.fromEntries(Object.entries(val).map(([k,v])=>[k,{oldValue:window.__data[k],newValue:v}]));Object.assign(window.__data,val);for(const fn of window.__storageListeners)fn(changes,'local');}},onChanged:{addListener:fn=>window.__storageListeners.push(fn)}},runtime:{id:'test',sendMessage:async msg=>({ok:true}),onMessage:{addListener:fn=>window.__messageListeners.push(fn)}}};
    }''', model=='old')
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    source=(SRC/js).read_text().replace('function getChatKey() {', 'function getChatKey() { if (window.__TEST_CHAT_KEY__) return window.__TEST_CHAT_KEY__;')
    page.evaluate('window.__TEST_CHAT_KEY__ = \"c:test-conversation-id-1\"')
    page.add_script_tag(content=(SRC/"drive_links.js").read_text())
    page.add_script_tag(content=source)
    return page,errors

with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 # test continuous sending through 2 steps stops only final line.
 page,errors=make_page(browser,model='old')
 page.wait_for_function('window.__sent.length===2',timeout=14000)
 page.wait_for_function("window.__data.stoppedChats['c:test-conversation-id-1'] === true",timeout=7000)
 sent=page.evaluate('window.__sent')
 assert len(sent)==2,(len(sent),sent)
 assert sent[0].startswith('autosigue ') and 'HE ACABADO' in sent[0],sent
 assert page.evaluate('window.__data.maxContinuesPerChat')==0
 assert page.evaluate('window.__data.autoSigueMigration330')==True
 st=page.evaluate('window.__data.stoppedChats')
 assert st.get('c:test-conversation-id-1')==True,st
 assert not errors,errors
 print('OK: ChatGPT simulado: 2 autosigue y detención exclusiva por HE ACABADO al final')
 print('OK: valores antiguos (sigue/12) migrados a autosigue/0')
 page.close()
 # test embedded phrase doesn't stop + retry disabled button before click
 page,errors=make_page(browser,initial_answer='No escribir HE ACABADO hasta acabar. Sigue trabajando.')
 page.evaluate("document.getElementById('send').disabled=true")
 page.wait_for_timeout(5700)
 assert page.evaluate('window.__sent.length')==0
 status=page.evaluate("window.__data.runtimeStatus")
 assert status.get('continueCount')==0,status
 # pre-click failure restored editor; button enabled to permit retry
 assert page.evaluate('window.__data.runtimeStatus.lastError') in ('', 'No hay botón de envío utilizable para este editor. No se ha enviado el mensaje.'), page.evaluate('window.__data.runtimeStatus')
 page.evaluate("document.getElementById('send').disabled=false")
 page.wait_for_function('window.__sent.length===2',timeout=16000)
 page.wait_for_timeout(2100)
 assert page.evaluate('window.__sent.length')==2
 assert not errors,errors
 print('OK: fallo pre-clic recuperado con reintento, borrador propio retirado')
 page.close()
 # test no click when user last and no model answer
 page,errors=make_page(browser)
 page.evaluate('''() => {let u=document.createElement('div');u.setAttribute('data-message-author-role','user');u.textContent='Pregunta pendiente del usuario';document.getElementById('conversation').appendChild(u);}''')
 page.wait_for_timeout(2400)
 assert page.evaluate('window.__sent.length')==0
 page.evaluate('''() => {let a=document.createElement('div');a.setAttribute('data-message-author-role','assistant');a.innerHTML='<div class="markdown">Respuesta pendiente resuelta</div>';document.getElementById('conversation').appendChild(a);}''')
 page.wait_for_function('window.__sent.length===2',timeout=16000)
 assert not errors,errors
 print('OK: no envía mientras mensaje del usuario espera respuesta')
 page.close()
 browser.close()
