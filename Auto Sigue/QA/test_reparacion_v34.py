import json
from pathlib import Path
p=Path(__file__).resolve().parent.parent
manifest=json.loads((p/'manifest.json').read_text(encoding='utf-8'))
assert manifest['manifest_version']==3 and manifest['version']=='3.4.0'
assert 'alarms' in manifest['permissions']
assert (p/manifest['background']['service_worker']).exists()
for c in manifest['content_scripts']:
 for f in c['js']: assert (p/f).exists(),f
b=(p/'background.js').read_text(encoding='utf-8')
c=(p/'content.js').read_text(encoding='utf-8')
assert all(x in b for x in ['CONTINUE_RESERVE','CONTINUE_CLICKED','CONTINUE_RESULT','CONTINUE_RELEASE','autosigueContinueLedger','chrome.alarms'])
assert c.index("continueJournal('CONTINUE_CLICKED'") < c.index('button.click();')
assert c.index('confirmSent(snapshot, editor)') < c.index("continueJournal('CONTINUE_RESULT',journalTurn,journalToken,true)")
assert all(x in c for x in ['restoreContinueState()', 'persistContinueCount()', 'WAKE_SCAN','persistedLedger','ambiguousSend'])
assert 'maxContinuesPerChat: 0' in c
print('OK: paquete, manifiesto y protecciones de estado')
