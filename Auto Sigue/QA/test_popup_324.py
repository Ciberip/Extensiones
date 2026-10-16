import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

async def run():
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
        page=await browser.new_page(viewport={'width':424,'height':730},device_scale_factor=1)
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        await page.add_init_script('''
        window.__store = {enabled:true, enabledChats:{}, continueText:'sigue', completionPhrase:'HE ACABADO', finishDelaySeconds:3, maxContinuesPerChat:12, watchdogEnabled:true, watchdogMinutes:20};
        const data = window.__store;
        window.chrome = {
          runtime:{id:'simulated-extension',sendMessage:async()=>({ok:true})},
          tabs:{query:async()=>[{id:123,title:'Prueba Auto Sigue',url:'https://chatgpt.com/c/test123'}],sendMessage:async()=>({ok:true,status:{answering:false,sending:false,sendStage:'',lastAction:'Esperando'}})},
          storage:{local:{get:async defaults=>{
            if(typeof defaults==='string')return {[defaults]:data[defaults]};
            if(Array.isArray(defaults))return Object.fromEntries(defaults.map(k=>[k,data[k]]));
            return {...defaults,...data};
          },set:async val=>{Object.assign(data,val);return true;} }},
          permissions:{request:async()=>true},scripting:{executeScript:async()=>[]}
        };
        ''')
        from re import sub
        root=Path('/mnt/data/as324_clean')
        html=(root/'popup.html').read_text(encoding='utf-8')
        html=html.replace('<link rel="stylesheet" href="popup.css">','<style>'+ (root/'popup.css').read_text(encoding='utf-8') + '</style>')
        html=html.replace('<script src="ai-routes.js"></script>','').replace('<script src="popup.js"></script>','')
        await page.set_content(html)
        await page.evaluate("""
        window.__store = {enabled:true, enabledChats:{}, continueText:'sigue', completionPhrase:'HE ACABADO', finishDelaySeconds:3, maxContinuesPerChat:12, watchdogEnabled:true, watchdogMinutes:20};
        const data = window.__store;
        window.chrome = {
          runtime:{id:'simulated-extension',sendMessage:async()=>({ok:true})},
          tabs:{query:async()=>[{id:123,title:'Prueba Auto Sigue',url:'https://chatgpt.com/c/test123'}],sendMessage:async()=>({ok:true,status:{answering:false,sending:false,sendStage:'',lastAction:'Esperando'}})},
          storage:{local:{get:async defaults=>{
            if(typeof defaults==='string')return {[defaults]:data[defaults]};
            if(Array.isArray(defaults))return Object.fromEntries(defaults.map(k=>[k,data[k]]));
            return {...defaults,...data};
          },set:async val=>{Object.assign(data,val);return true;} }},
          permissions:{request:async()=>true},scripting:{executeScript:async()=>[]}
        };
        """)
        await page.add_script_tag(content=(root/'ai-routes.js').read_text())
        await page.add_script_tag(content=(root/'popup.js').read_text())
        await page.wait_for_timeout(300)
        assert await page.locator('#continueText').input_value()=='sigue'
        assert await page.locator('#completionPhrase').input_value()=='HE ACABADO'
        assert await page.locator('text=Chats autorizados').count()==0
        assert await page.locator('text=Comportamiento').count()==0
        assert await page.locator('text=Conservar el chat original').count()==0
        await page.locator('#selectedChat').check()
        await page.wait_for_timeout(80)
        assert await page.evaluate("window.__store.enabledChats['c:test123']") is True
        await page.locator('#continueText').fill('Continúa revisando el código')
        await page.locator('#completionPhrase').fill('TRABAJO TERMINADO')
        await page.locator('#saveMessages').click()
        await page.wait_for_timeout(70)
        assert await page.evaluate('window.__store.continueText')=='Continúa revisando el código'
        assert await page.evaluate('window.__store.completionPhrase')=='TRABAJO TERMINADO'
        await page.locator('details.advanced summary').click()
        await page.locator('#maxContinuesPerChat').fill('0')
        await page.locator('#maxContinuesPerChat').dispatch_event('change')
        await page.wait_for_timeout(100)
        assert await page.evaluate('window.__store.maxContinuesPerChat')==0
        await page.locator('#watchdogMinutes').fill('5')
        await page.locator('#watchdogMinutes').dispatch_event('change')
        await page.wait_for_timeout(100)
        assert await page.evaluate('window.__store.watchdogMinutes')==5
        assert await page.locator('.step').count()==3
        await page.screenshot(path='/mnt/data/as324_clean/QA/panel_324.png',full_page=True)
        await page.locator('button[data-page=rutas]').click()
        assert await page.locator('#routeList .route').count()>=7
        await page.screenshot(path='/mnt/data/as324_clean/QA/rutas_324.png',full_page=True)
        width=await page.evaluate('({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth})')
        assert width['scrollWidth']==width['clientWidth'],width
        assert not errors,errors
        print('OK popup controls + route list, no JS error',width)
        await browser.close()

asyncio.run(run())
