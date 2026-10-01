from pathlib import Path

path = Path('/home/ubuntu/kimichord-game/client/public/KIMIchord_trees_fixed.html')
text = path.read_text()

replacements = [
    (
        'return `<g class="tree-node" onclick="selectChord(\'${c.note}\',\'${c.q}\')">',
        'return `<g class="tree-node" data-chord-note="${c.note}" data-chord-quality="${c.q}" onclick="selectChord(\'${c.note}\',\'${c.q}\',this)">`',
    ),
    (
        'html+=`<div class="chord-cell" onclick="playChord([${midis.join(\',\')}],0.6)">',
        'html+=`<div class="chord-cell" data-chord-note="${root}" data-chord-quality="${type}" onclick="playChord([${midis.join(\',\')}],0.6);moveMascotTo(\'${root}\',\'${type}\',this)">',
    ),
    (
        'html+=`<div class="scale-chip${isOn?\' on\':\'\'}" onclick="selectChord(\'${c.note}\',\'${c.q}\')">',
        'html+=`<div class="scale-chip${isOn?\' on\':\'\'}" onclick="selectChord(\'${c.note}\',\'${c.q}\',this)">',
    ),
    (
        'onclick="selectChord(\'${root}\',\'${s.q}\')"',
        'onclick="selectChord(\'${root}\',\'${s.q}\',this)"',
    ),
    (
        'onclick="event.stopPropagation();selectChord(\'${root}\',\'${t}\')"',
        'onclick="event.stopPropagation();selectChord(\'${root}\',\'${t}\',this)"',
    ),
]

for old, new in replacements:
    count = text.count(old)
    if not count:
        raise SystemExit(f'Missing replacement target: {old}')
    text = text.replace(old, new)

marker = "function selectChord(note,q){\n"
if marker not in text:
    raise SystemExit('selectChord marker not found')

feature = r'''function mascotCenter(el){
  if(!el)return null;
  const r=el.getBoundingClientRect();
  return{x:r.left+r.width/2,y:r.top+r.height/2};
}

function findMascotTarget(note,q,sourceEl){
  const matches=[...document.querySelectorAll('[data-chord-note][data-chord-quality]')]
    .filter(el=>el.dataset.chordNote===note&&el.dataset.chordQuality===q);
  return matches.find(el=>el.classList.contains('tree-node'))||sourceEl||matches[0]||null;
}

function drawMascotTrail(from,to){
  const svg=document.getElementById('mascotTrailSvg');
  if(!svg||!from||!to)return;
  const dx=to.x-from.x,dy=to.y-from.y,length=Math.max(1,Math.hypot(dx,dy));
  const line=document.createElementNS('http://www.w3.org/2000/svg','line');
  line.setAttribute('class','mascot-trail');
  line.setAttribute('x1',from.x);line.setAttribute('y1',from.y);
  line.setAttribute('x2',to.x);line.setAttribute('y2',to.y);
  line.style.setProperty('--trail-length',`${length}px`);
  line.style.strokeDasharray=`${length}px`;
  line.style.strokeDashoffset=`${length}px`;
  svg.appendChild(line);
  setTimeout(()=>line.remove(),5600);
}

function setMascotPosition(point){
  const mascot=document.getElementById('mascotTraveler');
  if(!mascot||!point)return;
  mascot.style.transform=`translate3d(${point.x-17}px,${point.y-17}px,0)`;
  mascot.style.display='flex';
  mascot.classList.add('show');
  mascotPosition=point;
}

function syncMascotTraveler(){
  if(!mascotTargetKey)return;
  const target=findMascotTarget(mascotTargetKey.note,mascotTargetKey.q,mascotTargetEl);
  if(!target)return;
  mascotTargetEl=target;
  const point=mascotCenter(target);
  setMascotPosition(point);
}

function moveMascotTo(note,q,sourceEl){
  const target=findMascotTarget(note,q,sourceEl);
  if(!target)return;
  const destination=mascotCenter(target);
  const previous=mascotHasPosition?mascotPosition:null;
  mascotTargetKey={note,q};
  mascotTargetEl=target;
  const mascot=document.getElementById('mascotTraveler');
  if(mascot)mascot.textContent=selectedMascot;
  if(previous&&destination&&Math.hypot(destination.x-previous.x,destination.y-previous.y)>2){
    drawMascotTrail(previous,destination);
  }
  mascotHasPosition=true;
  requestAnimationFrame(()=>setMascotPosition(destination));
}

'''

text = text.replace(marker, feature + marker)
text = text.replace(
    "function selectChord(note,q){\n  S.key=note;",
    "function selectChord(note,q,sourceEl){\n  moveMascotTo(note,q,sourceEl);\n  S.key=note;",
)
text = text.replace(
    "function render(){\n  if(S.level==='Beginner')renderBeginner();\n  else if(S.level==='Intermediate')renderIntermediate();\n  else renderAdvanced();\n}",
    "function render(){\n  if(S.level==='Beginner')renderBeginner();\n  else if(S.level==='Intermediate')renderIntermediate();\n  else renderAdvanced();\n  requestAnimationFrame(syncMascotTraveler);\n}",
)
text = text.replace(
    "document.querySelectorAll('.mascot-btn').forEach(btn=>{\n  btn.onclick=function(){document.querySelectorAll('.mascot-btn').forEach(b=>b.classList.remove('on'));this.classList.add('on');};\n});",
    "document.querySelectorAll('.mascot-btn').forEach(btn=>{\n  btn.onclick=function(){document.querySelectorAll('.mascot-btn').forEach(b=>b.classList.remove('on'));this.classList.add('on');selectedMascot=this.textContent.trim();const traveler=document.getElementById('mascotTraveler');if(traveler)traveler.textContent=selectedMascot;};\n});\nwindow.addEventListener('resize',syncMascotTraveler);\ndocument.getElementById('contentArea').addEventListener('scroll',syncMascotTraveler,{passive:true});",
)

path.write_text(text)
print('Mascot feature patch applied')
