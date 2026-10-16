'use strict';
const AS_ROUTE_KEY='autosigue_routes_v1';
const AS_DEFAULT_ROUTES=[
 {name:'ChatGPT',pattern:'https://chatgpt.com/*',enabled:true,engine:'chatgpt'},
 {name:'ChatGPT (anterior)',pattern:'https://chat.openai.com/*',enabled:true,engine:'chatgpt'},
 {name:'Claude',pattern:'https://claude.ai/*',enabled:true,engine:'pending'},
 {name:'Gemini',pattern:'https://gemini.google.com/*',enabled:true,engine:'pending'},
 {name:'Grok',pattern:'https://grok.com/*',enabled:true,engine:'pending'},
 {name:'Perplexity',pattern:'https://www.perplexity.ai/*',enabled:true,engine:'pending'},
 {name:'Copilot',pattern:'https://copilot.microsoft.com/*',enabled:true,engine:'pending'},
 {name:'DeepSeek',pattern:'https://chat.deepseek.com/*',enabled:true,engine:'pending'},
 {name:'Mistral',pattern:'https://chat.mistral.ai/*',enabled:true,engine:'pending'}
];
const AS_VALID_ROUTE=s=>{
 if(typeof s!=='string'||s.length>250||/\s/.test(s))return false;
 try { const v=new URL(s.replace(/\*/g,'a'));return v.protocol==='https:'&&!!v.hostname&& !s.includes('..')&&/^https:\/\/[\w.*-]+(?::\d+)?\/[\w*/.%-]*$/i.test(s); }catch{return false}
};
const AS_MATCH_ROUTE=(pattern,url)=>{
 try {const u=new URL(url);if(u.protocol!=='https:')return false;const re=new RegExp('^'+pattern.replace(/[|\\{}()[\]^$+?.]/g,'\\$&').replace(/\*/g,'.*')+'$','i');return re.test(u.href)}catch{return false}
};

// ChatGPT conserva sus ID reales. El resto usa su ruta o, en una página nueva,
// una clave de pestaña; no se mezclan permisos entre dominios ni conversaciones.
const AS_CHAT_KEY=tab=>{
  if(!tab?.url)return '';
  try{
    const url=new URL(tab.url);if(url.protocol!=='https:')return '';
    if(['chatgpt.com','chat.openai.com'].includes(url.hostname)){
      const m=url.pathname.match(/\/c\/([a-z0-9_-]+)/i);return m?'c:'+m[1]:'';
    }
    const path=url.pathname.replace(/\/+$/,'')||'/';
    const query=url.search.slice(0,100);
    const id=path==='/'||/^\/(app|chat|new)$/.test(path)?`tab-${tab.id||0}`:encodeURIComponent(path+query).slice(0,250);
    return `ai:${url.hostname.toLowerCase()}:${id}`;
  }catch{return ''}
};
