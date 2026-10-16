 'use strict';
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
  if(msg?.type!=='AI_GENERIC_TAB_ID')return;
  reply(Number.isInteger(sender.tab?.id)?{ok:true,tabId:sender.tab.id}:{ok:false});
});
const INTEGRATED=new Set(['chatgpt.com','chat.openai.com','claude.ai','gemini.google.com','grok.com','www.perplexity.ai','copilot.microsoft.com','chat.deepseek.com','chat.mistral.ai']);
async function injectCustom(tabId,url){try{
  const u=new URL(url);if(u.protocol!=='https:'||INTEGRATED.has(u.hostname))return;
  const routes=(await chrome.storage.local.get({autosigue_routes_v1:[]})).autosigue_routes_v1;
  const active=Array.isArray(routes)&&routes.some(r=>r.enabled!==false&&typeof r.pattern==='string'&&new RegExp('^'+r.pattern.replace(/[|\\{}()[\]^$+?.]/g,'\\$&').replace(/\*/g,'.*')+'$','i').test(url));
  if(!active||!await chrome.permissions.contains({origins:[u.origin+'/*']}))return;
  await chrome.scripting.executeScript({target:{tabId},files:['generic-content.js']});
}catch(_){}}
chrome.tabs.onUpdated.addListener((id,change,tab)=>{if(change.status==='complete'&&tab.url)injectCustom(id,tab.url);});
chrome.runtime.onInstalled.addListener(()=>{chrome.tabs.query({}).then(tabs=>tabs.forEach(t=>t.url&&injectCustom(t.id,t.url))).catch(()=>{});});
