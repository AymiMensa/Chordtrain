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
    expect(html).toContain("standard:{label:'標準',input:1.16,output:1.08");
    expect(html).toContain("bass:{label:'低頻加強',input:1.10,output:1.10");
    expect(html).toContain("night:{label:'夜間柔和',input:.82,output:.70");
    expect(html).not.toContain("standard:{label:'標準',input:1.16,output:0.0001");
    expect(html).not.toContain("bass:{label:'低頻加強',input:1.10,output:0.0001");
    expect(html).not.toContain("night:{label:'夜間柔和',input:.82,output:0.0001");
  });

  it("uses a bounded soft ceiling with stronger clean headroom instead of hard clipping", () => {
    expect(html).toContain("const kneeStart=.78;");
    expect(html).toContain("const ceiling=.92;");
    expect(html).toContain("const eased=u*u*(3-2*u);");
    expect(html).not.toContain("Math.tanh(knee*x)/Math.tanh(knee)");
    expect(html).toContain("compressor.threshold.value=-14;compressor.knee.value=24;compressor.ratio.value=6.2;");
    expect(html).toContain("compressor.attack.value=.018;compressor.release.value=.32;");
    expect(html).toContain("limiter.oversample='4x'");
    expect(html).toContain("output.gain.value=1.10");
  });

  it("uses a Night/Soft band-limited noise path and smooth source shutdown", () => {
    expect(html).toContain("const safeNoiseFilter=(cleanSafe||nightSafe)&&filterType==='highpass'?'bandpass':filterType");
    expect(html).toContain("handle.master.gain.exponentialRampToValueAtTime(0.0001,now+fadeSeconds)");
    expect(html).toContain("source.stop(now+fadeSeconds+.035)");
    expect(html).toContain("noise.stop(now+duration+.245)");
    expect(html).toContain("osc.stop(now+duration+.245)");
    expect(html).toContain("const cleanSafe=true;");
    expect(html).toContain("const safeNoiseFilter=(cleanSafe||nightSafe)&&filterType==='highpass'?'bandpass':filterType");
    expect(html).toContain("toneFilter.frequency.value=7600");
    expect(html).toContain("smoothlySetAudioParam(masterMix.airFilter.frequency,pure?7200:10500");
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
    expect(html).toContain("output.gain.value=1.10");
  });

  it("provides desktop, mobile, and headphone volume profiles with auto detection", () => {
    expect(html).toContain('id="deviceAudioProfile"');
    expect(html).toContain("const DEVICE_AUDIO_PROFILE_KEY='kimichord.deviceAudioProfile'");
    expect(html).toContain("desktop:{label:'桌面',chordVol:.62,arpVol:.78,metroVol:.78");
    expect(html).toContain("mobile:{label:'手機',chordVol:.50,arpVol:.62,metroVol:.55");
    expect(html).toContain("headphones:{label:'耳機',chordVol:.72,arpVol:.82,metroVol:.72");
    expect(html).toContain("function detectDeviceAudioProfile()");
    expect(html).toContain("function applyDeviceAudioProfile(profileKey,persist=true,notify=true)");
    expect(html).toContain("setMobilePureMode(profile.mobilePureMode,false)");
  });

  it("uses longer anti-click envelopes across metronome, Groove, and synthesized voices", () => {
    expect(html).toContain("t+0.028");
    expect(html).toContain("duration+.090");
    expect(html).toContain("duration+.245");
    expect(html).toContain("const attack=Math.min(.060,Math.max(.042,dur*.22));");
    expect(html).toContain("const release=voice.isArpeggio?.085:(voice.isChordBus?.075:.075);");
    expect(html).toContain("gain.gain.exponentialRampToValueAtTime(0.075*level,now+0.045)");
    expect(html).not.toContain("t+0.004");
    expect(html).toContain("gain.connect(ensureMasterMix().input)");
    expect(html).not.toContain("gain.connect(ctx.destination);osc.start(now)");
  });

  it("locks the shared clock to the first beat (downbeat) so metronome, chord and arpeggio stay aligned", () => {
    expect(html).toContain("let musicalClockActive=false,musicalClockAnchor=0,musicalClockPeriod=0,musicalClockSource=''");
    expect(html).toContain("musicalClockSource='metronome'");
    expect(html).toContain("const shouldSyncToMetronome=metronomeEnabled&&musicalClockActive&&musicalClockSource==='metronome'&&musicalClockPeriod>0;");
    expect(html).toContain("const nextBeatForSync=shouldSyncToMetronome");
    expect(html).toContain("setTimeout(()=>playChord(copy,dur,vol,capture,true)");
    // 錨點對齊第一個第一拍（小節線），period 為一小節（四拍），讓節拍器、和弦與琶音共用同一時鐘。
    expect(html).toContain("Math.ceil(ctx.currentTime/barSec)*barSec");
    expect(html).toContain("musicalClockPeriod=barSec");
    // 在非第一拍按下節拍器時，先以靜音顯示 1234 到第一拍再出聲。
    expect(html).toContain("function startMetronomeSilentCountdown(anchorSec)");
    expect(html).toContain("if(!hadMetronomeClock&&harmonyWasPlaying)resyncActiveHarmonyToMetronome(true)");
  });

  it("unlocks AudioContext during the original user gesture before async playback", () => {
    expect(html).toContain("document.body.addEventListener('pointerdown',function unlockAudio(){ensureAudioReady();}");
    expect(html).toContain("document.body.addEventListener('keydown',function unlockAudioFromKeyboard(event)");
    expect(html).toContain("document.getElementById('playAllBtn').onclick=function(){\n  ensureAudioReady();");
    expect(html).toContain("document.getElementById('scalePreviewBtn').onclick=function(){ensureAudioReady();playScalePreview();}");
  });

  it("exposes the requested non-exam Chinese, world, jazz, blues, and modal scales", () => {
    expect(html).toContain('id="scaleSelect"');
    for (const value of [
      "Shang Pentatonic", "Jiao Pentatonic", "Zhi Pentatonic", "Yu Pentatonic",
      "Chinese Seven", "Chinese Yayue", "Chinese Qingyue", "Chinese Yanyue",
      "Hirajoshi", "Insen", "Kumoi", "Iwato", "Bhairav", "Kafi",
      "Hungarian Minor", "Byzantine", "Bebop Dominant", "Altered", "Lydian Dominant",
    ]) expect(html).toContain(`value="${value}"`);
    expect(html).toContain("function updateScaleInfoUi()");
    expect(html).toContain("雅樂音階（古音階、正聲音階）");
    expect(html).toContain("燕樂音階（俗樂、清商音階）");
    expect(html).toContain("if(diatonicControls)diatonicControls.hidden=S.level==='Exam';");
  });
  it("uses the requested Chinese setting labels, scale listener, and four added instruments", () => {
    expect(html).toContain('<label>根音</label>');
    expect(html).toContain('<label for="scaleSelect">音階</label>');
    expect(html).toContain('id="scalePreviewBtn"');
    expect(html).toContain("♩ 聆聽音階");
    expect(html).toContain('value="GlassBowl">玻璃碗琴');
    expect(html).toContain('value="Handpan">飛碟鼓（Handpan／Pan Drum）');
    expect(html).toContain('value="SteelTongue">空靈鼓（Steel Tongue Drum）');
    expect(html).toContain('value="Kalimba">卡林巴（Kalimba／Mbira）');
    for (const value of ["GlassBowl", "Handpan", "SteelTongue", "Kalimba"]) expect(html).toContain(`inst==='${value}'`);
    expect(html).toContain('<label>教會調式</label>');
    expect(html).toContain("pattern:'依目前音階'");
    expect(html).toContain("GlassBowl:{partials:[1,2.71,4.93,7.18,9.64]");
    expect(html).toContain("Handpan:{partials:[1,.998,1.498,2.006,2.704,3.985]");
    expect(html).toContain("SteelTongue:{partials:[1,2.69,4.08,5.76,8.32]");
    expect(html).toContain("Kalimba:{partials:[1,2.02,3.96,6.05,8.12]");
    expect(html).toContain("decays:[.96,.72,.50,.34,.24]");
    expect(html).toContain("if(inst==='Handpan'&&index===0)osc.frequency.exponentialRampToValueAtTime(freq,t+.16)");
  });

  it("re-anchors a playing common progression on the next beat instead of muting it when metronome starts", () => {
    expect(html).toContain("function resyncActiveHarmonyToMetronome(force=false)");
    expect(html).toContain("clearSmartHarmonyTimers();");
    expect(html).toContain("if(!hadMetronomeClock&&harmonyWasPlaying)resyncActiveHarmonyToMetronome(true)");
    expect(html).toContain("不停止目前已發出的和弦尾韻");
  });
});
