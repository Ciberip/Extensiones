import json
from pathlib import Path
p=Path(__file__).resolve().parent.parent
m=json.loads((p/'manifest.json').read_text(encoding='utf-8'))
assert m['version']=='3.4.1' and 'alarms' in m['permissions']
for f in [m['background']['service_worker']]+[f for item in m['content_scripts'] for f in item['js']]:
 assert (p/f).exists(),f
b=(p/'background.js').read_text(encoding='utf-8')
c=(p/'content.js').read_text(encoding='utf-8')
assert "'CONTINUE_RECONCILE'" in b
assert "(!recovering && before.tabId !== tabId)" in b
assert b.index("const token = crypto.randomUUID()") < b.index("await chrome.storage.local.set({autosigueContinueLedger:all});")
assert "userTurnWithMarker(snapshot.sendMarker)" in c
assert "userTurnWithMarker(record.token)" in c
assert c.index("sendMarker: journalToken") < c.index("const method = await putText(editor, text)")
assert "lastReconciliation" in c
assert "if(scanBusy) {sendResponse({ok:true,skipped:true});return true;}" in c
assert "maxContinuesPerChat: 0" in c
assert "if (false && msg?.type === 'HANDOFF_NOW')" in c
print('OK integridad, marcador, reconciliacion y no duplicados')
