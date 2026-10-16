import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  page=await browser.new_page(viewport={'width':800,'height':600})
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  await page.set_content('''<style>body{font:16px Arial}button,textarea{display:block;width:200px;height:50px;margin:20px}</style>
    <div data-message-author-role="assistant" id="assistant">Todavía trabajando en esto.</div>
    <textarea placeholder="Mensaje" id="editor"></textarea>
    <button id="send" data-testid="send-button" onclick="window.__sent.push(document.getElementById('editor').value);const u=document.createElement('div');u.setAttribute('data-message-author-role','user');u.textContent=document.getElementById('editor').value;document.body.appendChild(u);document.getElementById('editor').value='';">Send</button>
    <button id="stop" aria-label="Stop generating" onclick="this.remove()">Stop</button>''')
  await page.evaluate('''() => {
   window.__sent=[];window.__advance=0; const baseNow=Date.now.bind(Date);Date.now=()=>baseNow()+window.__advance;
   window.__data={enabled:true,enabledChats:{'ai::blank':true},continueText:'sigue',completionPhrase:'HE ACABADO',maxContinuesPerChat:0,finishDelaySeconds:1,watchdogEnabled:true,watchdogMinutes:1};
   window.__listener=null;
   window.chrome={storage:{local:{get:async defaults=>({...defaults,...window.__data}),set:async val=>{Object.assign(window.__data,val)}}},runtime:{id:'test',sendMessage:async msg=>msg.type==='AI_GENERIC_TAB_ID'?{ok:true,tabId:55}:{ok:true},onMessage:{addListener:fn=>window.__listener=fn}}};
  }''')
  await page.add_script_tag(content=Path('/mnt/data/as324_clean/generic-content.js').read_text())
  await page.wait_for_timeout(1700)
  key=await page.evaluate('location.pathname')
  assert key=='blank',key
  await page.evaluate('window.__advance=70000')
  await page.wait_for_timeout(2800)
  count=await page.evaluate('window.__sent.length')
  assert count==1,f'timeout did not send, messages: {count}, key {key}'
  text=await page.evaluate('window.__sent[0]')
  assert 'sigue' in text and 'HE ACABADO' in text,text
  await page.evaluate("document.getElementById('assistant').textContent='La tarea está completa. HE ACABADO'")
  await page.wait_for_timeout(1200)
  status=await page.evaluate('''() => new Promise(res=>{window.__listener({type:'GET_STATUS',chatKey:'ai::blank'},null,res)})''')
  assert status['status']['stopped'] is True,status
  assert status['status']['sendStage']=='finalizado',status
  assert not errors,errors
  print('OK: envío por tiempo confirmado, texto con marcador, fin detectado, sin errores JS')
  await browser.close()
asyncio.run(run())
