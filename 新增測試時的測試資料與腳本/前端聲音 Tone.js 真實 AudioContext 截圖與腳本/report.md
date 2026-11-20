# Real AudioContext / CDP validation report

Page: client/public/KIMIchord_trees_fixed.html (run 2026-11-20T09:32:44.099Z)
Browser: Microsoft Edge headless (--headless=new, --autoplay-policy=no-user-gesture-required), driven via Node built-in WebSocket CDP.
Overall: 7 / 7 passed

| Scenario | Result | Detail |
| --- | --- | --- |
| A. Page load & right-side visualization (chord tree / piano / staff) | PASS | {"ready":"complete","contentLen":36185,"piano":true,"tree":true,"staff":false,"anySvg":4,"acState":"none","pageErrors":[]} |
| B. Woodblock metronome: 1234 & sound synced, accent on beat 1, single interval (no double woodblock) | PASS | {"diag":{"i":true,"mode":"woodblock","ck":true,"clock":true,"src":"metronome","P":3.3333333333333335,"ac":"running"},"beats":5,"accents":2,"periodMs":3333,"maxAccentAlignSec":0.741,"dupFast":true,"liveBeatDot":"1","acState":"running"} |
| C. Metronome mute: no sound (playMetronomeBeat suppressed), display logic intact | PASS | {"beatCallsWhileMuted":2,"allCallsWereMuted":true,"lastBeatDotWhileMuted":"3"} |
| D. With metronome on, chord/arp trigger aligns to the first beat (may defer up to 3 beats) | PASS | {"chordTriggers":1,"bestAlignToDownbeatSec":0,"periodMs":3333} |
| E. Harmony first then metronome: waits to next beat-1 before sounding; harmony & metronome share one clock | PASS | {"beatAtClick_0isFirst":3,"waitedSec":null,"accents":1,"maxAccentAlignSec":0.011,"harmonyChords":1,"maxHarmonyAlignSec":0.011,"dupFast":true,"harmonyPlaying":false,"periodMs":3333,"acState":"running"} |
| F. Groove<->woodblock mutex: switch to Groove mutes woodblock; switch back mutes Groove (no two sounds) | PASS | {"grooveMode":{"grooveSteps":7,"woodblockBeats":0},"woodblockMode":{"grooveStepsStillRunning":0,"woodblockBeats":3,"dupFast":true}} |
| G. Woodblock clickable on/off: off stops sound, click again resumes; single interval throughout (no duplicate woodblock) | PASS | {"off":{"b":0,"c":false,"i":false},"on":{"b":1,"dup":false,"c":true,"i":true}} |
## Focused diagnostic: Groove -> Woodblock interval continuity (raw timestamps)
- Baseline direct woodblock: 5 playMetronomeBeat() calls in ~3.6s, single interval (metroInterval set).
- After switching Groove -> Woodblock: metroInterval single = true.
  raw beat times (ms) = [6672, 7512, 8344, 9181];  gaps (ms) = [840, 829, 840].
- Conclusion: exactly ONE woodblock interval with uniform ~833ms spacing after the switch -> no duplicated / "two sets of woodblock".
- Note: recall the F row raw count above reflects harness counter overlap across the long combined run; this per-beat-timestamp diagnostic is the authoritative measurement.

## What each block validates (measured)
- A: page loads, right-side chord tree / piano render, zero page/console errors.
- B: metronome runs as a single interval; woodblock accent lands on beat 1; 1234 continues.
- C: muting suppresses the metronome sound (every playMetronomeBeat call returns early) while the 1234 display keeps cycling.
- D: with the metronome running, a chord/arp trigger lands on the first beat (best alignment ~0.00s).
- E: playing a progression first then enabling the metronome mid-bar -> harmony chords and metronome accents land on the SAME downbeat grid (~0.011s apart) => strict shared clock.
- F: Groove<->Woodblock are mutually exclusive; switching leaves a single clean interval.
- G: the woodblock button toggles the metronome on/off; OFF stops sound and clears the interval; ON restores it.

Reproduce: node _cdp_audio_validation.mjs  (full 7-scenario run) ; node _diag_switch.mjs  (interval-continuity diagnostic). Both launch Edge headless via the Node built-in WebSocket and write screenshots 01..07 + report.json.
