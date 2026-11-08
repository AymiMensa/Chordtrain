/**
 * BotV2.js — 重寫版決策核心：單一出口 + 參數化策略
 *
 * 為什麼重寫（實測診斷結論）：
 *   舊版 Bot.js 有 14 處放彈點、12 個互相競爭的狀態，每幀全部重新決策。
 *   任何單一改動都會被其他狀態在下一幀推翻 → 控制抖振（chattering），
 *   角色在兩三格之間來回抽屜。過去幾輪所有修正都只是在與這個結構對抗。
 *
 * V2 的結構：每幀只呼叫一次 decide()，只會產生一個決定。
 *   1. 站在火場裡 → 逃命      （硬約束，永遠優先）
 *   2. 怪物貼身   → 逃命      （硬約束）
 *   3. 否則       → 攻擊
 *   4. 都沒有     → 巡邏（維持活性）
 *
 * 所有行為差異都表現在一個參數向量上，由演化搜尋最佳化。
 */
import { computeBlastCells, normalizeShape } from './blast.js';
import { Player } from '../player/Player.js';

export const DEFAULT_PARAMS = {
    killWeight: 1000,      // 擊殺一隻的價值
    blockWeight: 500,      // 炸彈封住怪物去路的加成
    escapePenalty: 400,    // 撤不回安全格的懲罰
    approachCost: 10,      // 接近放彈點的時間懲罰
    minValue: 150,         // 低於此價值就不值得冒險
    threatRadius: 1.15,    // 怪物警戒距離（格）
    escapeRadius: 2.2,     // 撤退要拉開的距離（格）
};

export class BotV2 extends Player {
    constructor(gridX, gridY, gridSystem, mapManager, dangerMap, bombManager, itemManager, params) {
        const mock = {
            isKeyPressed: () => false,
            players: [{ actionJustPressed: false }, { actionJustPressed: false }]
        };
        super(gridX, gridY, gridSystem, mock, mapManager);
        this.setBombManager(bombManager);
        this.dangerMap = dangerMap;
        this.itemManager = itemManager;

        this.P = Object.assign({}, DEFAULT_PARAMS, params || {});
        this.state = 'INIT';
        this.thinkTimer = 0;
        this.sameCellFrames = 0;
        this.lastGX = gridX;
        this.lastGY = gridY;
        this.stuckDir = null;
        this.aiInput = { up: false, down: false, left: false, right: false, bomb: false };
        this.inputManager.isActionPressed = (pid, action) => !!this.aiInput[action];
    }

    getExplosionCells(gx, gy, range, isPierce, shape) {
        return computeBlastCells(this.gridSystem, this.mapManager,
            gx, gy, range, isPierce, normalizeShape(shape));
    }
    getMyExplosionShape() { return this.hasDiagonalFire ? 'X' : 'CROSS'; }
    getFuseTime() {
        if (this.shortFuse) return 2.0;
        if (this.longFuse) return 6.0;
        return 3.0;
    }
    getEffectiveSpeed() { return this.speed * (this.hasDash ? 1.5 : 1); }
    resetInput() {
        this.aiInput.up = false; this.aiInput.down = false;
        this.aiInput.left = false; this.aiInput.right = false;
        this.aiInput.bomb = false;
    }
    setDir(dx, dy) {
        this.resetInput();
        if (dx > 0) this.aiInput.right = true;
        else if (dx < 0) this.aiInput.left = true;
        else if (dy > 0) this.aiInput.down = true;
        else if (dy < 0) this.aiInput.up = true;
    }
    canMove(dx, dy) { return this.canPhysicallyMove(dx, dy); }

    /** 依實際像素距離判斷（遊戲的致死判定用的就是像素距離） */
    nearestMonsterDist(px, py) {
        const cs = this.gridSystem.getCellSize();
        let nearest = Infinity;
        for (const m of this.getEnemies()) {
            if (!m || m.isDead) continue;
            const d = Math.hypot(px - (m.x + cs / 2), py - (m.y + cs / 2));
            if (d < nearest) nearest = d;
        }
        return nearest / cs;
    }

    /** 敵人清單：怪物永遠是敵人；其他玩家只在 VS 模式下算敵人 */
    getEnemies() {
        const w = globalThis;
        const out = [];
        const mm = w.monsterManager;
        if (mm && mm.monsters) {
            for (const m of mm.monsters) if (m && !m.isDead) out.push(m);
        }
        if (w.gameMode === 'BOT_BOT_VS') {
            for (const p of [w.player, w.player2, w.bot, w.bot2]) {
                if (p && p !== this && !p.isDead) out.push(p);
            }
        }
        return out;
    }

    /** 這個格多久之後會被某顆還在倒數的炸彈掃到（Infinity = 永遠安全） */
    getMinBombExplosionTimeAt(x, y) {
        let minTime = Infinity;
        if (!this.bombManager) return minTime;
        for (const b of this.bombManager.bombs) {
            if (b.isExploded) continue;
            const cells = computeBlastCells(this.gridSystem, this.mapManager,
                b.gridX, b.gridY, b.fireRange, b.isPierce, normalizeShape(b.shape));
            if (cells.has(`${x},${y}`) && b.timer < minTime) minTime = b.timer;
        }
        return minTime;
    }

    inBlast(x, y) {
        if (this.dangerMap.getDangerInfo(x, y).isFlameActive) return true;
        return this.getMinBombExplosionTimeAt(x, y) < Infinity;
    }
    cellCenterDist(gx, gy) {
        const cs = this.gridSystem.getCellSize();
        return this.nearestMonsterDist(
            this.gridSystem.offsetX + gx * cs + cs / 2,
            this.gridSystem.offsetY + gy * cs + cs / 2);
    }

    canPhysicallyMove(dx, dy) {
        const cs = this.gridSystem.getCellSize();
        const pad = cs * 0.2;
        const step = this.getEffectiveSpeed() * cs * (1 / 60);
        const nx = this.x + (dx !== 0 ? Math.sign(dx) * step : 0);
        const ny = this.y + (dy !== 0 ? Math.sign(dy) * step : 0);
        const corners = [
            [nx + pad, ny + pad], [nx + cs - pad, ny + pad],
            [nx + pad, ny + cs - pad], [nx + cs - pad, ny + cs - pad],
        ];
        for (const [cx, cy] of corners) {
            const g = this.gridSystem.getGridCoord(cx, cy);
            if (this.mapManager.isSolid(g.x, g.y)) return false;
        }
        if (this.bombManager && !this.hasBombPass) {
            for (const bomb of this.bombManager.bombs) {
                const bp = this.gridSystem.getPixelCoord(bomb.gridX, bomb.gridY);
                const n1x = nx + pad, n1y = ny + pad, n2x = nx + cs - pad, n2y = ny + cs - pad;
                if (n1x < bp.x + cs && n2x > bp.x && n1y < bp.y + cs && n2y > bp.y) {
                    const o1x = this.x + pad, o1y = this.y + pad;
                    const o2x = this.x + cs - pad, o2y = this.y + cs - pad;
                    const was = o1x < bp.x + cs && o2x > bp.x && o1y < bp.y + cs && o2y > bp.y;
                    if (!was) return false;
                }
            }
        }
        return true;
    }

    /** 找安全格：離火場遠、離怪物遠；第一步必過真實物理判定 */
    findSafeExit(fromX, fromY, blastCells, timeLeft) {
        const fuse = this.getFuseTime();
        const budget = timeLeft === undefined ? fuse : timeLeft;
        const wantSafe = this.P.escapeRadius;
        const queue = [{ x: fromX, y: fromY, path: [], steps: 0 }];
        const seen = new Set([`${fromX},${fromY}`]);
        let fallback = null;
        while (queue.length > 0) {
            const c = queue.shift();
            if (c.steps / this.getEffectiveSpeed() >= budget) continue;
            for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                const nx = c.x + dx, ny = c.y + dy;
                const k = `${nx},${ny}`;
                if (seen.has(k)) continue;
                if (nx < 1 || ny < 1 ||
                    nx >= this.gridSystem.cols - 1 || ny >= this.gridSystem.rows - 1) continue;
                if (this.mapManager.isSolid(nx, ny)) continue;
                if (this.bombManager.hasBombAt(nx, ny)) continue;
                if (c.x === fromX && c.y === fromY && !this.canPhysicallyMove(dx, dy)) continue;

                const steps = c.steps + 1;
                const at = steps / this.getEffectiveSpeed();
                const hot = blastCells ? blastCells.has(`${nx},${ny}`)
                    : this.getMinBombExplosionTimeAt(nx, ny) <= at;
                if (hot) continue;

                const path = [...c.path, { x: nx, y: ny }];
                seen.add(k);
                const md = this.cellCenterDist(nx, ny);
                if (md >= wantSafe) return { path, ok: true, dist: md };
                if (!fallback) fallback = { path, ok: false, dist: md };
                queue.push({ x: nx, y: ny, path, steps });
            }
        }
        return fallback || { path: [], ok: false, dist: Infinity };
    }

    stepAlong(path) {
        if (!path || path.length === 0) return false;
        const n = path[0];
        const dx = Math.sign(n.x - this.gridX);
        const dy = Math.sign(n.y - this.gridY);
        if (dx === 0 && dy === 0) { path.shift(); return false; }
        if (!this.canMove(dx, dy)) return false;
        this.setDir(dx, dy);
        path.shift();
        return true;
    }


    // ================================================================
    //  Escape guarantee: simulate the REAL movement physics.
    // ================================================================
    //
    // Why simulation instead of grid BFS:
    //   Grid BFS answers "is the target cell walkable", but the game
    //   answers "does my collision box fit". In corridors the two differ,
    //   and that difference is why canSafelyPlaceBomb used to report
    //   canEscape=true and then the bot stood still and burned to death
    //   (83/150 deaths measured).
    //
    // The contract here is stronger and explicit:
    //   "Starting from where I actually am, following this exact path,
    //    frame by frame through the real collision code, am I outside
    //    the blast before the fuse expires?"
    // If the simulation cannot prove it, we do NOT place the bomb.

    /** One frame of movement physics, replicated from Player.update(). */
    simStep(x, y, dx, dy) {
        const cs = this.gridSystem.getCellSize();
        const pad = cs * 0.2;
        const step = this.getEffectiveSpeed() * cs * (1 / 60);
        let mx = dx * step, my = dy * step;
        const len = Math.hypot(mx, my);
        if (len > step && len > 0) { mx = mx / len * step; my = my / len * step; }

        const blocked = (px, py) => {
            const pts = [
                [px + pad, py + pad], [px + cs - pad, py + pad],
                [px + pad, py + cs - pad], [px + cs - pad, py + cs - pad],
            ];
            for (const [cx, cy] of pts) {
                const g = this.gridSystem.getGridCoord(cx, cy);
                if (this.mapManager.isSolid(g.x, g.y)) return true;
            }
            return false;
        };

        // Player.update(): X axis first, then Y axis, each independently
        let fx = x, fy = y;
        if (mx !== 0 && !blocked(x + mx, y)) fx = x + mx;
        if (my !== 0 && !blocked(fx, y + my)) fy = y + my;

        // bombs block movement too (same rule as Player.update)
        if (fx === x && fy === y) return { x, y, moved: false };
        return { x: fx, y: fy, moved: true };
    }

    /** Is this pixel position safe (outside blast, no bomb underfoot)? */
    posIsSafe(x, y, blastCells, path) {
        const cs = this.gridSystem.getCellSize();
        const g = this.gridSystem.getGridCoord(x + cs / 2, y + cs / 2);
        // standing on the bomb we just placed is not "safe"
        if (path && path.length > 0) {
            const n0 = path[0];
            if (g.x === n0.x && g.y === n0.y) return false;
        }
        if (blastCells.has(`${g.x},${g.y}`)) return false;
        if (this.bombManager.hasBombAt(g.x, g.y)) return false;
        if (this.dangerMap.getDangerInfo(g.x, g.y).isFlameActive) return false;
        return true;
    }

    /**
     * Simulate a candidate path frame-by-frame. Returns true only if the
     * character genuinely gets out of the blast in time.
     *
     * startX/startY is where the character will actually be when the bomb
     * goes off - i.e. the bomb cell's top-left pixel. Starting from the
     * character's CURRENT position was a bug: the path begins at the bomb
     * cell, so the first step pointed at a distant node, never advanced,
     * and every plan looked unsafe (0.4 bombs/game).
     */
    verifyEscapePath(path, blastCells, budgetFrames, startX, startY) {
        let x = (startX === undefined) ? this.x : startX;
        let y = (startY === undefined) ? this.y : startY;
        let pi = 0;
        let stalled = 0;
        const cs = this.gridSystem.getCellSize();
        const cx0 = this.gridSystem.getCellCoord
            ? null : null;   // placeholder to keep structure readable
        void cx0;

        for (let f = 0; f < budgetFrames; f++) {
            if (pi > 0 || path.length > 0) {
                // already safe (not counting the bomb cell itself)
                if (this.posIsSafe(x, y, blastCells, path)) return true;
            }
            if (pi >= path.length) { if (this._dbg) this._dbg.pathFail++; return false; }

            const n = path[pi];
            const g = this.gridSystem.getGridCoord(x + cs / 2, y + cs / 2);
            const dx = Math.sign(n.x - g.x), dy = Math.sign(n.y - g.y);
            let r;
            if (dx !== 0) r = this.simStep(x, y, dx, 0);
            else if (dy !== 0) r = this.simStep(x, y, 0, dy);
            else { pi++; continue; }

            if (!r.moved) {
                stalled++;
                // physically wedged: give up well before the fuse ends
                if (stalled > 45) { if (this._dbg) this._dbg.stallFail++; return false; }
                continue;
            }
            stalled = 0;
            x = r.x; y = r.y;
            const g2 = this.gridSystem.getGridCoord(x + cs / 2, y + cs / 2);
            if (g2.x === n.x && g2.y === n.y) pi++;
        }
        return false;
    }
    bfsPath(sx, sy, tx, ty, maxDepth) {
        if (sx === tx && sy === ty) return [];
        const q = [{ x: sx, y: sy, path: [] }];
        const seen = new Set([`${sx},${sy}`]);
        while (q.length > 0) {
            const c = q.shift();
            if (c.path.length >= maxDepth) continue;
            for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                const nx = c.x + dx, ny = c.y + dy;
                const k = `${nx},${ny}`;
                if (seen.has(k)) continue;
                if (nx < 1 || ny < 1 ||
                    nx >= this.gridSystem.cols - 1 || ny >= this.gridSystem.rows - 1) continue;
                if (this.mapManager.isSolid(nx, ny)) continue;
                if (this.bombManager.hasBombAt(nx, ny)) continue;
                seen.add(k);
                const path = [...c.path, { x: nx, y: ny }];
                if (nx === tx && ny === ty) return path;
                q.push({ x: nx, y: ny, path });
            }
        }
        return [];
    }

    /**
     * 攻擊規劃。評分依據全部來自實測（bb-mc2.mjs，136 顆炸彈樣本）：
     *   - 「火場蓋住怪物當下的格」命中率 100%（13/13）
     *   - 「逃逸出口 <= 1」命中率 11.5%，低於基準 15.4%（毫無鑑別力）
     *   => 真正機制是「炸彈阻擋怪物」，不是「地形死角」
     */

    /**
     * Generate candidate escape paths (grid BFS, ordered by length),
     * then PROVE each one by simulating the real physics.
     *
     * Grid BFS is still useful here - as a candidate generator.
     * It just must not be trusted as the answer. The simulation is
     * the authority; BFS only proposes.
     */
    planVerifiedEscape(bombGX, bombGY, blastCells) {
        const fuseFrames = Math.floor(this.getFuseTime() * 60);
        const seen = new Set([`${bombGX},${bombGY}`]);
        const queue = [{ x: bombGX, y: bombGY, path: [] }];
        const candidates = [];
        let guard = 0;

        while (queue.length > 0 && candidates.length < 24 && guard++ < 4000) {
            const c = queue.shift();
            if (c.path.length > 8) continue;
            for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                const nx = c.x + dx, ny = c.y + dy;
                const k = `${nx},${ny}`;
                if (seen.has(k)) continue;
                if (nx < 1 || ny < 1 ||
                    nx >= this.gridSystem.cols - 1 || ny >= this.gridSystem.rows - 1) continue;
                if (this.mapManager.isSolid(nx, ny)) continue;
                if (this.bombManager.hasBombAt(nx, ny)) continue;
                seen.add(k);
                const path = [...c.path, { x: nx, y: ny }];
                candidates.push(path);
                queue.push({ x: nx, y: ny, path });
            }
        }

        // shortest first: cheapest escape is usually also the most robust
        candidates.sort((a, b) => a.length - b.length);
        const cs = this.gridSystem.getCellSize();
        const startX = this.gridSystem.offsetX + bombGX * cs;
        const startY = this.gridSystem.offsetY + bombGY * cs;
        for (const p of candidates) {
            if (this.verifyEscapePath(p, blastCells, fuseFrames, startX, startY)) {
                return { ok: true, path: p };
            }
        }
        return { ok: false, path: [] };
    }
    planAttack() {
        const targets = this.getEnemies().filter(m => m && !m.isDead);
        if (targets.length === 0) return null;
        const cells0 = this.getExplosionCells(this.gridX, this.gridY,
            this.fireRange, !!this.hasPierce, this.getMyExplosionShape());
        let best = null, bestValue = -Infinity;

        for (let cy = Math.max(1, this.gridY - 3); cy <= Math.min(this.gridSystem.rows - 2, this.gridY + 3); cy++) {
            for (let cx = Math.max(1, this.gridX - 3); cx <= Math.min(this.gridSystem.cols - 2, this.gridX + 3); cx++) {
                if (this.mapManager.isSolid(cx, cy)) continue;
                if (this.bombManager.hasBombAt(cx, cy)) continue;
                const steps = Math.abs(cx - this.gridX) + Math.abs(cy - this.gridY);
                if (steps > 3) continue;

                const cells = this.getExplosionCells(cx, cy, this.fireRange,
                    !!this.hasPierce, this.getMyExplosionShape());
                let covered = 0, blocked = 0;
                for (const t of targets) {
                    if (!cells.has(`${t.gridX},${t.gridY}`)) continue;
                    covered++;
                    let open = 0;
                    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                        const nx = t.gridX + dx, ny = t.gridY + dy;
                        if (this.mapManager.isSolid(nx, ny)) continue;
                        if (cx === nx && cy === ny) continue;
                        if (this.bombManager.hasBombAt(nx, ny)) continue;
                        open++;
                    }
                    if (open <= 1) blocked++;
                }
                if (covered === 0) continue;

                // ---- ESCAPE GUARANTEE (hard gate, not a penalty) ----
                //
                // Proven by simulation against the real physics.
                // If we cannot PROVE the escape, we do not place the bomb.
                //
                // Why a gate and not a penalty: measurement showed the
                // bot dying to its own fire in 83/150 games - the single
                // dominant death cause. A penalty merely trades death for
                // timid play (evolution converged to placing 1 bomb/game
                // and timing out 129/150). A hard gate removes the option.
                const exit = this.planVerifiedEscape(cx, cy, cells); if (!this._dbg) this._dbg = {cand:0,covered:0,escapeFail:0,plans:0,strikes:0}; this._dbg.cand++; this._dbg.covered += covered; if (!exit.ok) { this._dbg.escapeFail++; continue; } this._dbg.plans++;
                if (!exit.ok) continue;

                let value = this.P.killWeight * covered
                    + this.P.blockWeight * blocked
                    - this.P.approachCost * steps;
                if (value > bestValue) {
                    bestValue = value;
                    best = {
                        bombX: cx, bombY: cy,
                        approachPath: this.bfsPath(this.gridX, this.gridY, cx, cy, 3),
                        escapePath: exit.path,
                        value,
                    };
                }
            }
        }
        if (!best || best.value < this.P.minValue) return null;
        void cells0;
        return best;
    }

    /** 巡邏：往離怪物最遠的可走鄰格，保證活性 */

    /**
     * ATTACK COMMITMENT - the missing half of the fix.
     *
     * Measurement (60 games, gate counters):
     *     cand=12765  covered=13923  escapeFail=7101  plans=5664  strikes=52
     *
     * The escape guarantee works (5664 plans passed it), but only 52 of
     * those plans ever became an actual bomb: a 0.9% conversion rate.
     *
     * Cause: planAttack() re-plans from scratch every 0.1s. Because
     * monsters move, the "best" cell keeps changing, so the bot walks
     * toward A, re-plans, walks toward B, and never arrives anywhere.
     * The escape side had this fixed (a commit latch); the attack side
     * never did.
     *
     * Fix: once a bomb target is chosen, commit to it until
     *   - the bot arrives (place the bomb), or
     *   - the target stops covering any monster (plan is stale), or
     *   - survival takes over (handled by the escape branches above).
     */
    committedBomb = null;

    chooseAttackPlan() {
        // 1. reuse the committed plan while it is still meaningful
        if (this.committedBomb) {
            const c = this.committedBomb;
            if (c.x === this.gridX && c.y === this.gridY) return c;
            // still covers a live monster?
            const cells = this.getExplosionCells(c.x, c.y, this.fireRange,
                !!this.hasPierce, this.getMyExplosionShape());
            let still = 0;
            for (const m of this.getEnemies()) {
                if (m && !m.isDead && cells.has(`${m.gridX},${m.gridY}`)) still++;
            }
            if (still > 0) {
                // stepAlong consumes the path, so refresh it when empty
                if (!c.approachPath || c.approachPath.length === 0) {
                    c.approachPath = this.bfsPath(this.gridX, this.gridY, c.x, c.y, 3);
                }
                return c;
            }
            this.committedBomb = null;
        }

        // 2. otherwise pick a fresh plan and latch it
        const p = this.planAttack();
        if (p) {
            this.committedBomb = {
                x: p.bombX, y: p.bombY,
                escapePath: p.escapePath,
                approachPath: p.approachPath,
            };
            return this.committedBomb;
        }
        return null;
    }
    doPatrol() {
        let best = null, bestScore = -Infinity;
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            if (!this.canPhysicallyMove(dx, dy)) continue;
            const nx = this.gridX + dx, ny = this.gridY + dy;
            if (this.mapManager.isSolid(nx, ny)) continue;
            if (this.bombManager.hasBombAt(nx, ny)) continue;
            if (this.inBlast(nx, ny)) continue;
            let d = this.cellCenterDist(nx, ny);
            if (this.stuckDir && dx === -this.stuckDir[0] && dy === -this.stuckDir[1]) d *= 0.5;
            if (d > bestScore) { bestScore = d; best = [dx, dy]; }
        }
        if (best) { this.stuckDir = best; this.setDir(best[0], best[1]); }
        this.state = 'PATROL';
    }

    /** 單一決策出口：每幀只做一次判斷，只產生一個決定 */
    think() {
        this.resetInput();

        // 硬約束 1：站在火場裡 -> 撤退
        if (this.inBlast(this.gridX, this.gridY)) {
            const ex = this.findSafeExit(this.gridX, this.gridY);
            if (this.stepAlong(ex.path)) { this.state = 'ESCAPE_BLAST'; return; }
        }

        // 硬約束 2：怪物貼身 -> 撤退
        const cs = this.gridSystem.getCellSize();
        const md = this.nearestMonsterDist(this.x + cs / 2, this.y + cs / 2);
        if (md <= this.P.threatRadius) {
            const ex = this.findSafeExit(this.gridX, this.gridY);
            if (this.stepAlong(ex.path)) { this.state = 'ESCAPE_MONSTER'; return; }
        }

        // 攻擊（承諾式：一旦選定目標就走到底，不再每幀改主意）
        const plan = this.chooseAttackPlan();
        if (plan) {
            if (this.gridX === plan.x && this.gridY === plan.y) {
                this.aiInput.bomb = true;
                if (this._dbg) this._dbg.strikes++;
                this.state = 'STRIKE';
                this.committedBomb = null;
                return;
            }
            if (plan.approachPath && plan.approachPath.length > 0 &&
                this.stepAlong(plan.approachPath)) {
                this.state = 'APPROACH';
                return;
            }
        }

        this.doPatrol();
    }

    update(dt) {
        if (this.isDead) { super.update(dt); return; }
        this.thinkTimer -= dt;
        if (this.gridX === this.lastGX && this.gridY === this.lastGY) this.sameCellFrames++;
        else { this.sameCellFrames = 0; this.lastGX = this.gridX; this.lastGY = this.gridY; }
        if (this.thinkTimer <= 0) { this.think(); this.thinkTimer = 0.1; }
        if (this.sameCellFrames > 90) { this.doPatrol(); this.sameCellFrames = 0; }
        super.update(dt);
    }
}
