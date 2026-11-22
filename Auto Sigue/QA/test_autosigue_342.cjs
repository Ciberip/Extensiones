const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');
const base = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(base,'content.js'), 'utf8');
const popup = fs.readFileSync(path.join(base,'popup.js'),'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(base,'manifest.json'),'utf8'));
const between = (a,b) => {let x=src.indexOf(a),y=src.indexOf(b,x+1);assert(x>=0&&y>x, a);return src.substring(x,y);};
const isEndSrc=between('  function isEndPhrase(value) {','  function buildContinuationMessage() {');
const context={settings:{completionPhrase:'HE ACABADO'},END_PHRASE:'HE ACABADO',endComparable:x=>String(x).trim().replace(/[.!¡!¿?…]+$/g,'').trim().toUpperCase()};
vm.createContext(context);vm.runInContext(isEndSrc,context);
assert.strictEqual(context.isEndPhrase('Queda trabajo pendiente. HE ACABADO'),false);
assert.strictEqual(context.isEndPhrase('Aún no escribas HE ACABADO\nSigo trabajando'),false);
assert.strictEqual(context.isEndPhrase('Finalizado\nHE ACABADO'),true);
assert.strictEqual(context.isEndPhrase('Finalizado\nHE ACABADO\nNo'),false);

const reconcileSrc=between('  async function reconcileContinueLedger(force=false) {','  const continueJournal =');
function env({marker=false,draft='',answering=false,uiError=false,age=60000}={}) {
 let clicks=0, counts=0, journal=0;
 const e={
  lastReconciliation:0,
  latestAssistant:()=>({text:'Trabajando'}),
  turnId:()=> 'turn42',
  persistedLedger:{turn42:{state:'uncertain',token:'abc123',at:Date.now()-age}},
  userTurnWithMarker:()=>marker,
  continueJournal:async()=>{journal++;return {ok:true}},
  continueCount:0,persistContinueCount:async()=>{counts++},
  handledTurnId:'',ambiguousSend:true,lastError:'revisar',
  sendStage:'error',lastAction:'',
  recoveryClicksByTurn:new Map(),
  allowedToSend:()=>true,sendBusy:false,isAnswering:()=>answering,
  hasPendingUserTurn:()=>false,activeUiError:()=>uiError,
  getComposer:()=>draft?{text:draft}:null,editorText:e=>e.text,
  continuationMarker:t=>'[AS_TX:'+t+']',
  getSendButton:()=>({disabled:false,getAttribute:()=>null,click:()=>{clicks++}}),
  Date,Number,Object,Map
 };
 vm.createContext(e);vm.runInContext(reconcileSrc,e);
 return {e,counts:()=>counts,clicks:()=>clicks,journal:()=>journal};
}
(async()=>{
 let x=env({marker:true});
 await x.e.reconcileContinueLedger(true);
 assert.equal(x.e.persistedLedger.turn42.state,'sent');
 assert.equal(x.e.ambiguousSend,false);assert.equal(x.counts(),1);assert.equal(x.journal(),1);
 x=env({marker:false,draft:''});
 await x.e.reconcileContinueLedger(true);
 assert.equal(x.clicks(),0);assert.equal(x.e.sendStage,'pendiente');assert.equal(x.e.lastError,'');
 x=env({marker:false,draft:'autosigue\n\n[AS_TX:abc123]'});
 await x.e.reconcileContinueLedger(true);
 assert.equal(x.clicks(),1);assert.equal(x.e.sendStage,'enviando');
 await x.e.reconcileContinueLedger(true);
 assert.equal(x.clicks(),1);
 x=env({marker:false,draft:'autosigue\n\n[AS_TX:abc123]',answering:true});
 await x.e.reconcileContinueLedger(true);assert.equal(x.clicks(),0);
 x=env({marker:false,draft:'autosigue\n\n[AS_TX:abc123]',age:10000});
 await x.e.reconcileContinueLedger(true);assert.equal(x.clicks(),0);
 const wd=between('  async function watchdog() {','  function finishedResponseForWorkflow() {');
 assert(!wd.includes('.click('), 'watchdog interrumpe la respuesta');
 assert(!popup.includes("setBadge('REVISAR'"), 'hay estado REVISAR');
 assert(popup.includes("RECUPERANDO"));
 assert(manifest.version==='3.4.2');
 for(const x of [manifest.background.service_worker, ...manifest.content_scripts.flatMap(c=>c.js)]) assert(fs.existsSync(path.join(base,x)), x);
 console.log('OK: fin solo por última línea, recuperación por marcador, borrador conservado, sin doble clic, no interrumpe por tiempo, panel y manifiesto');
})().catch(e=>{console.error(e);process.exit(1)});
