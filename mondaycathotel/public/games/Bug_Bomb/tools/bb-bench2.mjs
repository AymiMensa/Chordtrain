#!/usr/bin/env node
/* eslint-disable */
/**
 * bb-bench2.mjs — 全破關率權威量測（結果論的唯一裁判）
 *
 * 與舊 bb-journey*.mjs 的差別：
 *   1. 只走「出貨路徑」：不手動安裝任何策略，完全由 Bot.js 自己掛載政策
 *      （就是遊戲真正在做的事），這樣量到的數字才代表玩家看到的表現。
 *   2. 逐幀重演 main.js 的 update 順序（含 Boss、道具、碰撞、勝負判定）。
 *   3. 失敗歸因精確分類（blast / monsterContact / bossContact / bossBlast / TIMEOUT）。
 *   4. 開發種子與留出（holdout）種子分離，防止「同一組資料又調參又驗證」。
 *
 * 用法：
 *   node tools/bb-bench2.mjs <SINGLE|COOP|SINGLE,COOP> [N] [maxStage] [--holdout] [--policy=hunter|deep2] [--sec=600] [--no-pocket-dig] [--failures] [--hunt-items-single] [--kite-adjacent] [--baseline-mimic-adj] [--predict-contact] [--pocket-max-live=N] [--pocket-stuck-limit=N] [--chase-block-bomb] [--chase-block-range=N] [--tactical-bomb] [--pocket-bomb-progress] [--coop-assign] [--risk-score] [--pocket-dig-radius=N] [--rollout-bomb] [--rollout-hit-weight=N] [--rollout-risk-weight=N] [--rollout-risk-limit=N] [--journeys]
 */

import {
  GridSystem, MapManager, ItemManager, ExplosionManager, BombManager,
  MonsterManager, DangerMap, StageManager, DragonBoss, makeRandom, Bot,
} from './bb-sim.mjs';

const DT = 1 / 60;
const MODE_MAP = { SINGLE: 'BOT_SINGLE', COOP: 'BOT_BOT_COOP', VS: 'BOT_BOT_VS' };

const argv = process.argv.slice(2);
const pos = argv.filter(a => !a.startsWith('--'));
const flag = (n) => argv.some(a => a === '--' + n || a.startsWith('--' + n + '='));
const flagVal = (n, d) => {
  const a = argv.find(x => x.startsWith('--' + n + '='));
  return a ? a.split('=')[1] : d;
};

const MODES = (pos[0] || 'SINGLE,COOP').split(',').map(s => s.trim()).filter(Boolean);
const N = Number(pos[1] || 20);
const MAXSTAGE = Number(pos[2] || 60);
const HOLDOUT = flag('holdout');
const POLICY = flagVal('policy', '');
const SECONDS_PER_STAGE = Number(flagVal('sec', 600));

if (POLICY) global.__BB_POLICY_OVERRIDE = POLICY;
if (flag('no-pocket-dig')) global.__BB_DISABLE_POCKET_DIG = true;
if (flag('hunt-items-single')) global.__BB_HUNT_ITEMS_SINGLE = true;
if (flag('kite-adjacent')) global.__BB_KITE_ADJACENT = true;
if (flag('baseline-mimic-adj')) global.__BB_BASELINE_MIMIC_ADJ = true;
if (flag('predict-contact')) global.__BB_PREDICT_CONTACT = true;
if (flag('pocket-max-live')) global.__BB_POCKET_MAX_LIVE = Number(flagVal('pocket-max-live', '3'));
if (flag('pocket-stuck-limit')) global.__BB_POCKET_STUCK_LIMIT = Number(flagVal('pocket-stuck-limit', '200'));
if (flag('chase-block-bomb')) global.__BB_CHASE_BLOCK_BOMB = true;
if (flag('chase-block-range')) global.__BB_CHASE_BLOCK_RANGE = Number(flagVal('chase-block-range', '2.5'));
if (flag('tactical-bomb')) global.__BB_TACTICAL_BOMB = true;
if (flag('pocket-bomb-progress')) global.__BB_POCKET_BOMB_PROGRESS = true;
if (flag('coop-assign')) global.__BB_COOP_ASSIGN = true;
if (flag('risk-score')) global.__BB_RISK_SCORE = true;
if (flag('pocket-dig-radius')) global.__BB_POCKET_DIG_RADIUS = Number(flagVal('pocket-dig-radius', '6'));
if (flag('rollout-bomb')) global.__BB_ROLLOUT_BOMB = true;
if (flag('rollout-hit-weight')) global.__BB_ROLLOUT_HIT_WEIGHT = Number(flagVal('rollout-hit-weight', '18'));
if (flag('rollout-risk-weight')) global.__BB_ROLLOUT_RISK_WEIGHT = Number(flagVal('rollout-risk-weight', '10'));
if (flag('rollout-risk-limit')) global.__BB_ROLLOUT_RISK_LIMIT = Number(flagVal('rollout-risk-limit', '0.4'));

// 開發種子與留出種子互斥。
const SEED_BASE = HOLDOUT ? 0x51ed270b : 0x9e3779b1;
const seedAt = (i) => (SEED_BASE + i * 7919) >>> 0;

/** 依 main.js 建一場關卡世界 */
function makeWorld(stage, seed) {
  const rl = console.log, re = console.error;
  console.log = console.error = () => {};
  Math.random = makeRandom(seed);
  global.localStorage.setItem('bomber_stage', String(stage));

  const gs = new GridSystem(13, 11);
  const mm = new MapManager(gs);
  const im = new ItemManager(gs);
  const em = new ExplosionManager(gs, mm, im);
  const bm = new BombManager(gs, mm, em);
  const mo = new MonsterManager(gs, mm, bm);
  global.monsterManager = mo; global.mapManager = mm; global.explosionManager = em;
  global.gridSystem = gs;
  em.setBombManager(bm);
  gs.updateCellSize(1280, 960);
  const st = new StageManager(gs, mm, mo);
  st.currentStage = stage;
  st.setupStage();
  const dm = new DangerMap(gs, mm, bm, em, mo);
  if (dm.initGrid) dm.initGrid();
  st.setDangerMap(dm);
  global.stageManager = st; global.dangerMap = dm;
  global.bombManager = bm; global.itemManager = im;

  const isBoss = st.getStageTheme() === 'BOSS';
  let boss = null;
  if (isBoss) boss = new DragonBoss(Math.floor(gs.cols / 2), Math.floor(gs.rows / 2), gs, mm, em, stage);
  // Match main.js: HunterPolicy reads the boss through monsterManager.boss.
  mo.boss = boss;
  console.log = rl; console.error = re;
  return { gs, mm, im, em, bm, mo, dm, boss, stage, theme: st.getStageTheme() };
}

/** 靜音遊戲內的 console.log/error（ItemManager 等會直接 log），但保留我們自己的輸出 */
const REAL_LOG = console.log.bind(console);
const REAL_ERR = console.error.bind(console);
function quiet(fn) {
  console.log = () => {};
  console.error = () => {};
  try { return fn(); } finally { console.log = REAL_LOG; console.error = REAL_ERR; }
}

/** 一場關卡的回合成（重演 main.js 的 update 迴圈與勝負判定） */
function playStage(mode, stage, seed) {
  const w = makeWorld(stage, seed);
  const { gs, mm, im, em, bm, mo, dm, boss } = w;
  const mk = (gx, gy) => {
    const b = new Bot(gx, gy, gs, mm, dm, bm, im);
    b.setBombManager(bm); b.hp = 3; b.maxHp = 3;
    return b;
  };
  let bot = null, bot2 = null;
  if (mode === 'COOP') { bot = mk(1, 1); bot2 = mk(gs.cols - 2, 1); }
  else { bot = mk(1, 1); }
  const squad = [bot, bot2].filter(Boolean);
  global.player = null; global.player2 = null;
  global.bot = bot; global.bot2 = bot2;
  global.gameMode = MODE_MAP[mode];

  let bombs = 0;
  const op = bm.placeBomb.bind(bm);
  bm.placeBomb = function (...a) { const r = op(...a); if (r) bombs++; return r; };

  let explosionSource = 'boss';
  const createExplosion = em.createExplosion.bind(em);
  em.createExplosion = function (...args) {
    const start = em.explosions.length;
    const result = createExplosion(...args);
    for (const explosion of em.explosions.slice(start)) explosion.source = explosionSource;
    return result;
  };
  const triggerExplosion = bm.triggerExplosion.bind(bm);
  bm.triggerExplosion = function (bomb) {
    const previousSource = explosionSource;
    explosionSource = 'playerBomb';
    try { return triggerExplosion(bomb); }
    finally { explosionSource = previousSource; }
  };

  const startMonsters = mo.monsters.length;
  const prev = squad.map(() => ({ hp: 99, dead: false }));
  const deathCause = squad.map(() => 'none');
  let outcome = 'TIMEOUT', elapsed = 0, finalDeathCause = 'none';
  const maxF = Math.ceil(SECONDS_PER_STAGE / DT);

  const bossTouch = (p) => {
    if (!boss || boss.isDead) return false;
    const c = gs.getCellSize();
    return Math.abs(boss.x - p.x) < c && Math.abs(boss.y - p.y) < c;
  };
  const monsterTouch = (p) => {
    const c = gs.getCellSize();
    const pCx = p.x + c / 2, pCy = p.y + c / 2;
    for (const m of mo.monsters) {
      if (m.isDead) continue;
      if (Math.hypot(m.x + c / 2 - pCx, m.y + c / 2 - pCy) < c * 0.8) return true;
    }
    return false;
  };

  for (let f = 0; f < maxF; f++) {
    for (const p of squad) p.update(DT);
    bm.update(DT); em.update(DT); mo.update(DT); dm.update(DT); im.update(DT);
    for (const p of squad) im.checkPlayerCollection(p);
    for (const p of squad) mo.checkPlayerCollision(p);
    em.checkMonsterHit(mo);
    for (const p of squad) if (!p.isDead && em.checkPlayerHit(p)) p.die();
    if (boss && !boss.isDead && em.checkPlayerHit(boss)) boss.die();
    if (boss) boss.update(DT);
    elapsed += DT;

    // 受傷當下的死因歸因（比較 HP / 死亡旗標的變化）
    const frameDeathCauses = new Set();
    for (let i = 0; i < squad.length; i++) {
      const p = squad[i];
      const wasDead = prev[i].dead;
      if (!wasDead && (p.isDead || p.hp < prev[i].hp)) {
        const explosion = em.explosions.find(e =>
          !e.isDone && e.gridX === p.gridX && e.gridY === p.gridY
        );
        if (explosion) deathCause[i] = explosion.source === 'boss' ? 'bossBlast' : 'blast';
        else if (bossTouch(p)) deathCause[i] = 'bossContact';
        else if (monsterTouch(p)) deathCause[i] = 'monsterContact';
        else deathCause[i] = 'unknown';
        if (p.isDead) frameDeathCauses.add(deathCause[i]);
      }
      prev[i].dead = p.isDead;
      prev[i].hp = p.hp;
    }

    const allMonstersDead = mo.monsters.length === 0 && (!boss || boss.isDead);
    const teamAlive = squad.some(p => !p.isDead);
    if (!teamAlive) {
      outcome = 'DEAD';
      finalDeathCause = frameDeathCauses.size === 1
        ? frameDeathCauses.values().next().value
        : frameDeathCauses.size > 1 ? 'mixed' : 'unknown';
      break;
    }
    if (allMonstersDead) { outcome = 'CLEAR'; break; }
  }

  const kills = startMonsters - mo.monsters.length;
  const cause = outcome === 'DEAD' ? finalDeathCause : 'none';
  return {
    outcome, cause, kills, bombs, elapsed, theme: w.theme,
    monstersLeft: mo.monsters.length, bossLeft: boss && !boss.isDead ? Math.round(boss.hp) : 0,
    monsterTypes: mo.monsters.filter(m => !m.isDead).map(m => m.type),
    lastPhase: squad.map(p => p._ph || '-').join('/'),
    lastPosition: squad.map(p => `${p.gridX},${p.gridY}`).join('/'),
    survivors: squad.filter(p => !p.isDead).length,
  };
}

/** 從第 1 關一路闖到 MAXSTAGE；任一關失敗即旅程結束（= main.js 的行為） */
function playJourney(mode, seed) {
  const stages = [];
  for (let stage = 1; stage <= MAXSTAGE; stage++) {
    const out = playStage(mode, stage, (seed + stage * 104729) >>> 0);
    stages.push({ stage, ...out });
    if (out.outcome !== 'CLEAR') {
      return { stoppedAt: stage, cleared: stage - 1, completed: false, stages };
    }
  }
  return { stoppedAt: MAXSTAGE + 1, cleared: MAXSTAGE, completed: true, stages };
}


const say = (...a) => process.stdout.write(a.join(' ') + '\n');
global.__BB_SAY = say;
const CAUSES = ['blast', 'monsterContact', 'bossContact', 'bossBlast', 'mixed', 'unknown'];

const results = {};
for (const m of MODES) results[m] = [];

let i = 0;
const t0 = Date.now();
while (i < N) {
  for (const m of MODES) results[m].push(quiet(() => playJourney(m, seedAt(i))));
  i++;
  process.stdout.write(`  ... ${i}/${N} (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
}

say('');
say(`=== bb-bench2  ${HOLDOUT ? 'HOLDOUT' : 'DEV'}  ${POLICY ? 'policy=' + POLICY : 'policy=shipped(Bot.js self-install)'} ===`);
say(`modes=${MODES.join(',')}  N=${N}  maxStage=${MAXSTAGE}  perStageCap=${SECONDS_PER_STAGE}s  wall=${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (flag('journeys')) {
  for (const mode of MODES) {
    results[mode].forEach((result, index) => {
      say(`JOURNEY ${mode} ${index} ${JSON.stringify({ cleared: result.cleared, stoppedAt: result.stoppedAt, completed: result.completed })}`);
    });
  }
}
say('');
say('模式      全破率%  全破/N   平均通關數  平均清關秒  中位停關  最遠  blast monContact bossContact bossBlast mixed unknown TIMEOUT');
say('-'.repeat(136));
for (const mode of MODES) {
  const rs = results[mode];
  const stops = rs.map(r => r.stoppedAt).sort((a, b) => a - b);
  const full = rs.filter(r => r.completed).length;
  const avgCleared = rs.reduce((s, r) => s + r.cleared, 0) / rs.length;
  const clearStages = rs.flatMap(r => r.stages).filter(stage => stage.outcome === 'CLEAR');
  const avgClearSeconds = clearStages.length
    ? clearStages.reduce((sum, stage) => sum + stage.elapsed, 0) / clearStages.length
    : 0;
  const med = stops[Math.floor(stops.length / 2)];
  const cnt = {};
  let to = 0;
  for (const r of rs) {
    const last = r.stages[r.stages.length - 1];
    if (last.outcome === 'TIMEOUT') to++;
    if (last.outcome === 'DEAD') cnt[last.cause] = (cnt[last.cause] || 0) + 1;
  }
  say(`${mode.padEnd(9)} ${(100 * full / rs.length).toFixed(1).padStart(6)} ` +
      `${String(full).padStart(4)}/${String(rs.length).padEnd(4)} ${avgCleared.toFixed(2).padStart(10)} ` +
      `${avgClearSeconds.toFixed(1).padStart(11)} ` +
      `${String(med).padStart(8)} ${String(stops[stops.length - 1]).padStart(4)} ` +
      CAUSES.map(c => String(cnt[c] || 0).padStart(11)).join('') + String(to).padStart(9));
}

say('');
say('每關通關率（分母 = 實際到達該關的旅程數）:');
for (const mode of MODES) {
  say(`  [${mode}]`);
  for (let s = 1; s <= MAXSTAGE; s++) {
    const arrived = results[mode].filter(r => r.stoppedAt >= s).length;
    if (!arrived) continue;
    const passed = results[mode].filter(r => r.stages.some(x => x.stage === s && x.outcome === 'CLEAR')).length;
    say(`    stage ${String(s).padStart(2)}: ${(100 * passed / arrived).toFixed(1).padStart(6)}%  (${passed}/${arrived})`);
  }
}

if (flag('failures')) {
  say('');
  say('失敗樣本（末關狀態）:');
  for (const mode of MODES) {
    say(`  [${mode}]`);
    results[mode].forEach((journey, index) => {
      const last = journey.stages[journey.stages.length - 1];
      if (last.outcome === 'CLEAR') return;
      say(`    #${String(index).padStart(2)} stage=${last.stage} ${last.outcome}/${last.cause} ` +
        `left=${last.monstersLeft}[${last.monsterTypes.join(',')}] phase=${last.lastPhase} ` +
        `pos=${last.lastPosition} bombs=${last.bombs}`);
    });
  }
}

export { playStage, playJourney, makeWorld };
