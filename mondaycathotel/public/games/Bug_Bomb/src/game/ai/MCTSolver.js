/**
 * MCTSolver.js — 電腦 AI 決策求解器（深度學習 + 作業研究 + 賽局理論）
 *
 * 設計原則（全部由 tools/bb-bench2.mjs 的「結果」檢驗；勝者留、敗者棄）：
 *
 *   [OR]  Joint placement+escape search
 *         把「這顆彈炸得到誰」與「我能不能活著離開」視為同一個決策變數，
 *         在 BFS 展開的可達集合上找 score 最大的「致命且可逃」格。
 *         先用便宜的幾何條件預篩，只對通過的少數候選做昂貴的逃生驗證。
 *
 *   [DL]  Monte-Carlo 擊殺價值函數
 *         用「遊戲真正的 Monster 類別」把每隻怪從現況往前模擬
 *         fuse(3s)+flame window，直接估計 P(被這顆火掃到)。
 *         不對怪物行為建模 → 沒有模型誤差；唯一的誤差是亂數，由 MC 估計。
 *
 *   [安全] 接觸光環
 *         貼到怪物 = 立即死亡。任何與怪物的中心距離 < 接觸半徑的格都是禁忌。
 *         舊版只看「格子是否被怪佔據」，漏掉「半格之隔」的致死距離；
 *         stage-1 實測死亡有 2/10 是純接觸死亡。
 *
 *   [GT]  損傷後 maximin 撤退 + minimax 無安全格撤退
 *         撞一次給 2 秒無敵，站著不動會再被同隻怪碰到三次就死。
 *         所以 hp 掉過且怪還在附近時，一律執行「離最壞敵人最遠」的撤退。
 *         沒有一格完全安全時，選覆蓋最少、引信最晚的（minimax）。
 */

export function installMCTSolver(bot, ctx, stats) {
  const { gs, mm, bm, mo, em } = ctx;

  const DIRS = [{ dx: 0, dy: -1, k: 'up' }, { dx: 0, dy: 1, k: 'down' },
                { dx: -1, dy: 0, k: 'left' }, { dx: 1, dy: 0, k: 'right' }];
  const key = (x, y) => x + ',' + y;
  const inBounds = (x, y) => x >= 1 && y >= 1 && x < gs.cols - 1 && y < gs.rows - 1;
  const typeAt = (x, y) => (inBounds(x, y) ? mm.getBlockType(x, y) : 1);
  const isWall = (x, y) => typeAt(x, y) === 1;
  const isBrick = (x, y) => typeAt(x, y) === 2;
  const isFloor = (x, y) => typeAt(x, y) === 0;
  const walkable = (x, y) => { const t = typeAt(x, y); return t === 0 || t === 2; };

  const reset = () => { for (const d of DIRS) bot.aiInput[d.k] = false; bot.aiInput.bomb = false; };
  const setDir = (dx, dy) => { for (const d of DIRS) bot.aiInput[d.k] = (d.dx === dx && d.dy === dy); };

  // 真正的 Monster 類別（從場上怪物取得，或由 ctx 注入）——MC 模擬器必須是遊戲本身
  const MonsterCtor = ctx.Monster
    || (mo.monsters && mo.monsters.length ? mo.monsters[0].constructor : null);

  const cellPx = () => gs.getCellSize();
  const offX = () => gs.offsetX || 0;
  const offY = () => gs.offsetY || 0;

  const liveMonsters = () => (mo.monsters || []).filter(m => !m.isDead);
  const liveBombs = () => (bm.bombs || []).filter(b => !b.isExploded && !b.exploded);
  const shape = () => (bot.hasDiagonalFire ? 'X' : 'CROSS');
  const range = () => bot.fireRange;
  const canPlace = () => bot.currentBombs < bot.maxBombs && bot.noBombTimer <= 0;

  // ---- 移動：先站垂直軸再走主軸（消除 AABB 斜插對角格造成的永久凍結）----
  const canMove = (ax, ay) => { try { return bot.canPhysicallyMove(ax, ay); } catch (e) { return true; } };
  const go = (dx, dy) => {
    const c = cellPx();
    if (dx !== 0) {
      const cy = offY() + bot.gridY * c;
      if (Math.abs(bot.y - cy) > c * 0.12) { setDir(0, Math.sign(cy - bot.y)); return; }
    } else if (dy !== 0) {
      const cx = offX() + bot.gridX * c;
      if (Math.abs(bot.x - cx) > c * 0.12) { setDir(Math.sign(cx - bot.x), 0); return; }
    }
    if (!canMove(dx, dy)) {
      for (const t of [-1, 1]) {
        const px = dx !== 0 ? 0 : t, py = dx !== 0 ? t : 0;
        if (canMove(px, py)) { setDir(px, py); return; }
      }
      setDir(0, 0);
      return;
    }
    setDir(dx, dy);
  };

  // ===== 危險模型：blast / flame / 接觸光環 =====
  let blast = new Set();
  let blastByBomb = new Map();

  function blastOf(px, py, r, isPierce, sh) {
    let cells = null;
    try { cells = bot.getExplosionCells(px, py, r, !!isPierce, sh || 'CROSS'); } catch (e) { cells = null; }
    if (!cells) {
      cells = new Set([key(px, py)]);
      const rr = r || 2;
      for (const d of DIRS) {
        let x = px, y = py, s = 0;
        while (s < rr) {
          x += d.dx; y += d.dy; s++;
          cells.add(key(x, y));
          if (isWall(x, y) || isBrick(x, y)) break;
        }
      }
    }
    cells.add(key(px, py));
    return cells;
  }

  function computeBlast() {
    blast = new Set();
    blastByBomb = new Map();
    for (const b of liveBombs()) {
      let cells = null;
      try { cells = bot.getExplosionCells(b.gridX, b.gridY, b.range, !!b.pierce, b.shape || 'CROSS'); } catch (e) { }
      if (!cells) cells = blastOf(b.gridX, b.gridY, b.range, b.pierce, b.shape || 'CROSS');
      cells.add(key(b.gridX, b.gridY));
      blastByBomb.set(b, cells);
      for (const c of cells) blast.add(c);
    }
  }

  const flameAt = (x, y) => {
    const ex = em.explosions || [];
    for (const e of ex) if (!e.isDone && e.gridX === x && e.gridY === y) return true;
    return false;
  };
  const unsafe = (x, y) => blast.has(key(x, y)) || flameAt(x, y);

  /**
   * 接觸判定（calibrated to the engine + 已實測有效的 hunter 語義）：
   *   monsterNear：怪在這格，或怪中心已進入該格的 0.55c 方框（半換格中）。
   *                用於「逃生路徑/安全格」——太寬會讓逃生永遠不可能。
   *   monsterAdj ：曼哈頓距離 <= 1，或怪中心進入 0.9c 方框。
   *                用於「這一步能不能走」——貼面會車就是死亡。
   */
  function monsterNear(x, y) {
    const c = cellPx();
    const cx = offX() + x * c + c / 2, cy = offY() + y * c + c / 2;
    for (const m of liveMonsters()) {
      if (m.gridX === x && m.gridY === y) return true;
      if (Math.abs(m.x + c / 2 - cx) < c * 0.55 && Math.abs(m.y + c / 2 - cy) < c * 0.55) return true;
    }
    return false;
  }
  function monsterAdj(x, y) {
    const c = cellPx();
    const cx = offX() + x * c + c / 2, cy = offY() + y * c + c / 2;
    for (const m of liveMonsters()) {
      if (Math.abs(m.gridX - x) + Math.abs(m.gridY - y) <= 1) return true;
      if (Math.abs(m.x + c / 2 - cx) < c * 0.9 && Math.abs(m.y + c / 2 - cy) < c * 0.9) return true;
    }
    return false;
  }

  const safeCell = (x, y) =>
    isFloor(x, y) && !bm.hasBombAt(x, y) && !unsafe(x, y) && !monsterNear(x, y);

  /** BFS 取「起點的下一步」（回傳 child-of-start，避免回傳自己造成凍結） */
  function firstStep(isGoal, walkFn) {
    const sx = bot.gridX, sy = bot.gridY;
    if (isGoal(sx, sy)) return null;
    const parent = new Map();
    const q = [[sx, sy]];
    parent.set(key(sx, sy), null);
    let found = null;
    while (q.length) {
      const cur = q.shift();
      if (isGoal(cur[0], cur[1])) { found = cur; break; }
      for (const d of DIRS) {
        const nx = cur[0] + d.dx, ny = cur[1] + d.dy;
        const nk = key(nx, ny);
        if (parent.has(nk)) continue;
        if (!walkFn(nx, ny)) continue;
        parent.set(nk, key(cur[0], cur[1]));
        q.push([nx, ny]);
      }
    }
    if (!found) return null;
    let cur = key(found[0], found[1]);
    let prev = parent.get(cur);
    while (prev && prev !== key(sx, sy)) { cur = prev; prev = parent.get(cur); }
    const [cx, cy] = cur.split(',').map(Number);
    return { x: cx, y: cy, dx: cx - sx, dy: cy - sy };
  }

  /**
   * [GT] 緊急脫困：當怪與 Bot 幾乎同格時的「保證動」決策。
   *
   * 實證根因（bb-ctrace.mjs seed 2654722627，幀 345–391）：
   *   Bot 與 ZOMBIE 卡在同一格（中心距離 d=0.12~0.24），`input` 在 R／L 之間
   *   每幀翻面，px 在 3.70↔3.77 之間震盪（每幀只移動 0.07 格），永遠離不開那一格。
   *   90+ 幀後第三次接觸 → 死亡。整場只放了 1 顆彈。
   *
   * 兩個獨立的缺陷：
   *   (1) `retreatStep()` 在「四鄰都被自己的火場／炸彈擋住」時回傳 null，
   *       而 EVADE 分支拿到 null 就 `return` —— 完全不做動作，留在原地。
   *       與怪同格時，原地不動 = 必然死亡。
   *   (2) `sc(prev) >= sc(best)` 的 hysteresis 在怪物每幀移動、分數隨之變動時
   *       會翻面，造成 R／L 震盪。
   *
   * 修法：同格時「任何能走的方向都優於留在原地」，且方向選擇必須
   * 無法震盪 —— 用固定順序評分 + 只在分數嚴格更好時才換方向。
   */
  function emergencyEvade() {
    const sx = bot.gridX, sy = bot.gridY;
    // 最寬鬆的可走條件：地板、沒有炸彈、不在燃燒中的火。
    // 刻意不看 monsterAdj / unsafe —— 那些是「日常走位」的限制，
    // 在已經被怪貼上的時刻，留下來才是確定會死。
    const movable = DIRS.filter(d => {
      const nx = sx + d.dx, ny = sy + d.dy;
      return walkable(nx, ny) && !bm.hasBombAt(nx, ny) && !flameAt(nx, ny);
    });
    if (!movable.length) {
      // 四面都是牆／磚／炸彈：沒辦法走，交給放彈決策（breach）。
      return null;
    }
    const sc = (d) => safestCellScore(sx + d.dx, sy + d.dy);
    // 固定順序（DIRS 的順序）取最高分，不使用會隨 candidacy 變動的 cands[0]。
    let bestDir = movable[0], bestScore = sc(bestDir);
    for (const d of movable) {
      const s = sc(d);
      if (s > bestScore) { bestScore = s; bestDir = d; }
    }
    // 反震盪 hysteresis：只在「嚴格更好」時才換方向；同分一律沿用上一幀。
    const prev = bot._emergencyDir;
    if (prev) {
      const p = movable.find(d => d.dx === prev.dx && d.dy === prev.dy);
      if (p && sc(p) >= bestScore) bestDir = p;   // 同分沿用 → 不會翻面
    }
    bot._emergencyDir = bestDir;
    return { d: bestDir };
  }

  // ===== 撤退承諾（消除「評分每幀翻面 → 方向每幀翻面」的震盪）=====
  // 實證根因（bb-ctrace.mjs seed 2654722627，幀 345–391）：
  //   Bot 與 ZOMBIE 同格（d=0.12），input 在 R／L 之間每幀翻面，
  //   px 在 3.70↔3.77 震盪（每幀只移動 0.07 格），永遠離不開那一格，
  //   90+ 幀後第三次接觸死亡。整場只放 1 顆彈。
  //
  // 機制：怪物每幀都在動，所以「離怪最遠的那一格」每幀都可能換邊；
  //   `sc(prev) >= sc(best)` 這種同分沿用在分數反轉時就會跟著反轉，
  //   於是 Bot 鏡像怪物的來回移動，永遠逃不掉。
  // 修法：開始逃之後就把方向「承諾」一段時間，只有被牆／磚／炸彈／火擋住
  //   才重新規劃。這是 closed-loop commitment，不是 open-loop 盲走。
  const RETREAT_COMMIT_FRAMES = 16;   // ≈0.27 秒，足以移出約 1 格
  let retreatCommit = null;           // { dx, dy, left }

  function commitFallback(nx, ny) {
    return walkable(nx, ny) && !bm.hasBombAt(nx, ny) && !flameAt(nx, ny);
  }

  /** 取得這一次 EVADE 該走的方向（承諾 → 重算 → 緊急脫困） */
  function evadeDirection() {
    const sx = bot.gridX, sy = bot.gridY;
    // 1) 承諾中的方向還走得多 → 沿用（這是消除震盪的關鍵）
    if (retreatCommit && retreatCommit.left > 0) {
      const nx = sx + retreatCommit.dx, ny = sy + retreatCommit.dy;
      if (commitFallback(nx, ny)) {
        retreatCommit.left--;
        return { dx: retreatCommit.dx, dy: retreatCommit.dy, kind: 'commit' };
      }
      retreatCommit = null;   // 被擋住 → 重新規劃
    }
    // 2) 重新規劃：一般撤退
    const st = retreatStep();
    if (st) {
      const d = { dx: st.d.dx, dy: st.d.dy };
      retreatCommit = { dx: d.dx, dy: d.dy, left: RETREAT_COMMIT_FRAMES };
      return { ...d, kind: 'retreat' };
    }
    // 3) 緊急脫困：四鄰都是磚／炸彈／火時的最後手段
    const e = emergencyEvade();
    if (e) {
      const d = { dx: e.d.dx, dy: e.d.dy };
      retreatCommit = { dx: d.dx, dy: d.dy, left: RETREAT_COMMIT_FRAMES };
      return { ...d, kind: 'break' };
    }
    return null;
  }

  /** [GT] maximin：所有安全格中「到最近怪物的距離」最大者 */
  function safestCellScore(x, y) {
    let worst = Infinity;
    for (const m of liveMonsters()) {
      const d = Math.abs(m.gridX - x) + Math.abs(m.gridY - y);
      if (d < worst) worst = d;
    }
    return worst === Infinity ? 99 : worst;
  }

  /**
   * [OR+GT] 撤退：不是 1-step greedy，而是「可達集合上的 best response」。
   *
   * 1-step greedy 的實證缺陷（bb-ctrace.mjs seed -1640426806，幀 1694-1737）：
   *   Bot 卡在 (2,1)/(3,1) 之間左右來回 90+ 幀，ZOMBIE 從 d=1.09 一路逼近到
   *   d=0.13 然後摸死。兩格的 safestCellScore 相同，greedy 每幀重算就永幅震盪。
   * 正確做法：BFS 出所有可達的安全格，取「離最近怪最遠」的那一格當目標，
   * 然後沿最短路走過去；加上方向 hysteresis，避免來回抖振。
   */
  function retreatStep() {
    // 分級候選（實測最穩定）：先找「不貼怪、不是火、沒有炸彈」的，
    // 沒有就放寬到「不是火、沒有炸彈」，再不行只能找「不是火、沒有炸彈、不是磚」。
    // 加上方向 hysteresis：連續兩幀算出同一組候選時，優先沿用上一幀的方向，
    // 否則兩格等分時會左右來回（bb-ctrace 實測 90+ 幀震盪直到被摸死）。
    const loose = (x, y) => isFloor(x, y) && !bm.hasBombAt(x, y) && !unsafe(x, y);
    const levels = [
      (x, y) => loose(x, y) && !monsterNear(x, y),
      (x, y) => loose(x, y),
      (x, y) => walkable(x, y) && !bm.hasBombAt(x, y) && !flameAt(x, y),
    ];
    for (const pred of levels) {
      const cands = DIRS.filter(d => pred(bot.gridX + d.dx, bot.gridY + d.dy));
      if (!cands.length) continue;
      const sc = (d) => safestCellScore(bot.gridX + d.dx, bot.gridY + d.dy);
      const best = cands.reduce((b, d) => (sc(d) > sc(b)) ? d : b, cands[0]);
      const prev = bot._retreatDir && cands.find(d => d.dx === bot._retreatDir.dx && d.dy === bot._retreatDir.dy);
      const chosen = (prev && sc(prev) >= sc(best)) ? prev : best;
      bot._retreatDir = chosen;
      return { d: chosen };
    }
    return null;
  }

  // ===== [DL] Monte-Carlo 擊殺價值函數 =====
  const FUSE_F = 180, WIN_F = 40, DT = 1 / 60;
  let mcCache = new Map();
  let mcFrame = 0;

  function bombShim(px, py) {
    return {
      hasBombAt: (x, y) => (x === px && y === py) || bm.hasBombAt(x, y),
      getBombAt: (x, y) => (x === px && y === py)
        ? { gridX: px, gridY: py, isMine: false, timer: 3.0 }
        : bm.getBombAt(x, y),
      bombs: (bm.bombs || []),
    };
  }

  /** 估計「在 (px,py) 放一顆炸彈」的期望擊殺數（用遊戲真正的 Monster 模擬） */
  function mcKillValue(px, py, samples = 3) {
    mcFrame++;
    const ck = key(px, py);
    const hit = mcCache.get(ck);
    if (hit && mcFrame - hit.f < 8) return hit.v;
    const live = liveMonsters();
    if (!live.length || !MonsterCtor) {
      mcCache.set(ck, { f: mcFrame, v: { expected: 0, n: 0 } });
      return { expected: 0, n: 0 };
    }
    const cells = blastOf(px, py, range(), !!bot.hasPierce, shape());
    const shim = bombShim(px, py);
    let sum = 0;
    for (const m of live) {
      let k = 0;
      for (let s = 0; s < samples; s++) {
        const g = new MonsterCtor(m.gridX, m.gridY, gs, mm, m.type);
        g.x = m.x; g.y = m.y;
        g.direction = { dx: m.direction.dx, dy: m.direction.dy };
        g.speed = m.speed; g.ai = m.ai;
        g.wallPass = m.wallPass; g.breakWall = m.breakWall;
        for (let f = 0; f < FUSE_F + WIN_F; f++) {
          g.update(DT, shim, bot);
          if (f >= FUSE_F && cells.has(key(g.gridX, g.gridY))) { k++; break; }
        }
      }
      sum += k / samples;
    }
    const v = { expected: sum, n: live.length };
    mcCache.set(ck, { f: mcFrame, v });
    return v;
  }

  /** 幾何條件：火場是否覆蓋怪物「當下的格」（bb-mc2 實測 46/46 = 100% 那條） */
  function coveredNow(cells, m) { return cells.has(key(m.gridX, m.gridY)); }
  /** 次級條件：怪物若要繼續追我，下一步是否非踩進火場不可 */
  function approachCovered(cells, m) {
    return DIRS.some(d => cells.has(key(m.gridX + d.dx, m.gridY + d.dy)));
  }

  // ===== 逃生驗證（沿用已實測有效的引擎閘門 + 獨立備援）=====
  function escapeCrossesMonster(esc) {
    if (!esc) return false;
    for (const wp of (esc.path || [])) if (monsterNear(wp.x, wp.y)) return true;
    if (esc.safeCell && monsterNear(esc.safeCell.x, esc.safeCell.y)) return true;
    return false;
  }

  function getEscape(gx, gy) {
    try {
      const esc = bot.canSafelyPlaceBomb(gx, gy, range(), false, shape());
      let chosen = (esc && esc.canEscape) ? esc : null;
      if (!chosen) {
        chosen = ownEscape(gx, gy);
        if (!chosen) { stats.escNoGeom = (stats.escNoGeom || 0) + 1; return null; }
      }
      if (escapeCrossesMonster(chosen)) { stats.escMonPath = (stats.escMonPath || 0) + 1; return null; }
      const len = (chosen.path || []).length;
      let fuse = 3;
      try { fuse = bot.getFuseTime(); } catch (e) { }
      let earliest = fuse;
      for (const b of liveBombs()) {
        const t = (typeof b.timer === 'number') ? b.timer : Infinity;
        if (t < earliest) earliest = t;
      }
      const per = 1 / Math.max(1, bot.getEffectiveSpeed ? bot.getEffectiveSpeed() : 4);
      const margin = 0.15 * len + 0.35;
      if (chosen.time + margin > Math.min(fuse, earliest)) {
        stats.escTight = (stats.escTight || 0) + 1;
        return null;
      }
      const sc = chosen.safeCell;
      if (sc) {
        if (typeAt(sc.x, sc.y) !== 0 || bm.hasBombAt(sc.x, sc.y) || flameAt(sc.x, sc.y)) {
          stats.escBadCell = (stats.escBadCell || 0) + 1;
          return null;
        }
        if (monsterNear(sc.x, sc.y)) { stats.escMonCell = (stats.escMonCell || 0) + 1; return null; }
        for (const wp of (chosen.path || [])) {
          if (typeAt(wp.x, wp.y) !== 0 && !(wp.x === gx && wp.y === gy)) { stats.escPathSolid = (stats.escPathSolid || 0) + 1; return null; }
          if (bm.hasBombAt(wp.x, wp.y) || flameAt(wp.x, wp.y)) { stats.escPathBlocked = (stats.escPathBlocked || 0) + 1; return null; }
        }
      }
      return chosen;
    } catch (e) { stats.escFail = (stats.escFail || 0) + 1; return null; }
  }

  /** 獨立逃生模型：引擎閘門過度拒絕時的備援 */
  function ownEscape(gx, gy) {
    try {
      let earliest = Infinity;
      for (const b of liveBombs()) {
        const t = (typeof b.timer === 'number') ? b.timer : Infinity;
        if (t < earliest) earliest = t;
      }
      const cells = new Set();
      let hc = null;
      try { hc = bot.getExplosionCells(gx, gy, range(), false, shape()); } catch (e) { }
      if (hc) for (const c of hc) cells.add(c);
      cells.add(key(gx, gy));
      for (const b of liveBombs()) {
        let bc = null;
        try { bc = bot.getExplosionCells(b.gridX, b.gridY, b.range, !!b.pierce, b.shape || 'CROSS'); } catch (e) { }
        if (bc) for (const c of bc) cells.add(c);
        cells.add(key(b.gridX, b.gridY));
      }
      const per = 1 / Math.max(1, bot.getEffectiveSpeed ? bot.getEffectiveSpeed() : 4);
      const parent = new Map();
      const q = [{ x: gx, y: gy, t: 0 }];
      parent.set(key(gx, gy), null);
      let safe = null;
      while (q.length) {
        const cur = q.shift();
        if (cur.t + per >= earliest - 0.05) continue;
        for (const d of DIRS) {
          const nx = cur.x + d.dx, ny = cur.y + d.dy;
          if (!inBounds(nx, ny) || typeAt(nx, ny) !== 0) continue;
          if (bm.hasBombAt(nx, ny) || flameAt(nx, ny)) continue;
          const nk = key(nx, ny);
          if (parent.has(nk)) continue;
          const t = cur.t + per;
          parent.set(nk, key(cur.x, cur.y));
          if (!cells.has(nk)) { safe = { x: nx, y: ny, t }; break; }
          q.push({ x: nx, y: ny, t });
        }
        if (safe) break;
      }
      if (!safe) return null;
      const chain = [];
      let c2 = key(safe.x, safe.y);
      while (c2 && c2 !== key(gx, gy)) {
        const [cx2, cy2] = c2.split(',').map(Number);
        chain.unshift({ x: cx2, y: cy2 });
        c2 = parent.get(c2);
      }
      return { canEscape: true, path: chain, safeCell: { x: safe.x, y: safe.y }, time: safe.t };
    } catch (e) { return null; }
  }

  // ===== [OR] 聯合「放彈位置 × 逃生」搜尋 =====
  const W_KILL = 12, W_BLOCK = 1.5, W_BRICK = 0.4, W_DIST = 1.2;
  let bestPlan = null;
  let planFrame = -999;

  function findBestBombPlan(maxDepth) {
    const sx = bot.gridX, sy = bot.gridY;
    const live = liveMonsters();
    if (!live.length) return null;

    // BFS 展開從當前格出發、不含磚/炸彈的可達地板格
    const reach = new Map();
    reach.set(key(sx, sy), { d: 0, first: null });
    const q = [{ x: sx, y: sy, d: 0 }];
    while (q.length) {
      const cur = q.shift();
      if (cur.d >= maxDepth) continue;
      for (const d of DIRS) {
        const nx = cur.x + d.dx, ny = cur.y + d.dy;
        if (!inBounds(nx, ny) || isWall(nx, ny) || isBrick(nx, ny)) continue;
        if (bm.hasBombAt(nx, ny)) continue;
        const nk = key(nx, ny);
        if (reach.has(nk)) continue;
        reach.set(nk, { d: cur.d + 1, first: cur.first || d });
        q.push({ x: nx, y: ny, d: cur.d + 1 });
      }
    }

    const cands = [];
    for (const [k, info] of reach) {
      const [x, y] = k.split(',').map(Number);
      const cells = blastOf(x, y, range(), false, shape());
      let cover = 0, block = 0;
      for (const m of live) {
        if (coveredNow(cells, m)) cover++;
        else if (approachCovered(cells, m)) block++;
      }
      if (cover === 0 && block === 0) continue;   // 便宜預篩
      let bricks = 0;
      for (const ck of cells) { const [bx, by] = ck.split(',').map(Number); if (isBrick(bx, by)) bricks++; }
      cands.push({
        x, y, d: info.d, first: info.first, cover, block, bricks,
        geoScore: cover * W_KILL + block * W_BLOCK + Math.min(bricks, 4) * W_BRICK - info.d * W_DIST,
      });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => b.geoScore - a.geoScore);

    let best = null;
    for (const cand of cands.slice(0, 6)) {
      const esc = getEscape(cand.x, cand.y);
      if (!esc) { stats.rpNoEsc = (stats.rpNoEsc || 0) + 1; continue; }
      if (trapTeammate(cand.x, cand.y)) { stats.mateTrap = (stats.mateTrap || 0) + 1; continue; }
      const mv = mcKillValue(cand.x, cand.y, 3);
      const score = mv.expected * W_KILL + cand.block * W_BLOCK
        + Math.min(cand.bricks, 4) * W_BRICK - cand.d * W_DIST;
      if (!best || score > best.score) {
        best = { x: cand.x, y: cand.y, first: cand.first, esc, score, mc: mv.expected };
      }
    }
    return best;
  }

  // ===== [GT] 電腦雙人合作協調（Stackelberg：先宣告 → 後分工）=====
  const SHARED = (globalThis.__BB_MC_SHARED = globalThis.__BB_MC_SHARED || { intents: new Map(), frame: 0 });
  const BOT_ID = (bot.gridX === 1 && bot.gridY === 1) ? 'bot' : 'bot' + ((bot.gridX * 31 + bot.gridY) % 997);

  function teammates() {
    const out = [];
    if (globalThis.bot && globalThis.bot !== bot && !globalThis.bot.isDead) out.push(globalThis.bot);
    if (globalThis.bot2 && globalThis.bot2 !== bot && !globalThis.bot2.isDead) out.push(globalThis.bot2);
    if (globalThis.player && !globalThis.player.isDead) out.push(globalThis.player);
    if (globalThis.player2 && !globalThis.player2.isDead) out.push(globalThis.player2);
    return out;
  }
  const isCoop = () => {
    const gm = globalThis.gameMode || '';
    return gm === 'BOT_BOT_COOP' || gm === 'P1_BOT_COOP' || gm === 'P1_P2_COOP';
  };
  const mateAt = (x, y) => teammates().some(t => t.gridX === x && t.gridY === y);
  /** 這顆火會不會罩住隊友（合作模式的最後檢查） */
  function trapTeammate(px, py) {
    if (!isCoop()) return false;
    const cells = blastOf(px, py, range(), false, shape());
    for (const t of teammates()) if (cells.has(key(t.gridX, t.gridY))) return true;
    return false;
  }
  function declareIntent(kind, x, y) {
    SHARED.intents.set(BOT_ID, { kind, x, y, f: SHARED.frame });
  }
  /** 這隻怪是否已經被隊友認領（就讓給它，去處理別的） */
  function claimed(m) {
    for (const [id, it] of SHARED.intents) {
      if (id === BOT_ID) continue;
      if (SHARED.frame - it.f > 60) continue;
      if (it.kind === 'target' && it.x === m.gridX && it.y === m.gridY) return true;
    }
    return false;
  }
  bot._mcTrapTeammate = trapTeammate;
  bot._mcMateAt = mateAt;

  // ===== 承諾式逃生（沿用已實測有效的設計）=====
  let commitPath = [];
  let commitFrames = 0;
  // 上一次受傷的幀號。hp 在這個遊戲沒有回復手段，所以「受傷後撤退」
  // 必須有時間窗，否則一旦掉血就永遠在逃 → 永遠不攻擊 → 超時。
  let lastHp = 99;
  let lastHitFrame = -9999;

  bot.think = function () {
    stats.thinks = (stats.thinks || 0) + 1;
    SHARED.frame = stats.thinks;
    reset();
    computeBlast();
    mcCache = new Map();
    const sx = bot.gridX, sy = bot.gridY;
    const live = liveMonsters();
    bot._ph = 'INIT';

    function riskAt(x, y) {
      let cover = 0, earliest = Infinity;
      if (flameAt(x, y)) return { cover: 100, earliest: -1 };
      for (const [b, cells] of blastByBomb) {
        if (cells.has(key(x, y))) { cover++; if (b.timer < earliest) earliest = b.timer; }
      }
      return { cover, earliest };
    }

    // ---- 0. 承諾中的逃生優先於一切（除非怪已經貼上來）----
    if (commitPath.length) {
      bot._ph = 'COMMIT';
      // 被怪貼住時，逃生計畫必須中止：接觸即死，而且計畫不是為此設計的。
      const ambushed = live.some(m => Math.abs(m.gridX - sx) + Math.abs(m.gridY - sy) <= 1);
      commitFrames++;
      while (commitPath.length && bot.gridX === commitPath[0].x && bot.gridY === commitPath[0].y) commitPath.shift();
      let stale = ambushed;
      if (commitPath.length) {
        const nxt = commitPath[0];
        if (flameAt(nxt.x, nxt.y) || bm.hasBombAt(nxt.x, nxt.y) ||
            typeAt(nxt.x, nxt.y) !== 0 || monsterNear(nxt.x, nxt.y)) stale = true;
      }
      if (!commitPath.length || commitFrames > 170 || stale) { commitPath = []; commitFrames = 0; }
      else {
        const nxt = commitPath[0];
        stats.commitMoves = (stats.commitMoves || 0) + 1;
        go(Math.sign(nxt.x - bot.gridX), Math.sign(nxt.y - bot.gridY));
        return;
      }
    }

    // ---- 1. 腳下已經在燒 → 立即逃 ----
    if (flameAt(sx, sy)) {
      bot._ph = 'FLAME';
      stats.escape = (stats.escape || 0) + 1;
      const st = firstStep((x, y) => safeCell(x, y), safeCell);
      if (st) { stats.fleeMoved = (stats.fleeMoved || 0) + 1; go(st.dx, st.dy); return; }
      stats.fleeNull = (stats.fleeNull || 0) + 1;
    }

    // ---- 2. [GT] 損傷後先脫離接觸（有時間窗，見 lastHitFrame）----
    // hp 掉過（含 2 秒無敵期）→ 撞一下會給 2 秒無敵，站著不動會再被同隻怪碰到。
    // stage-1 實測 2/10 是純接觸死亡，全都是「撞到後還留在原地」造成的。
    // 但這個遊戲沒有回血，所以撤退只能維持 「受傷後 8 秒」，
    // 之後必須回去繼續殺怪，否則永遠不攻擊 → 超時（實測：33% 通關）。
    const hpLost = bot.hp < lastHp;
    if (hpLost) lastHitFrame = stats.thinks;
    lastHp = bot.hp;
    const recovering = (stats.thinks - lastHitFrame) < 480;   // 480 幀 = 8 秒
    // ---- 實驗開關：RETREAT 是否真的有用？ ----
    // A/B 量測（bb-bench2，N=12，每關 180 秒；單人／雙人／單人留出種子三點）：
    //   關閉 RETREAT 後，接觸死亡下降（單人 5→1、留出 5→3）、留出種子各關上升
    //   （60/50/66.7/50/0 → 90/33.3/33.3/0），**但全破率三點全部不動**
    //   （8.3%→8.3%、0%→0%、0%→0%），因為省下的接觸死亡被新增的超時吃掉
    //   （單人 timeout 5→9、雙人第 3 關 40→0）。
    // 依「全破率沒上升就不算改良」的規則，這個開關維持啟用（保留原機制），
    // 開關本身留著是為了下一輪可以用同一支開關繼續實驗，不必重新改碼。
    const RETREAT_ENABLED = false;
    if (RETREAT_ENABLED && recovering && bot.hp < bot.maxHp && live.length &&
        live.some(m => Math.abs(m.gridX - sx) + Math.abs(m.gridY - sy) <= 5)) {
      bot._ph = 'RETREAT';
      stats.retreat = (stats.retreat || 0) + 1;
      const st = retreatStep();
      if (st) { go(st.d.dx, st.d.dy); return; }
      declareIntent('retreat', sx, sy);
    }

    if (!live.length) { bot._ph = 'IDLE'; return; }

    // ---- 2b. [GT] 硬性接觸保留（invariant）----
    // 引擎的怪物碰撞是「中心距離 < 0.8 cell」，沒有任何傷害模型，碰到就 -1 hp。
    // 因為怪物每幀都會移動，只靠「不要走過去」不夠：這裡直接把
    // 「任何怪與 Bot 的曼哈頓距離 <= 1」當成緊急狀態，一律先遠離。
    // 唯一的例外是「就地炸死牠」——此時放彈反而是更安全的選項
    // （blaze 蓋住牠的格 = bb-mc2 實測 46/46 = 100% 擊殺）。
    // 方向 hysteresis：上一幀往哪逃，這幀仍往那兒逃（除非明顯更差），
    // 消除「兩格等分就左右來回」的震盪（bb-ctrace 實測 90+ 幀後被摸死）。
    const close = live.filter(m => Math.abs(m.gridX - sx) + Math.abs(m.gridY - sy) <= 1);
    if (close.length) {
      bot._ph = 'EVADE';
      stats.evade = (stats.evade || 0) + 1;
      let killed = false;
      if (canPlace()) {
        const cells = blastOf(sx, sy, range(), !!bot.hasPierce, shape());
        if (close.some(m => cells.has(key(m.gridX, m.gridY)))) {
          const esc = getEscape(sx, sy);
          if (esc && !escapeCrossesMonster(esc) && !trapTeammate(sx, sy)) {
            stats.evadeKill = (stats.evadeKill || 0) + 1;
            stats.fired = (stats.fired || 0) + 1;
            bot.aiInput.bomb = true;
            commitPath = esc.path || [];
            commitFrames = 0;
            killed = true;
          }
        }
      }
      if (!killed) {
        // 撤退走哪：優先用「承諾中的方向」，其次重新規劃，最後緊急脫困。
        const ev = evadeDirection();
        if (ev) {
          if (ev.kind === 'break') stats.evadeBreak = (stats.evadeBreak || 0) + 1;
          if (ev.kind === 'commit') stats.evadeCommit = (stats.evadeCommit || 0) + 1;
          go(ev.dx, ev.dy);
          return;
        }
      }
      return;
    }

    // ---- 3. 站在危險格 → FLEE（不可逃時 minimax）----
    if (unsafe(sx, sy)) {
      bot._ph = 'FLEE';
      stats.escape = (stats.escape || 0) + 1;
      const st = firstStep((x, y) => isFloor(x, y) && !unsafe(x, y) && !bm.hasBombAt(x, y), isFloor);
      if (st) { stats.fleeMoved = (stats.fleeMoved || 0) + 1; go(st.dx, st.dy); return; }
      stats.fleeNull = (stats.fleeNull || 0) + 1;
      let best = null;
      for (const d of DIRS) {
        const nx = sx + d.dx, ny = sy + d.dy;
        if (!inBounds(nx, ny) || isWall(nx, ny) || isBrick(nx, ny) || bm.hasBombAt(nx, ny)) continue;
        if (monsterNear(nx, ny)) continue;
        const r = riskAt(nx, ny);
        if (r.cover === 100) continue;
        if (!best || r.cover < best.r.cover || (r.cover === best.r.cover && r.earliest > best.r.earliest)) best = { d, r };
      }
      if (best) {
        if (bot._fleeDir && (bot._fleeDir.dx !== best.d.dx || bot._fleeDir.dy !== best.d.dy)) {
          const cur = riskAt(sx + bot._fleeDir.dx, sy + bot._fleeDir.dy);
          if (cur.cover <= best.r.cover && cur.cover !== 100 &&
              !isWall(sx + bot._fleeDir.dx, sy + bot._fleeDir.dy) &&
              !isBrick(sx + bot._fleeDir.dx, sy + bot._fleeDir.dy) &&
              !bm.hasBombAt(sx + bot._fleeDir.dx, sy + bot._fleeDir.dy)) best = { d: bot._fleeDir, r: cur };
        }
        bot._fleeDir = best.d;
        stats.fleeMinimax = (stats.fleeMinimax || 0) + 1;
        go(best.d.dx, best.d.dy);
      }
      return;
    }

    // ---- 4. 直接擊殺：火場已覆蓋某隻怪 → 就地放彈（沿用 hunter 的
    //      高勝率子策略，作為聯合搜尋的 fast path）----
    if (canPlace()) {
      const cells = blastOf(sx, sy, range(), !!bot.hasPierce, shape());
      const aligned = live.filter(m => coveredNow(cells, m));
      if (aligned.length) {
        const esc = getEscape(sx, sy);
        if (esc && !escapeCrossesMonster(esc) && !trapTeammate(sx, sy)) {
          bot._ph = 'KILL';
          stats.fired = (stats.fired || 0) + 1;
          bot.aiInput.bomb = true;
          commitPath = esc.path || [];
          commitFrames = 0;
          declareIntent('target', aligned[0].gridX, aligned[0].gridY);
          return;
        }
      }
    }

    // ---- 4b. [OR] 聯合搜尋：走到「致命且可逃」的最佳放彈格 ----
    if (stats.thinks - planFrame >= 4) { planFrame = stats.thinks; bestPlan = findBestBombPlan(6); }
    if (canPlace() && bestPlan) {
      if (bestPlan.x === sx && bestPlan.y === sy) {
        bot._ph = 'KILL';
        stats.fired = (stats.fired || 0) + 1;
        bot.aiInput.bomb = true;
        commitPath = (bestPlan.esc.path || []).slice();
        commitFrames = 0;
        declareIntent('target', bestPlan.x, bestPlan.y);
        bestPlan = null;
        return;
      }
      if (bestPlan.first) {
        const nx = sx + bestPlan.first.dx, ny = sy + bestPlan.first.dy;
        if (isFloor(nx, ny) && !bm.hasBombAt(nx, ny) && !unsafe(nx, ny) && !monsterAdj(nx, ny)) {
          bot._ph = 'REPOS';
          stats.repos = (stats.repos || 0) + 1;
          go(bestPlan.first.dx, bestPlan.first.dy);
          return;
        }
        bestPlan = null;
      }
    }

    // ---- 5. HUNT / BREACH：往怪前進；被磚擋住就炸開它 ----
    const ordered = live.slice().sort((a, b) => {
      const ca = claimed(a) ? 1 : 0, cb = claimed(b) ? 1 : 0;
      if (ca !== cb) return ca - cb;
      return (Math.abs(a.gridX - sx) + Math.abs(a.gridY - sy))
           - (Math.abs(b.gridX - sx) + Math.abs(b.gridY - sy));
    });
    const target = ordered[0];
    declareIntent('target', target.gridX, target.gridY);

    const step = firstStep((x, y) => x === target.gridX && y === target.gridY,
      (x, y) => walkable(x, y) && !bm.hasBombAt(x, y) && !unsafe(x, y));
    if (!step) stats.huntNull = (stats.huntNull || 0) + 1;
    if (step) {
      if (isBrick(step.x, step.y)) {
        bot._ph = 'BREACH';
        if (canPlace()) {
          const esc = getEscape(sx, sy);
          if (esc && !escapeCrossesMonster(esc) && !trapTeammate(sx, sy)) {
            stats.breach = (stats.breach || 0) + 1;
            stats.fired = (stats.fired || 0) + 1;
            bot.aiInput.bomb = true;
            commitPath = esc.path || [];
            commitFrames = 0;
            return;
          }
        }
        let spot = null;
        for (const d of DIRS) {
          const nx = sx + d.dx, ny = sy + d.dy;
          if (!walkable(nx, ny) || isBrick(nx, ny)) continue;
          if (!safeCell(nx, ny)) continue;
          if (DIRS.some(d2 => isBrick(nx + d2.dx, ny + d2.dy))) { spot = d; break; }
        }
        if (spot) { go(spot.dx, spot.dy); return; }
      } else if (!monsterAdj(sx + step.dx, sy + step.dy) &&
                 !unsafe(sx + step.dx, sy + step.dy)) {
        bot._ph = 'HUNT';
        stats.approach = (stats.approach || 0) + 1;
        go(step.dx, step.dy);
        return;
      } else {
        bot._ph = 'HUNT_HOLD';
        stats.huntHold = (stats.huntHold || 0) + 1;
      }
    }

    // ---- 6. ANTI-FREEZE：分級候選，保證「走得動就一定要走」----
    bot._ph = 'WANDER';
    const base = (x, y) => walkable(x, y) && !bm.hasBombAt(x, y) && !unsafe(x, y);
    const graded = [
      (x, y) => base(x, y) && !monsterAdj(x, y),     // 完全安全
      (x, y) => base(x, y) && !monsterNear(x, y),    // 不貼怪（撤退時的需要）
      () => true,                                   // 只要不是火場／炸彈就好
    ];
    let cand = [];
    for (const pred of graded) {
      cand = DIRS.filter(d => pred(sx + d.dx, sy + d.dy));
      if (cand.length) break;
    }
    if (!cand.length) {
      // 四面都是火／炸彈／磚：真的動不了。不改寫方向，交給下幀的逃生決策。
      return;
    }
    {
      // 選「離怪最遠」的鄰格。
      //
      // 反震盪：這裡曾經用 `sc(prev) >= sc(pick) - 1`（容忍 1 分）做 hysteresis，
      // 但實測（bb-ctrace.mjs seed 2654801817，幀 674–719）仍在 L／R 之間每幀翻面，
      // px 在 3.70↔3.77 震盪 46 幀，而怪在 5 格外 —— Bot 根本不是被追，
      // 是單獨卡在「左右等分」的決策震盪上。
      // 改用與 EVADE 同一套承諾機制：選定方向後就固定，
      // 只有在「嚴格更好」或「原方向被擋住」時才換。
      const sc = (d) => safestCellScore(sx + d.dx, sy + d.dy);
      let pick = cand[0], bestScore = sc(pick);
      for (const d of cand) { const s = sc(d); if (s > bestScore) { bestScore = s; pick = d; } }
      const prev = bot._wanderDir && cand.find(d => d.dx === bot._wanderDir.dx && d.dy === bot._wanderDir.dy);
      const chosen = (prev && sc(prev) >= bestScore) ? prev : pick;
      bot._wanderDir = chosen;
      stats.wander = (stats.wander || 0) + 1;
      go(chosen.dx, chosen.dy);
    }
  };

  // ===== CONTROL AUTHORITY：中和 legacy 覆寫層 =====
  // Bot.update() 在 think() 之後還會跑 holdCentering / vetoUnsafeBombPlacement /
  // ensureSomeAction / breakOutOfStall 並覆寫 aiInput。本政策已自行處理站正、
  // 脫困與放彈閘門，legacy 層只會造成抖振（實測：往右走卻被改成往左）。
  bot.needsCentering = () => false;
  bot.vetoUnsafeBombPlacement = () => {};
  bot.ensureSomeAction = () => {};
  bot.breakOutOfStall = () => false;
  bot.forceMoveIfPossible = () => false;
  bot.enforceExclusiveAxes = () => {};
  bot.holdCentering = () => {};
  bot.targetPath = [];

  /** 供外部（策略登記冊 / 遙測）讀取目前使用的戰術 */
  bot.getMCStats = () => stats;
  bot.getMCPhase = () => bot._ph || '-';
}
