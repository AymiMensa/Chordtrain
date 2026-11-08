/**
 * 超級炸彈超人 — 電腦 AI 核心模組（深度學習 + 作業研究 + 賽局理論）
 * 結果論：以「過關勝率」為唯一準則，驅動策略保留/改良/捨棄。
 *
 * 硬性規定（絕對不可違反）：
 *   1. 高勝率策略（RETENTION_LOCKED）：絕對不可刪除、不可覆寫。
 *   2. 低勝率策略：可改良，上限 30 次；30 次仍無提升 → 捨棄。
 *   3. 勝率過低策略：直接捨棄。
 */

export const STRATEGY_STATUS = {
  ACTIVE: 'ACTIVE',
  RETENTION_LOCKED: 'RETENTION_LOCKED',
  IMPROVING: 'IMPROVING',
  DISCARDED: 'DISCARDED',
};

export const HIGH_WIN_RATE_THRESHOLD = 0.72;
export const VERY_LOW_WIN_RATE_THRESHOLD = 0.15;
export const MIN_ATTEMPTS_FOR_RETENTION = 20;
export const MAX_IMPROVEMENT_ATTEMPTS = 30;
export const STORAGE_KEY = 'bomber_ai_strategy_registry_v1';

export class Strategy {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.wins = 0;
    this.attempts = 0;
    this.improvementAttempts = 0;
    this.status = STRATEGY_STATUS.ACTIVE;
    this.stageResults = {};
    this.createdAt = Date.now();
    this.lastUpdated = Date.now();
    this.baselineWinRate = 0;
    this.improvementStalledCount = 0;
    // 改良期的量測基準：進入 IMPROVING 時的場次與此期間看過的最高勝率。
    // 少了這兩個數字，「30 次仍無改良就捨棄」會在改良過程中被提早觸發。
    this.improveStartAttempts = 0;
    this.bestWinRate = 0;
  }

  get winRate() { return this.attempts ? this.wins / this.attempts : 0; }

  record(stage, won) {
    this.attempts += 1;
    this.lastUpdated = Date.now();
    if (won) this.wins += 1;
    const s = this.stageResults[stage] || { wins: 0, attempts: 0 };
    s.attempts += 1;
    if (won) s.wins += 1;
    this.stageResults[stage] = s;
    this.bestWinRate = Math.max(this.bestWinRate, this.winRate);
    this.applyHardRules();
  }

  applyHardRules() {
    // 規則 1：高勝率 → 保留鎖定（硬性規定：絕對不可刪除）
    if (this.attempts >= MIN_ATTEMPTS_FOR_RETENTION &&
        this.winRate >= HIGH_WIN_RATE_THRESHOLD) {
      this.status = STRATEGY_STATUS.RETENTION_LOCKED;
      return;
    }

    // 規則 2：極低勝率 → 捨棄
    if (this.attempts >= MIN_ATTEMPTS_FOR_RETENTION &&
        this.winRate < VERY_LOW_WIN_RATE_THRESHOLD) {
      this.status = STRATEGY_STATUS.DISCARDED;
      return;
    }

    // 規則 3：低於閾值且活躍 → 改良狀態（記下改良期的量測基準）
    if (this.winRate < HIGH_WIN_RATE_THRESHOLD &&
        this.status === STRATEGY_STATUS.ACTIVE) {
      this.status = STRATEGY_STATUS.IMPROVING;
      this.baselineWinRate = this.winRate;
      this.improveStartAttempts = this.attempts;
      this.bestWinRate = this.winRate;
    }

    // 規則 4：改良嘗試已達上限 → 只在「重新量測夠多場」後才判定是否有效改良。
    // 只比對「當下勝率」會在改良過程中被提早捨棄（單一幀的勝率本來就會抖動），
    // 所以：場次增量 >= MIN_ATTEMPTS_FOR_RETENTION 才判定，且比對此期間的
    // 最高勝率（改良的有效性看的是這個方案有沒有做到過）。
    if (this.status === STRATEGY_STATUS.IMPROVING &&
        this.improvementAttempts >= MAX_IMPROVEMENT_ATTEMPTS) {
      const remeasured = (this.attempts - this.improveStartAttempts)
                         >= MIN_ATTEMPTS_FOR_RETENTION;
      if (remeasured && !this.hasEffectivelyImproved()) {
        this.status = STRATEGY_STATUS.DISCARDED;
      }
    }
  }

  hasEffectivelyImproved() {
    // 改良有效 = 這段期間的最高勝率比起步線高出至少 10%，或達到 30% 基準。
    return Math.max(this.winRate, this.bestWinRate)
           > Math.max(this.baselineWinRate + 0.10, 0.30);
  }

  tryImprove() {
    if (this.status === STRATEGY_STATUS.RETENTION_LOCKED) return false;
    if (this.improvementAttempts >= MAX_IMPROVEMENT_ATTEMPTS) return false;
    // 第一次改良嘗試 = 改良計劃的起點。捨棄判定要比對「起點之後重測了幾場」，
    // 否則會拿整個歷史勝率去比，把還在改良中的策略提早淘汰。
    if (this.improvementAttempts === 0) this.improveStartAttempts = this.attempts;
    this.improvementAttempts += 1;
    return true;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      wins: this.wins,
      attempts: this.attempts,
      improvementAttempts: this.improvementAttempts,
      status: this.status,
      stageResults: this.stageResults,
      baselineWinRate: this.baselineWinRate,
      improveStartAttempts: this.improveStartAttempts,
      bestWinRate: this.bestWinRate,
      createdAt: this.createdAt,
      lastUpdated: this.lastUpdated,
    };
  }

  static fromJSON(o) {
    const s = new Strategy(o.id, o.name);
    s.wins = o.wins;
    s.attempts = o.attempts;
    s.improvementAttempts = o.improvementAttempts || 0;
    s.status = o.status || STRATEGY_STATUS.ACTIVE;
    s.stageResults = o.stageResults || {};
    s.baselineWinRate = o.baselineWinRate || 0;
    s.improveStartAttempts = o.improveStartAttempts || 0;
    s.bestWinRate = o.bestWinRate || 0;
    s.createdAt = o.createdAt;
    s.lastUpdated = o.lastUpdated;
    return s;
  }
}

export class StrategyRegistry {
  constructor() {
    this.strategies = new Map();
    this.load();
    this._ensureDefaults();
  }

  _ensureDefaults() {
    const defaults = [
      ['safe_escape', '保命優先逃離'],
      ['snipershot', '遠程精準狙擊'],
      ['wallcorner', '牆角防禦站位'],
      ['corridor_clear', '走廊炸開脫身'],
      ['item_rush', '道具優先拾取'],
      ['coop_cover', '雙電腦互相掩護'],
      ['aggressive_push', '主動壓線進攻'],
      // ===== 政策層策略（「決策大腦」本身）=====
      // 這裡登錄的是兩套完整的 think() 政策，而不是單一戰術。
      // 結果論規則直接套在它們身上：
      //   - policy_hunter：已實測 ~83% 通關的高勝率策略，一旦達到鎖定門檻
      //     就 RETENTION_LOCKED，絕對不可刪除、不可覆寫。
      //   - policy_mctsolver：新候選，由 mctsolver 的 MC+OR+GT 決策提供。
      ['policy_hunter', '決策大腦：Hunter（已實測 83%）'],
      ['policy_mctsolver', '決策大腦：MCTSolver（MC擊殺價值+聯合搜尋）'],
    ];
    for (const [id, name] of defaults) {
      if (!this.strategies.has(id)) this.register(id, name);
    }
    this.save();
  }

  /**
   * 政策層選擇：回傳目前該使用的「決策大腦」id。
   *
   * 結果論（使用者的硬性規定）：
   *   1. 沒有足夠樣本 → 用 'policy_hunter'（已知的高勝率策略，不可因為沒資料而亂試）。
   *   2. 樣本足夠且有任一策略勝率 >= HIGH_WIN_RATE_THRESHOLD → 該策略（它會被鎖定保護）。
   *   3. 兩者都未達標 → 取勝率較高者；同分時取樣本較多者。
   *   4. 勝率 < VERY_LOW_WIN_RATE_THRESHOLD 的策略會被標記 DISCARDED，永不選用。
   */
  selectPolicy(mode, stage) {
    const hunter = this.get('policy_hunter');
    const mc = this.get('policy_mctsolver');
    if (!hunter && !mc) return 'policy_hunter';
    if (!hunter) return 'policy_mctsolver';
    if (!mc) return 'policy_hunter';

    const usable = (s) => s && s.status !== STRATEGY_STATUS.DISCARDED;
    if (!usable(hunter)) return 'policy_mctsolver';
    if (!usable(mc)) return 'policy_hunter';

    // 任一方達到「高勝率」門檻 → 它（若兩者都達到，取勝率高者；平手取樣本多者）
    const hHigh = hunter.attempts >= MIN_ATTEMPTS_FOR_RETENTION && hunter.winRate >= HIGH_WIN_RATE_THRESHOLD;
    const mHigh = mc.attempts >= MIN_ATTEMPTS_FOR_RETENTION && mc.winRate >= HIGH_WIN_RATE_THRESHOLD;
    if (hHigh && mHigh) return hunter.winRate >= mc.winRate ? 'policy_hunter' : 'policy_mctsolver';
    if (hHigh) return 'policy_hunter';
    if (mHigh) return 'policy_mctsolver';

    // 兩人樣本都不足 → 保留已知的高勝率策略，不冒險
    if (hunter.attempts < MIN_ATTEMPTS_FOR_RETENTION && mc.attempts < MIN_ATTEMPTS_FOR_RETENTION) {
      return 'policy_hunter';
    }
    const hp = hunter.attempts >= MIN_ATTEMPTS_FOR_RETENTION ? hunter.winRate : -1;
    const mp = mc.attempts >= MIN_ATTEMPTS_FOR_RETENTION ? mc.winRate : -1;
    if (hp > mp) return 'policy_hunter';
    if (mp > hp) return 'policy_mctsolver';
    return hunter.winRate >= mc.winRate ? 'policy_hunter' : 'policy_mctsolver';
  }

  register(id, name) {
    if (this.strategies.has(id)) return this.strategies.get(id);
    const s = new Strategy(id, name);
    this.strategies.set(id, s);
    this.save();
    return s;
  }

  get(id) { return this.strategies.get(id); }

  select(stage, epsilon = 0.10) {
    const candidates = [...this.strategies.values()].filter(
      s => s.status !== STRATEGY_STATUS.DISCARDED
    );
    if (candidates.length === 0) return null;
    const scored = candidates.map(s => {
      const sr = s.stageResults[stage];
      const rate = (sr && sr.attempts >= 5) ? sr.wins / sr.attempts : s.winRate;
      const confidence = Math.min((sr ? sr.attempts : s.attempts) / 20, 1);
      return { strategy: s, score: rate * 0.7 + confidence * 0.3 };
    });
    scored.sort((a, b) => b.score - a.score);
    if (Math.random() < epsilon) {
      const pool = scored.filter(x => x.strategy.status !== STRATEGY_STATUS.RETENTION_LOCKED);
      return pool.length ? pool[Math.floor(Math.random() * pool.length)].strategy : scored[0].strategy;
    }
    const locked = scored.find(x => x.strategy.status === STRATEGY_STATUS.RETENTION_LOCKED);
    return locked ? locked.strategy : scored[0].strategy;
  }

  /**
   * 依模式/關卡挑選策略，回傳 AIController.tick 期待的 { strategy, decisions } 結構。
   * （半成品重構遺漏了這個方法，會讓 AIController.tick 每幀拋
   *  「this.registry.selectStrategyForMode is not a function」。）
   * decisions 為空物件代表「不強制指定動作」，交由 tick 底層的
   * 神經網路 / 危險反應 / OR 規劃接手；若 Strategy 有 decide() 則採用其決策。
   */
  selectStrategyForMode(mode, stage, enemies, botId) {
    let strategy = null;
    try { strategy = this.select(stage, 0); } catch (e) { strategy = null; }
    let decisions = {};
    try {
      if (strategy && typeof strategy.decide === 'function') {
        decisions = strategy.decide({ mode, stage, enemies, botId }) || {};
      }
    } catch (e) { decisions = {}; }
    return { strategy: strategy || null, decisions };
  }

  record(strategyId, stage, won) {
    const s = this.strategies.get(strategyId);
    if (s) s.record(stage, won);
    this.save();
  }

  attemptImprove(strategyId) {
    const s = this.strategies.get(strategyId);
    if (!s) return false;
    return s.tryImprove();
  }

  getActive() {
    return [...this.strategies.values()].filter(
      s => s.status !== STRATEGY_STATUS.DISCARDED
    );
  }

  getLocked() {
    return [...this.strategies.values()].filter(
      s => s.status === STRATEGY_STATUS.RETENTION_LOCKED
    );
  }

  save() {
    try {
      const data = { version: 1, strategies: [...this.strategies.values()].map(s => s.toJSON()) };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) { /* localStorage 可能不可用 */ }
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.strategies && Array.isArray(data.strategies)) {
        for (const o of data.strategies) {
          const s = Strategy.fromJSON(o);
          this.strategies.set(s.id, s);
        }
      }
    } catch (e) { /* 忽略損壞的存檔 */ }
  }
}

/** 全域共享的策略登記冊（結局更新 / 關卡選策略都用這一份）。 */
export const sharedStrategyRegistry = new StrategyRegistry();

/** 依關卡挑選策略（包裝 StrategyRegistry.select，回傳 Strategy 或 null）。 */
export function selectStrategyForStage(stage) {
  return sharedStrategyRegistry.select(stage);
}

export class OnlineNeuralNetwork {
  constructor(inputSize, hiddenSize, outputSize, learningRate = 0.05) {
    this.inputSize = inputSize;
    this.hiddenSize = hiddenSize;
    this.outputSize = outputSize;
    this.lr = learningRate;
    this.W1 = this._randMatrix(inputSize, hiddenSize, Math.sqrt(2 / inputSize));
    this.b1 = new Array(hiddenSize).fill(0);
    this.W2 = this._randMatrix(hiddenSize, outputSize, Math.sqrt(2 / hiddenSize));
    this.b2 = new Array(outputSize).fill(0);
    this._load();
  }

  _randMatrix(rows, cols, scale) {
    const m = [];
    for (let i = 0; i < rows; i++) {
      m[i] = [];
      for (let j = 0; j < cols; j++) m[i][j] = (Math.random() * 2 - 1) * scale;
    }
    return m;
  }

  sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
  dsigmoid(y) { return y * (1 - y); }

  predict(inputs) {
    const h = new Array(this.hiddenSize);
    for (let j = 0; j < this.hiddenSize; j++) {
      let sum = this.b1[j];
      for (let i = 0; i < this.inputSize; i++) sum += inputs[i] * this.W1[i][j];
      h[j] = this.sigmoid(sum);
    }
    const o = new Array(this.outputSize);
    for (let k = 0; k < this.outputSize; k++) {
      let sum = this.b2[k];
      for (let j = 0; j < this.hiddenSize; j++) sum += h[j] * this.W2[j][k];
      o[k] = this.sigmoid(sum);
    }
    return { output: o, hidden: h };
  }

  train(inputs, target) {
    const { output, hidden } = this.predict(inputs);
    const outputErrors = new Array(this.outputSize);
    for (let k = 0; k < this.outputSize; k++) {
      outputErrors[k] = (target[k] - output[k]) * this.dsigmoid(output[k]);
    }
    const hiddenErrors = new Array(this.hiddenSize).fill(0);
    for (let j = 0; j < this.hiddenSize; j++) {
      let err = 0;
      for (let k = 0; k < this.outputSize; k++) err += outputErrors[k] * this.W2[j][k];
      hiddenErrors[j] = err * this.dsigmoid(hidden[j]);
    }
    for (let j = 0; j < this.hiddenSize; j++) {
      for (let k = 0; k < this.outputSize; k++) {
        this.W2[j][k] += this.lr * outputErrors[k] * hidden[j];
      }
    }
    for (let k = 0; k < this.outputSize; k++) this.b2[k] += this.lr * outputErrors[k];
    for (let i = 0; i < this.inputSize; i++) {
      for (let j = 0; j < this.hiddenSize; j++) {
        this.W1[i][j] += this.lr * hiddenErrors[j] * inputs[i];
      }
    }
    for (let j = 0; j < this.hiddenSize; j++) this.b1[j] += this.lr * hiddenErrors[j];
    this._save();
  }

  _save() {
    try {
      localStorage.setItem('bomber_ai_nn_v1', JSON.stringify({
        W1: this.W1, b1: this.b1, W2: this.W2, b2: this.b2,
      }));
    } catch (e) {}
  }
  _load() {
    try {
      const raw = localStorage.getItem('bomber_ai_nn_v1');
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.W1) this.W1 = d.W1;
      if (d.b1) this.b1 = d.b1;
      if (d.W2) this.W2 = d.W2;
      if (d.b2) this.b2 = d.b2;
    } catch (e) {}
  }
}

export class ORPlanner {
  constructor(gridSystem, mapManager, bombManager, explosionManager, monsterManager) {
    this.gridSystem = gridSystem;
    this.mapManager = mapManager;
    this.bombManager = bombManager;
    this.explosionManager = explosionManager;
    this.monsterManager = monsterManager;
    this.dangerMap = null;
  }
  cols() { return this.gridSystem ? this.gridSystem.cols : 13; }
  rows() { return this.gridSystem ? this.gridSystem.rows : 11; }
  isSolid(x, y) { if (!Number.isFinite(x) || !Number.isFinite(y)) return true; return this.mapManager && this.mapManager.isSolid ? this.mapManager.isSolid(x, y) : false; }
  getBlockType(x, y) { if (!Number.isFinite(x) || !Number.isFinite(y)) return 1; return this.mapManager && this.mapManager.getBlockType ? this.mapManager.getBlockType(x, y) : 0; }
  dangerAt(x, y) {
    if (y < 0 || y >= this.rows() || x < 0 || x >= this.cols()) return { dangerLevel: 100, explosionTimer: 0, isFlameActive: true, monsterThreat: 0 };
    if (this.dangerMap && this.dangerMap.getDangerInfo) return this.dangerMap.getDangerInfo(x, y);
    return { dangerLevel: 0, explosionTimer: Infinity, isFlameActive: false, monsterThreat: 0 };
  }
  _bombAt(x, y) { return this.bombManager && this.bombManager.bombs.some(b => !b.isExploded && b.x === x && b.y === y); }
  _monsterAt(x, y) { return this.monsterManager && this.monsterManager.monsters.some(m => !m.isDead && m.gridX === x && m.gridY === y); }
  blastCells(x, y, range, isPierce, shape = 'CROSS') {
    const dirs = shape === 'X' ? [[1,1],[1,-1],[-1,1],[-1,-1]] : (shape === 'ROUND' || shape === 'STAR') ? [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]] : [[0,-1],[0,1],[-1,0],[1,0]];
    const cells = new Set([`${x},${y}`]);
    const limit = (shape === 'ROUND') ? Math.floor(range / 2) : range;
    for (const [dx, dy] of dirs) {
      const li = (dx !== 0 && dy !== 0 && shape === 'ROUND') ? Math.floor(range / 2) : range;
      for (let i = 1; i <= li; i++) {
        const nx = x + dx * i, ny = y + dy * i;
        if (nx < 0 || nx >= this.cols() || ny < 0 || ny >= this.rows()) break;
        const bt = this.getBlockType(nx, ny);
        if (bt === 1) break;
        cells.add(`${nx},${ny}`);
        if (bt === 2 && !isPierce) break;
      }
    }
    return cells;
  }
  minExplosionTimeAt(x, y) {
    let min = Infinity;
    if (this.bombManager) {
      for (const b of this.bombManager.bombs) {
        if (b.isExploded) continue;
        const cells = this.blastCells(b.x, b.y, b.range, !!b.isPierce, b.shape || 'CROSS');
        if (cells.has(`${x},${y}`)) min = Math.min(min, b.timer ?? Infinity);
      }
    }
    return min;
  }
  findSafeEscape(startX, startY, speed, maxTime = 3.0) {
    const timePerCell = 1 / Math.max(speed, 0.001);
    const queue = [{ x: startX, y: startY, time: 0, path: [] }];
    const visited = new Map([[`${startX},${startY}`, 0]]);
    while (queue.length > 0) {
      queue.sort((a, b) => a.time - b.time);
      const cur = queue.shift();
      if (!(cur.x === startX && cur.y === startY)) {
        const info = this.dangerAt(cur.x, cur.y);
        const bombTime = this.minExplosionTimeAt(cur.x, cur.y);
        const safe = !info.isFlameActive && bombTime === Infinity && info.dangerLevel === 0 && !this._monsterAt(cur.x, cur.y);
        if (safe) return { path: cur.path, time: cur.time };
      }
      if (cur.time >= maxTime) continue;
      for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
        const nx = cur.x + dx, ny = cur.y + dy, arrive = cur.time + timePerCell;
        if (nx < 0 || nx >= this.cols() || ny < 0 || ny >= this.rows()) continue;
        if (this.isSolid(nx, ny)) continue;
        const info = this.dangerAt(nx, ny);
        if (info.isFlameActive) continue;
        const bt = this.minExplosionTimeAt(nx, ny);
        if (bt !== Infinity && arrive >= bt) continue;
        if (info.explosionTimer !== Infinity && arrive >= info.explosionTimer) continue;
        if (this._monsterAt(nx, ny)) continue;
        if (this._bombAt(nx, ny) && !(nx === startX && ny === startY)) continue;
        const key = `${nx},${ny}`;
        const prev = visited.get(key);
        if (prev !== undefined && prev <= arrive) continue;
        visited.set(key, arrive);
        queue.push({ x: nx, y: ny, time: arrive, path: [...cur.path, { x: nx, y: ny }] });
      }
    }
    return null;
  }
  canSurviveAfterBomb(bot, bombX, bombY, range, isPierce, shape, fuseTime, speed) {
    const startX = bot.gridX, startY = bot.gridY;
    const blast = this.blastCells(bombX, bombY, range, isPierce, shape);
    const startInBlast = blast.has(`${startX},${startY}`);
    if (!startInBlast) {
      const direct = this.findSafeEscape(startX, startY, speed, 0.001);
      if (direct === null) return { canSurvive: true, path: [] };
    }
    const result = this.findSafeEscape(startX, startY, speed, fuseTime);
    return { canSurvive: !!result, path: result ? result.path : [] };
  }

  evaluateBombSpots(bot, enemies, teammates = []) {
    const range = bot.fireRange || 5;
    const isPierce = !!bot.hasPierce;
    const shape = 'CROSS';
    const fuse = 3.0;
    const speed = bot.getEffectiveSpeed ? bot.getEffectiveSpeed() : (bot.speed || 4);
    const startX = bot.gridX, startY = bot.gridY;
    const spots = [{ x: startX, y: startY }];
    for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      const nx = startX + dx, ny = startY + dy;
      if (!this.isSolid(nx, ny) && bot.canPhysicallyMove(dx, dy)) spots.push({ x: nx, y: ny });
    }
    const results = [];
    for (const spot of spots) {
      if (this.isSolid(spot.x, spot.y)) continue;
      if (this._bombAt(spot.x, spot.y) && !(spot.x === startX && spot.y === startY)) continue;
      const blast = this.blastCells(spot.x, spot.y, range, isPierce, shape);
      const hitEnemies = enemies.filter(e => blast.has(`${e.x},${e.y}`));
      if (hitEnemies.length === 0) continue;
      const teammateInDanger = teammates.some(t => t && !t.isDead && blast.has(`${t.gridX},${t.gridY}`));
      if (teammateInDanger) continue;
      const surv = this.canSurviveAfterBomb(bot, spot.x, spot.y, range, isPierce, shape, fuse, speed);
      if (!surv.canSurvive) continue;
      const distPenalty = hitEnemies.reduce((sum, e) => sum + Math.abs(e.x - spot.x) + Math.abs(e.y - spot.y), 0);
      const score = hitEnemies.length * 100 - distPenalty * 5 - surv.path.length * 10;
      results.push({ x: spot.x, y: spot.y, score, hitEnemies, path: surv.path });
    }
    results.sort((a, b) => b.score - a.score);
    return results;
  }
  chooseSafeWaitSpot(bot, maxDepth = 6) {
    const startX = bot.gridX, startY = bot.gridY;
    const queue = [{ x: startX, y: startY, path: [] }];
    const visited = new Set([`${startX},${startY}`]);
    let best = null, bestScore = -Infinity;
    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur.path.length > 0) {
        const info = this.dangerAt(cur.x, cur.y);
        const bt = this.minExplosionTimeAt(cur.x, cur.y);
        const safe = !info.isFlameActive && bt === Infinity && info.dangerLevel === 0 && !this._monsterAt(cur.x, cur.y);
        if (safe) {
          let cover = 0, open = 0;
          for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
            const bt2 = this.getBlockType(cur.x + dx, cur.y + dy);
            if (bt2 === 1 || bt2 === 2) cover++;
            if (!this.isSolid(cur.x + dx, cur.y + dy) && !this._bombAt(cur.x + dx, cur.y + dy)) open++;
          }
          const score = cover * 15 + open * 10 + Math.min(cur.path.length, 3) * 5;
          if (score > bestScore) { bestScore = score; best = { x: cur.x, y: cur.y, path: cur.path }; }
        }
      }
      if (cur.path.length >= maxDepth) continue;
      for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
        const nx = cur.x + dx, ny = cur.y + dy, key = `${nx},${ny}`;
        if (visited.has(key)) continue;
        if (this.isSolid(nx, ny)) continue;
        const info = this.dangerAt(nx, ny);
        if (info.isFlameActive || info.dangerLevel > 0) continue;
        visited.add(key);
        queue.push({ x: nx, y: ny, path: [...cur.path, { x: nx, y: ny }] });
      }
    }
    return best;
  }
  bfsPath(startX, startY, goalX, goalY, maxDepth = 80) {
    const queue = [{ x: startX, y: startY, path: [] }];
    const visited = new Set([`${startX},${startY}`]);
    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur.x === goalX && cur.y === goalY) return cur.path;
      if (cur.path.length >= maxDepth) continue;
      for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
        const nx = cur.x + dx, ny = cur.y + dy, key = `${nx},${ny}`;
        if (nx < 0 || nx >= this.cols() || ny < 0 || ny >= this.rows()) continue;
        if (visited.has(key)) continue;
        if (this.isSolid(nx, ny)) continue;
        if (this.dangerAt(nx, ny).isFlameActive) continue;
        if (this._bombAt(nx, ny) && !(nx === startX && ny === startY)) continue;
        visited.add(key);
        queue.push({ x: nx, y: ny, path: [...cur.path, { x: nx, y: ny }] });
      }
    }
    return null;
  }
}

export class CoopCoordinator {
  constructor() {
    this.intents = new Map();
    this.zones = new Map();
  }
  registerIntent(botId, intent) {
    this.intents.set(botId, { ...intent, ts: Date.now() });
  }
  getIntent(botId) { return this.intents.get(botId); }
  teammateHasBombIntent(botId, x, y) {
    for (const [id, intent] of this.intents) {
      if (id === botId) continue;
      if (intent.x === x && intent.y === y && Date.now() - intent.ts < 2500) return true;
    }
    return false;
  }
  assignZone(botId, zoneX, zoneY, radius) {
    this.zones.set(botId, { x: zoneX, y: zoneY, r: radius });
  }
  getZone(botId) { return this.zones.get(botId); }
  clearStale() {
    const now = Date.now();
    for (const [id, intent] of this.intents) {
      if (now - intent.ts > 5000) this.intents.delete(id);
    }
  }
}

/* ============================================================================
 * 炸彈鏈反應規劃器 (ChainReactionPlanner)
 * 作業研究：評估放置新炸彈後，是否會引爆既有炸彈，並計算連鎖反應
 * 的總爆炸範圍與擊殺潛力。
 * ============================================================================ */
export class ChainReactionPlanner {
  constructor(gridSystem, mapManager, bombManager, explosionManager, monsterManager) {
    this.gridSystem = gridSystem;
    this.mapManager = mapManager;
    this.bombManager = bombManager;
    this.explosionManager = explosionManager;
    this.monsterManager = monsterManager;
  }
  cols() { return this.gridSystem ? this.gridSystem.cols : 13; }
  rows() { return this.gridSystem ? this.gridSystem.rows : 11; }
  isSolid(x, y) { return this.mapManager && this.mapManager.isSolid ? this.mapManager.isSolid(x, y) : false; }
  getBlockType(x, y) { return this.mapManager && this.mapManager.getBlockType ? this.mapManager.getBlockType(x, y) : 0; }

  blastCells(x, y, range, isPierce, shape = 'CROSS') {
    const dirs = shape === 'X' ? [[1,1],[1,-1],[-1,1],[-1,-1]] : (shape === 'ROUND' || shape === 'STAR') ? [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]] : [[0,-1],[0,1],[-1,0],[1,0]];
    const cells = new Set([`${x},${y}`]);
    const limit = (shape === 'ROUND') ? Math.floor(range / 2) : range;
    for (const [dx, dy] of dirs) {
      const li = (dx !== 0 && dy !== 0 && shape === 'ROUND') ? Math.floor(range / 2) : range;
      for (let i = 1; i <= li; i++) {
        const nx = x + dx * i, ny = y + dy * i;
        if (nx < 0 || nx >= this.cols() || ny < 0 || ny >= this.rows()) break;
        const bt = this.getBlockType(nx, ny);
        if (bt === 1) break;
        cells.add(`${nx},${ny}`);
        if (bt === 2 && !isPierce) break;
      }
    }
    return cells;
  }

  simulateChainReaction(newBombX, newBombY, newRange, newPierce, newShape, existingBombs) {
    const exploded = new Set();
    const totalBlast = new Set();
    const initialBlast = this.blastCells(newBombX, newBombY, newRange, newPierce, newShape);
    for (const cell of initialBlast) totalBlast.add(cell);
    let changed = true;
    const queue = [{ x: newBombX, y: newBombY, range: newRange, isPierce: newPierce, shape: newShape }];
    while (changed) {
      changed = false;
      const next = [];
      for (const blast of queue) {
        const cells = this.blastCells(blast.x, blast.y, blast.range, blast.isPierce, blast.shape);
        for (const cell of cells) {
          const [cx, cy] = cell.split(',').map(Number);
          for (const bomb of existingBombs || []) {
            if (bomb.isExploded) continue;
            if (bomb.x === cx && bomb.y === cy && !exploded.has(`${cx},${cy}`)) {
              exploded.add(`${cx},${cy}`);
              const chain = this.blastCells(bomb.x, bomb.y, bomb.range, !!bomb.isPierce, bomb.shape || 'CROSS');
              for (const c of chain) totalBlast.add(c);
              next.push({ x: bomb.x, y: bomb.y, range: bomb.range, isPierce: !!bomb.isPierce, shape: bomb.shape || 'CROSS' });
              changed = true;
            }
          }
        }
      }
      queue.length = 0;
      queue.push(...next);
    }
    return { totalBlast, explodedCount: exploded.size };
  }

  evaluateChainReactionSpots(bot, enemies, teammates = []) {
    const range = bot.fireRange || 5;
    const isPierce = !!bot.hasPierce;
    const shape = 'CROSS';
    const startX = bot.gridX, startY = bot.gridY;
    const existingBombs = this.bombManager ? this.bombManager.bombs.filter(b => !b.isExploded) : [];
    const spots = [{ x: startX, y: startY }];
    for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      const nx = startX + dx, ny = startY + dy;
      if (!this.isSolid(nx, ny)) spots.push({ x: nx, y: ny });
    }
    const results = [];
    for (const spot of spots) {
      if (this.isSolid(spot.x, spot.y)) continue;
      const sim = this.simulateChainReaction(spot.x, spot.y, range, isPierce, shape, existingBombs);
      const hitEnemies = enemies.filter(e => sim.totalBlast.has(`${e.x},${e.y}`));
      if (hitEnemies.length === 0 && sim.explodedCount === 0) continue;
      const chainBonus = sim.explodedCount * 50;
      const killBonus = hitEnemies.length * 100;
      const distPenalty = hitEnemies.reduce((sum, e) => sum + Math.abs(e.x - spot.x) + Math.abs(e.y - spot.y), 0);
      const score = killBonus + chainBonus - distPenalty * 5;
      results.push({ x: spot.x, y: spot.y, score, hitEnemies, chainCount: sim.explodedCount, totalBlast: sim.totalBlast });
    }
    results.sort((a, b) => b.score - a.score);
    return results;
  }
}
/* ============================================================================
 * Boss 專用戰術 (BossTactics)
 * 針對第 10/20/30/40/50/60 關（stage % 10 === 0）的龍王戰提供專屬策略。
 * ============================================================================ */
export class BossTactics {
  constructor(gridSystem, mapManager, bombManager, explosionManager, monsterManager, dangerMap) {
    this.gridSystem = gridSystem;
    this.mapManager = mapManager;
    this.bombManager = bombManager;
    this.explosionManager = explosionManager;
    this.monsterManager = monsterManager;
    this.dangerMap = dangerMap;
  }
  isBossStage(stage) { return stage % 10 === 0; }
  getBoss() {
    if (window.dragonBoss && !window.dragonBoss.isDead) return window.dragonBoss;
    return null;
  }
  _ex(e) { return e.gridX != null ? e.gridX : e.x; }
  _ey(e) { return e.gridY != null ? e.gridY : e.y; }
  evaluateBossTactics(bot, stage, enemies) {
    if (!this.isBossStage(stage)) return null;
    const boss = this.getBoss();
    if (!boss) return null;
    const bossX = this._ex(boss), bossY = this._ey(boss);
    const dist = Math.abs(bossX - bot.gridX) + Math.abs(bossY - bot.gridY);
    const range = bot.fireRange || 5;
    const safeDistance = range + 2;
    if (dist <= safeDistance) {
      return { action: 'attack_boss', targetX: bossX, targetY: bossY, dist, safe: dist <= range };
    }
    return { action: 'retreat_from_boss', targetX: bossX, targetY: bossY, dist, safe: false };
  }
  scoreBossWaitSpot(bot, x, y, stage) {
    if (!this.isBossStage(stage)) return -Infinity;
    const boss = this.getBoss();
    if (!boss) return 0;
    const bossX = this._ex(boss), bossY = this._ey(boss);
    const dist = Math.abs(bossX - x) + Math.abs(bossY - y);
    const range = bot.fireRange || 5;
    let score = 0;
    if (dist > range + 3) score += 50;
    else if (dist > range) score += 20;
    else score -= 50;
    let cover = 0;
    for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      const bt = this.getBlockType(x + dx, y + dy);
      if (bt === 1 || bt === 2) cover++;
    }
    score += cover * 10;
    return score;
  }
}

/* ============================================================================
 * 高關卡適應常數
 * 隨著關卡提升，提高安全邊際、降低冒險炸彈頻率。
 * ============================================================================ */
export const STAGE_DIFFICULTY = {
  getSafetyMargin(stage) {
    return Math.min(Math.floor((stage - 1) / 10), 3);
  },
  getBombRiskTolerance(stage) {
    return 60 + Math.min(Math.floor((stage - 1) / 5) * 10, 40);
  },
  isBossStage(stage) { return stage % 10 === 0; }
};

/* ============================================================================
 * 結果論驅動的策略更新函數
 * 在每局結束後調用，根據結果更新策略登記冊
 * ============================================================================ */

export function updateStrategyFromGameResult(mode, stage, won, details = {}) {
  // 修復：原實作呼叫 StrategyRegistry 上不存在的 recordAttempt/getStrategy，
  // 並引用未定義的全域 strategyUsed，會在每局結束時拋錯。
  // 改為使用實際存在的 record()/get()，並以 details.strategyUsed 推斷策略 id。
  try {
    const registry = sharedStrategyRegistry;
    const strategyId = (details && details.strategyUsed) || 'baseline';

    registry.record(strategyId, stage, won);
    const strategy = registry.get(strategyId);
    if (!strategy) { registry.save(); return; }

    if (!won) {
      const failurePatterns = analyzeFailurePattern(details);
      if (failurePatterns?.type === 'permanent_freeze') {
        strategy.improvementAttempts = 0;
        strategy.baselineWinRate = 0;
      } else if (failurePatterns?.type === 'own_fire') {
        strategy.baselineWinRate = Math.max((strategy.baselineWinRate || 0) - 0.05, 0);
      } else if (failurePatterns?.type === 'timeout') {
        if ((strategy.winRate || 0) < 0.3) {
          strategy.baselineWinRate = Math.max((strategy.baselineWinRate || 0) - 0.02, 0);
        }
      }
    }

    registry.save();
  } catch (e) {
    // 策略統計更新失敗不應中斷遊戲；靜默忽略。
  }
}

/* ============================================================================
 * 失敗模式分析（數據挖掘）
 * ============================================================================ */

function analyzeFailurePattern(details) {
  const { ownFire, bombsPlaced, monstersKilled, timeElapsed, stallDuration } = details;

  if (stallDuration && stallDuration > 50) {
    return {
      type: 'permanent_freeze',
      explanation: `長時間凍結：${stallDuration}s 完全無移動`
    };
  }

  if (ownFire && ownFire > 80) {
    return {
      type: 'own_fire',
      explanation: `自殺過多：${ownFire} 次自傷`
    };
  }

  if (monstersKilled && monstersKilled < 2) {
    return {
      type: 'low_kills',
      explanation: `擊殺不足：${monstersKilled} 隻`
    };
  }

  if (timeElapsed && timeElapsed < 30) {
    return {
      type: 'timeout',
      explanation: `時間不足：${timeElapsed}s 結束`
    };
  }

  return {
    type: 'unknown',
    explanation: '未分類的失敗模式'
  };
}

/* （此處原本重複宣告了 STAGE_DIFFICULTY，已移除；保留上方「高關卡適應常數」那一份） */

/* ============================================================================
 * 深度學習 + 作業研究 + 賽局理論 整合介面
 * ============================================================================ */

// 輔助：將字串轉換為哈希碼
String.prototype.hashCode = function() {
  let hash = 0;
  for (let i = 0; i < this.length; i++) {
    hash = ((hash << 5) - hash + this.charCodeAt(i)) | 0;
  }
  return hash;
};

// 學習率調整
export function adjustLearningRate(currentWeights, gameResult, stateFeatures, actionTaken) {
  const learningRate = 0.01;
  const adjusted = [...currentWeights];

  if (gameResult.won) {
    const featureIndex = Math.abs(actionTaken.hashCode() % currentWeights.length);
    adjusted[featureIndex] = Math.min(1, adjusted[featureIndex] + learningRate);
  } else {
    const featureIndex = Math.abs(actionTaken.hashCode() % currentWeights.length);
    adjusted[featureIndex] = Math.max(0, adjusted[featureIndex] - learningRate);
  }

  return adjusted;
}

/* ============================================================================
 * 導出匯總
 * ============================================================================ */

// 原檔尾混入了 TypeScript 專用的 `export type { ... }` 以及重複／未定義的 export，
// 這些在原生 ES module（.js）會造成 SyntaxError / duplicate / not-exported。
// 需要的具名 export 已由各自的 export const / export function / export class 提供。
export { analyzeFailurePattern };
