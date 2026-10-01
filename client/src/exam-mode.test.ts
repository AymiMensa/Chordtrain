import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const html = readFileSync(resolve(process.cwd(), "client/public/KIMIchord_trees_fixed.html"), "utf8");

describe("隨堂考試模式契約", () => {
  it("提供難度入口與開始／停止控制", () => {
    expect(html).toContain('<option value="Exam">隨堂考試</option>');
    expect(html).toContain('id="examStartBtn"');
    expect(html).toContain('id="examStopBtn"');
    expect(html).toContain("function startExam()");
    expect(html).toContain("function stopExam()");
  });

  it("以自訂拍數進度同步出題 BPM，並使用既有節拍器模式", () => {
    expect(html).toContain('class="exam-beat-track"');
    expect(html).toContain("S.examBeat=(S.examBeat+1)%beats");
    expect(html).toContain("examBeatsPerQuestion");
    expect(html).toContain("startMetronome()");
    expect(html).toContain("S.metroMode");
  });

  it("將琴鍵 MIDI 判定為正確或錯誤並呈現統計", () => {
    expect(html).toContain("function handleExamKey(midiValue,key)");
    expect(html).toContain("const feedbackKind=target.includes(value)?'correct':'wrong'");
    expect(html).toContain("S.examFeedback[value]=feedbackKind");
    expect(html).toContain('id="examAccuracy"');
    expect(html).toContain('id="examErrorRate"');
    expect(html).toContain('id="examReaction"');
    expect(html).toContain("exam-correct");
    expect(html).toContain("exam-wrong");
  });

  it("提供三和弦、七和弦與延伸和弦分級及題庫篩選", () => {
    expect(html).toContain('id="examDifficultySelect"');
    expect(html).toContain('value="triad"');
    expect(html).toContain('value="seventh"');
    expect(html).toContain('value="extended"');
    expect(html).toContain("function examChordDifficulty(type)");
    expect(html).toContain("function examDifficultyTypes");
  });

  it("支援指定調性／和弦種類並保存考試設定", () => {
    expect(html).toContain('id="examKeySelect"');
    expect(html).toContain('id="examChordSelect"');
    expect(html).toContain("function saveExamSettings()");
    expect(html).toContain("EXAM_SETTINGS_KEY");
    expect(html).toContain("S.examKeys");
    expect(html).toContain("S.examChordTypes");
  });

  it("保存歷史紀錄並產生調性與和弦類型弱點分析", () => {
    expect(html).toContain("function saveExamAttempt(correct,timeout)");
    expect(html).toContain("EXAM_HISTORY_KEY");
    expect(html).toContain("function examHistoryMarkup()");
    expect(html).toContain('id="examHistoryBtn"');
    expect(html).toContain('id="examHistoryClearBtn"');
    expect(html).toContain("exam-analysis-grid");
  });

  it("限制考試題數為 10 至 200 題並在達標後結束本場", () => {
    expect(html).toContain('id="examQuestionLimit"');
    expect(html).toContain('min="10" max="200"');
    expect(html).toContain("clampExamQuestionLimit");
    expect(html).toContain("S.examQuestionCount>=S.examQuestionLimit");
    expect(html).toContain("本場完成");
  });

  it("提供三風格、三種長度且各 30 組的常見進行資料驅動入口", () => {
    expect(html).toContain("COMMON_PROGRESSION_BASES");
    expect(html).toContain("function commonProgressionCatalog(style=S.harmonyStyle,length=8)");
    expect(html).toContain('id="commonProgressionLengthSelect"');
    expect(html).toContain('id="commonProgressionSelect"');
    expect(html).toContain('id="commonProgressionApplyBtn"');
    expect(html).toContain("length===16");
    expect(html).toContain("length===32");
    expect(html).toContain("for(let variant=0;variant<3;variant++)");
    expect(html).toContain("playSelectedCommonProgression");
  });

  it("常見進行沿用現有和弦資料與智慧和聲播放流程", () => {
    expect(html).toContain("progressionChordFromToken");
    expect(html).toContain("CHORDS[q]");
    expect(html).toContain("playSmartHarmony(S.progression)");
    expect(html).toContain("HARMONY_STYLE_LABELS");
  });

  it("預設關閉藍色提示並提供可保存的顯示／隱藏按鈕", () => {
    expect(html).toContain('id="examKeyboardHintToggle"');
    expect(html).toContain("顯示藍色鍵盤提示");
    expect(html).toContain("隱藏藍色鍵盤提示");
    expect(html).toContain("examKeyboardHint:false");
    expect(html).toContain("keyboardHint:S.examKeyboardHint");
    expect(html).toContain("function updateExamHintToggle()");
    expect(html).toContain("exam-hint");
  });

  it("開始考試後可隱藏設定並使用放大的考試琴鍵", () => {
    expect(html).toContain('id="examSettingsBody"');
    expect(html).toContain('id="examSettingsToggle"');
    expect(html).toContain("S.examSettingsCollapsed=true");
    expect(html).toContain("height='224px'");
  });

  it("Exam 側欄隔離非考試設定並保留必要考試控制", () => {
    expect(html).toContain('id="sidebar"');
    expect(html).toContain('class="sb-section exam-mode-hidden" id="harmonyControlsSection"');
    expect(html).toContain('.sidebar.exam-mode-active .exam-mode-hidden');
    expect(html).toContain('id="examQuestionLimit"');
    expect(html).toContain('id="examDifficultySelect"');
    expect(html).toContain('id="examKeySelect"');
    expect(html).toContain('id="examChordSelect"');
    expect(html).toContain('id="metronome"');
    expect(html).toContain('id="grooveModeBtn"');
    expect(html).toContain('id="examKeyboardHintToggle"');
    expect(html).toContain("sidebar.classList.toggle('exam-mode-active',S.level==='Exam')");
  });

  it("保留智慧和聲與常見進行控制供其他模式使用", () => {
    expect(html).toContain('id="smartHarmonizeBtn"');
    expect(html).toContain('id="harmonyStyleSelect"');
    expect(html).toContain('id="commonProgressionSelect"');
    expect(html).toContain('id="harmonyDensitySelect"');
    expect(html).toContain('id="randomChordsBtn"');
  });

  it("提供進行預聽、摘要、收藏、搜尋與 JSON 匯入匯出", () => {
    expect(html).toContain('id="progressionPreviewBtn"');
    expect(html).toContain('id="progressionSummary"');
    expect(html).toContain('id="progressionFavoriteBtn"');
    expect(html).toContain('id="progressionSearch"');
    expect(html).toContain('id="progressionExportBtn"');
    expect(html).toContain('id="progressionImportBtn"');
    expect(html).toContain("progressionRoman");
    expect(html).toContain("saveProgressionFavorites");
  });

  it("考試作答琴鍵使用可貼齊內容左右邊界的全寬容器", () => {
    expect(html).toContain('class="exam-stage"');
    expect(html).toContain('class="visual-area exam-piano-stage"');
    expect(html).toContain('.exam-stage .exam-piano-stage{width:calc(100% + 18px)');
    expect(html).toContain('.exam-stage .exam-piano-stage .piano-mini{width:100%;max-width:none');
    expect(html).toContain('@media(max-width:700px)');
    expect(html).toContain('width:calc(100% + 24px);margin-left:-12px');
  });

  it("開始考試後立即關閉設定側欄與遮罩", () => {
    expect(html).toContain("document.getElementById('examStartBtn').onclick=function(){S.examTargetedPractice=false;S.examTargetedPracticePitches=[];startExam();");
    expect(html).toContain("sb.classList.remove('open')");
    expect(html).toContain("ov.classList.remove('show')");
    expect(html).toContain("examSettingsBody.hidden=true");
  });

  it("提供全螢幕考試聚焦作答與安全退出機制", () => {
    expect(html).toContain('id="examFullscreenBtn"');
    expect(html).toContain("examFullscreen:false");
    expect(html).toContain("function toggleExamFullscreen()");
    expect(html).toContain("document.body.classList.toggle('exam-focus-active'");
    expect(html).toContain("document.documentElement.requestFullscreen");
    expect(html).toContain("document.addEventListener('fullscreenchange'");
    expect(html).toContain("if(S.examFullscreen){S.examFullscreen=false;applyExamFullscreenState()");
    expect(html).toContain(".exam-focus-active .topbar,.exam-focus-active .sidebar");
    expect(html).toContain(".exam-focus-active .exam-panel{width:100%;max-width:none");
    expect(html).toContain(".exam-focus-active .exam-stage .exam-piano-stage .piano-mini{height:clamp(220px,52svh,500px)!important");
  });

  it("全螢幕考試可暫停並以完整四拍安全恢復目前題目", () => {
    expect(html).toContain("examPaused:false");
    expect(html).toContain('id="examPauseBtn"');
    expect(html).toContain("function pauseExam()");
    expect(html).toContain("function resumeExam()");
    expect(html).toContain("function toggleExamPause()");
    expect(html).toContain("S.examPaused=true");
    expect(html).toContain("if(!S.examActive||S.examPaused)return;");
    expect(html).toContain("if(S.examPaused||!S.examActive||!S.examQuestion||S.examResolved)return;");
    expect(html).toContain("stopMetronome();");
    expect(html).toContain("S.examBeat=0;S.examSelected=[];S.examFeedback={};S.examStaffNotes=[];S.examResolved=false");
    expect(html).toContain("startMetronome();");
    expect(html).toContain("restartExamTimer();");
    expect(html).toContain("考試已暫停：計時與作答已凍結");
  });

  it("全螢幕暫停以半透明遮罩清楚呈現狀態並提供恢復入口", () => {
    expect(html).toContain('class="exam-pause-overlay"');
    expect(html).toContain("background:rgba(11,22,39,.58)");
    expect(html).toContain("考試暫停中");
    expect(html).toContain('id="examPauseOverlayResumeBtn"');
    expect(html).toContain("pauseOverlayResumeBtn.onclick=resumeExam");
    expect(html).toContain("S.examPaused&&S.examFullscreen");
  });

  it("可見遊戲標題使用和弦進行教學與測驗", () => {
    expect(html).toContain('<div class="logo-text">和弦進行教學與測驗</div>');
    expect(html).toContain('<h1>✦ 和弦進行教學與測驗 ✦</h1>');
  });

  it("完成頁提供成績曲線與弱點導向下一場練習", () => {
    expect(html).toContain("examScoreSeries");
    expect(html).toContain("exam-score-chart");
    expect(html).toContain('id="examWeaknessNextBtn"');
    expect(html).toContain("依弱點開始下一場");
  });

  it("完成報告會統計暫停次數與累計暫停時間", () => {
    expect(html).toContain("examPauseCount:0");
    expect(html).toContain("examPauseStartedAt:0");
    expect(html).toContain("examPauseTotalMs:0");
    expect(html).toContain("function formatExamPauseDuration(ms)");
    expect(html).toContain("function settleExamPauseDuration()");
    expect(html).toContain("S.examPauseCount=Math.max(0,Number(S.examPauseCount||0))+1");
    expect(html).toContain("settleExamPauseDuration();");
    expect(html).toContain("S.examPauseCount=0;S.examPauseStartedAt=0;S.examPauseTotalMs=0");
    expect(html).toContain('class="exam-completion-stats"');
    expect(html).toContain("暫停次數");
    expect(html).toContain("累計暫停時間");
    expect(html).toContain("formatExamPauseDuration(S.examPauseTotalMs)");
  });

  it("離開隨堂考試時會安全回收全螢幕、暫停與節拍器狀態", () => {
    expect(html).toContain("function exitExamFocus()");
    expect(html).toContain("S.examFullscreen=false;");
    expect(html).toContain("document.body.classList.contains('exam-focus-active')");
    expect(html).toContain("const leavingExam=S.level==='Exam'&&nextLevel!=='Exam'");
    expect(html).toContain("if(leavingExam){");
    expect(html).toContain("exitExamFocus();");
    expect(html).toContain("stopExam();");
    expect(html).toContain("metronome.dispatchEvent(new Event('change'))");
    expect(html).toContain("S.examSettingsCollapsed=false;");
  });

  it("離開隨堂考試時會還原一般模式所需的主內容容器", () => {
    expect(html).toContain("function restoreStandardContentShell()");
    expect(html).toContain("document.getElementById('mainView')");
    expect(html).toContain('id=\"progressionBar\"');
    expect(html).toContain('id=\"contentHint\"');
    expect(html).toContain("if(S.level!=='Exam')restoreStandardContentShell();");
    expect(html).toContain("renderProgression();");
  });

  it("Exam 輸入即時顯示彩色全音符並於四拍清除", () => {
    expect(html).toContain("examStaffNotes:[]");
    expect(html).toContain("function renderExamStaff()");
    expect(html).toContain("exam-staff-note correct");
    expect(html).toContain("exam-staff-note wrong");
    expect(html).toContain("S.examStaffNotes=[...(S.examStaffNotes||[]),{midi:value,status:feedbackKind}");
    expect(html).toContain("if(feedbackKind==='wrong')");
    expect(html).toContain("if(S.examActive&&!S.examPaused)S.examStaffNotes=[]");
    expect(html).toContain("${renderExamStaff()}");
  });

  it("Exam 空譜仍保留固定五線譜與高音譜記號，換題只清除全音符", () => {
    expect(html).toContain("if(layout!=='exam')return'';");
    expect(html).toContain("staffNotes=[];");
    expect(html).toContain("${renderStaff(notes,'exam')}");
    expect(html).toContain('aria-label="高音譜號"');
  });

  it("Exam 藍色鍵盤提示以嚴格布林解析，字串 false 不會誤顯示提示", () => {
    expect(html).toContain("savedExamSettings.keyboardHint===true||savedExamSettings.keyboardHint==='true'");
    expect(html).toContain("examKeyboardHint:false");
  });

  it("關閉藍色提示時，考試鋼琴只使用已點選音作為 on 高亮", () => {
    expect(html).toContain("${renderMiniPiano(S.examSelected||[],'112px')}");
    expect(html).not.toContain("${renderMiniPiano(target,'112px')}");
  });

  it("Groove 總線與聲部使用較長平滑包絡，避免瞬態逼逼與啵啵雜音", () => {
    expect(html).toContain("input.gain.value=1.08");
    expect(html).toContain("toneFilter.frequency.value=9000");
    expect(html).toContain("const attack=Math.min(.028,Math.max(.020,duration*.20))");
    expect(html).toContain("const fadeSeconds=.16");
  });

  it("Exam 成績報告會顯示正確率與常錯音符", () => {
    expect(html).toContain("function examMistakeRows()");
    expect(html).toContain("function examReportMarkup()");
    expect(html).toContain("本場成績統計");
    expect(html).toContain("答題正確率");
    expect(html).toContain("常錯音符");
    expect(html).toContain("examReportBtn");
    expect(html).toContain("examReportRetryBtn");
  });

  it("Exam 支援自訂每題拍數與出題速度並同步計時器", () => {
    expect(html).toContain("examBeatsPerQuestion:4");
    expect(html).toContain("examQuestionBpm:72");
    expect(html).toContain("id=\"examBeatsPerQuestion\"");
    expect(html).toContain("id=\"examQuestionBpm\"");
    expect(html).toContain("const beats=clampExamBeats(S.examBeatsPerQuestion)");
    expect(html).toContain("Number(S.examQuestionBpm)");
    expect(html).toContain("saveExamSettings()");
  });

  it("Exam 正誤輸入會觸發音效與粒子回饋", () => {
    expect(html).toContain("function playExamFeedbackSound(kind)");
    expect(html).toContain("function spawnExamFeedbackParticles(midiValue,kind)");
    expect(html).toContain("playExamFeedbackSound(feedbackKind)");
    expect(html).toContain("spawnExamFeedbackParticles(value,feedbackKind)");
    expect(html).toContain("exam-feedback-particle ${kind}");
    expect(html).toContain(".exam-feedback-particle.wrong");
  });

  it("Exam 成績報告支援 JSON／CSV 匯出與針對性練習", () => {
    expect(html).toContain("function examReportPayload()");
    expect(html).toContain("function downloadExamReport(format)");
    expect(html).toContain("kimichord-exam-report.json");
    expect(html).toContain("kimichord-exam-report.csv");
    expect(html).toContain('id="examReportJsonBtn"');
    expect(html).toContain('id="examReportCsvBtn"');
    expect(html).toContain("function startTargetedExamPractice()");
    expect(html).toContain("S.examTargetedPracticePitches");
    expect(html).toContain('id="examTargetedPracticeBtn"');
  });

  it("Exam 回饋音效與粒子數量可設定並持久化", () => {
    expect(html).toContain('id="examFeedbackVolume"');
    expect(html).toContain('id="examParticleCount"');
    expect(html).toContain("feedbackVolume:S.examFeedbackVolume");
    expect(html).toContain("particleCount:S.examParticleCount");
    expect(html).toContain("Number(S.examFeedbackVolume)/100");
    expect(html).toContain("Number(S.examParticleCount??8)");
  });

  it("Exam 藍色提示會實際同步到考試琴鍵且離開模式清理吉祥物", () => {
    expect(html).toContain("${examClass(m)}${hint}");
    expect(html).toContain("${examClass(bm)}${hint}");
    expect(html).toContain("stopMascotPlayback();");
    expect(html).toContain("mascotPlaybackActive=false;");
    expect(html).toContain("traveler.classList.remove('show')");
    expect(html).toContain("trail.innerHTML=''");
  });

  it("手機直式和弦種類圖使用滿寬鋼琴並提高音名可讀性", () => {
    expect(html).toContain("@media (max-width:600px) and (orientation:portrait)");
    expect(html).toContain(".chord-map-visuals{grid-template-columns:minmax(0,1fr);gap:10px}");
    expect(html).toContain(".chord-map-visuals .piano-mini{width:100%;max-width:none;height:72px");
    expect(html).toContain(".chord-map-visuals .p-mini-w{font-size:clamp(7px,2.25vw,10px)");
    expect(html).toContain(".chord-map-visuals .p-mini-b{font-size:clamp(5px,1.65vw,7px)");
  });
});


describe("初學者即時旋律轉和弦契約", () => {
  it("使用短窗收集彈奏音並產生最多三個候選和弦", () => {
    expect(html).toContain("beginnerInputWindow:[]");
    expect(html).toContain("function updateBeginnerRecommendations");
    expect(html).toContain("function beginnerChordCandidates");
    expect(html).toContain("slice(0,3)");
    expect(html).toContain("beginnerRecommendations");
  });

  it("推薦面板顯示理由並提供手動套用按鈕", () => {
    expect(html).toContain('beginner-harmony-coach');
    expect(html).toContain("item.reason");
    expect(html).toContain("beginner-apply-btn");
    expect(html).toContain("applyBeginnerRecommendation");
  });

  it("套用候選和弦會沿用既有 selectChord 同步視覺化與伴奏", () => {
    expect(html).toContain("applyBeginnerRecommendation(index)");
    expect(html).toContain("selectChord(item.note,item.q,null,item.midis)");
    expect(html).toContain("renderProgression();");
    expect(html).toContain("playChord");
  });
});


describe("Beginner realtime harmony interaction", () => {
  it("renders an interactive beginner piano and routes its midi input", () => {
    expect(html).toContain('class="beginner-input-stage"');
    expect(html).toContain("renderMiniPiano([], '108px')");
    expect(html).toContain("function pianoKeyElement(target){return target?.closest?.('.piano-mini [data-midi]')||null;}");
    expect(html).toContain("if(S.level==='Beginner')collectBeginnerInput(midiValue);");
  });

  it("supports candidate preview, confidence indicators, and practice tracking", () => {
    expect(html).toContain("function previewBeginnerRecommendation(index)");
    expect(html).toContain("function beginnerConfidenceInfo()");
    expect(html).toContain("function recordBeginnerAdoption(item)");
    expect(html).toContain("beginner-practice-summary");
    expect(html).toContain("轉調機率");
  });
});


describe("初學者旋律轉和弦輸入契約", () => {
  it("旋律輸入琴鍵會收集音符並使用既有 NOTES 常數", () => {
    expect(html).toContain('class="beginner-input-stage"');
    expect(html).toContain("function collectBeginnerInput(midiValue)");
    expect(html).toContain("function pressPianoKey(key)");
    expect(html).toContain("addEventListener('click',event=>");
    expect(html).toContain("name:NOTES[((midiNumber%12)+12)%12]");
    expect(html).not.toContain("name:NOTE_NAMES[((midiNumber%12)+12)%12]");
    expect(html).toContain("updateBeginnerRecommendations();");
  });
});


describe("旋律轉和弦推薦面板契約", () => {
  it("保留短窗分析並讓候選推薦停留足夠時間", () => {
    expect(html).toContain("BEGINNER_INPUT_WINDOW_MS=1200");
    expect(html).toContain("BEGINNER_RECOMMENDATION_HOLD_MS=6000");
    expect(html).toContain("S.beginnerInputTimer=setTimeout");
    expect(html).toContain("S.beginnerKeyInfo=beginnerConfidenceInfo();if(!S.beginnerPinned)S.beginnerRecommendations=[]");
    expect(html).toContain("document.getElementById('beginnerHarmonyCoach')");
    expect(html).not.toContain("S.beginnerRecommendations=[];S.beginnerKeyInfo=beginnerConfidenceInfo();updateBeginnerRecommendations();},1200");
  });
});


describe("旋律轉和弦推薦面板控制契約", () => {
  it("提供固定顯示控制並在固定時保留候選推薦", () => {
    expect(html).toContain("beginnerPinned:false");
    expect(html).toContain("function toggleBeginnerPinned()");
    expect(html).toContain('beginner-pin-toggle');
    expect(html).toContain("if(!S.beginnerPinned)S.beginnerRecommendations=[]");
    expect(html).toContain("推薦面板已固定顯示");
  });

  it("顯示最近一次輸入旋律音符並在模式切換時清理", () => {
    expect(html).toContain("beginnerRecentInput:[]");
    expect(html).toContain("S.beginnerRecentInput=S.beginnerInputWindow.slice(-8)");
    expect(html).toContain("const noteLabel=notes?((S.beginnerInputWindow||[]).length?'目前音符':'最近輸入'):'等待彈奏'");
    expect(html).toContain("S.beginnerRecentInput=[]");
  });

  it("提供候選預聽與套用快捷鍵並避免攔截輸入控制", () => {
    expect(html).toContain("預聽：按 1–3　套用：按 Shift+1–3");
    expect(html).toContain("快捷鍵 ${index+1}");
    expect(html).toContain("if(!['1','2','3'].includes(event.key))return;");
    expect(html).toContain("if(event.shiftKey)applyBeginnerRecommendation(index);else previewBeginnerRecommendation(index);");
    expect(html).toContain("input,select,textarea,[contenteditable=\"true\"]");
  });
});


describe("Exam 即時五線譜固定版面契約", () => {
  it("固定五線譜容器並只替換音符內容，不移除五線譜本體", () => {
    expect(html).toContain(".exam-input-staff");
    expect(html).toContain("height:208px;min-height:208px");
    expect(html).toContain(".exam-staff-wrap{height:168px;min-height:168px");
    expect(html).toContain("return `<div class=\"exam-staff-wrap\" aria-label=\"考試即時五線譜\">${renderStaff(notes,'exam')}</div>`");
    expect(html).toContain('class="staff-clef"');
    expect(html).toContain('aria-label="高音譜號"');
    expect(html).toContain("S.examStaffNotes=[]");
  });
});

describe("Exam 五線譜進度與 Combo", () => {
  it("在固定五線譜旁顯示換題倒數進度條與 Combo", () => {
    expect(html).toContain('class="exam-countdown"');
    expect(html).toContain('class="exam-countdown-fill"');
    expect(html).toContain('aria-label="連續答對次數"');
    expect(html).toContain("Number(S.examCombo)||0");
  });

  it("換題時提供輕微視覺提示，並在答對／答錯時更新 Combo", () => {
    expect(html).toContain("exam-question-transition");
    expect(html).toContain("S.examQuestionTransition");
    expect(html).toContain("S.examCombo=(Number(S.examCombo)||0)+1");
    expect(html).toContain("S.examCombo=0");
  });
});


  it("提供可保存的考試答案和弦淡色參考標記", () => {
    expect(html).toContain('id="examAnswerReferenceToggle"');
    expect(html).toContain("examAnswerReference:false");
    expect(html).toContain("answerReference:S.examAnswerReference");
    expect(html).toContain("function updateExamAnswerReferenceToggle()");
    expect(html).toContain("examStatus:'reference'");
    expect(html).toContain("exam-staff-note reference");
  });

  it("保留固定五線譜容器，只在答案參考切換或換題時改變音符內容", () => {
    expect(html).toContain("const reference=S.examAnswerReference?");
    expect(html).toContain("const notes=[...reference,...(S.examStaffNotes||[])");
    expect(html).toContain('aria-label="考試即時五線譜"');
    expect(html).toContain("if(S.examActive&&!S.examPaused)S.examStaffNotes=[]");
  });
