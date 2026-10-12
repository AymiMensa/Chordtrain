import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Groove audio safety contracts", () => {
  const html = readFileSync(resolve(process.cwd(), "client/public/KIMIchord_trees_fixed.html"), "utf8");

  it("restores output after a direct Groove start instead of remaining at the fade floor", () => {
    expect(html).toContain("if(input){input.checked=true;input.setAttribute('aria-label',`關閉節拍器（${S.tempo} BPM）`);input.setAttribute('aria-checked','true');}");
    expect(html).toContain("mix.output.gain.exponentialRampToValueAtTime(target,now+.025)");
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

  it("uses one smooth Groove voice envelope and keeps bright-wave peaks under control", () => {
    expect(html).toContain("master.gain.setValueAtTime(0,now);");
    expect(html).toContain("master.gain.linearRampToValueAtTime(normalizedLevel,now+attack);");
    expect(html).toContain("master.gain.linearRampToValueAtTime(0,releaseEnd);");
    expect(html).toContain("gain.gain.setValueAtTime(Math.max(.0001,level),now);");
    expect(html).toContain("S.mobilePureMode?0.14:0.22");
    expect(html).toContain("(S.grooveWaveform==='sawtooth'||S.grooveWaveform==='square')?1050:1800");
  });

  it("softens broadband noise edges and catches stacked transient peaks", () => {
    expect(html).toContain("compressor.attack.value=.003;compressor.release.value=.26;");
    expect(html).toContain("toneFilter.frequency.value=7200");
    expect(html).toContain("const edgeFade=Math.min(Math.floor(data.length*.012),Math.max(8,Math.floor(ctx.sampleRate*.003)))");
    expect(html).toContain("Math.min(fadeIn,fadeOut)");
    expect(html).toContain("limiter.oversample='4x'");
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

  it("keeps every four-beat part on the shared downbeat timeline", () => {
    expect(html).toContain("let beatTimeline={originTime:0,isRunning:false,beatMs:0,runId:0};");
    expect(html).toContain("function acquireBeatTimelineForPlayback(){return ensureBeatTimeline();}");
    expect(html).toContain("function getMsUntilNextDownbeat()");
    expect(html).toContain("const BEATS_PER_MEASURE=4;");
    expect(html).toContain("const horizon=now+0.12;");
    expect(html).toContain("while(beatTimeline.originTime+nextStep*stepSeconds<=horizon)");
    expect(html).toContain("while(beatTimeline.originTime+nextBeatIndex*beatTimeline.beatMs/1000<=horizon)");
    expect(html).toContain("metroInterval=setInterval(scheduleGroove,25);");
    expect(html).toContain("metroInterval=setInterval(scheduleWoodblock,25);");
    expect(html).toContain("function playChord(midis,dur,vol,capture,startAt)");
    expect(html).toContain("const noteStartAt=(Number.isFinite(startAt)?startAt:ac().currentTime+.012)+i*interval/1000;");
    expect(html).toContain("playMetronomeBeat(beat===0,targetTime)");
    expect(html).toContain("playGrooveStep(step,targetTime)");
    expect(html).toContain("const elapsedSteps=(AC.currentTime-beatTimeline.originTime)/stepSeconds;");
    expect(html).toContain("let nextStep=Math.max(0,Math.ceil(elapsedSteps-1e-6));");
    expect(html).toContain("let nextBeatIndex=Math.max(0,Math.ceil((AC.currentTime-beatTimeline.originTime)*1000/beatTimeline.beatMs-1e-6));");
    expect(html).not.toContain("Math.ceil(Math.max(0,elapsedSteps)/(measureSteps)-1e-6)*measureSteps");
    expect(html).not.toContain("metroInterval=setTimeout(");
    expect(html).not.toContain("playGrooveStep(0);");
    expect((html.match(/const beatAlignMs=getMsUntilNextDownbeat\(\);/g)||[]).length).toBe(3);
    expect(html).toContain("function scheduleChordAudio(midis,startAt,guard=()=>true)");
    expect(html).toContain("const leadSeconds=.12;");
    expect(html).toContain("document.getElementById('instSelect').onchange=function(){S.inst=normalizeInstrument(this.value);};");
  });

  it("provides quick audio profiles for desktop, mobile and headphones", () => {
    expect(html).toContain('id="audioDeviceProfile"');
    expect(html).toContain('<option value="desktop">桌面</option>');
    expect(html).toContain('<option value="mobile">手機</option>');
    expect(html).toContain('<option value="headphones">耳機</option>');
  });
});
