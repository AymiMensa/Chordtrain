/**
 * hs-solver.mjs — HUNTER solver: an aggressive kill-first Bomberman-bot solver.
 *
 * Proven baseline this builds on (clean-policy): fair ~8% / immortal ~57%.
 * The 1-monster 600s test proved the real bottleneck is KILLING, not survival:
 * the clean policy fires ~1 bomb and merely AVOIDS the monster instead of
 * cornering it. So this solver keeps clean-policy's proven committed-escape +
 * tunnel machinery, but adds:
 *
 *   H1. AUTHORITATIVE blast union each think() (getExplosionCells over every
 *       live bomb + a conservative cross fallback + each bomb's own cell).
 *       Used to veto stepping into any future flame, not just active flame.
 *   H2. AMBUSH / DENIAL bombing: bomb whenever any live monster would be within
 *       the new blast (or must cross it to keep chasing), not only when a
 *       monster is PERFECTLY cross-aligned. A chasing/wandering monster has a
 *       high chance to walk into the blast; this converts "wait for alignment"
 *       into "deny the cells around me".
 *   H3. Lead prediction: the monster only re-aims at grid intersections, so
 *       mid-corridor it is COMMITTED to its direction for one step. Bomb a cell
 *       its committed path must cross.
 *
 * Movement is driven purely by bot.aiInput.{up,down,left,right,bomb}.
 */

export function installHunterPolicy(bot, ctx, stats) {
  const { gs, mm, bm, dm, mo, em } = ctx;
  const DIRS = [ { dx: 0, dy: -1, k: 'up' }, { dx: 0, dy: 1, k: 'down' },
                 { dx: -1, dy: 0, k: 'left' }, { dx: 1, dy: 0, k: 'right' } ];
  const key = (x, y) => x + ',' + y;
  const inBounds = (x, y) => x >= 1 && y >= 1 && x < gs.cols - 1 && y < gs.rows - 1;
  const typeAt = (x, y) => (inBounds(x, y) ? mm.getBlockType(x, y) : 1);
  const isWall = (x, y) => typeAt(x, y) === 1;         // hard wall only
  const isBrick = (x, y) => typeAt(x, y) === 2;        // soft brick
  // Walkable now = floor or brick (brick costs more so BFS prefers open floor).
  const walkable = (x, y) => { const t = typeAt(x, y); return t === 0 || t === 2; };

  const reset = () => { for (const d of DIRS) bot.aiInput[d.k] = false; bot.aiInput.bomb = false; };
  const setDir = (dx, dy) => { for (const d of DIRS) bot.aiInput[d.k] = (d.dx === dx && d.dy === dy); };

  /**
   * go(dx,dy) — move one grid step, BUT centre on the perpendicular axis first.
   *
   * Root cause of every freeze (proven by _trace_death + _probe_map on seed
   * 444444437): Player.update uses a padded AABB that is checked separately per
   * axis. When the bot holds RIGHT along a corridor while its py is NOT centred
   * in that row, the box's far corner clips the DIAGONAL cell (e.g. (2,2) hard
   * wall while stepping from (1,1)->(2,1)), checkCollision returns true, and
   * the bot is frozen in place for seconds until its own bomb kills it.
   *
   * Fix: to walk horizontally, first slide vertically to the row centre; to
   * walk vertically, first slide horizontally to the column centre. This is the
   * standard Bomberman "rail alignment" the 70-patch original bot does implicitly.
   */
  const cell = () => gs.getCellSize();
  const canMove = (ax, ay) => {
    try { return bot.canPhysicallyMove(ax, ay); } catch (e) { return true; }
  };
  const go = (dx, dy) => {
    bot._goArgs = [dx, dy];
    const c = cell();
    const ox = gs.offsetX || 0, oy = gs.offsetY || 0;
    // bot.x/bot.y are the sprite's TOP-LEFT pixel. The bot is perfectly aligned
    // to the cell it logically occupies when top-left == (ox + gridX*c, oy + gridY*c).
    const cellTopX = ox + bot.gridX * c;
    const cellTopY = oy + bot.gridY * c;
    // *** ONLY align when the engine's own physics says the move is blocked. ***
    // The previous version demanded |offset| <= 1px before committing to the
    // real direction, but one frame moves ~5.8px at speed 4 -> the alignment
    // term could NEVER converge: frame traces showed the sprite oscillating
    // px 506<->513 forever (L, R, L, R ...) while its commit path said "up",
    // so it never left its own blast cell and died (dominant ownFire death).
    // canPhysicallyMove() tolerates up to pad = 0.2*cell misalignment, so we
    // only need to slide toward the rail while the desired move is blocked.
    if (dx !== 0 || dy !== 0) {
      if (!canMove(dx, dy)) {
        if (dx !== 0 && dy === 0) {
          const ay = Math.sign(cellTopY - bot.y);
          if (ay !== 0 && canMove(0, ay)) { setDir(0, ay); return; }
        } else if (dy !== 0 && dx === 0) {
          const ax = Math.sign(cellTopX - bot.x);
          if (ax !== 0 && canMove(ax, 0)) { setDir(ax, 0); return; }
        }
      }
    }
    setDir(dx, dy);
  };

  const liveMonsters = () => mo.monsters.filter(m => !m.isDead);
  // 到最近活怪的曼哈頓距離（高密度闢場「拉風箏」能力用）。
  const nearestMonsterDist = (x, y) => {
    let best = Infinity;
    for (const m of mo.monsters) { if (m.isDead) continue; const d = Math.abs(m.gridX - x) + Math.abs(m.gridY - y); if (d < best) best = d; }
    return best;
  };
  // 是否有存活隊友（電腦雙人合作才有）。雙人可分工：一隻拉風箏、一隻輸出，故高密度
  // 闢場的「拉開距離」走位只在 COOP 啟用；單人模式維持原本近身獵殺策略（實測更優）。
  const hasMate = () => {
    try {
      const w = (typeof window !== 'undefined' && window) || (typeof global !== 'undefined' && global);
      if (!w || !w.bot || !w.bot2) return false;
      const mate = w.bot === bot ? w.bot2 : (w.bot2 === bot ? w.bot : null);
      return !!mate && mate !== bot && !mate.isDead;
    } catch (e) { return false; }
  };
  const mateBot = () => {
    try {
      const w = (typeof window !== 'undefined' && window) || (typeof global !== 'undefined' && global);
      if (!w || !w.bot || !w.bot2) return null;
      const mate = w.bot === bot ? w.bot2 : (w.bot2 === bot ? w.bot : null);
      return mate && mate !== bot && !mate.isDead ? mate : null;
    } catch (e) { return null; }
  };

  // Monster contact is INSTANT death (no damage model): the engine kills when
  // the centre distance drops below 0.8 * cellSize, i.e. effectively when the
  // monster enters the bot's own cell (or the reverse). We therefore treat a
  // cell as occupied when a live monster is on it OR its centre is already
  // inside that cell's disc (mid-transition). This is the guard that stops the
  // bot walking straight into a chasing ZOMBIE while hunting it.
  const monsterNear = (x, y) => {
    const c = cell();
    const cx = (gs.offsetX || 0) + x * c + c / 2;
    const cy = (gs.offsetY || 0) + y * c + c / 2;
    for (const m of liveMonsters()) {
      if (m.gridX === x && m.gridY === y) return true;
      if (Math.abs(m.x + c / 2 - cx) < c * 0.55 && Math.abs(m.y + c / 2 - cy) < c * 0.55) return true;
    }
    return false;
  };
  // Adjacency guard (collision-course veto): engine contact fires at centre
  // distance < 0.8 cell, i.e. MID-TRANSITION between two cells 1 apart. A
  // Stepping into an orthogonally adjacent cell can collide mid-transition when
  // a moving monster approaches (trace seed #17). Stationary monsters such as
  // MIMIC do not need this buffer; their own cell remains blocked.
  const monsterAdj = (x, y) => {
    const c = cell();
    const cx = (gs.offsetX || 0) + x * c + c / 2;
    const cy = (gs.offsetY || 0) + y * c + c / 2;
    const baselineAdjacency = typeof global !== 'undefined' && global.__BB_BASELINE_MIMIC_ADJ;
    const predictContact = typeof global !== 'undefined' && global.__BB_PREDICT_CONTACT;
    const playerDx = x - bot.gridX, playerDy = y - bot.gridY;
    const adjacentStep = Math.abs(playerDx) + Math.abs(playerDy) === 1;
    for (const m of liveMonsters()) {
      const distance = Math.abs(m.gridX - x) + Math.abs(m.gridY - y);
      if (predictContact) {
        const mx = m.x + c / 2;
        const my = m.y + c / 2;
        if (distance === 0 || Math.hypot(mx - cx, my - cy) < c * 0.8) return true;
        if (!adjacentStep || !m.speed || !m.direction) continue;

        const playerSpeed = Math.max(0, bot.speed || 0) * c;
        const monsterSpeed = Math.max(0, m.speed || 0) * c;
        const dirX = Math.sign(playerDx), dirY = Math.sign(playerDy);
        const targetX = cx, targetY = cy;
        const horizon = Math.min(0.35, 1 / Math.max(bot.speed || 1, 1));
        const tick = 1 / 60;
        for (let t = tick; t <= horizon + 1e-6; t += tick) {
          const playerTravel = Math.min(playerSpeed * t, c);
          const px = bot.x + c / 2 + dirX * playerTravel;
          const py = bot.y + c / 2 + dirY * playerTravel;
          const mxAtT = mx + m.direction.dx * monsterSpeed * t;
          const myAtT = my + m.direction.dy * monsterSpeed * t;
          if (Math.hypot(px - mxAtT, py - myAtT) < c * 0.8) return true;
        }
        continue;
      }
      const moving = m.speed > 0 || baselineAdjacency;
      if (distance === 0 || (moving && distance <= 1)) return true;
      if (moving &&
          Math.abs(m.x + c / 2 - cx) < c * 0.9 &&
          Math.abs(m.y + c / 2 - cy) < c * 0.9) return true;
    }
    return false;
  };

  // One step the bot may safely TAKE: must be plain floor (a soft brick blocks
  // movement), no live bomb on it, not covered by any blast, and not occupied
  // by a monster (contact = death).
  const okStepFull = (x, y) => typeAt(x, y) === 0 && !bm.hasBombAt(x, y) && !unsafe(x, y) && !monsterNear(x, y);

  // ---- AUTHORITATIVE danger model (replaces the unreliable DangerMap) --------
  // Frame tracing (bb-deathtrace) proved DangerMap UNDERSTATES blast coverage:
  // the bot's ownFire deaths (84/97) happen ON the bomb cell with dan=0.
  // We union the engine's own getExplosionCells() over every LIVE bomb. This is
  // conservative (union includes each bomb's own blast; a chain detonation only
  // detonates a second bomb whose blast is ALREADY in the union) and exact for
  // "will this cell ever be on fire" — the only property that matters for not
  // dying. Rebuilt each think() into `blast` (Set of "x,y").
  let blast = new Set();
  function computeBlast() {
    blast = new Set();
    const bombs = (bm.bombs || []);
    for (const b of bombs) {
      let cells = null;
      try { cells = bot.getExplosionCells(b.gridX, b.gridY, b.range, !!b.pierce, b.shape || 'CROSS'); }
      catch (e) { cells = null; }
      if (cells) { for (const c of cells) blast.add(c); }
      // The bomb's own cell is always on fire when it detonates — include it
      // even if getExplosionCells() omits the origin.
      blast.add(key(b.gridX, b.gridY));
      // API absent -> conservative cross fallback (stops at wall/brick).
      const r = (b.range || 2);
      blast.add(key(b.gridX, b.gridY));
      for (const d of DIRS) {
        let x = b.gridX, y = b.gridY, s = 0;
        while (s < r) { x += d.dx; y += d.dy; s++; blast.add(key(x, y));
          if (isWall(x, y) || isBrick(x, y)) break; }
      }
    }
  }
  // Active flame only (an explosion already burning underfoot).
  const flameAt = (x, y) => {
    const ex = em.explosions || [];
    for (const e of ex) {
      if (e.isDone) continue;
      if (e.gridX === x && e.gridY === y) return true;
    }
    return false;
  };
  // "unsafe" = on fire now OR covered by some live bomb's blast.
  const unsafe = (x, y) => blast.has(key(x, y)) || flameAt(x, y);
  // Back-compat name used by the reactive dodge branch.
  const dangerNow = (x, y) => unsafe(x, y);

  // Minimax risk of standing on a cell: HOW MANY live blasts can reach it, and
  // the EARLIEST moment any of them detonates. Used by the FLEE fallback when
  // no cell is fully safe: the game-theoretically correct move is the one that
  // minimises the number of ways to die and maximises the time we have left.
  function riskAt(x, y) {
    let cover = 0, earliest = Infinity;
    if (flameAt(x, y)) return { cover: 100, earliest: -1 };
    for (const b of (bm.bombs || [])) {
      if (b.isExploded) continue;
      let hit = (b.gridX === x && b.gridY === y);
      if (!hit) {
        let cells = null;
        try { cells = bot.getExplosionCells(b.gridX, b.gridY, b.range, !!b.pierce, b.shape || 'CROSS'); } catch (e) { }
        if (cells) hit = cells.has(key(x, y));
      }
      if (hit) { cover++; if (b.timer < earliest) earliest = b.timer; }
    }
    return { cover, earliest };
  }


  /**
   * BFS over walkable cells (floor + soft brick) from the bot to the nearest
   * cell satisfying `isGoal`. Returns the FIRST STEP (child-of-start) so the
   * bot never returns its own cell (the freeze bug). Returns null if none.
   */
  function firstStep(isGoal, costBrick = 3, walkFn = walkable) {
    const sx = bot.gridX, sy = bot.gridY;
    if (isGoal(sx, sy)) return null; // already there
    const parent = new Map();        // "x,y" -> "px,py"
    const q = [[sx, sy]];
    parent.set(key(sx, sy), null);
    let found = null;
    while (q.length) {
      const [x, y] = q.shift();
      if (isGoal(x, y)) { found = [x, y]; break; }
      for (const d of DIRS) {
        const nx = x + d.dx, ny = y + d.dy;
        const nk = key(nx, ny);
        if (parent.has(nk)) continue;
        if (!walkFn(nx, ny)) continue;
        if (bm.hasBombAt(nx, ny)) continue;   // don't path through armed bombs
        parent.set(nk, key(x, y));
        q.push([nx, ny]);
      }
    }
    if (!found) return null;
    // unwind to the child of start
    let cur = key(found[0], found[1]);
    let prev = parent.get(cur);
    while (prev && prev !== key(sx, sy)) { cur = prev; prev = parent.get(cur); }
    const [cx, cy] = cur.split(',').map(Number);
    return { x: cx, y: cy, dx: cx - sx, dy: cy - sy };
  }

  function hasFloorPathTo(target) {
    if (!target || target.isDead) return false;
    const start = { x: bot.gridX, y: bot.gridY };
    const startKey = key(start.x, start.y);
    const seen = new Set([startKey]);
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      if (current.x === target.gridX && current.y === target.gridY) return true;
      for (const d of DIRS) {
        const x = current.x + d.dx, y = current.y + d.dy;
        const cellKey = key(x, y);
        // Isolation is structural; temporary bombs must not make a floor route look sealed.
        if (seen.has(cellKey) || typeAt(x, y) !== 0) continue;
        seen.add(cellKey);
        queue.push({ x, y });
      }
    }
    return false;
  }

  // Does a bomb at (bx,by) with CROSS shape reach the monster through clear cells?
  function crossReaches(bx, by, mx, my, range) {
    if (bx !== mx && by !== my) return false;
    const step = bx === mx ? { dx: 0, dy: Math.sign(my - by) } : { dx: Math.sign(mx - bx), dy: 0 };
    let x = bx, y = by, steps = 0;
    while (steps < range) {
      x += step.dx; y += step.dy; steps++;
      if (x === mx && y === my) return true;
      if (isWall(x, y)) return false;      // hard wall stops the cross
      // soft brick in between also blocks reach to the monster (blast stops there)
      if (isBrick(x, y)) return false;
    }
    return false;
  }

  const shape = () => (bot.hasDiagonalFire ? 'X' : 'CROSS');
  const range = () => bot.fireRange;

  // Nearest monster reachable through walkable (floor+brick) cells. BLAST-VETO:
  // the path must not route through any live bomb's blast cell — otherwise the
  // bot walks back into its own still-ticking bomb's blast after escaping (the
  // dominant ownFire death: 84/97 on the killer cell). A monster that is itself
  // standing in a blast is excluded (it is about to die; no need to chase it).
  const huntWalk = (x, y) => walkable(x, y) && !bm.hasBombAt(x, y) && !unsafe(x, y);
  const huntWalkLoose = (x, y) => walkable(x, y) && !bm.hasBombAt(x, y);
  const nearestReachable = () => {
    const live = liveMonsters();
    const mate = typeof global !== 'undefined' && global.__BB_COOP_ASSIGN ? mateBot() : null;
    if (!mate) {
      const allGoals = (x, y) => live.some(m => m.gridX === x && m.gridY === y);
      const allStep = firstStep(allGoals, 3, huntWalk);
      if (allStep) return allStep;
      return firstStep(allGoals, 3, huntWalkLoose);
    }
    const mateTarget = mate && live.includes(mate._huntTarget) && live.length > 1
      ? mate._huntTarget : null;
    const targets = live.filter(m => m !== mateTarget).sort((a, b) =>
      (Math.abs(a.gridX - bot.gridX) + Math.abs(a.gridY - bot.gridY)) -
      (Math.abs(b.gridX - bot.gridX) + Math.abs(b.gridY - bot.gridY)));
    const target = targets[0] || live[0] || null;
    bot._huntTarget = target;
    const goal = (x, y) => target && x === target.gridX && y === target.gridY;
    const step = firstStep(goal, 3, huntWalk);
    if (step) return step;
    // Loose fallback: if every strict, blast-safe route is blocked, at least
    // keep advancing toward the target. HUNT itself still refuses an unsafe
    // immediate step, so the loose route only rescues huntNull stalls.
    return firstStep(goal, 3, huntWalkLoose);
  };

  // Time-aware, physics-verified escape for a bomb at (gx,gy). Returns the full
  // canSafelyPlaceBomb() result ({canEscape, path, safeCell, time}) or null.
  function getEscape(gx, gy) {
    try {
      const esc = bot.canSafelyPlaceBomb(gx, gy, range(), false, shape());
      let chosen = (esc && esc.canEscape) ? esc : null;
      if (!chosen) {
        // Conservative over-rejection fallback: the engine rejects on some
        // transient/physics ground while a blast-free, time-feasible path may
        // still exist. Re-verify with ownEscape and force it through the SAME
        // margin / path / monster sanity the engine result must pass.
        chosen = ownEscape(gx, gy);
        if (chosen && escapeCrossesMonster(chosen)) return null;
      } else if (escapeCrossesMonster(chosen)) {
        return null;
      }
      if (!chosen) return null;
      // ---- Robust-execution margin (OR: safety buffer under latency) --------
      // The engine verifies arrival STRICTLY before detonation with zero slack,
      // and assumes every cell costs exactly 1/speed. Real movement pays a
      // centering/turn latency per cell. Frame tracing showed 97% of own-fire
      // deaths happen while following a "verified" commit path: no live bombs
      // remained and the death cell was in an ACTIVE FLAME — i.e. the bot
      // arrived one cell SHORT of the promised safe cell. Demand slack.
      const len = (chosen.path || []).length;
      let fuse = 3;
      try { fuse = bot.getFuseTime(); } catch (e) { }
      // ---- Strict commit feasibility: the fuse TICKS DOWN after placement. ----
      // The engine verifies against the FULL fuse, but our commit path only
      // starts executing AFTER placement frames. Under latency each grid step
      // costs ~1/speed + centering slack; demand arrival strictly before the
      // earliest live detonation, not just the hypothetical fuse.
      let earliest = fuse;
      for (const b of (bm.bombs || [])) {
        if (b.isExploded || b.exploded) continue;
        const t = (typeof b.timer === 'number') ? b.timer : Infinity;
        // The hypothetical new bomb is not yet in bm.bombs; existing bombs are.
        if (t < earliest) earliest = t;
      }
      const per = 1 / Math.max(1, bot.getEffectiveSpeed ? bot.getEffectiveSpeed() : 4);
      // Early-run blast latency is the dominant ownFire source in coop; require
      // extra escape slack for the first ~20 seconds only, then restore the
      // normal margin so the late run does not turn into a timeout.
      const margin = 0.15 * len + 0.35;
      if (chosen.time + margin > Math.min(fuse, earliest)) { stats.escTight = (stats.escTight || 0) + 1; return null; }
      // ---- Safe-cell sanity: the promised safe cell must itself be floor, ----
      // bomb-free, flame-free AND monster-free at decision time. An escape that
      // ends on a chasing monster's cell is a contact death, not an escape.
      const sc = chosen.safeCell;
      if (sc) {
        if (typeAt(sc.x, sc.y) !== 0 || bm.hasBombAt(sc.x, sc.y) || flameAt(sc.x, sc.y)) return null;
        if (monsterNear(sc.x, sc.y)) { stats.escMonster = (stats.escMonster || 0) + 1; return null; }
        for (const wp of (chosen.path || [])) {
          if (typeAt(wp.x, wp.y) !== 0 && !(wp.x === gx && wp.y === gy)) return null;
          if (bm.hasBombAt(wp.x, wp.y) || flameAt(wp.x, wp.y)) return null;
          if (monsterNear(wp.x, wp.y)) { stats.escMonster = (stats.escMonster || 0) + 1; return null; }
        }
      }
      return chosen;
    } catch (e) { stats.escFail = (stats.escFail || 0) + 1; return null; }
  }
  function canEscapeHere(gx, gy) { return !!getEscape(gx, gy); }

  // ---- INDEPENDENT escape model (fallback when engine gate over-rejects) ----
  // The engine's canSafelyPlaceBomb() rejects on neighbouring live bombs /
  // active flame / first-step physics ("engine" verdict): 60-300 rejections
  // per run left the bot idle next to approaching monsters (contact deaths)
  // or unable to breach a pocket (timeouts). We re-verify with our OWN
  // time-aware BFS: floor-only walk, no live bombs, no flame, and arrival at a
  // blast-free cell strictly before the EARLIEST detonation (existing bombs
  // plus the hypothetical one), minus a per-cell latency margin.
  function ownEscape(gx, gy) {
    try {
      let fuse = 3;
      try { fuse = bot.getFuseTime(); } catch (e) { }
      const per = 0.26;                    // conservative per-cell cost (latency incl.)
      let earliest = fuse;
      for (const b of (bm.bombs || [])) {
        if (b.isExploded || b.exploded) continue;
        const t = (typeof b.timer === 'number') ? b.timer : Infinity;
        if (t < earliest) earliest = t;
      }
      // Hypothetical blast of the new bomb, unioned with existing blasts.
      const cells = new Set();
      let hc = null;
      try { hc = bot.getExplosionCells(gx, gy, range(), false, shape()); } catch (e) { }
      if (hc) for (const c of hc) cells.add(c);
      cells.add(key(gx, gy));
      for (const b of (bm.bombs || [])) {
        if (b.isExploded || b.exploded) continue;
        let bc = null;
        try { bc = bot.getExplosionCells(b.gridX, b.gridY, b.range, !!b.pierce, b.shape || 'CROSS'); } catch (e) { }
        if (bc) for (const c of bc) cells.add(c);
        cells.add(key(b.gridX, b.gridY));
      }
      // Time-aware BFS over floor cells. We may STEP THROUGH blast cells as
      // long as we ARRIVE at a blast-free cell before the earliest detonation.
      const parent = new Map();           // "x,y" -> "px,py"
      const arrived = new Map();          // "x,y" -> arrival time
      parent.set(key(gx, gy), null);
      arrived.set(key(gx, gy), 0);
      const q = [{ x: gx, y: gy, t: 0 }];
      let safe = null;
      while (q.length) {
        const cur = q.shift();
        if (cur.t + per >= earliest - 0.05) continue;  // no time to move further
        for (const dir of DIRS) {
          const nx = cur.x + dir.dx, ny = cur.y + dir.dy;
          if (!inBounds(nx, ny) || typeAt(nx, ny) !== 0) continue;
          if (bm.hasBombAt(nx, ny)) continue;
          if (flameAt(nx, ny)) continue;
          const nk = key(nx, ny);
          if (parent.has(nk)) continue;
          const t = cur.t + per;
          parent.set(nk, key(cur.x, cur.y));
          arrived.set(nk, t);
          if (!cells.has(nk)) { safe = { x: nx, y: ny, t }; break; }
          q.push({ x: nx, y: ny, t });
        }
        if (safe) break;
      }
      if (!safe) return null;
      const chain = [];
      let c2 = key(safe.x, safe.y);
      while (c2 && c2 !== key(gx, gy)) { const [cx2, cy2] = c2.split(',').map(Number); chain.unshift({ x: cx2, y: cy2 }); c2 = parent.get(c2); }
      return { canEscape: true, path: chain, safeCell: { x: safe.x, y: safe.y }, time: safe.t };
    } catch (e) { return null; }
  }

  // Does the committed escape route (or its safe cell) cross a LIVE monster?
  // Contact costs 1/3 hp + 2s shield; a placement whose only escape runs
  // through a chasing monster is a losing trade (game-theory: reject moves
  // whose execution is controlled by the opponent).
  function escapeCrossesMonster(esc) {
    if (!esc) return false;
    for (const wp of (esc.path || [])) if (monsterNear(wp.x, wp.y)) return true;
    if (esc.safeCell && monsterNear(esc.safeCell.x, esc.safeCell.y)) return true;
    return false;
  }

  const canPlace = () => bot.currentBombs < bot.maxBombs;
  const pocketDigEnabled = !(typeof global !== 'undefined' &&
    global.__BB_DISABLE_POCKET_DIG);
  const pocketStuckLimit = typeof global !== 'undefined' &&
    Number.isFinite(global.__BB_POCKET_STUCK_LIMIT)
    ? global.__BB_POCKET_STUCK_LIMIT : 200;
  const pocketDigRadius = typeof global !== 'undefined' &&
    Number.isFinite(global.__BB_POCKET_DIG_RADIUS)
    ? global.__BB_POCKET_DIG_RADIUS : 6;

  function targetPathCost(target, removedBricks = new Set()) {
    const sx = bot.gridX, sy = bot.gridY;
    const startKey = key(sx, sy);
    const costs = new Map([[startKey, 0]]);
    const buckets = [[{ x: sx, y: sy }]];
    for (let cost = 0; cost < buckets.length; cost++) {
      for (let i = 0; i < (buckets[cost] || []).length; i++) {
        const current = buckets[cost][i];
        const currentKey = key(current.x, current.y);
        if (cost !== costs.get(currentKey)) continue;
        if (current.x === target.gridX && current.y === target.gridY) return cost;
        for (const d of DIRS) {
          const nx = current.x + d.dx, ny = current.y + d.dy;
          if (!inBounds(nx, ny) || isWall(nx, ny)) continue;
          const nk = key(nx, ny);
          const brick = isBrick(nx, ny) && !removedBricks.has(nk);
          const nextCost = cost + (brick ? 4 : 1);
          if (nextCost >= (costs.get(nk) ?? Infinity)) continue;
          costs.set(nk, nextCost);
          (buckets[nextCost] ||= []).push({ x: nx, y: ny });
        }
      }
    }
    return Infinity;
  }

  function getSafeDigPlan(target) {
    if (!canPlace() || !target || target.isDead) {
      stats.pkRejectPrerequisite = (stats.pkRejectPrerequisite || 0) + 1;
      return null;
    }
    const sx = bot.gridX, sy = bot.gridY;
    const currentPathCost = targetPathCost(target);
    if (!Number.isFinite(currentPathCost)) {
      stats.pkRejectTargetPath = (stats.pkRejectTargetPath || 0) + 1;
      return null;
    }

    const safeWalk = (x, y) => typeAt(x, y) === 0 && !unsafe(x, y) &&
      !bm.hasBombAt(x, y) && !monsterAdj(x, y);
    const distances = new Map([[key(sx, sy), 0]]);
    const queue = [{ x: sx, y: sy }];
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      const currentKey = key(current.x, current.y);
      for (const d of DIRS) {
        const nx = current.x + d.dx, ny = current.y + d.dy;
        const nk = key(nx, ny);
        if (distances.has(nk) || !safeWalk(nx, ny)) continue;
        distances.set(nk, distances.get(currentKey) + 1);
        queue.push({ x: nx, y: ny });
      }
    }

    let best = null;
    let overRadius = 0;
    let noBlast = 0;
    let noBrick = 0;
    let noEscape = 0;
    let escapeMonster = 0;
    let noProgress = 0;
    for (const [siteKey, distance] of distances) {
      if (distance > pocketDigRadius) {
        overRadius++;
        continue;
      }
      const [x, y] = siteKey.split(',').map(Number);
      const cells = bot.getExplosionCells(x, y, range(), false, shape());
      if (!cells) {
        noBlast++;
        continue;
      }

      const removedBricks = new Set();
      for (const cellKey of cells) {
        const [bx, by] = cellKey.split(',').map(Number);
        if (isBrick(bx, by)) removedBricks.add(cellKey);
      }
      if (!removedBricks.size) {
        noBrick++;
        continue;
      }
      const escape = getEscape(x, y);
      if (!escape) {
        noEscape++;
        continue;
      }
      if (escapeCrossesMonster(escape)) {
        escapeMonster++;
        continue;
      }
      const afterCost = targetPathCost(target, removedBricks);
      const gain = currentPathCost - afterCost;
      if (!(gain > 0)) {
        noProgress++;
        continue;
      }

      const score = gain * 3 - distance - (escape.path || []).length * 0.5;
      if (!best || score > best.score) best = { x, y, score, gain };
    }
    stats.pkRejectOverRadius = (stats.pkRejectOverRadius || 0) + overRadius;
    stats.pkRejectNoBlast = (stats.pkRejectNoBlast || 0) + noBlast;
    stats.pkRejectNoBrick = (stats.pkRejectNoBrick || 0) + noBrick;
    stats.pkRejectNoEscape = (stats.pkRejectNoEscape || 0) + noEscape;
    stats.pkRejectEscapeMonster = (stats.pkRejectEscapeMonster || 0) + escapeMonster;
    stats.pkRejectNoProgress = (stats.pkRejectNoProgress || 0) + noProgress;
    return best;
  }

  function simulateBombRollout(bombX, bombY, blastCells, escape) {
    const c = cell();
    const ox = gs.offsetX || 0, oy = gs.offsetY || 0;
    const fuse = Math.max(0.5, bot.getFuseTime());
    const playerSpeed = Math.max(1, bot.getEffectiveSpeed ? bot.getEffectiveSpeed() : bot.speed || 4);
    const escapePath = escape.path || [];
    const variants = 3;
    const steps = Math.ceil(fuse * 10);
    const dt = fuse / steps;
    const dirs = DIRS.map(({ dx, dy }) => ({ dx, dy }));
    const random01 = (monsterIndex, variant, step) => {
      let value = (monsterIndex * 73856093 ^ variant * 19349663 ^ step * 83492791) >>> 0;
      value = Math.imul(value ^ (value >>> 13), 1274126177);
      return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
    };
    const playerAt = (time) => {
      const progress = time * playerSpeed;
      const index = Math.floor(progress);
      const fraction = Math.min(1, progress - index);
      const from = index === 0 ? { x: bombX, y: bombY } : escapePath[index - 1] || escape.safeCell;
      const to = escapePath[index] || escape.safeCell || from;
      return {
        x: from.x + (to.x - from.x) * fraction + 0.5,
        y: from.y + (to.y - from.y) * fraction + 0.5,
      };
    };

    let expectedHits = 0, escapeContacts = 0, samples = 0;
    const monsters = liveMonsters();
    for (let monsterIndex = 0; monsterIndex < monsters.length; monsterIndex++) {
      const monster = monsters[monsterIndex];
      if (!(monster.speed > 0) || !monster.direction) continue;
      for (let variant = 0; variant < variants; variant++) {
        let x = (monster.x + c / 2 - ox) / c;
        let y = (monster.y + c / 2 - oy) / c;
        let dx = Math.sign(monster.direction.dx), dy = Math.sign(monster.direction.dy);
        let decisionCell = key(Math.floor(x), Math.floor(y));
        let hit = false, contactedEscape = false;
        for (let step = 1; step <= steps; step++) {
          const time = step * dt;
          const cellX = Math.floor(x), cellY = Math.floor(y);
          const atIntersection = Math.abs(x - (cellX + 0.5)) <= monster.speed * dt &&
            Math.abs(y - (cellY + 0.5)) <= monster.speed * dt;
          if (atIntersection && decisionCell !== key(cellX, cellY)) {
            decisionCell = key(cellX, cellY);
            if (monster.ai === 'chase' && random01(monsterIndex, variant, step) < 0.8) {
              const target = playerAt(time);
              const targetDx = target.x - x, targetDy = target.y - y;
              if (Math.abs(targetDx) > Math.abs(targetDy)) {
                dx = Math.sign(targetDx); dy = 0;
              } else {
                dx = 0; dy = Math.sign(targetDy);
              }
            }
          }
          const nx = x + dx * monster.speed * dt;
          const ny = y + dy * monster.speed * dt;
          const nextCellX = Math.floor(nx), nextCellY = Math.floor(ny);
          if (nextCellX !== cellX || nextCellY !== cellY) {
            const block = typeAt(nextCellX, nextCellY);
            const blocked = block === 1 ||
              (block === 2 && !monster.wallPass && !monster.breakWall) ||
              (nextCellX === bombX && nextCellY === bombY) ||
              bm.hasBombAt(nextCellX, nextCellY);
            if (blocked) {
              x = cellX + 0.5;
              y = cellY + 0.5;
              const open = dirs.filter(d => {
                const tx = cellX + d.dx, ty = cellY + d.dy, tile = typeAt(tx, ty);
                return tile !== 1 && (tile !== 2 || monster.wallPass || monster.breakWall) &&
                  !(tx === bombX && ty === bombY) && !bm.hasBombAt(tx, ty);
              });
              if (open.length) {
                const chosen = open[Math.floor(random01(monsterIndex, variant + 11, step) * open.length)];
                dx = chosen.dx;
                dy = chosen.dy;
              }
            } else {
              x = nx;
              y = ny;
            }
          } else {
            x = nx;
            y = ny;
          }
          if (time < fuse - 0.1) {
            const player = playerAt(time);
            if (Math.hypot(x - player.x, y - player.y) < 0.8) contactedEscape = true;
          } else if (blastCells.has(key(Math.floor(x), Math.floor(y)))) {
            hit = true;
          }
        }
        if (hit) expectedHits += 1 / variants;
        if (contactedEscape) escapeContacts++;
        samples++;
      }
    }
    return {
      expectedHits,
      escapeContactRisk: samples ? escapeContacts / samples : 0,
    };
  }

  // ---- JOINT PLACEMENT + ESCAPE SEARCH (OR) ---------------------------------
  // The escape gate is only ever evaluated at the CURRENT cell, so a bot
  // standing in a dead end (geoTrap) or one whose fire range has grown so wide
  // that its own blast covers the whole pocket simply refuses to bomb forever
  // -- while the chasers close in and contact-kill it (30/37 fair deaths).
  // Scan the floor cells within `depth` steps and pick the one maximising
  //     score = 12*kills + 3*monsters-about-to-walk-in + 0.5*bricks - 1.5*steps
  // subject to the SAME verified escape gate. This is the classic
  // "place the bomb where it is both lethal and escapable" joint decision.
  let rpTarget = null;     // {x, y, first, esc}
  let rpFrame = -999;
  function repositionToBomb(depth) {
    const live = liveMonsters();
    if (!live.length) return null;
    const sx = bot.gridX, sy = bot.gridY;
    const seen = new Map();                    // "x,y" -> { d, first }
    const q = [{ x: sx, y: sy, d: 0, first: null }];
    seen.set(key(sx, sy), { d: 0, first: null });
    while (q.length) {
      const cur = q.shift();
      if (cur.d >= depth) continue;
      for (const d of DIRS) {
        const nx = cur.x + d.dx, ny = cur.y + d.dy;
        if (!inBounds(nx, ny) || isWall(nx, ny) || isBrick(nx, ny)) continue;
        if (bm.hasBombAt(nx, ny)) continue;
        const nk = key(nx, ny);
        if (seen.has(nk)) continue;
        seen.set(nk, { d: cur.d + 1, first: cur.first || d });
        q.push({ x: nx, y: ny, d: cur.d + 1, first: cur.first || d });
      }
    }
    const cands = [];
    for (const [k, info] of seen) {
      const [x, y] = k.split(',').map(Number);
      let cells = null;
      try { cells = bot.getExplosionCells(x, y, range(), false, shape()); } catch (e) { }
      if (!cells) continue;
      let kills = 0, near = 0, bricks = 0, predictedHits = 0;
      for (const m of live) {
        if (cells.has(key(m.gridX, m.gridY))) kills++;
        else if (DIRS.some(d => cells.has(key(m.gridX + d.dx, m.gridY + d.dy)))) near++;
        if (typeof global !== 'undefined' && global.__BB_TACTICAL_BOMB &&
            !cells.has(key(m.gridX, m.gridY)) && m.speed > 0 && m.direction) {
          let gx = m.gridX, gy = m.gridY;
          const travel = Math.min(3, m.speed * 2.5);
          const steps = Math.ceil(travel);
          for (let i = 0; i < steps; i++) {
            const nx = gx + m.direction.dx, ny = gy + m.direction.dy;
            if (!inBounds(nx, ny) || isWall(nx, ny) || isBrick(nx, ny)) break;
            gx = nx; gy = ny;
            if (cells.has(key(gx, gy))) {
              predictedHits++;
              break;
            }
          }
        }
      }
      for (const ck of cells) { const [bx, by] = ck.split(',').map(Number); if (isBrick(bx, by)) bricks++; }
      const tacticalWeight = typeof global !== 'undefined' && global.__BB_TACTICAL_BOMB ? 5 : 0;
      const score = kills * 12 + near * 3 + predictedHits * tacticalWeight +
        Math.min(bricks, 4) * 0.5 - info.d * 1.5;
      if (score <= 0) continue;
      cands.push({ x, y, d: info.d, first: info.first, score, kills, cells });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => b.score - a.score);
    const useRollout = typeof global !== 'undefined' && global.__BB_ROLLOUT_BOMB;
    let best = null;
    for (const cand of cands.slice(0, useRollout ? 12 : 5)) {
      if (cand.d === 0) continue;              // current cell = KILL/AMBUSH's job
      const esc = getEscape(cand.x, cand.y);
      if (esc) {
        if (useRollout) {
          const rollout = simulateBombRollout(cand.x, cand.y, cand.cells, esc);
          const riskLimit = typeof global !== 'undefined' && Number.isFinite(global.__BB_ROLLOUT_RISK_LIMIT)
            ? global.__BB_ROLLOUT_RISK_LIMIT : 0.4;
          if (rollout.escapeContactRisk > riskLimit) {
            stats.rolloutEscapeRejected = (stats.rolloutEscapeRejected || 0) + 1;
            continue;
          }
          const hitWeight = typeof global !== 'undefined' && Number.isFinite(global.__BB_ROLLOUT_HIT_WEIGHT)
            ? global.__BB_ROLLOUT_HIT_WEIGHT : 18;
          const riskWeight = typeof global !== 'undefined' && Number.isFinite(global.__BB_ROLLOUT_RISK_WEIGHT)
            ? global.__BB_ROLLOUT_RISK_WEIGHT : 10;
          cand.score += rollout.expectedHits * hitWeight - rollout.escapeContactRisk * riskWeight;
          cand.rolloutHits = rollout.expectedHits;
          stats.rolloutCandidates = (stats.rolloutCandidates || 0) + 1;
        } else {
          cand.esc = esc;
          return cand;
        }
        cand.esc = esc;
        if (!best || cand.score > best.score) best = cand;
      } else {
        stats.rpNoEsc = (stats.rpNoEsc || 0) + 1;
      }
    }
    return best;
  }

  // ---- Why did the escape gate reject this placement? ----------------------
  // Classifies an engine canSafelyPlaceBomb() rejection into:
  //   'geoTrap'   — every floor cell reachable in the open map lies inside the
  //                 hypothetical blast (walls/bricks solid, no timing) => the
  //                 CURRENT cell is a dead end; we must reposition FIRST.
  //   'tooSlow'   — a safe cell exists but is farther than the fuse allows.
  //   'engine'    — geometry+time are fine; the engine rejected on some other
  //                 ground (neighbouring live bomb, active flame, first-step
  //                 canPhysicallyMove). => transient / physics.
  function classifyNoEsc(bx, by, ox, oy) {
    const R = range();
    const blast = new Set();
    blast.add(key(bx, by));
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      for (let i = 1; i <= R; i++) {
        const nx = bx + dx * i, ny = by + dy * i;
        if (!inBounds(nx, ny) || isWall(nx, ny)) break;
        blast.add(key(nx, ny));
        if (isBrick(nx, ny)) break;
      }
    }
    let safeExists = false;
    const per = 1 / Math.max(1, bot.getEffectiveSpeed ? bot.getEffectiveSpeed() : 4);
    let fuse = 3;
    try { fuse = bot.getFuseTime(); } catch (e) { }
    const q = [{ x: ox, y: oy, t: 0 }];
    const seen = new Set([key(ox, oy)]);
    let bestT = Infinity;
    while (q.length) {
      const cur = q.shift();
      if (cur.t > 0 && !blast.has(key(cur.x, cur.y))) { safeExists = true; bestT = Math.min(bestT, cur.t); break; }
      if (cur.t >= fuse) continue;
      for (const d of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = cur.x + d[0], ny = cur.y + d[1];
        const nk = key(nx, ny);
        if (!inBounds(nx, ny) || isWall(nx, ny) || isBrick(nx, ny)) continue;
        if (seen.has(nk)) continue;
        seen.add(nk);
        q.push({ x: nx, y: ny, t: cur.t + per });
      }
    }
    if (!safeExists) return 'geoTrap';
    if (bestT >= fuse) return 'tooSlow';
    return 'engine';
  }

  // Probe the ENGINE's own gate to find which check rejects a placement.
  // We cumulatively neutralise each engine-side check and re-run the real
  // canSafelyPlaceBomb(); the first configuration that flips to "canEscape"
  // names the blocker. All patches are restored before returning.
  function engineWhy(bx, by) {
    const run = () => {
      try { const e = bot.canSafelyPlaceBomb(bx, by, range(), false, shape()); return !!(e && e.canEscape); }
      catch (e) { return false; }
    };
    if (run()) return 'ok';
    const pPhys = bot.canPhysicallyMove;
    const pDg = dm.getDangerInfo;
    const pBt = bot.getMinBombExplosionTimeAt;
    const pBb = bm.hasBombAt;
    const pFuse = bot.getFuseTime;
    const restoreAll = () => {
      bot.canPhysicallyMove = pPhys; dm.getDangerInfo = pDg;
      bot.getMinBombExplosionTimeAt = pBt; bm.hasBombAt = pBb; bot.getFuseTime = pFuse;
    };
    let verdict = 'never';
    try {
      bot.canPhysicallyMove = () => true;
      if (run()) { verdict = 'phys'; return restoreAll(), verdict; }
      dm.getDangerInfo = () => ({ isFlameActive: false, dangerLevel: 0, explosionTimer: Infinity });
      if (run()) { verdict = 'danger'; return restoreAll(), verdict; }
      bot.getMinBombExplosionTimeAt = () => Infinity;
      if (run()) { verdict = 'bombTime'; return restoreAll(), verdict; }
      bm.hasBombAt = () => false;
      if (run()) { verdict = 'bombBlock'; return restoreAll(), verdict; }
      bot.getFuseTime = () => 999;
      if (run()) { verdict = 'fuse'; return restoreAll(), verdict; }
      verdict = 'model'; // engine's blast model ≠ ours (shape/pierce) or physics
    } finally { restoreAll(); }
    return verdict;
  }

  // ---- Anti-chatter state ---------------------------------------------------
  // Frame tracing (bb-hstrace seed #16) showed the approach step flip-flopping
  // L/R every frame while the bot froze on a cell: the wandering monster moves,
  // BFS re-targets, and the first step flips. We keep the last commanded
  // direction and only change it if the new step differs for several
  // consecutive frames OR the grid position is frozen (then force a break).
  let hsLastStep = null;      // {dx,dy} last commanded approach step
  let hsStepDiffFrames = 0;   // how long the computed step has differed
  let hsLastGrid = null;      // last (x,y) when we issued an approach step
  let hsGridFreeze = 0;       // frames the grid pos has been unchanged

  // ===== Commit-escape state =====
  // When we place a bomb, canSafelyPlaceBomb() returns a TIME-AWARE, physics-
  // verified path to a safe cell. We STORE it and follow it to completion,
  // instead of recomputing a purely-geometric flee each frame (which happily
  // routes through soon-to-explode cells and gets the bot killed by its own
  // blast — the dominant ownFire death). A committed path outranks everything
  // except an active flame already under our feet (reactive last-resort dodge).
  let commitPath = [];      // [{x,y}, ...] remaining waypoints to the safe cell
  let commitFrames = 0;     // how long we've been committed (watchdog)
  let pocketStuck = 0;
  let pocketCheckThink = 0;
  let pocketTarget = null;
  let pocketBestCost = Infinity;
  let pocketPlan = null;
  let pocketPlanThink = 0;
  let pocketMonsterCount = 0;
  let pocketLastFired = 0;
  let pocketFailedBombs = 0;
  let bossPlan = null;      // {first:{dx,dy}} — 靠近龍王的下一步（BOSS 戰用）
  let bossFrame = -999;     // 上次規劃 BOSS 戰的 thinks 計數

  bot.think = function () {
    stats.thinks = (stats.thinks || 0) + 1;
    reset();
    computeBlast();
    const sx = bot.gridX, sy = bot.gridY;
    const live = liveMonsters();
    // Boss reference (BOSS 關才有)。透過 mo.boss 取得龍王（main.js / bb-sim 皆
    // 同等設置 monsterManager.boss）。這是電腦 AI 得以攻破 BOSS 關的唯一來源。
    const boss = (mo.boss && !mo.boss.isDead) ? mo.boss : null;

    // ---- 0. COMMITTED ESCAPE: follow the verified path to its safe cell ----
    bot._ph = 'COMMIT';
    bot._hcplen = commitPath.length;
    bot._cp0 = commitPath[0] ? commitPath[0].x + ',' + commitPath[0].y : '-';
    bot._scf = bot.sameCellFrames | 0;
    if (commitPath.length) {
      bot._ph = 'COMMIT';
      commitFrames++;
      // Drop waypoints we've already reached.
      while (commitPath.length && bot.gridX === commitPath[0].x && bot.gridY === commitPath[0].y) commitPath.shift();
      // ---- Closed-loop revalidation (OR: never follow a stale plan) ---------
      // The verified path is open-loop: bombs tick, flames appear, monsters
      // walk. If the NEXT waypoint is now flame / live bomb / non-floor /
      // monster-occupied, following it is suicide — abandon and replan.
      if (commitPath.length) {
        const nxt0 = commitPath[0];
        if (flameAt(nxt0.x, nxt0.y) || bm.hasBombAt(nxt0.x, nxt0.y) ||
            typeAt(nxt0.x, nxt0.y) !== 0 || monsterNear(nxt0.x, nxt0.y)) {
          stats.commitStale = (stats.commitStale || 0) + 1;
          commitPath = []; commitFrames = 0;
        }
      }
      // Watchdog: fuse is ~3s (180 frames); a commit living longer is stale.
      if (!commitPath.length || commitFrames > 170) { commitPath = []; commitFrames = 0; }
      else {
        const nxt = commitPath[0];
        const dx = Math.sign(nxt.x - bot.gridX), dy = Math.sign(nxt.y - bot.gridY);
        stats.commitMoves = (stats.commitMoves || 0) + 1;
        go(dx, dy);
        return;
      }
    }

    // Reactive last-resort: standing in an ACTIVE flame (not just a timer).
    // A committed path normally prevents this; if it goes stale, dodge now.
    if (flameAt(sx, sy)) {
      bot._ph = 'FLAME';
      stats.escape = (stats.escape || 0) + 1;
      const floorSafe = (x, y) => typeAt(x, y) === 0 && !flameAt(x, y) && !unsafe(x, y) && !bm.hasBombAt(x, y);
      const step = firstStep((x, y) => floorSafe(x, y), 3, (x, y) => typeAt(x, y) === 0);
      if (step) { stats.fleeMoved = (stats.fleeMoved || 0) + 1; go(step.dx, step.dy); return; }
      stats.fleeNull = (stats.fleeNull || 0) + 1;
    }

    if (!live.length) {
      if (!boss) return;
      // ===== BOSS FIGHT (boss-aware, additive) =====
      // 小怪清空、只剩龍王時，舊政策在這裡直接 return、永遠不打龍王 -> BOSS 關
      // 永遠無法 CLEAR（stage 30-60 實測 0%）。這裡改用「結果論」把龍王的 hp 打到 0，
      // 同時絕不踏進龍王接觸圈 / 火焰。這是加法邏輯，非 BOSS 關完全不受影響。
      (function bossFight() {
        const bx = boss.gridX, by = boss.gridY;
        bot._hboss = 1;
        // (A) KILL：已與龍王同列/同行且中間無遮蔽、又有逃生路 -> 立刻放彈。
        if (canPlace() && crossReaches(sx, sy, bx, by, range())) {
          const esc = getEscape(sx, sy);
          if (esc) {
            bot._ph = 'BOSSKILL'; stats.bossFired = (stats.bossFired || 0) + 1;
            bot.aiInput.bomb = true; commitPath = esc.path || []; commitFrames = 0;
            return;
          }
        }
        // 可站立格：地板、無彈、無火、且不在龍王 3x3 接觸圈內。
        const bossContact = (x, y) => Math.abs(x - bx) <= 1 && Math.abs(y - by) <= 1;
        const standOK = (x, y) => typeAt(x, y) === 0 && !bm.hasBombAt(x, y) &&
                                   !unsafe(x, y) && !bossContact(x, y);
        const aligned = (x, y) => (x === bx || y === by) &&
                                  (Math.abs(x - bx) + Math.abs(y - by)) >= 2 &&
                                  (Math.abs(x - bx) + Math.abs(y - by)) <= range();
        // (B) 規劃/跟隨：走到一個「與龍王對齊、可放彈命中、可逃生」的格子。
        // 龍王會移動，所以經常重規劃。
        if (bossPlan && stats.thinks - bossFrame > 120) bossPlan = null;
        if (!bossPlan) {
          bossFrame = stats.thinks;
          const goal = (x, y) => standOK(x, y) && aligned(x, y) &&
                                 crossReaches(x, y, bx, by, range()) && !!getEscape(x, y);
          const f = firstStep(goal, 1, standOK);
          if (f) { bossPlan = { first: f }; }
        }
        if (bossPlan && bossPlan.first) {
          const nx = sx + bossPlan.first.dx, ny = sy + bossPlan.first.dy;
          if (standOK(nx, ny)) {
            bot._ph = 'BOSSAPPROACH'; stats.bossApproach = (stats.bossApproach || 0) + 1;
            go(bossPlan.first.dx, bossPlan.first.dy); return;
          }
          bossPlan = null;
        }
        // (C) 找不到對齊格：安全箝制（anti-freeze + 迴避接觸），朝能對齊/靠近的方向。
        const dirs = DIRS.filter(d => standOK(sx + d.dx, sy + d.dy));
        if (dirs.length) {
          let best = dirs.find(d => aligned(sx + d.dx, sy + d.dy))
                  || dirs.find(d => (Math.abs(sx + d.dx - bx) + Math.abs(sy + d.dy - by)) <
                                    (Math.abs(sx - bx) + Math.abs(sy - by)))
                  || dirs[0];
          bot._ph = 'BOSSKITE'; go(best.dx, best.dy); return;
        }
      })();
      return;
    }
    try { const wasInstalled = bot._hunterInstalled === true; } catch (e) { bot._hunterInstalled = false; }

    // ---- ENDGAME SWEEP (guarded): few monsters left, open the last pocket ----
    if (live.length && live.length <= 2) {
      for (const m of live) {
        if (m.isDead) continue;
        const d = Math.abs(m.gridX - bot.gridX) + Math.abs(m.gridY - bot.gridY);
        if (d > 2) continue;
        const tk = m.gridX + ',' + m.gridY;
        const reachCells = (typeof getValidMovesIncludingBricks === 'function')
          ? (getValidMovesIncludingBricks(bot.gridX, bot.gridY) || new Set()) : new Set();
        const inReach = reachCells.has && reachCells.has(tk);
        if (!inReach) continue;
        if (canPlace() && getEscape(bot.gridX, bot.gridY)) {
          const esc = getEscape(bot.gridX, bot.gridY);
          bot._ph = 'BREACH2';
          stats.sweepBreach3 = (stats.sweepBreach3 || 0) + 1;
          bot.aiInput.bomb = true;
          if (esc) { commitPath = esc.path || []; commitFrames = 0; }
          return;
        }
        const b2 = (typeof BFS !== 'undefined' && BFS.find)
          ? BFS.find(bot.gridX, bot.gridY, m.gridX, m.gridY, false, true) : null;
        if (b2 && b2.path && b2.path.length) {
          const nx = b2.path[0].x, ny = b2.path[0].y;
          if (okStepFull(nx, ny)) { bot._ph = 'SWEEP3'; stats.sweepMove4 = (stats.sweepMove4 || 0) + 1; go(nx - bot.gridX, ny - bot.gridY); return; }
        }
        break;
      }
    }
    // ---- 1. FLEE from armed-bomb danger (no commit active) ----
    // `unsafe` = on fire OR covered by any live bomb's blast (authoritative).
    if (unsafe(sx, sy)) {
      bot._ph = 'FLEE';
      stats.escape = (stats.escape || 0) + 1;
      const floorOnly = (x, y) => typeAt(x, y) === 0;
      const step = firstStep((x, y) => floorOnly(x, y) && !unsafe(x, y) && !bm.hasBombAt(x,y), 3, floorOnly);
      if (step) { stats.fleeMoved = (stats.fleeMoved || 0) + 1; go(step.dx, step.dy); return; }
      stats.fleeNull = (stats.fleeNull || 0) + 1;
      // ---- Minimax fallback: no fully-safe cell exists ---------------------
      // Stand still = certain death. Move to the neighbour covered by the FEWEST
      // blasts (tie-break: the LATEST detonation), and keep the previous
      // direction unless a strictly better one appears (anti-chatter).
      let best = null;
      for (const d of DIRS) {
        const nx = sx + d.dx, ny = sy + d.dy;
        if (!inBounds(nx, ny) || isWall(nx, ny) || isBrick(nx, ny) || bm.hasBombAt(nx, ny)) continue;
        const r = riskAt(nx, ny);
        if (r.cover === 100) continue;                 // active flame: never step in
        if (!best || r.cover < best.r.cover ||
            (r.cover === best.r.cover && r.earliest > best.r.earliest)) best = { d, r };
      }
      if (best) {
        // Hysteresis: keep last flee direction if it is equally good.
        if (bot._fleeDir && (bot._fleeDir.dx !== best.d.dx || bot._fleeDir.dy !== best.d.dy)) {
          const cur = riskAt(sx + bot._fleeDir.dx, sy + bot._fleeDir.dy);
          if (cur.cover <= best.r.cover && cur.cover !== 100 &&
              inBounds(sx + bot._fleeDir.dx, sy + bot._fleeDir.dy) &&
              !isWall(sx + bot._fleeDir.dx, sy + bot._fleeDir.dy) &&
              !isBrick(sx + bot._fleeDir.dx, sy + bot._fleeDir.dy) &&
              !bm.hasBombAt(sx + bot._fleeDir.dx, sy + bot._fleeDir.dy)) best = { d: bot._fleeDir, r: cur };
        }
        bot._fleeDir = best.d;
        stats.fleeMinimax = (stats.fleeMinimax || 0) + 1;
        go(best.d.dx, best.d.dy);
        return;
      }
      return; // already in danger: never place more bombs from here
    }

    // Drop a temporary barrier in a close pursuer's path, then flee along a
    // verified escape route that increases separation from that monster.
    if (typeof global !== 'undefined' && global.__BB_CHASE_BLOCK_BOMB && canPlace()) {
      const c = cell();
      const px = bot.x + c / 2, py = bot.y + c / 2;
      const chaseBlockRange = Number.isFinite(global.__BB_CHASE_BLOCK_RANGE)
        ? global.__BB_CHASE_BLOCK_RANGE : 2.5;
      const pursuer = live.find(m => {
        if (!(m.speed > 0) || !m.direction) return false;
        const mx = m.x + c / 2, my = m.y + c / 2;
        const toPlayerX = px - mx, toPlayerY = py - my;
        const distance = Math.hypot(toPlayerX, toPlayerY);
        if (distance > c * chaseBlockRange || distance < c * 0.8) return false;
        const forward = m.direction.dx * toPlayerX + m.direction.dy * toPlayerY;
        const lateral = Math.abs(m.direction.dx * toPlayerY - m.direction.dy * toPlayerX);
        return forward > 0 && lateral <= Math.max(c * 0.55, forward * 0.5);
      });
      if (pursuer && typeAt(sx, sy) === 0 && !bm.hasBombAt(sx, sy)) {
        const escape = getEscape(sx, sy);
        const first = escape && escape.path && escape.path[0];
        if (escape && first && !escapeCrossesMonster(escape)) {
          const toMonsterX = pursuer.x + c / 2 - px;
          const toMonsterY = pursuer.y + c / 2 - py;
          const escapeX = first.x - sx, escapeY = first.y - sy;
          if (-(toMonsterX * escapeX + toMonsterY * escapeY) > 0) {
            bot._ph = 'CHASEBLOCK';
            stats.chaseBlockBomb = (stats.chaseBlockBomb || 0) + 1;
            bot.aiInput.bomb = true;
            commitPath = escape.path;
            commitFrames = 0;
            return;
          }
        }
      }
    }

    // ---- 2. KILL: a live monster already in my CROSS line ----
    if (canPlace()) {
      const target = live.find(m => crossReaches(sx, sy, m.gridX, m.gridY, range()));
      if (target) {
        bot._ph = 'KILL';
        const esc = getEscape(sx, sy);
        if (esc && !escapeCrossesMonster(esc)) {
          stats.fired = (stats.fired || 0) + 1;
          bot.aiInput.bomb = true;
          commitPath = esc.path || [];   // follow the verified escape
          commitFrames = 0;
          return;
        }
        stats.killNoEsc = (stats.killNoEsc || 0) + 1; // aligned but no verified escape
        const whyK = classifyNoEsc(sx, sy, sx, sy);
        stats['noEsc_' + whyK] = (stats['noEsc_' + whyK] || 0) + 1;
      }
    }

    // ---- 2b. AMBUSH / DENIAL: fire ONLY IF the blast actually reaches the
    // monster or at least one of its 4 approach cells (lead prediction: a
    // chasing monster re-aims only at grid intersections, so it must cross
    // one of those cells to keep chasing). The old gate was a bare Chebyshev
    // <= 2 test, which anchored the bot next to POCKETED monsters (stuck in a
    // brick dead-end, never approaching) and spammed useless bombs there --
    // 25 wasted placements / 90s in trace seed #3 -> pure TIMEOUT.
    if (canPlace()) {
      let cellsNow = null;
      try { cellsNow = bot.getExplosionCells(sx, sy, range(), false, shape()); } catch (e) { cellsNow = null; }
      const near = live.find(m => {
        if (!cellsNow) return Math.abs(m.gridX - sx) <= 1 && Math.abs(m.gridY - sy) <= 1;
        if (cellsNow.has(key(m.gridX, m.gridY))) return true;
        return DIRS.some(d => cellsNow.has(key(m.gridX + d.dx, m.gridY + d.dy)));
      });
      // ---- No-anchoring guard: don't camp a POCKETED monster ---------------
      // A monster walled behind bricks (unreachable via huntWalk) never
      // approaches; bombing next to it every frame is pure TIMEOUT fuel
      // (trace: pocketed MIMIC → 6255 ambushNoEsc in one run). Only AMBUSH
      // reachable monsters; pocketed ones are BREACH/HUNT's job.
      if (near) {
        bot._ph = 'AMBUSH';
        const nearReach = firstStep((x, y) => x === near.gridX && y === near.gridY, 3, huntWalk);
        const esc = nearReach ? getEscape(sx, sy) : null;
        if (esc) {
          stats.ambush = (stats.ambush || 0) + 1;
          stats.fired = (stats.fired || 0) + 1;
          bot.aiInput.bomb = true;
          commitPath = esc.path || [];
          commitFrames = 0;
          return;
        }
        stats.ambushNoEsc = (stats.ambushNoEsc || 0) + 1;
        const why = classifyNoEsc(sx, sy, sx, sy);
        stats['noEsc_' + why] = (stats['noEsc_' + why] || 0) + 1;
        const engWhy = engineWhy(sx, sy);
        stats['eng_' + engWhy] = (stats['eng_' + engWhy] || 0) + 1;
      }
    }

    // ---- 2c. ARRIVAL AT A JOINT-SEARCHED BOMB CELL -------------------------
    // We repositioned to a cell the joint placement+escape search picked;
    // now execute the placement (re-verified this frame).
    if (canPlace() && rpTarget && rpTarget.x === sx && rpTarget.y === sy) {
      const esc = getEscape(sx, sy);
      if (esc) {
        stats.rpBomb = (stats.rpBomb || 0) + 1;
        stats.fired = (stats.fired || 0) + 1;
        bot.aiInput.bomb = true;
        commitPath = esc.path || [];
        commitFrames = 0;
        rpTarget = null;
        return;
      }
      rpTarget = null;                       // stale: re-plan later
    }

    // ---- 2d. REPOSITION-TO-BOMB: go stand where we CAN bomb them ----------
    // Fires when the current cell is not a viable placement (dead end / blast
    // too wide) but a nearby cell is both lethal and escapable.
    if (canPlace() && !(rpTarget && rpTarget.x === sx && rpTarget.y === sy)) {
      if (rpTarget && stats.thinks - rpFrame > 300) rpTarget = null;   // stale plan
      if (!rpTarget && stats.thinks - rpFrame >= 30) {
        rpFrame = stats.thinks;
        rpTarget = repositionToBomb(3);
      }
      if (rpTarget && rpTarget.first) {
        const nx = sx + rpTarget.first.dx, ny = sy + rpTarget.first.dy;
        if (okStepFull(nx, ny)) {
          bot._ph = 'REPOS';
          stats.repos = (stats.repos || 0) + 1;
          go(rpTarget.first.dx, rpTarget.first.dy);
          return;
        }
        rpTarget = null;                     // blocked: re-plan
      }
    }

    // Break toward an isolated monster only after the floor route has stalled
    // and the monster has not become closer through normal hunting.
    const pocketWalk = (x, y) => typeAt(x, y) === 0 &&
      !bm.hasBombAt(x, y) && !unsafe(x, y) && !monsterAdj(x, y);
    if (stats.thinks - pocketCheckThink >= 10) {
      pocketCheckThink = stats.thinks;
      stats.pkChecks = (stats.pkChecks || 0) + 1;
      const maxPocketLive = typeof global !== 'undefined' && Number.isFinite(global.__BB_POCKET_MAX_LIVE)
        ? global.__BB_POCKET_MAX_LIVE : 3;
      const isolated = live.length <= maxPocketLive
        ? live.filter(monster => !hasFloorPathTo(monster))
        : [];
      if (isolated.length) stats.pkIsolatedChecks = (stats.pkIsolatedChecks || 0) + 1;
      let nextTarget = null;
      let nextCost = Infinity;
      for (const monster of isolated) {
        const cost = targetPathCost(monster);
        if (cost < nextCost) {
          nextTarget = monster;
          nextCost = cost;
        }
      }

      if (live.length !== pocketMonsterCount || nextTarget !== pocketTarget) {
        pocketMonsterCount = live.length;
        pocketTarget = nextTarget;
        pocketBestCost = nextCost;
        pocketStuck = 0;
        pocketFailedBombs = 0;
        pocketLastFired = stats.fired || 0;
        pocketPlan = null;
      } else if (!nextTarget || !Number.isFinite(nextCost)) {
        pocketStuck = 0;
        pocketBestCost = nextCost;
        pocketPlan = null;
      } else if (nextCost + 0.1 < pocketBestCost) {
        pocketBestCost = nextCost;
        pocketStuck = 0;
        pocketFailedBombs = 0;
        pocketLastFired = stats.fired || 0;
        // Keep an active dig-site route while the bot's own position improves.
      } else {
        // A verified bomb escape is not target progress. Keep accumulating the
        // no-progress window while COMMIT is active, then act only after escape.
        pocketStuck += 10;
        stats.pkStuckMax = Math.max(stats.pkStuckMax || 0, pocketStuck);
        const fired = stats.fired || 0;
        if (typeof global !== 'undefined' && global.__BB_POCKET_BOMB_PROGRESS &&
            fired > pocketLastFired) {
          pocketFailedBombs += fired - pocketLastFired;
          pocketLastFired = fired;
        }
      }
    }

    const pocketProgressReady = typeof global !== 'undefined' && global.__BB_POCKET_BOMB_PROGRESS
      ? pocketFailedBombs >= 3 : pocketStuck > pocketStuckLimit;
    if (pocketDigEnabled && pocketTarget && (pocketProgressReady || pocketPlan) && !unsafe(sx, sy) &&
        commitPath.length === 0 && canPlace()) {
      const targetHasFloorPath = pocketPlan && hasFloorPathTo(pocketTarget);
      if (pocketPlan && (targetHasFloorPath || pocketTarget.isDead || !live.includes(pocketTarget) ||
          typeAt(pocketPlan.x, pocketPlan.y) !== 0 ||
          unsafe(pocketPlan.x, pocketPlan.y) || bm.hasBombAt(pocketPlan.x, pocketPlan.y))) {
        pocketPlan = null;
      }
      if (!pocketPlan && stats.thinks - pocketPlanThink >= 20) {
        pocketPlanThink = stats.thinks;
        stats.pkPlanSearches = (stats.pkPlanSearches || 0) + 1;
        pocketPlan = getSafeDigPlan(pocketTarget);
        const keyName = pocketPlan ? 'pkPlanFound' : 'pkPlanMiss';
        stats[keyName] = (stats[keyName] || 0) + 1;
      }
      if (pocketPlan) {
        if (sx === pocketPlan.x && sy === pocketPlan.y) {
          const escape = getEscape(sx, sy);
          const blast = bot.getExplosionCells(sx, sy, range(), false, shape());
          const removedBricks = new Set();
          if (blast) {
            for (const cellKey of blast) {
              const [bx, by] = cellKey.split(',').map(Number);
              if (isBrick(bx, by)) removedBricks.add(cellKey);
            }
          }
          const improvesRoute = removedBricks.size > 0 &&
            targetPathCost(pocketTarget, removedBricks) < targetPathCost(pocketTarget);
          if (escape && !escapeCrossesMonster(escape) && improvesRoute && canPlace()) {
            bot._ph = 'PKDIG';
            stats.pkDig = (stats.pkDig || 0) + 1;
            bot.aiInput.bomb = true;
            commitPath = escape.path || [];
            commitFrames = 0;
            pocketPlan = null;
            pocketStuck = 0;
            return;
          }
          pocketPlan = null;
        } else {
          const stepToSite = firstStep(
            (x, y) => x === pocketPlan.x && y === pocketPlan.y,
            1,
            pocketWalk
          );
          if (stepToSite && !monsterAdj(sx + stepToSite.dx, sy + stepToSite.dy)) {
            bot._ph = 'PKGO';
            stats.pkGo = (stats.pkGo || 0) + 1;
            go(stepToSite.dx, stepToSite.dy);
            return;
          }
          pocketPlan = null;
        }
      }
    }

    // ---- 3. HUNT / BREACH: step toward nearest reachable monster ----
    // Pathing routes THROUGH soft bricks (cost 3) because a monster walled off
    // behind bricks is only reachable by bombing a corridor open. When the next
    // cell is a soft brick, the bot is adjacent to the wall: BREACH it by
    // bombing its OWN cell (the cross destroys the adjacent brick) if a verified
    // escape exists. CRITICAL: never press INTO a brick — that is the freeze bug
    // (the bot stalls against the wall forever, 83% of survivors are walled off).
    // If we cannot breach from THIS cell (no escape within fuse), reposition to a
    // neighbouring floor cell that is also wall-adjacent and retry next frame.
    const step = nearestReachable();
    if (!step) stats.huntNull = (stats.huntNull || 0) + 1;
    if (step) {
      const onBrick = isBrick(step.x, step.y);
      if (onBrick) {
        bot._ph = 'BREACH';
        if (canPlace()) {
          const esc = getEscape(sx, sy);
          if (esc) {
            stats.breach = (stats.breach || 0) + 1;
            stats.fired = (stats.fired || 0) + 1;
            bot.aiInput.bomb = true;
            commitPath = esc.path || [];
            commitFrames = 0;
            return;
          }
        }
        // Cannot breach from here: reposition to a safe floor neighbour that is
        // still adjacent to a wall brick (progress toward a breachable cell).
        let spot = null;
        for (const d of DIRS) {
          const nx = sx + d.dx, ny = sy + d.dy;
          if (!walkable(nx, ny) || isBrick(nx, ny)) continue;
          if (bm.hasBombAt(nx, ny) || unsafe(nx, ny)) continue;
          if (DIRS.some(d2 => isBrick(nx + d2.dx, ny + d2.dy))) { spot = d; break; }
        }
        if (spot) { go(spot.dx, spot.dy); return; }
        // else fall through to safe anti-freeze (do NOT enter the brick)
      } else {
        bot._ph = 'HUNT';
        // Avoid cells adjacent to moving monsters as well as occupied cells.
        // Pursuing into an adjacent cell can collide mid-transition when both
        // the bot and monster move toward each other; WANDER applies this same
        // veto and can choose a safe approach angle instead.
        if (monsterAdj(sx + step.dx, sy + step.dy)) {
          stats.huntHold = (stats.huntHold || 0) + 1;
        } else if (unsafe(sx + step.dx, sy + step.dy) && !isBrick(step.x, step.y)) {
          // HUNT blast veto: never chase INTO a live/known blast cell. If the
          // immediate pursuit step is covered, fall through to safe WANDER.
          stats.huntUnsafe = (stats.huntUnsafe || 0) + 1;
        } else {
          stats.approach = (stats.approach || 0) + 1;
          go(step.dx, step.dy);
          return;
        }
      }
    }

    // When combat has no safe progress step, collect nearby upgrades that improve
    // survivability or attack capacity; ignore harmful and purely situational drops.
    const itemValues = {
      FIRE: 4, SUPER_FIRE: 5, BOMB: 4, DOUBLE_BOMB: 5, TRIPLE_BOMB: 5,
      SUPER_BOMB: 5, SPEED: 4, SUPER_SPEED: 5, SHIELD: 5, INVINCIBLE: 5,
      PHOENIX: 5, LIFE_UP: 5, HEAL: 4, PIERCE: 3, DIAGONAL_FIRE: 3,
      CROSS_FIRE: 5,
    };
    const items = (bot.itemManager && bot.itemManager.items) || [];
    let itemGoal = null;
    let itemScore = -Infinity;
    for (const item of items) {
      const value = itemValues[item.type] || 0;
      if (!value) continue;
      const distance = Math.abs(item.gridX - sx) + Math.abs(item.gridY - sy);
      if (distance > 6) continue;
      const score = value * 3 - distance;
      if (score > itemScore) {
        itemGoal = item;
        itemScore = score;
      }
    }
    const shouldPursueItem = hasMate() || (typeof global !== 'undefined' &&
      global.__BB_HUNT_ITEMS_SINGLE);
    if (shouldPursueItem && itemGoal) {
      const stepToItem = firstStep(
        (x, y) => x === itemGoal.gridX && y === itemGoal.gridY,
        1,
        (x, y) => typeAt(x, y) === 0 && !unsafe(x, y) &&
          !bm.hasBombAt(x, y) && !monsterAdj(x, y)
      );
      if (stepToItem && !monsterAdj(sx + stepToItem.dx, sy + stepToItem.dy)) {
        bot._ph = 'ITEM';
        go(stepToItem.dx, stepToItem.dy);
        return;
      }
    }

    // ---- 4. ANTI-FREEZE: nudge toward any SAFE, walkable, bomb-free neighbour
    // Two vetoes (both measured win-rate positive):
    //  (a) MONSTER VETO — never step onto a cell a live monster occupies or is
    //      mid-transition into (contact = -1/3hp + 2s shield; three contacts
    //      = death). 8/30 stage-1 deaths were pure contact while WANDERing.
    //  (b) BLAST VETO — never step into a live bomb's blast; only fall back to
    //      a merely-LESS-covered cell if staying put is itself covered.
    bot._ph = 'WANDER';
    let cand = DIRS.filter(d => walkable(sx + d.dx, sy + d.dy) && !bm.hasBombAt(sx + d.dx, sy + d.dy) && !monsterAdj(sx + d.dx, sy + d.dy) && !unsafe(sx + d.dx, sy + d.dy));
    if (!cand.length) {
      // Nothing fully safe to step onto. Only move if it is STRICTLY better
      // than standing still -- if the cell we are on is blast-free, staying
      // put beats stepping into a covered neighbour (this was 87 ownFire
      // deaths: the minimax term happily traded a safe cell for a merely
      // "less covered" one).
      let best = null;
      for (const d of DIRS) {
        const nx = sx + d.dx, ny = sy + d.dy;
        if (!inBounds(nx, ny) || isWall(nx, ny) || isBrick(nx, ny) || bm.hasBombAt(nx, ny)) continue;
        const r = riskAt(nx, ny);
        if (r.cover === 100) continue;
        if (!best || r.cover < best.r.cover ||
            (r.cover === best.r.cover && r.earliest > best.r.earliest)) best = { d, r };
      }
      const here = riskAt(sx, sy);
      if (best && best.r.cover < here.cover) {
        stats.wanderMinimax = (stats.wanderMinimax || 0) + 1;
        go(best.d.dx, best.d.dy);
      }
      return;
    }
    if (cand.length) {
      // Stable anti-freeze: don't rotate the chosen neighbour every frame
      // (that was the freeze bug once stats.wander became a real number).
      // Prefer the candidate that gets us closer to the nearest live monster,
      // then keep momentum when it is equally good.
      const anchor = live.reduce((best, m) => {
        if (!best) return m;
        const bd = Math.abs(best.gridX - sx) + Math.abs(best.gridY - sy);
        const md = Math.abs(m.gridX - sx) + Math.abs(m.gridY - sy);
        return md < bd ? m : best;
      }, null);
      const distTo = (d) => {
        if (!anchor) return 0;
        const nx = sx + d.dx, ny = sy + d.dy;
        return Math.abs(anchor.gridX - nx) + Math.abs(anchor.gridY - ny);
      };
      const anchorDist = anchor ? Math.abs(anchor.gridX - sx) + Math.abs(anchor.gridY - sy) : 999;
      let pick = anchor
        ? cand.reduce((best, d) => (!best || distTo(d) < distTo(best)) ? d : best, null)
        : cand[0];
      if (typeof global !== 'undefined' && global.__BB_RISK_SCORE) {
        const horizon = 0.35;
        const c = cell();
        const scoreMove = (d) => {
          const nx = sx + d.dx, ny = sy + d.dy;
          const progress = anchor
            ? Math.abs(anchor.gridX - sx) + Math.abs(anchor.gridY - sy) -
              (Math.abs(anchor.gridX - nx) + Math.abs(anchor.gridY - ny))
            : 0;
          let risk = 0;
          for (const m of live) {
            if (!(m.speed > 0) || !m.direction) continue;
            const mx = m.x + c / 2 + m.direction.dx * m.speed * c * horizon;
            const my = m.y + c / 2 + m.direction.dy * m.speed * c * horizon;
            const px = (gs.offsetX || 0) + nx * c + c / 2;
            const py = (gs.offsetY || 0) + ny * c + c / 2;
            const separation = Math.hypot(mx - px, my - py) / c;
            risk += Math.max(0, 1.5 - separation);
          }
          return progress * 2 - risk * 1.5;
        };
        pick = cand.reduce((best, d) => !best || scoreMove(d) > scoreMove(best) ? d : best, null);
      }
      let retreatPick = null;
      if (typeof global !== 'undefined' && global.__BB_KITE_ADJACENT) {
        const threats = live.filter(m => m.speed > 0);
        const threatDist = (x, y) => threats.length
          ? Math.min(...threats.map(m => Math.abs(m.gridX - x) + Math.abs(m.gridY - y)))
          : Infinity;
        const currentThreatDist = threatDist(sx, sy);
        if (currentThreatDist <= 1) {
          const retreat = cand.reduce((best, d) => {
            const distance = threatDist(sx + d.dx, sy + d.dy);
            return !best || distance > best.distance ? { d, distance } : best;
          }, null);
          if (retreat && retreat.distance > currentThreatDist) retreatPick = retreat.d;
        }
      }
      const prev = bot._wanderDir && cand.find(d => d.dx === bot._wanderDir.dx && d.dy === bot._wanderDir.dy);
      if (prev && (!anchor || distTo(prev) <= distTo(pick))) pick = prev;
      if (retreatPick) {
        pick = retreatPick;
        stats.kiteAdjacent = (stats.kiteAdjacent || 0) + 1;
      }
      // 高密度闢場（>=7 隻活怪）：診斷（bb-hdtrace）顯示死因幾乎全是「怪物接觸」。
      // 改為「拉開與最近怪的距離」的走位——讓怪追進自己的十字線，交給 KILL 分支處決，
      // 而不是擠進怪群。低密度關維持原「朝最近怪近身獵殺」（實測近身更優），故此處只在
      // >=7 時覆寫，s1-7（<=6 隻）完全不受影響。
      // 高密度闢場・僅 COOP（有存活隊友時）啟用「最大化與最近怪距離」的走位：
      // 診斷（bb-hdtrace）顯示高密度關死因幾乎全是怪物接觸；雙人可分工（一隻拉風箏、
      // 一隻輸出），持續拉開距離能大幅降低接觸死亡。單人模式無隊友分擔輸出，只逃不殺
      // 會反而變差，故以 hasMate() 排除——單人模式此段完全不作用、維持基線策略。
      // 僅「非 BOSS 關 + COOP + 高密度」啟用：BOSS 關必須清光全部小怪並打龍王，純拉風箏
      // 會拖慢清怪（實測 COOP s10/s30 因此退化），故有龍王時排除、維持 aggressive 清怪基線。
      const bossAlive = !!(mo.boss && !mo.boss.isDead);
      if (live.length >= 7 && hasMate() && !bossAlive) {
        const sep = cand.reduce((best, d) =>
          (!best || nearestMonsterDist(sx + d.dx, sy + d.dy) > nearestMonsterDist(sx + best.dx, sy + best.dy)) ? d : best, null);
        if (sep) pick = sep;
      }
      bot._wanderDir = pick;
      stats.wander = (stats.wander || 0) + 1;
      go(pick.dx, pick.dy);
    }
  };

  // ===== CONTROL AUTHORITY: neutralise the legacy override layer ============
  // Bot.update() runs holdCentering / vetoUnsafeBombPlacement /
  // ensureSomeAction / breakOutOfStall AFTER think(), and rewrites aiInput.
  // Frame tracing (bb-hs HSTRACE, death at t=52.5) proved this is THE chatter
  // generator: our policy presses RIGHT (commit path), holdCentering presses
  // LEFT, and the sprite oscillates px 506<->513 forever with net displacement
  // zero -- the bot never completes its "verified" escape and dies in its own
  // blast with 1 waypoint left. Our policy already does its own centering
  // (go), its own stall handling (ANTI-FREEZE) and its own placement gate
  // (canSafelyPlaceBomb + robustness margin), so the legacy layer may only
  // corrupt the decisions. Take the controls.
  bot.needsCentering = () => false;
  bot.vetoUnsafeBombPlacement = () => {};
  bot.ensureSomeAction = () => {};
  bot.breakOutOfStall = () => false;
  bot.forceMoveIfPossible = () => false;
  bot.enforceExclusiveAxes = () => {};
  bot.holdCentering = () => {};
  bot.targetPath = [];      // never let followPath() hijack our movement
}
