import sys
content = open('client/public/KIMIchord_trees_fixed.html', 'r', encoding='utf-8').read()
old = '''  const beatSec = 60 / Math.max(30, Number(S.tempo) || 72);
  const barSec = beatSec * 4;
  musicalClockAnchor = Math.ceil(AC.currentTime / barSec) * barSec; // 下個第一拍（秒）
  musicalClockPeriod = barSec * 1000; // 毫秒，只用於檢查 >0
  musicalClockActive=true;
  musicalClockSource = 'metronome';'''
new = '''  const beatSec = 60 / Math.max(30, Number(S.tempo) || 72);
  const barSec = beatSec * 4;
  if(musicalClockPeriod <= 0){
    musicalClockAnchor = Math.ceil(AC.currentTime / barSec) * barSec;
    musicalClockPeriod = barSec * 1000;
  }
  musicalClockActive=true;
  musicalClockSource = 'metronome';'''
if old in content:
    content = content.replace(old, new)
    open('client/public/KIMIchord_trees_fixed.html', 'w', encoding='utf-8').write(content)
    print('REPLACED')
else:
    print('OLD NOT FOUND')
    idx = content.find('musicalClockAnchor')
    if idx >= 0:
        print(repr(content[idx-50:idx+200]))