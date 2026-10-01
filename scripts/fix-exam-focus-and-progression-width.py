from pathlib import Path

path = Path('/home/ubuntu/kimichord-game/client/public/KIMIchord_trees_fixed.html')
text = path.read_text()

css_anchor = '.harmony-common-progressions .sb-btn{width:100%;margin-top:6px}'
css_insert = css_anchor + '\n.harmony-common-progressions .sb-select{width:calc(100% + 15px);max-width:none}\n.exam-controls.is-exam-active #examSettingsBody{display:none!important}'
if css_anchor in text and '.harmony-common-progressions .sb-select{width:calc(100% + 15px)' not in text:
    text = text.replace(css_anchor, css_insert, 1)

old_start = "  stopExam();S.level='Exam';S.examSettingsCollapsed=true;S.examActive=true;S.examQuestionCount=0;"
new_start = "  stopExam();S.level='Exam';S.examSettingsCollapsed=true;S.examActive=true;const examSettingsBody=document.getElementById('examSettingsBody');if(examSettingsBody){examSettingsBody.hidden=true;examSettingsBody.setAttribute('hidden','');}const examControls=document.getElementById('examControls');if(examControls)examControls.classList.add('is-exam-active');S.examQuestionCount=0;"
if old_start in text and "examControls.classList.add('is-exam-active')" not in text:
    text = text.replace(old_start, new_start, 1)

old_stop = "  S.examActive=false;S.examQuestion=null;S.examSelected=[];S.examFeedback={};S.examBeat=0;updateExamStats();"
new_stop = "  S.examActive=false;S.examQuestion=null;S.examSelected=[];S.examFeedback={};S.examBeat=0;const examSettingsBody=document.getElementById('examSettingsBody');if(examSettingsBody){examSettingsBody.hidden=false;examSettingsBody.removeAttribute('hidden');}const examControls=document.getElementById('examControls');if(examControls)examControls.classList.remove('is-exam-active');updateExamStats();"
if old_stop in text and "examControls.classList.remove('is-exam-active')" not in text:
    text = text.replace(old_stop, new_stop, 1)

path.write_text(text)
print('patched')
