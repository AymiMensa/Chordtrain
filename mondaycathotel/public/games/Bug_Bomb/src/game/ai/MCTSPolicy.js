/* eslint-disable */
/**
 * MCTSPolicy.js — 帶前向模型＋深 rollout 的搜索式決策層 (v1)
 * 僅在 BB_POLICY=mctsfull 時由 Bot.js 掛載；hunter 仍是預設，本檔不影響基線。
 * 前向模型(grid+位置) + receding-horizon rollout 統一決策 走位/炸彈/爆炎視界/多怪風箏。
 */
export function installMCTSPolicy(bot, ctx, stats) {
  const { gs, mm, bm, dm, mo, em, im } = ctx;
  const DT = 1 / 60, CONTACT = 0.8, FUSE = 3.0, FIRE_TTL = 0.55;
  const DIRS = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
  const key = (x, y) => x + ',' + y;
  stats && (stats.thinks = 0);

  // 控制權：停用 legacy override 層（同 HunterPolicy）。
  bot.needsCentering = () => false; bot.vetoUnsafeBombPlacement = () => {};
  bot.ensureSomeAction = () => {}; bot.breakOutOfStall = () => false;
  bot.forceMoveIfPossible = () => false; bot.enforceExclusiveAxes = () => {};
  bot.holdCentering = () => {}; bot.targetPath = [];

  let seedCtr = 0x9e3779b1;
  const mkRng = (seed) => { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
  const hashState = () => {
    let h = (++seedCtr) * 2654435761;
    h = (h ^ (bot.gridX << 3) ^ (bot.gridY << 11) ^ (mo.monsters.length << 7)) >>> 0;
    let i = 0; for (const m of mo.monsters) { if (i++ > 6) break; h = (((h * 31 + m.gridX) | 0) ^ (m.gridY << 5)) >>> 0; }
    return h >>> 0;
  };

  function snapshot() {
    const cols = gs.cols, rows = gs.rows;
    const G = new Uint8Array(cols * rows);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) G[y * cols + x] = (mm.getBlockType(x, y) & 3);
    const fires = new Map();
    for (const e of (em.explosions || [])) if (!e.isDone) fires.set(key(e.gridX, e.gridY), Math.max(0.05, e.timer));
    const bombs = (bm.bombs || []).map(b => ({ gx: b.gridX, gy: b.gridY, range: b.range || 2, pierce: !!b.pierce, shape: b.shape || 'CROSS', t: (b.timer !== undefined ? b.timer : FUSE) }));
    const mons = mo.monsters.filter(m => !m.isDead).map(m => ({ gx: m.gridX, gy: m.gridY, ai: m.ai, sp: m.speed, frozen: !!m.isFrozen }));
    let boss = null;
    if (mo.boss && !mo.boss.isDead) boss = { gx: mo.boss.gridX, gy: mo.boss.gridY, sp: mo.boss.speed, phase: mo.boss.phase, hp: mo.boss.hp };
    return { cols, rows, G, botSpd: bot.speed || 4, bot: { cx: bot.gridX, cy: bot.gridY }, bombs, fires, mons, boss,
      maxB: bot.maxBombs, range: bot.fireRange, pierce: !!bot.hasPierce, alive: true, kills: 0, t: 0 };
  }
  function explodeInto(S, b) {
    const dirs = [];
    if (b.shape === 'X') dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
    else if (b.shape === 'ROUND' || b.shape === 'SQUARE') dirs.push([1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]);
    else dirs.push([1, 0], [-1, 0], [0, 1], [0, -1]);
    S.fires.set(key(b.gx, b.gy), FIRE_TTL);
    for (const [dx, dy] of dirs) {
      for (let i = 1; i <= b.range; i++) {
        if (b.shape === 'ROUND' && Math.abs(dx) === 1 && Math.abs(dy) === 1 && i > Math.max(1, b.range / 2)) break;
        const x = b.gx + dx * i, y = b.gy + dy * i;
        if (x < 0 || y < 0 || x >= S.cols || y >= S.rows) break;
        const t = S.G[y * S.cols + x];
        if (t === 1) break;
        if (t === 2) { S.fires.set(key(x, y), FIRE_TTL); S.G[y * S.cols + x] = 0; if (!b.pierce) break; else continue; }
        S.fires.set(key(x, y), FIRE_TTL);
      }
    }
  }
  function step(S, act) {
    if (act.bomb && S.bombs.length < S.maxB) {
      const gi = Math.round(S.bot.cx), gj = Math.round(S.bot.cy);
      if (S.G[gj * S.cols + gi] !== 1) S.bombs.push({ gx: gi, gy: gj, range: S.range, pierce: S.pierce, shape: 'CROSS', t: FUSE });
    }
    if (act.dx || act.dy) {
      const spd = S.botSpd * DT;
      const ncx = S.bot.cx + act.dx * spd, ncy = S.bot.cy + act.dy * spd;
      const tgx = Math.round(S.bot.cx + act.dx * 0.51), tgy = Math.round(S.bot.cy + act.dy * 0.51);
      const ok = (tgx >= 0 && tgy >= 0 && tgx < S.cols && tgy < S.rows) && S.G[tgy * S.cols + tgx] === 0 && !S.bombs.some(b => b.gx === tgx && b.gy === tgy);
      if (ok) { S.bot.cx = ncx; S.bot.cy = ncy; }
    }
    S.t += DT;
    for (const [k2, v] of S.fires) { const nv = v - DT; if (nv <= 0) S.fires.delete(k2); else S.fires.set(k2, nv); }
    for (let i = S.bombs.length - 1; i >= 0; i--) { const b = S.bombs[i]; b.t -= DT; if (b.t <= 0) { explodeInto(S, b); S.bombs.splice(i, 1); } }
    if (S.fires.has(key(Math.round(S.bot.cx), Math.round(S.bot.cy)))) { S.alive = false; return; }
    if (!S.alive) return;
    for (let i = S.mons.length - 1; i >= 0; i--) { const m = S.mons[i]; if (S.fires.has(key(Math.round(m.gx), Math.round(m.gy)))) { S.mons.splice(i, 1); S.kills++; } }
    if (S.boss) { const bx = Math.round(S.boss.gx), by = Math.round(S.boss.gy); if (S.fires.has(key(bx, by))) S.boss.hp -= 1; }
    for (const m of S.mons) {
      if (m.frozen || m.ai === 'idle' || m.sp <= 0) continue;
      const dx = S.bot.cx - m.gx, dy = S.bot.cy - m.gy, L = Math.hypot(dx, dy) || 1, st = m.sp * DT;
      const ncx = m.gx + dx / L * st, ncy = m.gy + dy / L * st, gi = Math.round(ncx), gj = Math.round(ncy);
      if (gi >= 0 && gj >= 0 && gi < S.cols && gj < S.rows && S.G[gj * S.cols + gi] === 0) { m.gx = ncx; m.gy = ncy; }
      if (Math.hypot(S.bot.cx - m.gx, S.bot.cy - m.gy) < CONTACT) { S.alive = false; return; }
    }
    if (S.boss) {
      const dx = S.bot.cx - S.boss.gx, dy = S.bot.cy - S.boss.gy, L = Math.hypot(dx, dy) || 1, st = (S.boss.sp || 2) * DT;
      const ncx = S.boss.gx + dx / L * st, ncy = S.boss.gy + dy / L * st, gi = Math.round(ncx), gj = Math.round(ncy);
      if (gi >= 0 && gj >= 0 && gi < S.cols && gj < S.rows && S.G[gj * S.cols + gi] === 0) { S.boss.gx = ncx; S.boss.gy = ncy; }
      if (Math.hypot(S.bot.cx - S.boss.gx, S.bot.cy - S.boss.gy) < CONTACT) { S.alive = false; }
    }
  }
  const clone = (S) => ({ cols: S.cols, rows: S.rows, G: S.G.slice(), botSpd: S.botSpd, bot: { cx: S.bot.cx, cy: S.bot.cy }, bombs: S.bombs.map(b => ({ ...b })), fires: new Map(S.fires), mons: S.mons.map(m => ({ ...m })), boss: S.boss ? { ...S.boss } : null, maxB: S.maxB, range: S.range, pierce: S.pierce, alive: S.alive, kills: S.kills, t: S.t });
  const usable = (S, dx, dy) => { const gx = Math.round(S.bot.cx) + dx, gy = Math.round(S.bot.cy) + dy; if (gx < 0 || gy < 0 || gx >= S.cols || gy >= S.rows) return false; if (S.G[gy * S.cols + gx] !== 0) return false; if (S.bombs.some(b => b.gx === gx && b.gy === gy)) return false; return !S.fires.has(key(gx, gy)); };
  const fireDist = (S, x, y) => { let b = 99; for (const k2 of S.fires.keys()) { const p = k2.indexOf(','); const kx = +k2.slice(0, p), ky = +k2.slice(p + 1); b = Math.min(b, Math.abs(kx - x) + Math.abs(ky - y)); } return b; };
  const openAt = (S, x, y) => { let c = 0; for (const d of DIRS) { const gx = x + d.dx, gy = y + d.dy; if (gx >= 0 && gy >= 0 && gx < S.cols && gy < S.rows && S.G[gy * S.cols + gx] === 0 && !S.bombs.some(b => b.gx === gx && b.gy === gy)) c++; } return c; };
  const clearLine = (S, x0, y0, x1, y1) => { if (x0 !== x1 && y0 !== y1) return false; const sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0); let x = x0, y = y0; while (!(x === x1 && y === y1)) { x += sx; y += sy; if (x < 0 || y < 0 || x >= S.cols || y >= S.rows || S.G[y * S.cols + x] !== 0) return false; } return true; };
  const willFireSoon = (S) => S.bombs.some(b => b.t < 0.35 && (Math.abs(b.gx - Math.round(S.bot.cx)) + Math.abs(b.gy - Math.round(S.bot.cy))) <= b.range);
  const monDist = (S, x, y) => { let b = 99; for (const m of S.mons) b = Math.min(b, Math.hypot(m.gx - x, m.gy - y)); return b; };
  const nearMon = (S, x, y, r) => { for (const m of S.mons) if (Math.hypot(m.gx - x, m.gy - y) <= r) return true; return false; };
  const bombableHere = (S, bgx, bgy) => S.mons.find(m => (Math.round(m.gx) === bgx || Math.round(m.gy) === bgy) && Math.hypot(m.gx - S.bot.cx, m.gy - S.bot.cy) <= S.range + 0.6 && clearLine(S, bgx, bgy, Math.round(m.gx), Math.round(m.gy)));
  const safeEscapeExists = (S) => { const bgx = Math.round(S.bot.cx), bgy = Math.round(S.bot.cy); for (const d of DIRS) { const gx = bgx + d.dx, gy = bgy + d.dy; if (usable(S, d.dx, d.dy) && monDist(S, gx, gy) >= 2) return true; } return false; };
  // --- hunter 風格的規劃 helpers（rollout 升級用）---
  const bfsTo = (S, isGoal, walkFn) => {
    const sx0 = Math.round(S.bot.cx), sy0 = Math.round(S.bot.cy);
    if (isGoal(sx0, sy0)) return null;
    const parent = new Map(); parent.set(key(sx0, sy0), null); const q = [[sx0, sy0]]; let found = null;
    while (q.length) {
      const c = q.shift(); if (isGoal(c[0], c[1])) { found = c; break; }
      for (const d of DIRS) { const nx = c[0] + d.dx, ny = c[1] + d.dy, nk = key(nx, ny); if (parent.has(nk)) continue; if (nx < 0 || ny < 0 || nx >= S.cols || ny >= S.rows) continue; if (!walkFn(nx, ny)) continue; parent.set(nk, key(c[0], c[1])); q.push([nx, ny]); }
    }
    if (!found) return null;
    let cur = key(found[0], found[1]); let prev = parent.get(cur);
    while (prev && prev !== key(sx0, sy0)) { cur = prev; prev = parent.get(cur); }
    const p = cur.split(','); const cx = +p[0], cy = +p[1];
    return { x: cx, y: cy, dx: cx - sx0, dy: cy - sy0 };
  };
  const blastCells = (S, b) => {
    const set = new Set(); set.add(key(b.gx, b.gy));
    const dirs = b.shape === 'X' ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of dirs) for (let i = 1; i <= b.range; i++) { const x = b.gx + dx * i, y = b.gy + dy * i; if (x < 0 || y < 0 || x >= S.cols || y >= S.rows || S.G[y * S.cols + x] === 1) break; set.add(key(x, y)); if (S.G[y * S.cols + x] === 2) { if (!b.pierce) break; } }
    return set;
  };
  const dangerSet = (S) => { const D = new Set(); for (const k of S.fires.keys()) D.add(k); for (const b of S.bombs) for (const c of blastCells(S, b)) D.add(c); return D; };
  // 回傳「走向一個安全格」的第一步（含考慮自己即將放的彈的爆炎）；找不到回 null。
  const getEscapeModel = (S, plusBombAtSelf) => {
    const D = dangerSet(S);
    if (plusBombAtSelf) { const hb = { gx: Math.round(S.bot.cx), gy: Math.round(S.bot.cy), range: S.range, pierce: S.pierce, shape: 'CROSS' }; for (const c of blastCells(S, hb)) D.add(c); }
    if (!D.has(key(Math.round(S.bot.cx), Math.round(S.bot.cy)))) return { dx: 0, dy: 0 };  // 已安全
    return bfsTo(S, (x, y) => !D.has(key(x, y)) && S.G[y * S.cols + x] === 0 && !S.bombs.some(b => b.gx === x && b.gy === y), (x, y) => S.G[y * S.cols + x] === 0);
  };
  function greedy(S, rng) {
    const bgx = Math.round(S.bot.cx), bgy = Math.round(S.bot.cy);
    // (A) 被威脅（火/即將炸/有怪近身）→ 逃到「最遠怪＋最安全＋最空」的格
    if (S.fires.has(key(bgx, bgy)) || willFireSoon(S) || nearMon(S, S.bot.cx, S.bot.cy, 1.6)) {
      let best = null, bs = -1e9;
      for (const d of DIRS) if (usable(S, d.dx, d.dy)) {
        const gx = bgx + d.dx, gy = bgy + d.dy;
        const sc = -fireDist(S, gx, gy) * 6 + openAt(S, gx, gy) * 3 + Math.min(monDist(S, gx, gy), 5) * 8;
        if (sc > bs) { bs = sc; best = d; }
      }
      if (best) return { dx: best.dx, dy: best.dy, bomb: false };
    }
    // (B) 順手炸：怪對齊＋有「逃到非貼身安全格」的退路才放（降低自困/接觸風險）
    if (S.bombs.length < S.maxB) {
      const alignM = bombableHere(S, bgx, bgy);
      if (alignM && safeEscapeExists(S) && rng() < 0.7) return { dx: 0, dy: 0, bomb: true };
    }
    // (C) kiting-safe 走位：移到「最近怪距離最大」的安全格；同分若某格能對齊續殺則小幅偏好
    const cands = DIRS.filter(d => usable(S, d.dx, d.dy));
    if (cands.length) {
      let best = null, bs = -1e9;
      for (const d of cands) {
        const gx = bgx + d.dx, gy = bgy + d.dy;
        const md = monDist(S, gx, gy);
        const aligned = !!bombableHere(S, gx, gy);
        const sc = Math.min(md, 5) * 10 + (aligned ? 6 : 0) + openAt(S, gx, gy) * 2;
        if (sc > bs) { bs = sc; best = d; }
      }
      return { dx: best.dx, dy: best.dy, bomb: false };
    }
    return { dx: 0, dy: 0, bomb: false };
  }
  function hunterGreedy(S, rng) {
    const bgx = Math.round(S.bot.cx), bgy = Math.round(S.bot.cy), self = key(bgx, bgy);
    const imminent = S.bombs.some(b => b.t < 0.4 && (Math.abs(b.gx - bgx) + Math.abs(b.gy - bgy)) <= b.range);
    // (0) commit-escape：在火/在爆炎內 或 彈即將爆 → 走向安全格（receding 逃生）
    if (S.fires.has(self) || imminent) {
      const esc = getEscapeModel(S, false);
      if (esc) return { dx: esc.dx, dy: esc.dy, bomb: false };
    }
    // (1) 可殺：怪在十字 + 放彈後仍可逃 → 放彈
    if (S.bombs.length < S.maxB && bombableHere(S, bgx, bgy) && getEscapeModel(S, true) && rng() < 0.8) return { dx: 0, dy: 0, bomb: true };
    // (2) BFS 找最近可達怪（走磚）；下一步是磚 → breach(放彈開路)；空地 → 前進
    const st = bfsTo(S, (x, y) => S.mons.some(m => !m.frozen && Math.round(m.gx) === x && Math.round(m.gy) === y),
      (x, y) => (S.G[y * S.cols + x] === 0 || S.G[y * S.cols + x] === 2) && !S.bombs.some(b => b.gx === x && b.gy === y) && !S.fires.has(key(x, y)));
    if (st) {
      const brickNext = S.G[st.y * S.cols + st.x] === 2;
      if (brickNext && S.bombs.length < S.maxB && getEscapeModel(S, true) && rng() < 0.8) return { dx: 0, dy: 0, bomb: true };
      if (!brickNext) return { dx: st.dx, dy: st.dy, bomb: false };
    }
    // (3) fallback kiting-safe
    const cands = DIRS.filter(d => usable(S, d.dx, d.dy) && !S.fires.has(key(bgx + d.dx, bgy + d.dy)));
    if (cands.length) { let best = null, bs = -1e9; for (const d of cands) { const gx = bgx + d.dx, gy = bgy + d.dy; const sc = Math.min(monDist(S, gx, gy), 5) * 8 + openAt(S, gx, gy) * 2; if (sc > bs) { bs = sc; best = d; } } return { dx: best.dx, dy: best.dy, bomb: false }; }
    return { dx: 0, dy: 0, bomb: false };
  }
  // 1-ply 前瞻繼續政策（重構升級）：每個 rollout 步改為「對候選動作 clone+推進+葉值評估，取最優」，
  // 讓深 rollout 的內層不再是純貪婪，而是 1 層 expectimax（bot 極大化存活/距離/逃脫）。
  const leafValue = (S) => { if (!S.alive) return -1e6; if (S.mons.length === 0 && (!S.boss || S.boss.hp <= 0)) return 1e6; let n = 99; for (const m of S.mons) n = Math.min(n, Math.hypot(m.gx - S.bot.cx, m.gy - S.bot.cy)); if (S.boss) n = Math.min(n, Math.hypot(S.boss.gx - S.bot.cx, S.boss.gy - S.bot.cy)); return openAt(S, Math.round(S.bot.cx), Math.round(S.bot.cy)) * 6 + Math.min(n, 6) * 8 - fireDist(S, Math.round(S.bot.cx), Math.round(S.bot.cy)) * 5; };
  const hunterGreedyLA = (S, rng) => {
    const bgx = Math.round(S.bot.cx), bgy = Math.round(S.bot.cy);
    const cands = [];
    for (const d of DIRS) if (usable(S, d.dx, d.dy)) cands.push({ dx: d.dx, dy: d.dy, bomb: false });
    if (S.bombs.length < S.maxB) cands.push({ dx: 0, dy: 0, bomb: true });
    cands.push({ dx: 0, dy: 0, bomb: false });
    let best = { dx: 0, dy: 0, bomb: false }, bs = -1e9;
    for (const a of cands) { const T = clone(S); try { step(T, a); } catch (e) {} const v = leafValue(T); if (v > bs) { bs = v; best = a; } }
    return best;
  };
  function rollout(S0, firstAct, rng, depth) {
    const S = clone(S0);
    step(S, firstAct);
    for (let k = 0; k < depth; k++) {
      if (!S.alive) break;
      step(S, (k % 2 === 0) ? hunterGreedyLA(S, rng) : hunterGreedy(S, rng));
      if (!S.alive) return -1e6;
      if (S.mons.length === 0 && (!S.boss || S.boss.hp <= 0)) return 1e5 + (depth * DT - S.t);
    }
    if (!S.alive) return -1e6;
    let val = S.kills * 120;
    if (S.boss && S0.boss) val += (S0.boss.hp - S.boss.hp) * 70;
    let nmin = 99; for (const m of S.mons) nmin = Math.min(nmin, Math.hypot(m.gx - S.bot.cx, m.gy - S.bot.cy));
    if (S.boss) nmin = Math.min(nmin, Math.hypot(S.boss.gx - S.bot.cx, S.boss.gy - S.bot.cy));
    val += Math.min(nmin, 6) * 10;
    val += openAt(S, Math.round(S.bot.cx), Math.round(S.bot.cy)) * 6;
    return val;
  }
  const ROLLOUTS = 5, DEPTH = 70;      // ~1.17s 前向（含 1-ply 前瞻繼續）
  bot.think = function () {
    stats && (stats.thinks = (stats.thinks || 0) + 1);
    bot.aiInput.up = bot.aiInput.down = bot.aiInput.left = bot.aiInput.right = bot.aiInput.bomb = false;
    let S0;
    try { S0 = snapshot(); } catch (e) { S0 = null; }
    if (!S0) { bot._ph = 'MCTSERR'; return; }
    let bestAct = null, bestVal = -Infinity;
    const actions = [];
    for (const d of DIRS) {
      const gx = Math.round(S0.bot.cx) + d.dx, gy = Math.round(S0.bot.cy) + d.dy;
      if (gx < 0 || gy < 0 || gx >= S0.cols || gy >= S0.rows || S0.G[gy * S0.cols + gx] !== 0 || S0.bombs.some(b => b.gx === gx && b.gy === gy) || S0.fires.has(key(gx, gy))) continue;
      actions.push({ dx: d.dx, dy: d.dy, bomb: false });
    }
    if (S0.bombs.length < S0.maxB) actions.push({ dx: 0, dy: 0, bomb: true });
    if (!actions.length) { bot._ph = 'MCTSNONE'; return; }
    for (const a of actions) {
      let sum = 0;
      for (let r = 0; r < ROLLOUTS; r++) sum += rollout(S0, a, mkRng((hashState() ^ (r * 2654435761)) >>> 0), DEPTH);
      const val = sum / ROLLOUTS;
      if (val > bestVal) { bestVal = val; bestAct = a; }
    }
    if (bestAct) {
      if (bestAct.dx === 1) bot.aiInput.right = true; else if (bestAct.dx === -1) bot.aiInput.left = true;
      if (bestAct.dy === 1) bot.aiInput.down = true; else if (bestAct.dy === -1) bot.aiInput.up = true;
      if (bestAct.bomb) bot.aiInput.bomb = true;
    }
    bot._ph = 'MCTS';
  };
}
