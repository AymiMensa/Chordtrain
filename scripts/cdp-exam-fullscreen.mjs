import fs from "node:fs";

const previewUrl = process.env.KIMICHORD_PREVIEW_URL || "https://3000-ixc22bz2fbfyv6ztdzfrv-fcb23435.sg1.manus.computer/KIMIchord_trees_fixed.html";
const targets = await fetch("http://127.0.0.1:9222/json").then(response => response.json());
const target = targets.find(item => item.type === "page" && item.url.includes("manus.computer"));

if (!target?.webSocketDebuggerUrl) {
  throw new Error("找不到可供驗證的 Chromium 頁面");
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  const handler = pending.get(message.id);
  if (!handler) return;
  pending.delete(message.id);
  if (message.error) handler.reject(new Error(message.error.message));
  else handler.resolve(message.result);
});

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "頁面 JavaScript 執行失敗");
  return result.result.value;
}

try {
  await send("Page.navigate", { url: previewUrl });
  await wait(1200);

  const examReady = await evaluate(`(() => {
    const select = document.getElementById('levelSelect');
    if (!select) return { ok: false, reason: 'missing levelSelect' };
    select.value = 'Exam';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const hintButton = document.getElementById('examKeyboardHintToggle');
    const hintDefault = { pressed: hintButton?.getAttribute('aria-pressed'), label: hintButton?.textContent?.trim(), enabled: S.examKeyboardHint };
    hintButton?.click();
    const hintEnabled = { pressed: hintButton?.getAttribute('aria-pressed'), label: hintButton?.textContent?.trim(), enabled: S.examKeyboardHint };
    hintButton?.click();
    const hintDisabled = { pressed: hintButton?.getAttribute('aria-pressed'), label: hintButton?.textContent?.trim(), enabled: S.examKeyboardHint };
    const tempo = document.getElementById('tempoSlider');
    if (tempo) {
      tempo.value = '300';
      tempo.dispatchEvent(new Event('input', { bubbles: true }));
      tempo.dispatchEvent(new Event('change', { bubbles: true }));
    }
    document.getElementById('examStartBtn')?.click();
    return {
      ok: true,
      fullscreenButton: Boolean(document.getElementById('examFullscreenBtn')),
      pauseButton: Boolean(document.getElementById('examPauseBtn')),
      hintDefault,
      hintEnabled,
      hintDisabled,
    };
  })()`);
  if (!examReady?.ok || !examReady.fullscreenButton || !examReady.pauseButton || examReady.hintDefault?.enabled || examReady.hintDefault?.pressed !== 'false' || examReady.hintDefault?.label !== '顯示藍色鍵盤提示' || !examReady.hintEnabled?.enabled || examReady.hintEnabled?.pressed !== 'true' || examReady.hintEnabled?.label !== '隱藏藍色鍵盤提示' || examReady.hintDisabled?.enabled || examReady.hintDisabled?.pressed !== 'false') throw new Error(`Exam 啟動或藍色提示控制不正確：${JSON.stringify(examReady)}`);

  const focused = await evaluate(`(() => {
    document.getElementById('examFullscreenBtn').click();
    const styles = id => getComputedStyle(document.getElementById(id)).display;
    const piano = document.querySelector('.exam-piano-stage .piano-mini');
    const panel = document.querySelector('.exam-panel');
    const content = document.querySelector('.content');
    return {
      focusClass: document.body.classList.contains('exam-focus-active'),
      topbar: styles('themeBtn'),
      sidebar: styles('sidebar'),
      footer: styles('contentArea').overflowX,
      pianoHeight: Math.round(piano?.getBoundingClientRect().height || 0),
      panelWidth: Math.round(panel?.getBoundingClientRect().width || 0),
      contentWidth: Math.round(content?.getBoundingClientRect().width || 0),
      bodyOverflow: getComputedStyle(document.getElementById('contentArea')).overflowX,
    };
  })()`);
  if (!focused.focusClass || focused.sidebar !== 'none' || focused.pianoHeight < 200 || focused.panelWidth < focused.contentWidth * 0.95 || focused.bodyOverflow !== 'hidden') {
    throw new Error(`全螢幕聚焦狀態不正確：${JSON.stringify(focused)}`);
  }

  await wait(250);
  const paused = await evaluate(`(async () => {
    const before = { beat: S.examBeat, selected: S.examSelected.length, active: S.examActive };
    document.getElementById('examPauseBtn')?.click();
    const pausedBeat = S.examBeat;
    document.querySelector('.exam-piano-stage [data-midi]')?.click();
    await new Promise(resolve => setTimeout(resolve, 470));
    return {
      before,
      paused: S.examPaused,
      pausedBeat,
      afterBeat: S.examBeat,
      selected: S.examSelected.length,
      pauseText: document.getElementById('examPauseBtn')?.textContent?.trim(),
      notice: document.querySelector('.exam-paused-notice')?.textContent?.trim(),
      overlay: document.querySelector('.exam-pause-overlay')?.className,
      overlayText: document.getElementById('examPauseOverlayTitle')?.textContent?.trim(),
      overlayResumeButton: document.getElementById('examPauseOverlayResumeBtn')?.textContent?.trim(),
      overlayBackground: getComputedStyle(document.querySelector('.exam-pause-overlay')).backgroundColor,
      metroRunning: Boolean(metroInterval),
    };
  })()`);
  if (!paused.paused || paused.afterBeat !== paused.pausedBeat || paused.selected !== paused.before.selected || paused.pauseText !== '繼續考試' || !paused.notice?.includes('計時與作答已凍結') || paused.overlay !== 'exam-pause-overlay' || paused.overlayText !== '考試暫停中' || paused.overlayResumeButton !== '繼續考試' || paused.overlayBackground !== 'rgba(11, 22, 39, 0.58)' || paused.metroRunning) {
    throw new Error(`暫停考試未正確凍結：${JSON.stringify(paused)}`);
  }
  const pausedShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync("/tmp/exam-pause-fullscreen.png", Buffer.from(pausedShot.data, "base64"));

  await send("Emulation.setDeviceMetricsOverride", {
    mobile: true,
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
  });
  await wait(180);
  const mobilePaused = await evaluate(`(() => ({
    viewport: [window.innerWidth, window.innerHeight],
    scrollWidth: document.documentElement.scrollWidth,
    pianoWidth: Math.round(document.querySelector('.exam-piano-stage .piano-mini')?.getBoundingClientRect().width || 0),
      pauseVisible: document.getElementById('examPauseBtn')?.textContent?.trim(),
      noticeVisible: Boolean(document.querySelector('.exam-paused-notice')),
      overlayVisible: Boolean(document.querySelector('.exam-pause-overlay')),
      overlayResumeButton: document.getElementById('examPauseOverlayResumeBtn')?.textContent?.trim(),
    }))()`);
  if (mobilePaused.scrollWidth > mobilePaused.viewport[0] + 1 || mobilePaused.pianoWidth < mobilePaused.viewport[0] * 0.9 || mobilePaused.pauseVisible !== '繼續考試' || !mobilePaused.noticeVisible || !mobilePaused.overlayVisible || mobilePaused.overlayResumeButton !== '繼續考試') {
    throw new Error(`手機直式暫停版面不正確：${JSON.stringify(mobilePaused)}`);
  }
  const mobilePausedShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync("/tmp/exam-pause-fullscreen-mobile.png", Buffer.from(mobilePausedShot.data, "base64"));
  await send("Emulation.clearDeviceMetricsOverride");
  await wait(100);

  const resumed = await evaluate(`(async () => {
    document.getElementById('examPauseOverlayResumeBtn')?.click();
    S.examBeatsPerQuestion = 4;
    S.examQuestionBpm = 300;
    S.tempo = 300;
    restartExamTimer();
    const initialBeat = S.examBeat;
    await new Promise(resolve => setTimeout(resolve, 280));
    return {
      paused: S.examPaused,
      active: S.examActive,
      initialBeat,
      currentBeat: S.examBeat,
      selected: S.examSelected.length,
      pauseText: document.getElementById('examPauseBtn')?.textContent?.trim(),
      metroRunning: Boolean(metroInterval),
    };
  })()`);
  if (resumed.paused || !resumed.active || resumed.initialBeat !== 0 || resumed.currentBeat === 0 || resumed.selected !== 0 || resumed.pauseText !== '暫停' || !resumed.metroRunning) {
    throw new Error(`恢復考試未以完整四拍安全重啟：${JSON.stringify(resumed)}`);
  }

  const completion = await evaluate(`(() => {
    S.examQuestionLimit = 1;
    for (const midi of [...(S.examQuestion?.midis || [])]) handleExamKey(midi, 'cdp');
    const report = document.querySelector('.exam-completion-stats');
    return {
      active: S.examActive,
      questionCount: S.examQuestionCount,
      pauseCount: S.examPauseCount,
      pauseTotalMs: S.examPauseTotalMs,
      reportText: report?.textContent?.replace(/\\s+/g, ' ').trim(),
    };
  })()`);
  if (completion.active || completion.questionCount !== 1 || completion.pauseCount !== 1 || completion.pauseTotalMs <= 0 || !completion.reportText?.includes('暫停次數 1 次') || !completion.reportText.includes('累計暫停時間')) {
    throw new Error(`完成報告的暫停統計不正確：${JSON.stringify(completion)}`);
  }

  const restarted = await evaluate(`(() => {
    startExam();
    const stats = { pauseCount: S.examPauseCount, pauseTotalMs: S.examPauseTotalMs, pauseStartedAt: S.examPauseStartedAt };
    stopExam();
    return stats;
  })()`);
  if (restarted.pauseCount !== 0 || restarted.pauseTotalMs !== 0 || restarted.pauseStartedAt !== 0) {
    throw new Error(`下一場考試未重設暫停統計：${JSON.stringify(restarted)}`);
  }

  const exited = await evaluate(`(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return {
      focusClass: document.body.classList.contains('exam-focus-active'),
      sidebar: getComputedStyle(document.getElementById('sidebar')).display,
      buttonText: document.getElementById('examFullscreenBtn')?.textContent?.trim(),
    };
  })()`);
  if (exited.focusClass || exited.sidebar === 'none' || exited.buttonText !== '全螢幕考試') {
    throw new Error(`Esc 退出全螢幕失敗：${JSON.stringify(exited)}`);
  }

  const modeSwitch = await evaluate(`(() => {
    const select = document.getElementById('levelSelect');
    select.value = 'Exam';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('examStartBtn')?.click();
    const examBeforeSwitch = { level: S.level, active: S.examActive, focus: S.examFullscreen };
    select.value = 'Beginner';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const beginner = {
      level: S.level,
      active: S.examActive,
      paused: S.examPaused,
      focus: document.body.classList.contains('exam-focus-active'),
      sidebarExam: document.getElementById('sidebar')?.classList.contains('exam-mode-active'),
    };
    select.value = 'Intermediate';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      examBeforeSwitch,
      beginner,
      intermediate: {
        level: S.level,
        previewCount: document.querySelectorAll('.chord-map-visuals .piano-mini').length,
        mapVisible: Boolean(document.querySelector('.chord-map-visuals')),
      },
    };
  })()`);
  if (modeSwitch.examBeforeSwitch.level !== 'Exam' || !modeSwitch.examBeforeSwitch.active || modeSwitch.beginner.level !== 'Beginner' || modeSwitch.beginner.active || modeSwitch.beginner.paused || modeSwitch.beginner.focus || modeSwitch.beginner.sidebarExam || modeSwitch.intermediate.level !== 'Intermediate' || !modeSwitch.intermediate.mapVisible || modeSwitch.intermediate.previewCount < 1) {
    throw new Error(`隨堂考試切換回一般模式失敗：${JSON.stringify(modeSwitch)}`);
  }

  await send("Emulation.setDeviceMetricsOverride", {
    mobile: true,
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
  });
  await wait(160);
  const mobileChordMap = await evaluate(`(() => {
    const piano = document.querySelector('.chord-map-visuals .piano-mini');
    const white = [...document.querySelectorAll('.chord-map-visuals .p-mini-w')];
    const black = [...document.querySelectorAll('.chord-map-visuals .p-mini-b')];
    const fits = elements => elements.every(element => element.scrollWidth <= element.clientWidth + 1);
    return {
      viewport: [window.innerWidth, window.innerHeight],
      scrollWidth: document.documentElement.scrollWidth,
      pianoWidth: Math.round(piano?.getBoundingClientRect().width || 0),
      panelWidth: Math.round(document.querySelector('.intermediate-visual-panel')?.getBoundingClientRect().width || 0),
      whiteLabelsFit: fits(white),
      blackLabelsFit: fits(black),
      whiteFont: white[0] ? getComputedStyle(white[0]).fontSize : '',
      blackFont: black[0] ? getComputedStyle(black[0]).fontSize : '',
    };
  })()`);
  if (mobileChordMap.scrollWidth > mobileChordMap.viewport[0] + 1 || mobileChordMap.pianoWidth < mobileChordMap.panelWidth * 0.9 || !mobileChordMap.whiteLabelsFit || !mobileChordMap.blackLabelsFit) {
    throw new Error(`手機直式和弦種類圖鋼琴可讀性不正確：${JSON.stringify(mobileChordMap)}`);
  }
  const mobileChordMapShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync("/tmp/chord-map-mobile-portrait.png", Buffer.from(mobileChordMapShot.data, "base64"));
  await send("Emulation.clearDeviceMetricsOverride");

  console.log(JSON.stringify({ status: 'PASS', examReady, focused, paused, mobilePaused, resumed, completion, restarted, exited, modeSwitch, mobileChordMap }, null, 2));
} finally {
  socket.close();
}
