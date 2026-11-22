from pathlib import Path
from playwright.sync_api import sync_playwright
SRC=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page(viewport={'width':800,'height':620})
 errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
 page.set_content('''<style>button,div[contenteditable]{padding:12px;border:1px solid black;display:block;min-height:36px;min-width:180px;margin:20px}</style>
 <main id="conv"><div data-role="user">Haz la tarea</div><div data-role="assistant">Primera respuesta pendiente de continuar.</div></main>
 <div role="textbox" contenteditable="true" id="editor"></div><button data-testid="send-button" id="send">Enviar</button>
 <script>window.__sent=[];document.getElementById('send').onclick=()=>{let value=document.getElementById('editor').innerText;window.__sent.push(value);let u=document.createElement('div');u.setAttribute('data-role','user');u.innerText=value;document.getElementById('conv').appendChild(u);document.getElementById('editor').replaceChildren();let a=document.createElement('div');a.setAttribute('data-role','assistant');a.innerText=window.__sent.length===1?'Aún falta trabajo.':'Comprobado.\\nHE ACABADO';document.getElementById('conv').appendChild(a);};</script>''')
 page.evaluate('''() => {window.__TEST_AI_KEY__='ai:test:conversation';window.__data={enabled:true,enabledChats:{'ai:test:conversation':true},maxContinuesPerChat:0,continueText:'autosigue',completionPhrase:'HE ACABADO',finishDelaySeconds:1,watchdogEnabled:false};window.chrome={runtime:{sendMessage:async()=>({ok:true,tabId:4}),onMessage:{addListener:fn=>window.__listener=fn}},storage:{local:{get:async defaults=>({...defaults,...window.__data}),set:async vals=>Object.assign(window.__data,vals)}}};}''')
 source=(SRC/'generic-content.js').read_text().replace('const getKey=()=>{','const getKey=()=>{if(window.__TEST_AI_KEY__)return window.__TEST_AI_KEY__;')
 page.add_script_tag(content=source)
 page.wait_for_function('window.__sent.length===2',timeout=14000)
 page.wait_for_timeout(2600)
 sent=page.evaluate('window.__sent')
 assert len(sent)==2,sent
 assert sent[0].startswith('autosigue ') and sent[1].startswith('autosigue '),sent
 res=page.evaluate('''() => new Promise(resolve=>window.__listener({type:'GET_STATUS',chatKey:'ai:test:conversation'},null,resolve))''')
 assert res['status']['stopped'],res
 assert res['status']['confirmed']==2,res
 assert not errors,errors
 print('OK: motor IA genérico simulado, respuestas rápidas sin botón Stop, dos envíos y detención con marcador.')
 browser.close()
