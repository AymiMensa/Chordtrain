const fs = require('fs');
const path = require('path');
const { JSDOM } = require('../mondaycathotel/node_modules/jsdom');

const HTML_PATH = path.resolve(__dirname, '..', 'mondaycathotel', 'public', 'games', 'Maze TD.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

function makeEnv(seed, overrides) {
  const errors = [];
  const { VirtualConsole } = require('../mondaycathotel/node_modules/jsdom');
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdomError: ' + (e && e.message ? e.message : e)));
  vc.on('error', e => errors.push('error: ' + e));

  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k === 'measureText') return (s) => ({ width: String(s).length * 8 });
      return () => {};
    },
    set() { return true; }
  });

  let now = 0;
  let rafCb = null;
  const intervals = new Map();
  let intervalId = 0;

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    url: 'https://monday-cat-hotel.test/games/maze-td.html',
    beforeParse(window) {
      window.__now = 0;
      try { window.performance.now = () => window.__now; } catch (e) {}
      try { window.Date.now = () => window.__now; } catch (e) {}
      let _seed = seed;
      window.Math.random = function() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };
      window.HTMLCanvasElement.prototype.getContext = () => ctx;
      window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: window.innerWidth || 1024, height: window.innerHeight || 768 });
      window.AudioContext = class { constructor() { this.currentTime = 0; this.state = 'running'; this.sampleRate = 44100; } resume() {} createOscillator() { return { frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; } createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }; } createBiquadFilter() { return { frequency: { value: 0, setValueAtTime() {} }, Q: { value: 0 }, connect() {}, type: '' }; } createBuffer() { return { getChannelData() { return new Float32Array(4); } }; } createBufferSource() { return { buffer: null, connect() {}, start() {} }; } };
      window.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
      window.cancelAnimationFrame = () => {};
      window.setInterval = (cb, ms) => { const id = ++intervalId; intervals.set(id, { cb, ms, acc: 0 }); return id; };
      window.clearInterval = (id) => { intervals.delete(id); };
      window.setTimeout = () => 0;
      window.clearTimeout = () => {};
      window.innerWidth = 1280;
      window.innerHeight = 720;
      window.devicePixelRatio = 1;
      // inject overrides
      window.AI_OVERRIDES = overrides || [];
      window.AI_OVERRIDE_IDX = 0;
    }
  });
  const w = dom.window;
  function stepFrame(ms) {
    now += ms;
    w.__now = now;
    const cb = rafCb; rafCb = null;
    if (cb) cb(now);
    for (const [, rec] of intervals) {
      rec.acc += ms;
      if (rec.acc >= rec.ms) {
        rec.acc -= rec.ms;
        try { rec.cb(); } catch (e) { errors.push('interval err: ' + e.message); }
      }
    }
  }
  return { w, stepFrame, errors, dom };
}

function runWithOverrides(overrides, frames, seed) {
  const { w, stepFrame } = makeEnv(seed || 12345, overrides || []);
  w.eval("selectDifficulty('god')");
  w.document.getElementById('startBtn').click();
  w.document.getElementById('aiAutoBtn').click();
  let maxLevel = 1;
  for (let i = 0; i < frames; i++) {
    stepFrame(100);
    if (i % 50 === 0) {
      const level = w.eval('state.level');
      const over = w.eval('state.over');
      if (level > maxLevel) maxLevel = level;
      if (over) break;
    }
  }
  const level = w.eval('state.level');
  if (level > maxLevel) maxLevel = level;
  return { maxLevel, finalLevel: level, over: w.eval('state.over') };
}

module.exports = { runWithOverrides, makeEnv };
