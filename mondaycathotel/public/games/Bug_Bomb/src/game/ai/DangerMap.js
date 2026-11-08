import { computeBlastCells, normalizeShape } from './blast.js';

export class DangerMap {
    constructor(gridSystem, mapManager, bombManager, explosionManager, monsterManager) {
        this.gridSystem = gridSystem;
        this.mapManager = mapManager;
        this.bombManager = bombManager;
        this.explosionManager = explosionManager;
        this.monsterManager = monsterManager;
        this.grid = [];
        this.initGrid();
    }

    initGrid() {
        this.grid = [];
        for (let y = 0; y < this.gridSystem.rows; y++) {
            const row = [];
            for (let x = 0; x < this.gridSystem.cols; x++) {
                row.push({
                    dangerLevel: 0,
                    explosionTimer: Infinity,
                    isFlameActive: false,
                    isMonsterDanger: false,
                    // ===== 新增：怪物威脅強度，與「火焰危險」完全分離 =====
                    //
                    // 原本 monsterDanger 與 fire danger 共用 dangerLevel / explosionTimer，
                    // 造成兩套機制互相矛盾（詳見 update() 的說明）。
                    // monsterThreat 是一個獨立的度量：
                    //   0 = 沒有怪物威脅
                    //   1 = 怪物可能移動過來的鄰格
                    //   2 = 怪物現在所在格
                    monsterThreat: 0
                });
            }
            this.grid.push(row);
        }
    }

    update() {
        // ---------- 第一階段：重置，並建立「純火焰危險」基底 ----------
        for (let y = 0; y < this.gridSystem.rows; y++) {
            for (let x = 0; x < this.gridSystem.cols; x++) {
                const c = this.grid[y][x];
                if (this.mapManager.isSolid(x, y)) {
                    c.dangerLevel = 100;
                    c.explosionTimer = 0;
                    c.isFlameActive = false;
                    c.isMonsterDanger = false;
                    c.monsterThreat = 0;
                } else {
                    c.dangerLevel = 0;
                    c.explosionTimer = Infinity;
                    c.isFlameActive = false;
                    c.isMonsterDanger = false;
                    c.monsterThreat = 0;
                }
            }
        }

        // ---------- 第二階段：正在燃燒的火焰（立即致命）----------
        if (this.explosionManager) {
            for (const exp of this.explosionManager.explosions) {
                if (!exp.isDone && this.grid[exp.gridY] && this.grid[exp.gridY][exp.gridX]) {
                    const c = this.grid[exp.gridY][exp.gridX];
                    c.dangerLevel = 100;
                    c.explosionTimer = 0;
                    c.isFlameActive = true;
                }
            }
        }

        // ---------- 第三階段：尚未爆炸的炸彈（預警範圍）----------
        //
        // ===== 這裡是「AI 躲錯位置」的頭號根因 =====
        //
        // 舊版把方向寫死成四方向十字形：
        //     const directions = [
        //         { dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }
        //     ];
        // 完全忽略炸彈的 shape。
        //
        // 但真正造成傷害的 ExplosionManager.createExplosion() 會依 shape 改變方向：
        //   'X'      → 對角線四方向
        //   'ROUND'  → 十字 + 對角（對角只有一半長）
        //   'LASER'  → 十字、貫穿軟磚、range 直接變成 20
        //
        // 後果：對角線的格子在危險地圖裡被標成「安全」，
        //       實際上卻會被火焰掃到 —— AI 就這樣走進火裡。
        //
        // 修正：改用 blast.js 的 computeBlastCells()，
        //       它是 ExplosionManager 的純函式複製品，規則完全一致。
        if (this.bombManager) {
            for (const bomb of this.bombManager.bombs) {
                if (bomb.isExploded) continue;

                const shape = normalizeShape(bomb.shape);
                const cells = computeBlastCells(this.gridSystem, this.mapManager,
                    bomb.gridX, bomb.gridY, bomb.fireRange, bomb.isPierce, shape);

                for (const key of cells) {
                    const [cx, cy] = key.split(',').map(Number);
                    const c = this.grid[cy] && this.grid[cy][cx];
                    if (!c) continue;
                    c.dangerLevel += 50;
                    c.explosionTimer = Math.min(c.explosionTimer, bomb.timer);
                }
            }
        }

        // ---------- 第四階段：怪物威脅（完全不碰火焰欄位）----------
        //
        // ===== 這裡是「偵測敵人」與「保護自己」互相矛盾的根因 =====
        //
        // 舊版怪物迴圈寫在炸彈迴圈「之後」，並且這樣寫：
        //     this.grid[ny][nx].dangerLevel += 40;
        //     this.grid[ny][nx].explosionTimer = 0;     // ← 覆蓋掉！
        //
        // 兩個問題：
        //  1) explosionTimer = 0 的語意是「現在就會炸」，
        //     但怪物根本不會爆炸。於是「旁邊有怪物」被誤判成「這裡現在就有火」，
        //     isCellSafe() 的 `dangerLevel > 0 && currentTime >= explosionTimer`
        //     對每一個怪物鄰格都成立 → 這些格永遠被當成不安全。
        //  2) 由於怪物迴圈在後，它會把那些格「本來正確的炸彈倒數」覆蓋成 0，
        //     於是真正的火場資訊被怪物資訊污染。
        //
        // 結果：AI 一邊「偵測到怪物要躲」，一邊「以為躲的地方沒有火」，
        //       兩個判斷互相打架，最後站在火裡被燒死。
        //
        // 修正：怪物資訊改寫進獨立的 monsterThreat 欄位，
        //       絕不再觸碰 dangerLevel / explosionTimer / isFlameActive。
        //       「火焰危險」與「怪物威脅」从此各管各的，不再互相覆蓋。
        if (this.monsterManager && this.monsterManager.monsters) {
            for (const monster of this.monsterManager.monsters) {
                if (monster.isDead) continue;

                const here = this.grid[monster.gridY] && this.grid[monster.gridY][monster.gridX];
                if (here) {
                    here.isMonsterDanger = true;
                    here.monsterThreat = 2;
                    // ===== 怪物不污染 dangerLevel =====
                    //
                    // 實測（決定性）：DangerMap 讓怪物貢獻 dangerLevel += 80/40 時，
                    // 「火場內曾出現怪物」在 20 顆炸彈裡是 0 次，
                    // 狀態分布只有 FLEE/PATROL/BREAK_WALLS/WALL_DEFEND/GATHER，
                    // 完全沒有任何攻擊狀態（SNIPE / BREACH_FOR_ATTACK）。
                    //
                    // 原因鏈：canSafelyPlaceBomb() 要求撤退到 dangerLevel === 0 的格，
                    // 而怪物貢獻 40/80 → 幾乎沒有這樣的格 → canEscape 永遠 false
                    // → 所有攻擊分支的 `if (!canEscape) continue;` 永遠生效
                    // → AI 一次都沒有進入過攻擊狀態，放的彈全是開路用的工具彈。
                    //
                    // 這才是擊殺為 0 的真正原因，不是「怪物跑太快打不到」。
                    //
                    // 怪物資訊改由獨立的 monsterThreat 承載（下方設定），
                    // 「要不要躲怪物」交給 hasMonsterThreat() 與 planMonsterEscape()。
                    // 火焰危險則維持 dangerLevel / explosionTimer 的原語意。
                    here.dangerLevel += 0;
                }

                const dirs = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}];
                for (const d of dirs) {
                    const nx = monster.gridX + d.dx;
                    const ny = monster.gridY + d.dy;
                    const c = this.grid[ny] && this.grid[ny][nx];
                    // 不可通行的格不需要標記（AI 本來也走不進去）
                    if (c && !this.mapManager.isSolid(nx, ny)) {
                        if (c.monsterThreat < 1) {
                            c.isMonsterDanger = true;
                            c.monsterThreat = 1;
                        }
                        c.dangerLevel += 0;
                    }
                }
            }
        }
    }

    getDangerLevel(x, y) {
        if (y >= 0 && y < this.gridSystem.rows && x >= 0 && x < this.gridSystem.cols) {
            return this.grid[y][x].dangerLevel;
        }
        return 100;
    }

    getDangerInfo(x, y) {
        if (y >= 0 && y < this.gridSystem.rows && x >= 0 && x < this.gridSystem.cols) {
            return this.grid[y][x];
        }
        // 越界視為最危險（但沒有怪物）
        return {
            dangerLevel: 100,
            explosionTimer: 0,
            isFlameActive: false,
            isMonsterDanger: false,
            monsterThreat: 0
        };
    }
}
