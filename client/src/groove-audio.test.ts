import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Groove audio safety contracts", () => {
  const html = readFileSync(resolve(process.cwd(), "client/public/KIMIchord_trees_fixed.html"), "utf8");

  it("restores output after a direct Groove start instead of remaining at the fade floor", () => {
    expect(html).toContain("if(input){input.checked=true;input.setAttribute('aria-label',`關閉節拍器（${S.tempo} BPM）`);input.setAttribute('aria-checked','true');}");
    expect(html).toContain("mix.output.gain.exponentialRampToValueAtTime(target,now+.075)");
  });

  it("keeps built-in Groove preset output gains audible", () => {
    expect(html).toContain("standard:{label:'標準',input:1.08,output:.92");
    expect(html).toContain("bass:{label:'低頻加強',input:1.02,output:.94");
    expect(html).toContain("night:{label:'夜間柔和',input:.82,output:.70");
    expect(html).not.toContain("standard:{label:'標準',input:1.08,output:0.0001");
    expect(html).not.toContain("bass:{label:'低頻加強',input:1.02,output:0.0001");
    expect(html).not.toContain("night:{label:'夜間柔和',input:.82,output:0.0001");
  });

  it("uses a Night/Soft band-limited noise path and smooth source shutdown", () => {
    expect(html).toContain("const nightNoiseFilter=nightSafe&&filterType==='highpass'?'bandpass':filterType");
    expect(html).toContain("handle.master.gain.exponentialRampToValueAtTime(0.0001,now+fadeSeconds)");
    expect(html).toContain("source.stop(now+fadeSeconds+.035)");
  });

  it("records recent Groove clipping events with a readable cause and level snapshot", () => {
    expect(html).toContain('id="grooveClipHistory"');
    expect(html).toContain("function grooveClipReason(peak,rms)");
    expect(html).toContain("function recordGrooveClipEvent(peak,rms)");
    expect(html).toContain("近期削波事件");
    expect(html).toContain("峰值 ${Math.round(event.peak*100)}%");
    expect(html).toContain("RMS ${Math.round(event.rms*100)}%");
  });

  it("provides a one-click audio preference reset without weakening the safe output path", () => {
    expect(html).toContain('id="resetAudioPreferencesBtn"');
    expect(html).toContain("function resetAudioPreferences()");
    expect(html).toContain("AUDIO_PREFERENCE_KEYS.forEach");
    expect(html).toContain("setSoundLayerEnabled('chord',false)");
    expect(html).toContain("setMetronomeMode('woodblock')");
    expect(html).toContain("limiter.oversample='4x'");
    expect(html).toContain("output.gain.value=.98");
  });

  it("drives metronome, Groove, chords and arpeggio from one AudioContext beat timeline", () => {
    // 共用時脈的宣告與輔助函式必須存在。
    expect(html).toContain("let beatTimeline={originTime:0,isRunning:false,beatMs:0,runId:0};");
    expect(html).toContain("function startBeatTimeline()");
    expect(html).toContain("function stopBeatTimeline()");
    expect(html).toContain("function getMsUntilNextBeat()");

    // 木魚與 Groove 都必須以自校正 setTimeout 取代裸 setInterval，避免累積漂移。
    expect(html).not.toContain("metroInterval=setInterval(");

    // 節拍器／Groove 啟動時必須沿用進行已建立的拍點。startMetronome 會先呼叫
    // stopMetronome（內部 stopBeatTimeline 拆除時脈），因此兩條排程都要走
    // acquireBeatTimelineForPlayback() 沿用原點，不可一律以「當下」為新原點，
    // 否則與和弦進行形成 0–1 拍的固定相位差（聽感即「差半拍」）。
    expect(html).toContain("function acquireBeatTimelineForPlayback()");
    expect(html).toContain("const timelineRun=acquireBeatTimelineForPlayback();");
    expect(html).not.toContain("const timelineRun=startBeatTimeline();");

    // 重複宣告會被 JS 函式宣告的 hoisting 覆蓋（以最後一個定義為準）；
    // 若舊版實作殘留在後面，前面正確的版本會被靜默蓋掉，必須限制只能有一個。
    const matches=html.match(/function acquireBeatTimelineForPlayback\(/g)||[];
    expect(matches.length).toBe(1);
    // 舊版實作不查 preserved，出現即代表修補被覆蓋。
    expect(html).not.toContain("function acquireBeatTimelineForPlayback(){\n  if(isBeatTimelineRunning()&&beatTimeline.beatMs===getBeatMs())return adoptBeatTimeline(beatTimeline);\n  return startBeatTimeline();\n}");

    // stopBeatTimeline 必須保留原點，否則後啟動的節拍器接不回既有拍點。
    expect(html).toContain("beatTimelinePreserved={originTime:beatTimeline.originTime,beatMs:beatTimeline.beatMs}");
    expect(html).toContain("return adoptBeatTimeline(beatTimelinePreserved);");

    // metroInterval 改為 setTimeout handle，必須用 clearTimeout 取消。
    expect(html).toContain("if(metroInterval){clearTimeout(metroInterval);metroInterval=null;}");

    // 兩條進行排程都必須對齊節拍邊界，而非自原點立即起拍。
    expect(html).toContain("const beatAlignMs=getMsUntilNextBeat();");
    expect(html).toContain("},beatAlignMs+i*chordMs);");
    expect(html).toContain("},beatAlignMs+index*chordMs));");

    // 排程觸發點都要以 runId 守衛，舊排程不得在新時間軸上繼續發聲。
    expect(html).toContain("if(timelineRun!==beatTimeline.runId)return;");
  });
});
