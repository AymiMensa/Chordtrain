import sys
content = open('client/public/KIMIchord_trees_fixed.html', 'r', encoding='utf-8').read()
# 尋找 startMetronomeNow 函數中的錨點設定
import re
# 模式：找到 musicalClockAnchor = Math.ceil(...) 這一行
pattern = r'(  const beatSec = 60 / Math\.max\(30, Number\(S\.tempo\) \|\| 72\);\n  const barSec = beatSec \* 4;\n)  musicalClockAnchor = Math\.ceil\(AC\.currentTime / barSec\) \* barSec;.*?\n  musicalClockPeriod = barSec \* 1000;.*?\n  musicalClockActive=true;\n  musicalClockSource = .metronome.;'
m = re.search(pattern, content)
if m:
    print('FOUND PATTERN')
    print('MATCH:', repr(m.group(0)[:200]))
else:
    print('PATTERN NOT FOUND')
    # 找所有 musicalClockAnchor 出現位置
    for m2 in re.finditer(r'musicalClockAnchor', content):
        print(f'Found at {m2.start()}:', repr(content[m2.start()-30:m2.start()+80]))