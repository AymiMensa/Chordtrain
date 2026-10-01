from pathlib import Path

path = Path('/home/ubuntu/kimichord-game/client/public/KIMIchord_trees_fixed.html')
text = path.read_text()
old = 'onclick="selectChord(\'${c.note}\',\'${c.q}\',this)">`\n              <circle'
new = 'onclick="selectChord(\'${c.note}\',\'${c.q}\',this)">\n              <circle'
count = text.count(old)
if count != 2:
    raise SystemExit(f'Expected 2 malformed SVG templates, found {count}')
path.write_text(text.replace(old, new))
print('Fixed SVG template delimiters')
