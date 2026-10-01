from pathlib import Path

path = Path('/home/ubuntu/kimichord-game/client/public/KIMIchord_trees_fixed.html')
s = path.read_text()

# 1) Exam question limit persistence and state.
old = "S.examHistory=readExamHistory();"
new = "S.examHistory=readExamHistory();\nconst clampExamQuestionLimit=value=>Math.min(200,Math.max(10,Math.round(Number(value)||10)));\nS.examQuestionLimit=clampExamQuestionLimit(savedExamSettings.questionLimit);\nS.commonProgressionLength=8;S.commonProgressionIndex=0;S.commonProgressionId='';"
assert old in s
s = s.replace(old, new, 1)

old = "function saveExamSettings(){try{localStorage.setItem(EXAM_SETTINGS_KEY,JSON.stringify({difficulty:S.examDifficulty,keys:S.examKeys,chordTypes:S.examChordTypes}));}catch(error){}}"
new = "function saveExamSettings(){try{localStorage.setItem(EXAM_SETTINGS_KEY,JSON.stringify({difficulty:S.examDifficulty,keys:S.examKeys,chordTypes:S.examChordTypes,questionLimit:S.examQuestionLimit}));}catch(error){}}"
assert old in s
s = s.replace(old, new, 1)

# 2) Exam UI: insert number input before difficulty selector.
needle = '<div class="sb-row"><label for="examDifficultySelect">考試難度</label>'
insert = '<div class="sb-row"><label for="examQuestionLimit">題數</label><input class="sb-input exam-question-limit" id="examQuestionLimit" type="number" min="10" max="200" step="1" value="10" inputmode="numeric" aria-label="隨堂考試題數（10 至 200 題）"><span class="exam-inline-note">10–200 題</span></div>\n        '
assert needle in s
s = s.replace(needle, insert + needle, 1)

# 3) Harmony UI: add classic progression controls after harmony style row.
needle = '<div class="sb-row harmony-style-row"><label for="harmonyStyleSelect">風格</label><select class="sb-select" id="harmonyStyleSelect" aria-label="智慧和聲風格"><option value="popular">流行</option><option value="jazz">爵士</option><option value="classical">古典</option></select></div>'
insert = needle + '\n      <div class="harmony-common-progressions" aria-label="常見種類進行">\n        <div class="harmony-common-title">常見種類進行</div>\n        <div class="sb-row"><label for="commonProgressionLengthSelect">長度</label><select class="sb-select" id="commonProgressionLengthSelect" aria-label="常見進行長度"><option value="8">8 組</option><option value="16">16 組</option><option value="32">32 組</option></select></div>\n        <div class="sb-row"><label for="commonProgressionSelect">經典進行</label><select class="sb-select" id="commonProgressionSelect" aria-label="常見經典和聲進行"></select></div>\n        <button class="sb-btn" id="commonProgressionApplyBtn" type="button">載入並播放常見進行</button>\n      </div>'
assert needle in s
s = s.replace(needle, insert, 1)

# 4) Add catalog and helpers before existing harmonyStyleDiatonic.
marker = 'function harmonyStyleDiatonic(style){'
assert marker in s
catalog = r'''// 經典常見種類進行：每種風格以 10 個具代表性的骨架，搭配三種常用變體，
// 產生每個長度恰好 30 組的可追溯資料；所有音級與和弦種類均由現有 CHORDS／調式資料解析。
const COMMON_PROGRESSION_BASES={
  popular:[
    [['I','Major'],['V','Major'],['vi','Minor'],['IV','Major'],['I','Major'],['V','Major'],['vi','Minor'],['IV','Major']],
    [['I','Major'],['vi','Minor'],['IV','Major'],['V','Major'],['I','Major'],['vi','Minor'],['IV','Major'],['V','Major']],
    [['vi','Minor'],['IV','Major'],['I','Major'],['V','Major'],['vi','Minor'],['IV','Major'],['I','Major'],['V','Major']],
    [['I','Major'],['IV','Major'],['vi','Minor'],['V','Major'],['I','Major'],['IV','Major'],['V','Major'],['I','Major']],
    [['I','Major'],['V','Major'],['vi','Minor'],['iii','Minor'],['IV','Major'],['I','Major'],['IV','Major'],['V','Major']],
    [['I','Major'],['IV','Major'],['I','Major'],['V','Major'],['vi','Minor'],['IV','Major'],['I','Major'],['V','Major']],
    [['I','Major'],['iii','Minor'],['vi','Minor'],['IV','Major'],['I','Major'],['V','Major'],['IV','Major'],['V','Major']],
    [['I','Major'],['vi','Minor'],['ii','Minor'],['V','Major'],['I','Major'],['IV','Major'],['ii','Minor'],['V','Major']],
    [['I','Major'],['V','Major'],['IV','Major'],['I','Major'],['vi','Minor'],['iii','Minor'],['IV','Major'],['V','Major']],
    [['vi','Minor'],['V','Major'],['IV','Major'],['I','Major'],['vi','Minor'],['IV','Major'],['V','Major'],['I','Major']]
  ],
  jazz:[
    [['ii','Minor 7'],['V','Dominant 7'],['I','Major 7'],['I','Major 7'],['vi','Minor 7'],['ii','Minor 7'],['V','Dominant 7'],['I','Major 7']],
    [['I','Major 7'],['vi','Minor 7'],['ii','Minor 7'],['V','Dominant 7'],['I','Major 7'],['IV','Major 7'],['ii','Minor 7'],['V','Dominant 7']],
    [['iii','Minor 7'],['vi','Minor 7'],['ii','Minor 7'],['V','Dominant 7'],['I','Major 7'],['VI','Dominant 7'],['ii','Minor 7'],['V','Dominant 7']],
    [['I','Major 7'],['VI','Dominant 7'],['ii','Minor 7'],['V','Dominant 7'],['I','Major 7'],['IV','Major 7'],['iv','Minor 7'],['I','Major 7']],
    [['I','Major 7'],['vi','Minor 7'],['IV','Major 7'],['V','Dominant 7'],['iii','Minor 7'],['vi','Minor 7'],['ii','Minor 7'],['V','Dominant 7']],
    [['ii','Minor 7'],['V','Dominant 7'],['iii','Minor 7'],['vi','Minor 7'],['ii','Minor 7'],['V','Dominant 7'],['I','Major 7'],['VI','Dominant 7']],
    [['I','Major 7'],['I','Major 7'],['iv','Minor 7'],['bVII','Dominant 7'],['I','Major 7'],['vi','Minor 7'],['ii','Minor 7'],['V','Dominant 7']],
    [['iii','Minor 7'],['VI','Dominant 7'],['ii','Minor 7'],['V','Dominant 7'],['I','Major 7'],['IV','Major 7'],['ii','Minor 7'],['V','Dominant 7']],
    [['vi','Minor 7'],['ii','Minor 7'],['V','Dominant 7'],['I','Major 7'],['IV','Major 7'],['iv','Minor 7'],['I','Major 7'],['V','Dominant 7']],
    [['I','Major 7'],['VI','Dominant 7'],['ii','Minor 7'],['V','Dominant 7'],['iii','Minor 7'],['VI','Dominant 7'],['ii','Minor 7'],['V','Dominant 7']]
  ],
  classical:[
    [['I','Major'],['IV','Major'],['V','Major'],['I','Major'],['vi','Minor'],['ii','Minor'],['V','Major'],['I','Major']],
    [['I','Major'],['V','Major'],['vi','Minor'],['iii','Minor'],['IV','Major'],['I','Major'],['V','Major'],['I','Major']],
    [['I','Major'],['vi','Minor'],['ii','Minor'],['V','Major'],['I','Major'],['IV','Major'],['V','Major'],['I','Major']],
    [['I','Major'],['IV','Major'],['I','Major'],['V','Major'],['vi','Minor'],['IV','Major'],['V','Major'],['I','Major']],
    [['i','Minor'],['iv','Minor'],['V','Major'],['i','Minor'],['VI','Major'],['III','Major'],['iv','Minor'],['V','Major']],
    [['i','Minor'],['VI','Major'],['III','Major'],['VII','Major'],['iv','Minor'],['i','Minor'],['V','Major'],['i','Minor']],
    [['I','Major'],['vi','Minor'],['IV','Major'],['ii','Minor'],['V','Major'],['I','Major'],['V','Major'],['I','Major']],
    [['I','Major'],['IV','Major'],['ii','Minor'],['V','Major'],['I','Major'],['vi','Minor'],['IV','Major'],['V','Major']],
    [['I','Major'],['iii','Minor'],['vi','Minor'],['ii','Minor'],['V','Major'],['I','Major'],['IV','Major'],['V','Major']],
    [['I','Major'],['IV','Major'],['V','Major'],['vi','Minor'],['ii','Minor'],['V','Major'],['I','Major'],['I','Major']]
  ]
};
const COMMON_PROGRESSION_VARIANTS=['原典骨架','色彩變體','終止變體'];
function progressionDegreeIndex(token){const map={i:0,ii:1,iii:2,iv:3,v:4,vi:5,vii:6};const m=String(token).toLowerCase().replace(/[^iv]/g,'');return map[m]??0;}
function progressionRootNote(token){const scale=getDiatonic(S.key,S.scale)||[];return scale[progressionDegreeIndex(token)]?.note||S.key;}
function progressionQuality(token,quality){
  const roman=String(token);const minor=/^[iv]+$/.test(roman)||/^[iv]+$/.test(roman.toLowerCase())&&roman!==roman.toUpperCase();
  if(CHORDS[quality])return quality;
  return minor&&CHORDS.Minor? 'Minor':'Major';
}
function progressionChordFromToken(token,quality){const note=progressionRootNote(token);const q=progressionQuality(token,quality);return{note,q,name:note+(CHORDS[q]?.rom||q)};}
function commonProgressionCatalog(style=S.harmonyStyle,length=8){
  const bases=COMMON_PROGRESSION_BASES[style]||COMMON_PROGRESSION_BASES.popular;
  const items=[];
  bases.forEach((base,index)=>{
    for(let variant=0;variant<3;variant++){
      let sequence=base.map(([token,quality])=>progressionChordFromToken(token,quality));
      if(variant===1)sequence=sequence.map((chord,i)=>i===sequence.length-1?progressionChordFromToken('I',style==='jazz'?'Major 7':'Major'):chord);
      if(variant===2)sequence=sequence.map((chord,i)=>i===sequence.length-2?progressionChordFromToken('V',style==='jazz'?'Dominant 7':'Major'):chord);
      if(length===16)sequence=sequence.concat(sequence.slice(0,8));
      if(length===32)sequence=sequence.concat(sequence.slice(0,8),sequence.slice(0,8),sequence.slice(0,8));
      items.push({id:`${style}-${length}-${index*3+variant+1}`,label:`${HARMONY_STYLE_LABELS[style]||style}經典 ${String(index*3+variant+1).padStart(2,'0')}・${COMMON_PROGRESSION_VARIANTS[variant]}`,style,length,sequence});
    }
  });
  return items;
}
function populateCommonProgressions(){
  const select=document.getElementById('commonProgressionSelect');if(!select)return;
  const length=Number(document.getElementById('commonProgressionLengthSelect')?.value)||8;
  const list=commonProgressionCatalog(S.harmonyStyle,length);S.commonProgressionLength=length;
  select.innerHTML=list.map((item,index)=>`<option value="${item.id}">${item.label}</option>`).join('');
  const selected=list.findIndex(item=>item.id===S.commonProgressionId);select.value=selected>=0?S.commonProgressionId:(list[0]?.id||'');S.commonProgressionId=select.value;
}
function selectedCommonProgression(){const list=commonProgressionCatalog(S.harmonyStyle,S.commonProgressionLength||8);return list.find(item=>item.id===S.commonProgressionId)||list[0]||null;}
function playSelectedCommonProgression(){const item=selectedCommonProgression();if(!item)return;S.progression=item.sequence.map(chord=>({...chord}));renderProgression();render();playSmartHarmony(S.progression);showToast(`已播放${item.label}`);}
'''
s = s.replace(marker, catalog + marker, 1)

# 5) Render exam question limit and progress.
old = "const stats=`<div class=\"exam-panel-stats\"><span>答題 <strong>${S.examQuestionCount}</strong></span>"
new = "const stats=`<div class=\"exam-panel-stats\"><span>進度 <strong>${S.examQuestionCount}/${S.examQuestionLimit}</strong></span><span>答題 <strong>${S.examQuestionCount}</strong></span>"
assert old in s
s = s.replace(old, new, 1)

# 6) Finish an exam session at configured question count.
old = "updateExamStats();\n}\nfunction handleExamKey"
new = "updateExamStats();\n  if(S.examQuestionCount>=S.examQuestionLimit){\n    S.examActive=false;if(examTimer){clearInterval(examTimer);examTimer=null;}\n    setExamStatus(`本場完成：${S.examQuestionCount} 題，正確 ${S.examCorrectCount} 題`,'correct');\n    renderExam();\n  }\n}\nfunction handleExamKey"
assert old in s
s = s.replace(old, new, 1)

# 7) Event bindings: exam question limit, common progression controls.
needle = "document.getElementById('harmonyStyleSelect').onchange=function(){S.harmonyStyle=this.value;showToast(`智慧和聲風格：${HARMONY_STYLE_LABELS[S.harmonyStyle]||'流行'}`);};"
replacement = "document.getElementById('harmonyStyleSelect').onchange=function(){S.harmonyStyle=this.value;populateCommonProgressions();showToast(`智慧和聲風格：${HARMONY_STYLE_LABELS[S.harmonyStyle]||'流行'}`);};\ndocument.getElementById('commonProgressionLengthSelect').onchange=function(){S.commonProgressionLength=Number(this.value)||8;S.commonProgressionId='';populateCommonProgressions();};\ndocument.getElementById('commonProgressionSelect').onchange=function(){S.commonProgressionId=this.value;};\ndocument.getElementById('commonProgressionApplyBtn').onclick=function(){playSelectedCommonProgression();};\ndocument.getElementById('examQuestionLimit').onchange=function(){S.examQuestionLimit=clampExamQuestionLimit(this.value);this.value=S.examQuestionLimit;saveExamSettings();renderExam();showToast(`本場題數：${S.examQuestionLimit} 題`);};"
assert needle in s
s = s.replace(needle, replacement, 1)

# 8) Initialize controls after existing exam scope initialization.
needle = "updateExamScopeControls();"
replacement = "updateExamScopeControls();\nconst examQuestionLimitInput=document.getElementById('examQuestionLimit');if(examQuestionLimitInput)examQuestionLimitInput.value=S.examQuestionLimit;\npopulateCommonProgressions();"
assert needle in s
s = s.replace(needle, replacement, 1)

# 9) Add small styles near existing exam styles.
style_marker = '.exam-panel{'
style = '.exam-question-limit{max-width:88px;text-align:center}.exam-inline-note{font-size:10px;color:var(--muted,#7c8797);white-space:nowrap}.harmony-common-progressions{margin-top:8px;padding:8px;border:1px solid color-mix(in srgb,var(--line,#d7dce5) 75%,transparent);border-radius:10px;background:color-mix(in srgb,var(--surface,#fff) 82%,transparent)}.harmony-common-title{font-size:12px;font-weight:700;margin-bottom:5px;color:var(--text,#28313d)}.harmony-common-progressions .sb-btn{width:100%;margin-top:6px}.exam-panel-stats{flex-wrap:wrap}\n'
assert style_marker in s
s = s.replace(style_marker, style + style_marker, 1)

path.write_text(s)
print('updated', path)
