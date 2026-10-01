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
});
