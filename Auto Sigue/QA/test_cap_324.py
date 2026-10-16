from pathlib import Path
import re,subprocess
s=Path('/mnt/data/as324_clean/content.js').read_text()
block=re.search(r'function maxReached\(\)\s*\{([\s\S]*?)\n  \}',s)
assert block, 'maxReached missing'
js='''const maxReached = function(){'''+block.group(1)+'''};'''+'''
let continueCount=100000;let settings={maxContinuesPerChat:0};
if(maxReached())throw Error('0 must be infinite');
settings.maxContinuesPerChat=5;if(!maxReached())throw Error('positive cap should apply');
continueCount=4;if(maxReached())throw Error('below cap should allow');
console.log('OK: 0 unlimited, cap 5 enforced');
'''
p=subprocess.run(['node','-e',js],capture_output=True,text=True)
print(p.stdout,p.stderr)
assert p.returncode==0
