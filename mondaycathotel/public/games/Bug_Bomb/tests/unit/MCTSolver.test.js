import { describe, it, expect, beforeEach } from 'vitest';
import {
  StrategyRegistry,
  Strategy,
  STRATEGY_STATUS,
  HIGH_WIN_RATE_THRESHOLD,
  VERY_LOW_WIN_RATE_THRESHOLD,
  MIN_ATTEMPTS_FOR_RETENTION,
  MAX_IMPROVEMENT_ATTEMPTS,
} from '../../src/game/ai/AIStrategy.js';
import { installMCTSolver } from '../../src/game/ai/MCTSolver.js';

describe('策略登記冊的硬性規定（結果論）', () => {
  it('高勝率策略會被 RETENTION_LOCKED（絕對不可刪除、不可改良）', () => {
    const s = new Strategy('p', '測試高勝率');
    for (let i = 0; i < MIN_ATTEMPTS_FOR_RETENTION; i++) s.record(1, true);
    expect(s.winRate).toBe(1);
    expect(s.status).toBe(STRATEGY_STATUS.RETENTION_LOCKED);
    expect(s.tryImprove()).toBe(false);   // 硬性規定：鎖定後不可改寫
  });

  it('勝率過低策略會被直接捨棄', () => {
    const s = new Strategy('p', '測試極低勝率');
    for (let i = 0; i < MIN_ATTEMPTS_FOR_RETENTION; i++) s.record(1, false);
    expect(s.winRate).toBeLessThan(VERY_LOW_WIN_RATE_THRESHOLD);
    expect(s.status).toBe(STRATEGY_STATUS.DISCARDED);
  });

  it('改良有上限：測試 30 次仍無效就捨棄', () => {
    const s = new Strategy('p', '測試改良上限');
    for (let i = 0; i < 15; i++) s.record(1, false);
    for (let i = 0; i < 5; i++) s.record(1, true);   // 25%：低但不算極低
    expect(s.winRate).toBeCloseTo(0.25, 5);
    // 真實流程：邊改邊量。每次改良嘗試都伴隨一場重新量測。
    for (let i = 0; i < MAX_IMPROVEMENT_ATTEMPTS; i++) {
      expect(s.tryImprove()).toBe(true);
      s.record(1, false);
    }
    expect(s.tryImprove()).toBe(false);              // 上限已達
    expect(s.status).toBe(STRATEGY_STATUS.DISCARDED);
  });

  it('改良真的有效（勝率明顯上升）時不捨棄', () => {
    const s = new Strategy('p', '測試改良有效');
    for (let i = 0; i < 15; i++) s.record(1, false);
    for (let i = 0; i < 5; i++) s.record(1, true);   // 25% 起步
    for (let i = 0; i < MAX_IMPROVEMENT_ATTEMPTS; i++) {
      s.tryImprove();
      s.record(1, i < 27);                          // 90% 勝率
    }
    expect(s.tryImprove()).toBe(false);
    expect(s.winRate).toBeGreaterThan(0.6);
    expect(s.status).not.toBe(STRATEGY_STATUS.DISCARDED);
  });

  it('重新量測的樣本不夠時，不提早判定捨棄（避免淘汰掉正在改良的策略）', () => {
    const s = new Strategy('p', '測試樣本不足');
    for (let i = 0; i < 15; i++) s.record(1, false);
    for (let i = 0; i < 5; i++) s.record(1, true);   // 25% 起步
    for (let i = 0; i < MAX_IMPROVEMENT_ATTEMPTS; i++) s.tryImprove();
    // 只重測 5 場（< MIN_ATTEMPTS_FOR_RETENTION）：不足以判定
    for (let i = 0; i < 5; i++) s.record(1, false);
    expect(s.status).toBe(STRATEGY_STATUS.IMPROVING);
  });
});

describe('政策層選擇（selectPolicy）', () => {
  let reg;
  beforeEach(() => {
    reg = new StrategyRegistry();
    for (const id of ['policy_hunter', 'policy_mctsolver']) {
      const s = reg.get(id);
      s.wins = 0; s.attempts = 0; s.improvementAttempts = 0;
      s.status = STRATEGY_STATUS.ACTIVE; s.stageResults = {};
    }
  });

  it('樣本不足時，保留已知的高勝率策略（hunter），不冒險換候選', () => {
    for (let i = 0; i < 25; i++) reg.get('policy_hunter').record(1, true);
    expect(reg.selectPolicy('BOT_SINGLE', 1)).toBe('policy_hunter');
  });

  it('hunter 勝率不足而 mctsolver 明顯更好時，選 mctsolver', () => {
    for (let i = 0; i < 20; i++) reg.get('policy_hunter').record(1, false);
    for (let i = 0; i < 20; i++) reg.get('policy_mctsolver').record(1, true);
    expect(reg.selectPolicy('BOT_SINGLE', 1)).toBe('policy_mctsolver');
  });

  it('兩者都達到高勝率門檻時，取勝率高者', () => {
    for (let i = 0; i < 20; i++) reg.get('policy_hunter').record(1, true);
    for (let i = 0; i < 25; i++) reg.get('policy_mctsolver').record(1, true);

/** 最小假世界：邊界與 even-even 是硬牆，其餘空地（與 MapManager 的規則一致） */
function makeFakeWorld(cols = 9, rows = 7) {
  const grid = [];
  for (let y = 0; y < rows; y++) {
    grid[y] = [];
    for (let x = 0; x < cols; x++) {
      if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) grid[y][x] = 1;
      else if (x % 2 === 0 && y % 2 === 0) grid[y][x] = 1;
      else grid[y][x] = 0;
    }
  }
  const cell = 40;
  const gs = {
    cols, rows, offsetX: 0, offsetY: 0,
    getCellSize: () => cell,
    getPixelCoord: (gx, gy) => ({ x: gx * cell, y: gy * cell }),
    getGridCoord: (px, py) => ({ x: Math.floor((px + cell / 2) / cell), y: Math.floor((py + cell / 2) / cell) }),
    updateCellSize() {},
  };
  const mm = {
    getBlockType: (x, y) => (x < 0 || y < 0 || x >= cols || y >= rows ? 1 : grid[y][x]),
    isSolid: (x, y) => (x < 0 || y < 0 || x >= cols || y >= rows ? true : grid[y][x] === 1 || grid[y][x] === 2),
  };
  const bm = { bombs: [], hasBombAt: () => false, getBombAt: () => null };
  const em = { explosions: [] };
  const mo = { monsters: [] };
  const dm = { getDangerInfo: () => ({ isFlameActive: false, dangerLevel: 0, explosionTimer: Infinity }) };
  return { gs, mm, bm, em, mo, dm, im: null };
}

function makeFakeBot() {
  return {
    gridX: 1, gridY: 1, x: 40, y: 40,
    maxBombs: 1, currentBombs: 0, fireRange: 5,
    hasPierce: false, hasDiagonalFire: false,
    hp: 3, maxHp: 3, noBombTimer: 0,
    aiInput: { up: false, down: false, left: false, right: false, bomb: false },
    canPhysicallyMove: () => true,
    getExplosionCells: () => new Set(['1,1', '1,2', '1,3', '2,1', '3,1']),
    getFuseTime: () => 3,
    getEffectiveSpeed: () => 4,
    // 刻意回報「逃不掉」：驗證安全性質 —— 不能逃就不該放彈。
    canSafelyPlaceBomb: () => ({ canEscape: false, path: [], safeCell: null, time: 0 }),
    targetPath: [],
  };
}

describe('installMCTSolver：掛載不變量（安全性質，不隨情境改變）', () => {
  it('掛載不拋錯、think 是函式、沒有怪時不按炸彈', () => {
    const w = makeFakeWorld();
    const bot = makeFakeBot();
    const stats = {};
    expect(() => installMCTSolver(bot, w, stats)).not.toThrow();
    expect(typeof bot.think).toBe('function');
    bot.think();
    for (const k of ['up', 'down', 'left', 'right', 'bomb']) {
      expect(typeof bot.aiInput[k]).toBe('boolean');
    }
    expect(bot.aiInput.bomb).toBe(false);
  });

  it('不能逃生的時候絕不按炸彈（保性命的不變量）', () => {
    const w = makeFakeWorld();
    const bot = makeFakeBot();
    // 一隻怪走進十字火線：這是「該殺」的情境，但 canSafelyPlaceBomb 說逃不掉
    const cell = w.gs.getCellSize();
    w.mo.monsters = [{
      gridX: 3, gridY: 1, x: 3 * cell, y: 1 * cell,
      direction: { dx: 1, dy: 0 }, speed: 1, ai: 'chase',
      type: 'ZOMBIE', wallPass: false, breakWall: false, isDead: false,
    }];
    installMCTSolver(bot, w, {});
    for (let f = 0; f < 40; f++) {
      bot.think();
      expect(bot.aiInput.bomb).toBe(false);
    }
  });

  it('被怪貼住時保證會輸出移動指令（不凍結 = 不會被摸死）', () => {
    const w = makeFakeWorld();
    const bot = makeFakeBot();
    bot.gridX = 1; bot.gridY = 1; bot.x = 40; bot.y = 40;
    const cell = w.gs.getCellSize();
    w.mo.monsters = [{
      gridX: 2, gridY: 1, x: 2 * cell, y: 1 * cell,
      direction: { dx: 1, dy: 0 }, speed: 1, ai: 'chase',
      type: 'ZOMBIE', wallPass: false, breakWall: false, isDead: false,
    }];
    installMCTSolver(bot, w, {});
    let moved = false;
    for (let f = 0; f < 30; f++) {
      bot.think();
      const ai = bot.aiInput;
      if (ai.up || ai.down || ai.left || ai.right) moved = true;
    }
    expect(moved).toBe(true);
  });

  it('legacy 覆寫層被中和（不再改寫本政策的輸入）', () => {
    const w = makeFakeWorld();
    const bot = makeFakeBot();
    installMCTSolver(bot, w, {});
    expect(bot.needsCentering()).toBe(false);
    expect(bot.vetoUnsafeBombPlacement()).toBeUndefined();
    expect(bot.breakOutOfStall()).toBe(false);
    expect(bot.ensureSomeAction()).toBeUndefined();
    expect(bot.forceMoveIfPossible()).toBe(false);
  });
});

    for (let i = 0; i < 5; i++) reg.get('policy_mctsolver').record(1, false);
    expect(reg.selectPolicy('BOT_SINGLE', 1)).toBe('policy_hunter');
  });

  it('被捨棄的政策永遠不會被選用', () => {
    reg.get('policy_hunter').status = STRATEGY_STATUS.DISCARDED;
    expect(reg.selectPolicy('BOT_SINGLE', 1)).toBe('policy_mctsolver');
  });
});
