import sys
content = open('client/public/KIMIchord_trees_fixed.html', 'r', encoding='utf-8').read()
# 尋找 startMetronomeNow 中的錨點設定
# 行 4696-4701
old = '''  musicalClockActive=true;
  const beatSec = 60 / Math.max(30, Number(S.tempo) || 72);
  const barSec = beatSec * 4;
  musicalClockAnchor = Math.ceil(AC.currentTime / barSec) * barSec; // 下個第一拍（秒）
  musicalClockPeriod = barSec * 1000; // 毫秒，只用於檢查 >0
  musicalClockSource = 'metronome';'''
new = '''  const beatSec = 60 / Math.max(30, Number(S.tempo) || 72);
  const barSec = beatSec * 4;
  if(musicalClockPeriod <= 0){
    musicalClockAnchor = Math.ceil(AC.currentTime / barSec) * barSec;
    musicalClockPeriod = barSec * 1000;
  }
  musicalClockActive=true;
  musicalClockSource = 'metronome';'''
count = content.count(old)
print(f'Found {count} occurrence(s)')
if count > 0:
    content = content.replace(old, new)
    open('client/public/KIMIchord_trees_fixed.html', 'w', encoding='utf-8').write(content)
    print('REPLACED')
else:
    print('Not found - checking variations...')
    # 找所有包含 barSec 的行
    for i, line in enumerate(content.split('\\n'), 1):
        if 'barSec' in line:
            print(f'Line {i}: {repr(line)}')