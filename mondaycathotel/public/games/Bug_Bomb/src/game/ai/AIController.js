/**
 * 超級炸彈超人 — 電腦 AI 決策控制器
 * 串接 Bot 與 AIStrategy（深度學習 + 作業研究 + 賽局理論 + 結果論）
 * 優先級：保命 > 安全放炸彈擊殺 > 移動/站位 > 合作協調
 */

import {
  StrategyRegistry, STRATEGY_STATUS, HIGH_WIN_RATE_THRESHOLD,
  selectStrategyForStage, updateStrategyFromGameResult,
  OnlineNeuralNetwork, ORPlanner, CoopCoordinator,
  ChainReactionPlanner, BossTactics, STAGE_DIFFICULTY,
} from './AIStrategy.js';

const ACTIONS = ['up', 'down', 'left', 'right', 'bomb'];

export class AIController {
  constructor(bot, registry, nn, planner, coordinator, botId, chainReactionPlanner, bossTactics) {
    this.bot = bot;
    this.botId = botId;
    this.registry = registry;
    this.nn = nn;
    this.planner = planner;
    this.coordinator = coordinator;
    this.chainReactionPlanner = chainReactionPlanner;
    this.bossTactics = bossTactics;
    this.enabled = true;
    this.history = [];
    this.stage = 1;
    this.lastBombTime = 0;
    this.time = 0;
    this.bombRiskTolerance = 60;
    if (bot.dangerMap) this.planner.dangerMap = bot.dangerMap;
    if (chainReactionPlanner) chainReactionPlanner.gridSystem = bot.gridSystem;
    if (bossTactics) bossTactics.gridSystem = bot.gridSystem;
  }

  tick(deltaTime, stage, enemies, teammates) {
    this.time += deltaTime;
    this.stage = stage;
    // 高關卡適應：提高安全邊際，降低放炸彈風險容忍
    this.bombRiskTolerance = STAGE_DIFFICULTY.getBombRiskTolerance(stage);

    // ===== 決策權委派回 bot.think()（恢復戰力的實測正解）=====
    //
    // 插樁實測（_probe_combat.mjs，各 8 場 / 60 秒，同一組種子）：
    //   AIController 停用、由 think() 驅動 → 8 場共 38 顆彈、8 殺、1 clear
    //   AIController 啟用、由其 tick 驅動  → 8 場共 0 顆彈、0 殺、0 clear
    //   （其中 decideBomb 被呼叫 28800 次，「決定放彈」卻只有 0 次）
    //
    // 根因：這個 AIController 的 NN/OR 戰鬥決策在半成品重構後已不完整
    // （decideBomb 只會放「當下爆破就命中」的彈，而本遊戲要靠誘敵／投機彈，
    // 且它幾乎不站位去湊 alignment）。真正會打的是 Bot.think()
    // （Bug 2/3/5 與其餘數十輪打磨都在那一條決策鏈）。
    //
    // 因此把「每幀決策」交回 think()；AIController 只保留低成本的狀態記帳，
    // 不再自行產生那些幾乎全空的動作指令。若日後要重建 AIController 的戰鬥邏輯，
    // 只要在下方改回呼叫 handleImmediateDanger/decideBomb/decideMovement 即可。
    if (this.bot && this.bot.isDead) return;
    try {
      const selected = this.registry.selectStrategyForMode(this.mode, stage, enemies, this.botId);
      this.currentStrategy = selected ? selected.strategy : null;   // 純記錄，不影響動作
    } catch (e) { /* 策略記帳失敗不應影響決策 */ }

    if (this.bot && typeof this.bot.think === 'function') {
      this.bot.think();
    }
  }

  extractFeatures(stage, enemies, teammates) {
    const bot = this.bot;
    const cols = bot.gridSystem ? bot.gridSystem.cols : 13;
    const rows = bot.gridSystem ? bot.gridSystem.rows : 11;
    const f = new Array(14).fill(0);
    f[0] = bot.gridX / Math.max(cols - 1, 1);
    f[1] = bot.gridY / Math.max(rows - 1, 1);
    const info = this.planner.dangerAt(bot.gridX, bot.gridY);
    f[2] = Math.min(info.dangerLevel, 100) / 100;
    f[3] = info.isFlameActive ? 1 : 0;
    f[4] = (info.explosionTimer === Infinity ? 0 : Math.max(0, 3 - info.explosionTimer) / 3);
    let nearest = 999;
    for (const e of enemies || []) {
      const d = Math.abs(e.x - bot.gridX) + Math.abs(e.y - bot.gridY);
      if (d < nearest) nearest = d;
    }
    f[5] = nearest === 999 ? 1 : 1 - Math.min(nearest, 10) / 10;
    f[6] = Math.min((enemies || []).length, 10) / 10;
    f[7] = bot.currentBombs / Math.max(bot.maxBombs, 1);
    f[8] = Math.min((bot.fireRange || 5), 10) / 10;
    f[9] = Math.min(stage, 60) / 60;
    f[10] = bot.hasPierce ? 1 : 0;
    f[11] = bot.hasSuperBomb ? 1 : 0;
    f[12] = Math.min((teammates.filter(t => t && !t.isDead).length + 1), 2) / 2;
    f[13] = Math.min(this.time, 60) / 60;
    return f;
  }

  handleImmediateDanger(bot, features, pred) {
    const onBomb = bot.bombManager && bot.bombManager.getBombAt(bot.gridX, bot.gridY);
    const info = this.planner.dangerAt(bot.gridX, bot.gridY);
    const inDanger = (onBomb && !onBomb.isExploded) || info.isFlameActive || info.dangerLevel >= 100;
    if (!inDanger) return false;
    const speed = bot.getEffectiveSpeed ? bot.getEffectiveSpeed() : (bot.speed || 4);
    const escape = this.planner.findSafeEscape(bot.gridX, bot.gridY, speed, 3.0);
    if (escape && escape.path.length > 0) {
      const first = escape.path[0];
      this.setDir(bot, first.x - bot.gridX, first.y - bot.gridY);
      return true;
    }
    const wait = this.planner.chooseSafeWaitSpot(bot, 8);
    if (wait && wait.path.length > 0) {
      const first = wait.path[0];
      this.setDir(bot, first.x - bot.gridX, first.y - bot.gridY);
      return true;
    }
    const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
    for (const [dx, dy] of dirs) {
      if (bot.canPhysicallyMove(dx, dy) && !this.planner.isSolid(bot.gridX + dx, bot.gridY + dy)) {
        this.setDir(bot, dx, dy); return true;
      }
    }
    return true;
  }

  setDir(bot, dx, dy) {
    if (dx > 0) bot.aiInput.right = true;
    else if (dx < 0) bot.aiInput.left = true;
    else if (dy > 0) bot.aiInput.down = true;
    else if (dy < 0) bot.aiInput.up = true;
  }

  _ex(e) { return e.gridX != null ? e.gridX : e.x; }
  _ey(e) { return e.gridY != null ? e.gridY : e.y; }

  decideBomb(bot, enemies, teammates, features, pred) {
    if (this.time - this.lastBombTime < 0.5) return false;
    if (bot.currentBombs >= (bot.maxBombs || 1)) return false;
    const enemiesN = (enemies || []).map(e => ({ x: this._ex(e), y: this._ey(e) }));
    const regularSpots = this.planner.evaluateBombSpots(bot, enemiesN, teammates);
    let best = regularSpots[0];
    let source = 'regular';
    if (this.chainReactionPlanner) {
      const chainSpots = this.chainReactionPlanner.evaluateChainReactionSpots(bot, enemiesN, teammates);
      const chainBest = chainSpots[0];
      if (chainBest && (!best || chainBest.score > best.score)) {
        best = chainBest;
        source = 'chain';
      }
    }
    if (!best) return false;
    const nnBombPref = pred[4] || 0;
    const worthIt = best.hitEnemies.length >= 1 && (best.score >= this.bombRiskTolerance || nnBombPref > 0.55);
    if (!worthIt) return false;
    if (this.coordinator.teammateHasBombIntent(this.botId, best.x, best.y)) return false;
    this.lastBombTime = this.time;
    bot.aiInput.bomb = true;
    if (best.path && best.path.length > 0) {
      const first = best.path[0];
      this.setDir(bot, first.x - bot.gridX, first.y - bot.gridY);
    }
    this.coordinator.registerIntent(this.botId, {
      x: best.x, y: best.y, range: bot.fireRange || 5, stage: this.stage, ts: this.time, source,
    });
    return true;
  }

  decideMovement(bot, enemies, teammates, features, pred) {
    const speed = bot.getEffectiveSpeed ? bot.getEffectiveSpeed() : (bot.speed || 4);
    const stage = this.stage;
    const isBoss = STAGE_DIFFICULTY.isBossStage(stage);

    // Boss 專用戰術：Boss 關優先處理龍王
    if (isBoss && this.bossTactics) {
      const bossTactic = this.bossTactics.evaluateBossTactics(bot, stage, enemies);
      if (bossTactic) {
        if (bossTactic.action === 'retreat_from_boss') {
          // 撤離到安全距離：朝遠離 Boss 的方向走，或找安全等待點
          const dx = bot.gridX - bossTactic.targetX;
          const dy = bot.gridY - bossTactic.targetY;
          const moveDir = this._pickSafeMoveDir(bot, dx, dy, pred);
          if (moveDir) { this.setDir(bot, moveDir[0], moveDir[1]); return; }
          // 撤離到安全等待點
          const wait = this.planner.chooseSafeWaitSpot(bot, 8);
          if (wait && wait.path.length > 0) {
            const first = wait.path[0];
            this.setDir(bot, first.x - bot.gridX, first.y - bot.gridY);
            return;
          }
        } else if (bossTactic.action === 'attack_boss' && bossTactic.safe) {
          // 在射程內且安全，朝 Boss 靠近並準備放炸彈（decideBomb 會處理放彈）
          const dx = bossTactic.targetX - bot.gridX;
          const dy = bossTactic.targetY - bot.gridY;
          const moveDir = this._pickSafeMoveDir(bot, dx, dy, pred);
          if (moveDir) { this.setDir(bot, moveDir[0], moveDir[1]); return; }
        }
      }
    }

    let target = null;
    const nearest = this.nearestEnemy(bot, enemies);
    if (nearest) {
      const dist = Math.abs(this._ex(nearest) - bot.gridX) + Math.abs(this._ey(nearest) - bot.gridY);
      if (dist <= (bot.fireRange || 5) + 2) target = { x: this._ex(nearest), y: this._ey(nearest) };
    }
    if (!target) {
      const wait = this.planner.chooseSafeWaitSpot(bot, 6);
      if (wait) target = { x: wait.x, y: wait.y, path: wait.path };
    }
    if (target) {
      const path = target.path || this.planner.bfsPath(bot.gridX, bot.gridY, target.x, target.y);
      if (path && path.length > 0) {
        const first = path[0];
        this.setDir(bot, first.x - bot.gridX, first.y - bot.gridY);
        return;
      }
    }
    const dirs = [[0,-1,'up'],[0,1,'down'],[-1,0,'left'],[1,0,'right']];
    const movePrefs = [pred[0], pred[1], pred[2], pred[3]];
    let bestDir = null, bestPref = -1;
    for (let i = 0; i < dirs.length; i++) {
      const [dx, dy] = dirs[i];
      if (!bot.canPhysicallyMove(dx, dy)) continue;
      if (this.planner.isSolid(bot.gridX + dx, bot.gridY + dy)) continue;
      if (this.planner.dangerAt(bot.gridX + dx, bot.gridY + dy).isFlameActive) continue;
      if (movePrefs[i] > bestPref) { bestPref = movePrefs[i]; bestDir = [dx, dy]; }
    }
    if (bestDir) this.setDir(bot, bestDir[0], bestDir[1]);
  }

  _pickSafeMoveDir(bot, wantDx, wantDy, pred) {
    const dirs = [];
    if (wantDx !== 0) dirs.push([wantDx > 0 ? 1 : -1, 0]);
    if (wantDy !== 0) dirs.push([0, wantDy > 0 ? 1 : -1]);
    const movePrefs = [pred[0], pred[1], pred[2], pred[3]];
    const dirMap = [[0,-1,'up'],[0,1,'down'],[-1,0,'left'],[1,0,'right']];
    let bestDir = null, bestPref = -1;
    for (const [dx, dy] of dirs) {
      if (!bot.canPhysicallyMove(dx, dy)) continue;
      if (this.planner.isSolid(bot.gridX + dx, bot.gridY + dy)) continue;
      if (this.planner.dangerAt(bot.gridX + dx, bot.gridY + dy).isFlameActive) continue;
      const idx = dirMap.findIndex(d => d[0] === dx && d[1] === dy);
      const pref = idx >= 0 ? movePrefs[idx] : 0;
      if (pref > bestPref) { bestPref = pref; bestDir = [dx, dy]; }
    }
    return bestDir;
  }

  nearestEnemy(bot, enemies) {
    let best = null, bestD = Infinity;
    for (const e of enemies || []) {
      const d = Math.abs(this._ex(e) - bot.gridX) + Math.abs(this._ey(e) - bot.gridY);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  endStage(won) {
    const bot = this.bot;
    // ---- 結果論：把「這台 Bot 這一次用的是哪個決策大腦」記進登記冊 ----
    // 只有這樣，selectPolicy() 才有資料可用，否則永遠退回預設策略。
    const policyId = (bot && bot._activePolicy)
      ? ('policy_' + bot._activePolicy)          // 'policy_hunter' | 'policy_mctsolver'
      : 'policy_hunter';
    try { this.registry.record(policyId, this.stage, won); } catch (e) { /* 不中斷遊戲 */ }

    const strategy = this.registry.select(this.stage, 0);
    const sid = strategy ? strategy.id : 'unknown';
    this.registry.record(sid, this.stage, won);
    const reward = won ? 1 : -1;
    const target = new Array(5).fill(0.01);
    const lastAction = this.history.length ? this.history[this.history.length - 1].action : 'bomb';
    const ai = ACTIONS.indexOf(lastAction);
    if (ai >= 0) target[ai] = won ? 0.9 : 0.1;
    for (const rec of this.history) this.nn.train(rec.inputs, target);
    this.history = [];
  }

  recordDecision(inputs, action) {
    this.history.push({ inputs: inputs.slice(), action });
  }

}

/* ============================================================================
 * 共用單例：所有電腦 Bot 共享同一個策略登記冊、神經網路與合作協調器，
 * 使雙電腦模式下兩台 Bot 能協調並共同累積勝率學習（結果論）。
 * ============================================================================ */
// 這些類別已於檔案頂部一次匯入；此處直接建立 Bot 與隊友 AI 共享的實例。
export const sharedRegistry = new StrategyRegistry();
export const sharedNn = new OnlineNeuralNetwork(14, 16, 5);
export const sharedCoordinator = new CoopCoordinator();

/* ============================================================================
 * 自我對弈模擬訓練器 (SelfPlayTrainer)
 * 不需真人操作，讓 AI 自己跑多局累積經驗（結果論訓練）。
 * 在訓練模式下，每關結束後自動進入下一關，並記錄勝負供神經網路與策略登記冊學習。
 * ============================================================================ */
export class SelfPlayTrainer {
  constructor({ maxStages = 60, gamesPerStage = 1, mode = 'BOT_SINGLE', onProgress } = {}) {
    this.maxStages = maxStages;
    this.gamesPerStage = gamesPerStage;
    this.mode = mode;
    this.onProgress = onProgress;
    this.running = false;
    this.currentStage = 1;
    this.gamesLeft = 0;
    this.stats = { wins: 0, losses: 0, total: 0, byStage: {} };
    this._boundOnStageEnd = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.currentStage = 1;
    this.gamesLeft = this.gamesPerStage;
    this._setupHook();
    this._beginGame();
    console.log('[SelfPlayTrainer] 訓練開始：模式', this.mode, '關卡', this.currentStage);
  }

  stop() {
    this.running = false;
    this._removeHook();
    console.log('[SelfPlayTrainer] 訓練停止', this.stats);
  }

  _setupHook() {
    // 攔截 endStage 結果：每關結束後自動決定下一步
    const origEndStage = AIController.prototype.endStage;
    this._boundOnStageEnd = (bot, won) => {
      if (!this.running) return;
      this.stats.total += 1;
      if (won) this.stats.wins += 1; else this.stats.losses += 1;
      const s = this.currentStage;
      this.stats.byStage[s] = this.stats.byStage[s] || { wins: 0, losses: 0 };
      if (won) this.stats.byStage[s].wins += 1; else this.stats.byStage[s].losses += 1;

      this.gamesLeft -= 1;
      if (this.onProgress) this.onProgress(this.currentStage, won, this.stats);

      if (this.gamesLeft > 0) {
        // 同一關再玩一局
        this._beginGame();
      } else {
        // 進入下一關
        this.currentStage += 1;
        if (this.currentStage > this.maxStages) {
          console.log('[SelfPlayTrainer] 全部訓練完成', this.stats);
          this.stop();
          return;
        }
        this.gamesLeft = this.gamesPerStage;
        this._beginGame();
      }
    };
    // 將 hook 註冊到 window，供 main.js 呼叫端使用
    window.__selfPlayHook = this._boundOnStageEnd;
  }

  _removeHook() {
    window.__selfPlayHook = null;
  }

  _beginGame() {
    // 以訓練模式初始化遊戲
    if (typeof window.initGame === 'function') {
      // 切換到純電腦模式
      const prev = window.gameMode;
      window.gameMode = this.mode;
      window.initGame();
      window.gameMode = prev;
    }
  }

  /** 供 main.js 在關卡結束（VICTORY/GAMEOVER）時呼叫，將結果回傳給訓練器。
   * 僅負責訓練流程統計與自動進入下一關；策略/NN 記錄由 main.js 直接呼叫 endStage 負責。 */
  onStageResult(won) {
    if (!this.running || !this._boundOnStageEnd) return;
    this._boundOnStageEnd(null, won);
  }
}

export const sharedSelfPlayTrainer = new SelfPlayTrainer({ maxStages: 60, gamesPerStage: 1, mode: 'BOT_SINGLE' });
