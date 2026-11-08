/**
 * Bug_Bomb ?衍ess 璅⊥皜祈岫?堆?蝝?撖?銝耨?寥??脫??塚?
 *
 *   node bb-sim.cjs baseline [runs] [stages]
 *   node bb-sim.cjs run <SINGLE|COOP|VS> <stage> <seed>
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// 遊戲根目錄解析：這個檔案會被放在 tools/ 下（相對於遊戲根），也可能被放在
// 儲存庫根目錄（mondaycathotel/public/games/Bug_Bomb）。兩種位置都要能用，
// 否則「node tools/x.mjs」會因為相對路徑只在一邊成立而直接找不到模組。
// 依序嘗試：同目錄、tools/ 的上一層、storage 根、再逐層往上找。
function resolveGameRoot() {
  const cands = [];
  const push = (p) => { const r = path.resolve(p); if (r && cands.indexOf(r) === -1) cands.push(r); };
  push(__dirname);
  push(path.join(__dirname, '..'));
  push(path.join(__dirname, 'mondaycathotel/public/games/Bug_Bomb'));
  push(path.join(__dirname, 'public/games/Bug_Bomb'));
  push(path.join(__dirname, 'games/Bug_Bomb'));
  push(path.join(__dirname, 'Bug_Bomb'));
  push(path.join(__dirname, '../../..'));                         // tools/ -> 儲存庫根
  push(path.join(__dirname, '../mondaycathotel/public/games/Bug_Bomb'));
  push(path.join(__dirname, '../../../mondaycathotel/public/games/Bug_Bomb'));
  // 逐層往上走四層，檢查是否存在 src/engine/physics/GridSystem.js
  let up = __dirname;
  for (let i = 0; i < 5; i++) {
    up = path.dirname(up);
    push(up);
    push(path.join(up, 'mondaycathotel/public/games/Bug_Bomb'));
    push(path.join(up, 'public/games/Bug_Bomb'));
  }
  for (const c of cands) {
    if (fs.existsSync(path.join(c, 'src/engine/physics/GridSystem.js'))) return c;
  }
  return cands[0];
}
const BASE = resolveGameRoot();


// ---- ?撠????璅∠??芰 localStorage / window ----
const store = new Map();
// 對應 main.js 的真實 gameMode 字串。
// Bot.getEnemies() 與 isTeamMateInDangerZone() 都會讀 window.gameMode 判斷敵我，
// 模擬器若不設定，isCoop 會是 falsy，導致 SINGLE/COOP 模式誤把隊友當敵人 → 測試失真。
const MODE_MAP = { SINGLE: 'BOT_SINGLE', COOP: 'BOT_BOT_COOP', VS: 'BOT_BOT_VS' };
global.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
global.window = global;
global.audioManager = new Proxy({}, { get: () => () => {} });

const { GridSystem } = require(path.join(BASE, 'src/engine/physics/GridSystem.js'));
const { MapManager } = require(path.join(BASE, 'src/game/map/MapManager.js'));
const { BombManager } = require(path.join(BASE, 'src/game/bomb/BombManager.js'));
const { ExplosionManager } = require(path.join(BASE, 'src/game/explosion/ExplosionManager.js'));
const { ItemManager } = require(path.join(BASE, 'src/game/item/ItemManager.js'));
const { MonsterManager } = require(path.join(BASE, 'src/game/monster/MonsterManager.js'));
const { DangerMap } = require(path.join(BASE, 'src/game/ai/DangerMap.js'));
const { Bot } = require(path.join(BASE, 'src/game/ai/Bot.js'));
const { DragonBoss } = require(path.join(BASE, 'src/game/monster/DragonBoss.js'));
const { StageManager } = require(path.join(BASE, 'src/game/map/StageManager.js'));

// ---- ?舫??曆???----
function makeRandom(seed) {
  let s = seed >>> 0;
  return function () {
    let v = (s += 0x6D2B79F5);
    v = Math.imul(v ^ (v >>> 15), v | 1);
    v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
    return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
  };
}


/** 璅⊥?桐??嚗pdate ??撠? main.js gameEngine.setUpdate */
function simulateStage({ mode, stage, seed, maxSeconds = 600, canvasW = 1280, canvasH = 960 }) {
  const realRandom = Math.random;
  Math.random = makeRandom(seed);
  store.set('bomber_stage', String(stage));

  const gridSystem = new GridSystem(13, 11);
  const mapManager = new MapManager(gridSystem);
  const itemManager = new ItemManager(gridSystem);
  itemManager.setAudioManager(global.audioManager);
  const explosionManager = new ExplosionManager(gridSystem, mapManager, itemManager);
  explosionManager.setAudioManager(global.audioManager);
  const bombManager = new BombManager(gridSystem, mapManager, explosionManager);
  bombManager.setAudioManager(global.audioManager);
  const monsterManager = new MonsterManager(gridSystem, mapManager, bombManager);
  global.monsterManager = monsterManager;
  explosionManager.setBombManager(bombManager);
  const dangerMap = new DangerMap(gridSystem, mapManager, bombManager, explosionManager, monsterManager);

  const stageManager = new StageManager(gridSystem, mapManager, monsterManager);
  stageManager.setDangerMap(dangerMap);
  stageManager.currentStage = stage;
  gridSystem.updateCellSize(canvasW, canvasH);
  stageManager.setupStage();
  dangerMap.initGrid();

  const theme = stageManager.getStageTheme();
  let dragonBoss = null;
  if (theme === 'BOSS') {
    dragonBoss = new DragonBoss(Math.floor(gridSystem.cols / 2), Math.floor(gridSystem.rows / 2),
      gridSystem, mapManager, explosionManager, stage);
  } else if (mode === 'VS') {
    monsterManager.spawnMonsters(3, stage);
  }

  const mk = (gx, gy) => {
    const b = new Bot(gx, gy, gridSystem, mapManager, dangerMap, bombManager, itemManager);
    b.setBombManager(bombManager); b.hp = 3; b.maxHp = 3; return b;
  };
  let bot = null, bot2 = null;
  if (mode === 'VS' || mode === 'COOP') { bot = mk(1, 1); bot2 = mk(gridSystem.cols - 2, 1); }
  else if (mode === 'SINGLE') { bot = mk(1, 1); }
  global.player = null; global.player2 = null; global.bot = bot; global.bot2 = bot2; global.gameMode = MODE_MAP[mode];
  const squad = [bot, bot2].filter(Boolean);

  const dt = 1 / 60;
  const maxFrames = Math.ceil(maxSeconds / dt);
  let f = 0, elapsed = 0, outcome = 'TIMEOUT';
  const deaths = [], trail = [];

  while (f < maxFrames) {
    for (const p of squad) p.update(dt);
    bombManager.update(dt);
    explosionManager.update(dt);
    monsterManager.update(dt);
    dangerMap.update(dt);
    itemManager.update(dt);
    for (const p of squad) monsterManager.checkPlayerCollision(p);
    explosionManager.checkMonsterHit(monsterManager);
    for (const p of squad) if (!p.isDead && explosionManager.checkPlayerHit(p)) p.die();
    if (dragonBoss && !dragonBoss.isDead && explosionManager.checkPlayerHit(dragonBoss)) dragonBoss.die();
    if (dragonBoss && !dragonBoss.isDead) {
      const cs = gridSystem.getCellSize();
      for (const p of squad) if (!p.isDead && Math.abs(dragonBoss.x - p.x) < cs && Math.abs(dragonBoss.y - p.y) < cs) p.die();
    }
    if (dragonBoss) dragonBoss.update(dt);

    for (const p of squad) {
      if (p.isDead && !p.__logged) {
        p.__logged = true;
        deaths.push({ t: +elapsed.toFixed(2), who: p === bot ? 'A' : 'B', hp: p.hp, pos: [p.gridX, p.gridY] });
      }
    }
    f++; elapsed += dt;

    if (f % 60 === 0) {
      trail.push(Math.round(elapsed) + 's ' + squad.map(p => `${p.gridX},${p.gridY}`).join(' | '));
      if (trail.length > 30) trail.shift();
    }

    const allMonstersDead = monsterManager.monsters.length === 0 && (!dragonBoss || dragonBoss.isDead);
    if (mode === 'VS') {
      const t1 = !bot.isDead, t2 = !bot2.isDead;
      if (!t1 && !t2) { outcome = 'DRAW'; break; }
      if (!t1) { outcome = 'LOSE'; break; }
      if (!t2) { outcome = 'WIN'; break; }
    } else {
      if (!squad.some(p => !p.isDead)) { outcome = 'DEAD'; break; }
      if (allMonstersDead) { outcome = 'CLEAR'; break; }
    }
  }

  const r = {
    mode, stage, theme, outcome, seconds: +elapsed.toFixed(1), frames: f,
    monstersLeft: monsterManager.monsters.length,
    bossHpLeft: dragonBoss ? Math.max(0, dragonBoss.hp) : null,
    bossMaxHp: dragonBoss ? dragonBoss.maxHp : null,
    alive: squad.filter(p => !p.isDead).length,
    hp: squad.map(p => p.hp),
    bombsAtEnd: bombManager.bombs.length,
    cols: gridSystem.cols, rows: gridSystem.rows,
    deaths, trail,
  };
  Math.random = realRandom;
  return r;
}


/** 批次診斷失敗原因：跑 N 局，統計死亡/超時與死因 */
export function batchDiagnose(mode, stage, runs, seedBase = 0x9e3779b1) {
  const realLog = console.log, realErr = console.error;
  const out = [];
  for (let i = 1; i <= runs; i++) {
    console.log = console.error = () => {};
    const seed = (i * seedBase) ^ (stage * 2654435761);
    const r = simulateStage({ mode, stage, seed, canvasW: 1280, canvasH: 960 });
    console.log = realLog; console.error = realErr;
    out.push(r);
  }

  // 統計
  const byOutcome = {};
  out.forEach(r => { byOutcome[r.outcome] = (byOutcome[r.outcome] || 0) + 1; });

  // 死亡局的怪物剩餘數分布
  const deadLeft = out.filter(r => r.outcome === 'DEAD').map(r => r.monstersLeft);
  const timeoutLeft = out.filter(r => r.outcome === 'TIMEOUT').map(r => r.monstersLeft);

  return {
    stage, mode, runs,
    byOutcome,
    avgMonstersLeftOnDead: deadLeft.length ? (deadLeft.reduce((a, b) => a + b, 0) / deadLeft.length).toFixed(1) : null,
    avgMonstersLeftOnTimeout: timeoutLeft.length ? (timeoutLeft.reduce((a, b) => a + b, 0) / timeoutLeft.length).toFixed(1) : null,
    sampleDead: out.filter(r => r.outcome === 'DEAD').slice(0, 3).map(r => ({ sec: r.seconds, left: r.monstersLeft, hp: r.hp })),
    sampleTimeout: out.filter(r => r.outcome === 'TIMEOUT').slice(0, 3).map(r => ({ sec: r.seconds, left: r.monstersLeft, hp: r.hp })),
  };
}

function countDecisions(mode, stage, seed, seconds) {
  const realRandom = Math.random;
  const realLog = console.log, realErr = console.error;
  console.log = console.error = () => {};
  Math.random = makeRandom(seed);
  store.set('bomber_stage', String(stage));

  const gridSystem = new GridSystem(13, 11);
  const mapManager = new MapManager(gridSystem);
  const itemManager = new ItemManager(gridSystem);
  const explosionManager = new ExplosionManager(gridSystem, mapManager, itemManager);
  const bombManager = new BombManager(gridSystem, mapManager, explosionManager);
  const monsterManager = new MonsterManager(gridSystem, mapManager, bombManager);
  global.monsterManager = monsterManager;
  explosionManager.setBombManager(bombManager);
  const dangerMap = new DangerMap(gridSystem, mapManager, bombManager, explosionManager, monsterManager);
  const stageManager = new StageManager(gridSystem, mapManager, monsterManager);
  stageManager.setDangerMap(dangerMap);
  stageManager.currentStage = stage;
  gridSystem.updateCellSize(1280, 960);
  stageManager.setupStage();
  dangerMap.initGrid();
  if (stageManager.getStageTheme() !== 'BOSS' && mode === 'VS') monsterManager.spawnMonsters(3);

  const bot = new Bot(1, 1, gridSystem, mapManager, dangerMap, bombManager, itemManager);
  bot.setBombManager(bombManager); bot.hp = 3; bot.maxHp = 3;
  global.player = null; global.player2 = null; global.bot = bot; global.bot2 = null;
  global.gameMode = MODE_MAP[mode];

  const stat = { states: {}, bombTry: 0, escapeOK: 0, escapeNG: 0, pathFound: 0, pathNull: 0,
                 huntTry: 0, huntOK: 0, chaseTry: 0, chaseOK: 0, safeCalls: 0, safeTrue: 0 };
  const oThink = bot.think.bind(bot);
  bot.think = function () { oThink(); stat.states[this.state] = (stat.states[this.state] || 0) + 1; };
  const oCan = bot.canSafelyPlaceBomb.bind(bot);
  bot.canSafelyPlaceBomb = function (...a) { stat.bombTry++; const r = oCan(...a); if (r && r.canEscape) stat.escapeOK++; else stat.escapeNG++; return r; };
  const oEsc = bot.findGlobalEscapePath.bind(bot);
  bot.findGlobalEscapePath = function (...a) { const r = oEsc(...a); if (r) stat.pathFound++; else stat.pathNull++; return r; };
  const oHunt = bot.trySafeHunt.bind(bot);
  bot.trySafeHunt = function () { stat.huntTry++; const r = oHunt(); if (r) stat.huntOK++; return r; };
  const oChase = bot.tryChase.bind(bot);
  bot.tryChase = function () { stat.chaseTry++; const r = oChase(); if (r) stat.chaseOK++; return r; };
  const oSafe = bot.isCellSafe.bind(bot);
  bot.isCellSafe = function (...a) { stat.safeCalls++; const r = oSafe(...a); if (r) stat.safeTrue++; return r; };

  const dt = 1 / 60;
  for (let f = 0, n = Math.ceil(seconds / dt); f < n; f++) {
    bot.update(dt);
    bombManager.update(dt); explosionManager.update(dt);
    monsterManager.update(dt); dangerMap.update(dt); itemManager.update(dt);
  }

  Math.random = realRandom;
  console.log = realLog; console.error = realErr;
  return { ...stat, monstersLeft: monsterManager.monsters.length, bombsOnField: bombManager.bombs.length };
}

// ===== 並行測試：同時跑 N 個子行程，大幅加快收斂 =====
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { cpus } from 'os';

export function parallelBench(modes, stages, runs, seedBase = 0x9e3779b1) {
  const jobs = [];
  for (const mode of modes) for (const stage of stages) jobs.push({ mode, stage, runs, seedBase });
  const nCpu = Math.max(1, Math.min(cpus().length, 8));
  const perWorker = Math.ceil(jobs.length / nCpu);
  return Promise.all(Array.from({ length: Math.min(nCpu, jobs.length) }, (_, wi) => {
    const slice = jobs.slice(wi * perWorker, (wi + 1) * perWorker);
    return new Promise((resolve, reject) => {
      const w = new Worker(new URL(import.meta.url), {
        workerData: { slice, seedBase },
      });
      w.on('message', m => { if (m.error) reject(new Error(m.error)); else resolve(m.results); });
      w.on('error', reject);
    });
  })).then(chunks => chunks.flat());
}

if (!isMainThread && workerData && workerData.slice) {
  const { slice, seedBase } = workerData;
  const out = [];
  for (const { mode, stage, runs } of slice) {
    const rs = [];
    for (let i = 1; i <= runs; i++) {
      rs.push(simulateStage({ mode, stage, seed: (i * seedBase) ^ (stage * 2654435761), canvasW: 1280, canvasH: 960 }));
    }
    out.push({ mode, stage, theme: rs[0].theme, results: rs });
  }
  parentPort.postMessage({ results: out });
}

// ===== 匯出（供 bb-probe / bb-cli 使用）=====
export {
  GridSystem, MapManager, ItemManager, ExplosionManager, BombManager,
  MonsterManager, DangerMap, Bot, DragonBoss, StageManager, makeRandom, MODE_MAP,
  simulateStage, probeBot, traceRun, countDecisions,
};
/** 瘛勗漲?ａ?嚗? N 蝘?瑼Ｚ? Bot ?捱蝑???閮箸?⊥香?? */
function probeBot(mode, stage, seed, seconds = 8) {
  const realRandom = Math.random;
  const realLog = console.log, realErr = console.error;
  console.log = console.error = () => {};
  Math.random = makeRandom(seed);
  store.set('bomber_stage', String(stage));

  const gridSystem = new GridSystem(13, 11);
  const mapManager = new MapManager(gridSystem);
  const itemManager = new ItemManager(gridSystem);
  const explosionManager = new ExplosionManager(gridSystem, mapManager, itemManager);
  const bombManager = new BombManager(gridSystem, mapManager, explosionManager);
  const monsterManager = new MonsterManager(gridSystem, mapManager, bombManager);
  global.monsterManager = monsterManager;
  explosionManager.setBombManager(bombManager);
  const dangerMap = new DangerMap(gridSystem, mapManager, bombManager, explosionManager, monsterManager);
  const stageManager = new StageManager(gridSystem, mapManager, monsterManager);
  stageManager.setDangerMap(dangerMap);
  stageManager.currentStage = stage;
  gridSystem.updateCellSize(1280, 960);
  stageManager.setupStage();
  dangerMap.initGrid();

  const mk = (gx, gy) => {
    const b = new Bot(gx, gy, gridSystem, mapManager, dangerMap, bombManager, itemManager);
    b.setBombManager(bombManager); b.hp = 3; b.maxHp = 3; return b;
  };
  let bot = null, bot2 = null;
  if (mode === 'VS' || mode === 'COOP') { bot = mk(1, 1); bot2 = mk(gridSystem.cols - 2, 1); }
  else bot = mk(1, 1);
  global.player = null; global.player2 = null; global.bot = bot; global.bot2 = bot2; global.gameMode = MODE_MAP[mode];
  const squad = [bot, bot2].filter(Boolean);

  const dt = 1 / 60;
  const frames = Math.ceil(seconds / dt);
  const states = new Map();
  const posCount = new Map();
  for (let f = 0; f < frames; f++) {
    for (const p of squad) p.update(dt);
    bombManager.update(dt); explosionManager.update(dt);
    monsterManager.update(dt); dangerMap.update(dt); itemManager.update(dt);
  }

  const out = {};
  for (const p of squad) {
    const who = p === bot ? 'A' : 'B';
    const pos = `${p.gridX},${p.gridY}`;
    posCount.set(pos, (posCount.get(pos) || 0) + 1);
    states.set(p.state, (states.get(p.state) || 0) + 1);
    out[who] = {
      pos, state: p.state, hp: p.hp, isDead: p.isDead,
      aiInput: { ...p.aiInput },
      targetPathLen: (p.targetPath || []).length,
      targetPath: (p.targetPath || []).slice(0, 6).map(s => `${s.x},${s.y}`),
      consecutiveStuck: p.consecutiveStuck,
      thinkTimer: +p.thinkTimer.toFixed(2),
      fireRange: p.fireRange, maxBombs: p.maxBombs, currentBombs: p.currentBombs,
      bombsOnField: bombManager.bombs.length,
      monsters: monsterManager.monsters.length,
      // ?嚗雿??臭??舀銝隞颱??航粥?孵?
      neighbors: [[0,-1],[0,1],[-1,0],[1,0]].map(([dx,dy]) => {
        const nx = p.gridX+dx, ny = p.gridY+dy;
        return `${dx},${dy}:${mapManager.isSolid(nx,ny)?'WALL':'open'}`;
      }),
      lastDx: +(p.lastDx||0).toFixed(3), lastDy: +(p.lastDy||0).toFixed(3),
    };
  }
  out.__stateHistogram = Object.fromEntries(states);
  out.__monsterPositions = monsterManager.monsters.map(m => ({ t: m.type, x: m.gridX, y: m.gridY, sp: m.speed, ai: m.ai }));

  Math.random = realRandom;
  console.log = realLog; console.error = realErr;
  return out;
}

// ---- CLI ----
const _log = console.log;
/** 逐幀追蹤 Bot 的決策與移動，定位卡死的确切原因 */
function traceRun(mode, stage, seed, seconds) {
  const realRandom = Math.random, realLog = console.log;
  console.log = console.error = () => {};
  Math.random = makeRandom(seed);
  store.set('bomber_stage', String(stage));

  const gridSystem = new GridSystem(13, 11);
  const mapManager = new MapManager(gridSystem);
  const itemManager = new ItemManager(gridSystem);
  const explosionManager = new ExplosionManager(gridSystem, mapManager, itemManager);
  const bombManager = new BombManager(gridSystem, mapManager, explosionManager);
  const monsterManager = new MonsterManager(gridSystem, mapManager, bombManager);
  global.monsterManager = monsterManager;
  explosionManager.setBombManager(bombManager);
  const dangerMap = new DangerMap(gridSystem, mapManager, bombManager, explosionManager, monsterManager);
  const stageManager = new StageManager(gridSystem, mapManager, monsterManager);
  stageManager.setDangerMap(dangerMap);
  stageManager.currentStage = stage;
  gridSystem.updateCellSize(1280, 960);
  stageManager.setupStage();
  dangerMap.initGrid();
  const CS = gridSystem.getCellSize();

  const mk = (gx, gy) => {
    const b = new Bot(gx, gy, gridSystem, mapManager, dangerMap, bombManager, itemManager);
    b.setBombManager(bombManager); b.hp = 3; b.maxHp = 3; return b;
  };
  const bot = mk(1, 1);
  let bot2 = null;
  if (mode === 'VS' || mode === 'COOP') bot2 = mk(gridSystem.cols - 2, 1);
  global.player = null; global.player2 = null; global.bot = bot; global.bot2 = bot2; global.gameMode = MODE_MAP[mode];
  const squad = [bot, bot2].filter(Boolean);

  const dt = 1 / 60;
  const frames = Math.ceil(seconds / dt);
  const rows = [];
  for (let f = 0; f < frames; f++) {
    for (const p of squad) p.update(dt);
    bombManager.update(dt); explosionManager.update(dt);
    monsterManager.update(dt); dangerMap.update(dt); itemManager.update(dt);
    for (const p of squad) monsterManager.checkPlayerCollision(p);
    explosionManager.checkMonsterHit(monsterManager);
    for (const p of squad) if (!p.isDead && explosionManager.checkPlayerHit(p)) p.die();

    if (f % 3 === 0) {
      const b = bot;
      // 重演 Player 的碰撞判斷，印出四個角各自的網格與 solid 狀態
      const pad = CS * 0.2;
      const corners = [[b.x + pad, b.y + pad], [b.x + CS - pad, b.y + pad],
                       [b.x + pad, b.y + CS - pad], [b.x + CS - pad, b.y + CS - pad]];
      const cornerInfo = corners.map(([cx, cy]) => {
        const g = gridSystem.getGridCoord(cx, cy);
        return `${g.x},${g.y}:${mapManager.isSolid(g.x, g.y) ? 'WALL' : 'open'}`;
      });
      rows.push({
        f,
        gx: b.gridX, gy: b.gridY,
        px: +(b.x / CS).toFixed(2), py: +(b.y / CS).toFixed(2),
        st: b.state,
        in: (b.aiInput.right ? 'R' : '') + (b.aiInput.left ? 'L' : '') + (b.aiInput.down ? 'D' : '') + (b.aiInput.up ? 'U' : '') + (b.aiInput.bomb ? 'B' : '') || '-',
        path: (b.targetPath || []).length,
        p0: (b.targetPath || [])[0] ? `${b.targetPath[0].x},${b.targetPath[0].y}` : '-',
        bombs: b.currentBombs + '/' + b.maxBombs,
        stuck: b.consecutiveStuck,
        mon: monsterManager.monsters.length,
        corners: cornerInfo,
        wbp: b.wasBombPressed ? 1 : 0,
      });
    }
  }
  Math.random = realRandom;
  console.log = realLog; console.error = realLog;

  realLog('   f   gx,gy      px,py    state          in  path p0      bombs stuck mon wbp  corners');
  for (const r of rows.slice(0, 90)) {
    realLog([String(r.f).padStart(4), (`${r.gx},${r.gy}`).padStart(7), (`${r.px},${r.py}`).padStart(13),
      r.st.padEnd(14), r.in.padStart(4), String(r.path).padStart(4), r.p0.padStart(7),
      r.bombs.padStart(6), String(r.stuck).padStart(4), String(r.mon).padStart(4), String(r.wbp).padStart(3),
      r.corners.join(' ')].join(' '));
  }
  realLog('');
  realLog('=== 診斷結論 ===');
  realLog('Bot 反覆對同一方向輸入移動指令，但 Player 的四角 AABB 碰撞判定擋下它，');
  realLog('且因「網格座標未變」而重複同一決定數十幀。');
  realLog('AI 需要的是：移動前先驗證該方向在物理上真的走得通，走不通就換方向。');
}

/** 驗證某方向在物理上是否走得通（重演 Player 的四角 AABB 判定） */export function canPhysicallyMove(bot, dx, dy) {
  const CS = bot.gridSystem.getCellSize();
  const pad = CS * 0.2;
  const step = bot.speed * CS / 60; // 單幀位移，與 Player.update 相同
  const nx = bot.x + (dx !== 0 ? Math.sign(dx) * step : 0);
  const ny = bot.y + (dy !== 0 ? Math.sign(dy) * step : 0);
  const corners = [[nx + pad, ny + pad], [nx + CS - pad, ny + pad],
                   [nx + pad, ny + CS - pad], [nx + CS - pad, ny + CS - pad]];
  for (const [cx, cy] of corners) {
    const g = bot.gridSystem.getGridCoord(cx, cy);
    if (bot.mapManager.isSolid(g.x, g.y)) return false;
  }
  // 也要檢查炸彈阻擋（但允許從自己腳下的炸彈走出）
  if (bot.bombManager) {
    for (const bomb of bot.bombManager.bombs) {
      const bp = bot.gridSystem.getPixelCoord(bomb.gridX, bomb.gridY);
      const p1x = nx + pad, p1y = ny + pad, p2x = nx + CS - pad, p2y = ny + CS - pad;
      if (p1x < bp.x + CS && p2x > bp.x && p1y < bp.y + CS && p2y > bp.y) {
        const o1x = bot.x + pad, o1y = bot.y + pad, o2x = bot.x + CS - pad, o2y = bot.y + CS - pad;
        const wasOverlapping = o1x < bp.x + CS && o2x > bp.x && o1y < bp.y + CS && o2y > bp.y;
        if (!wasOverlapping) return false;
      }
    }
  }
  return true;
}
