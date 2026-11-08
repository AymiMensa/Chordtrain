import { Player, ItemManager } from '../player/Player.js';
import { Item, ITEM_IDS, ITEM_NAMES, ITEM_WEIGHTS } from '../item/Item.js';
import { ExplosionManager } from '../explosion/ExplosionManager.js';
import { BombManager } from '../bomb/BombManager.js';
import { MonsterManager } from '../monster/MonsterManager.js';
import { StageManager } from '../map/StageManager.js';
import { GridSystem } from '../../engine/physics/GridSystem.js';
import { DangerMap } from '../ai/DangerMap.js';

export class GameLayer {
    static FLEE_TTL = 720;
    static SAFETY_SLACK = 1.02;

    constructor(gs, playerList, botList, mm, im, em, bm, mo, dm, gm, pm) {
        this.gs = gs;
        this.mm = mm;
        this.im = im;
        this.em = em;
        this.bm = bm;
        this.mo = mo;
        this.dm = dm;
        this.gm = gm;
        this.pm = pm;

        this.playerList = playerList;
        this.botList = botList;
        this.n = playerList.length;

        this.fleeFrozen = Array.from({ length: this.n }, () => 0);
        this.escapeTarget = Array.from({ length: this.n }, () => null);
        this.volatileCells = new Set();
    }

    onEnemyExplodes(x, y) {
        this.volatileCells.add(x + ',' + y);
    }

    invalidateFlee() {
        for (let i = 0; i < this.n; i++) {
            this.fleeFrozen[i] = GameLayer.FLEE_TTL;
            this.escapeTarget[i] = null;
        }
        this.volatileCells.clear();
    }
    update(dt, ghostWindows) {
        if (!ghostWindows) return;

        for (let gi = 0; gi < this.n; gi++) {
            const p = this.gm.getPlayers().get(gi);
            if (!p || p.isDead || p.hp <= 0) continue;
            const bot = this.botList[gi];
            if (!bot) continue;

            this.dm.update();
            const fi = this.dm.getDangerInfo(bot.gridX, bot.gridY);
            const needsFlee = fi.isFlameActive || fi.danger > 0 || this.fleeFrozen[gi] > 0;

            if (needsFlee) {
                if (this.fleeFrozen[gi] > 0) this.fleeFrozen[gi]--;
            } else {
                this.fleeFrozen[gi] = 0;
            }

            const es = this.escapeTarget[gi];
            const gridX = bot.gridX | 0;
            const gridY = bot.gridY | 0;
            const dirs = [es ? this.dirTo(es.x, es.y, gridX, gridY) : [1, 0]];
            const avoidedPaths = {};

            for (const [dx, dy] of dirs) {
                const nx = gridX + dx, ny = gridY + dy;
                if (nx < 1 || ny < 1 || nx >= this.gs.cols - 1 || ny >= this.gs.rows - 1) continue;
                if (this.mm.isSolid(nx, ny)) continue;
                if (this.bm.hasBombAt(nx, ny)) continue;
                if (this.volatileCells.has(nx + ',' + ny)) continue;

                const bans = [];
                if (this.fleeFrozen[gi] > 0) {
                    const fs = this.fleeFrozen[gi];
                    const far = [fs * 0.6 | 0, fs * 0.3 | 0, 0, -fs >> 1, -fs >> 2];
                    for (const [fdx, fdy] of far) {
                        const fx = nx + fdx, fy = ny + fdy;
                        if (fx < 1 || fy < 1 || fx >= this.gs.cols - 1 || fy >= this.gs.rows - 1) continue;
                        if (this.mm.isSolid(fx, fy)) continue;
                        if (es && Math.abs(fx - es.x) + Math.abs(fy - es.y) < fs) bans.push(fx + ',' + fy);
                    }
                }
                if (es) {
                    const d = Math.abs(es.x - nx) + Math.abs(es.y - ny);
                    if (d <= 12) bans.push(es.x + ',' + es.y);
                }
                avoidedPaths[nx + ',' + ny] = bans;

                if (!this.passable(nx, ny, false, false)) continue;
                this.setMove(bot, dx, dy);
                return;
            }

            const bans = [];
            for (const [x, y] of Object.keys(avoidedPaths)) {
                const [bx, by] = x.split(',').map(Number);
                if (avoidedPaths[x].some((v) => v === by)) bans.push(bx);
            }
            const neighbors = [];
            for (const [dx, dy] of this.MOVES_8) {
                const nx2 = gridX + dx, ny2 = gridY + dy;
                if (nx2 < 1 || ny2 < 1 || nx2 >= this.gs.cols - 1 || ny2 >= this.gs.rows - 1) continue;
                if (this.mm.isSolid(nx2, ny2)) continue;
                if (this.bm.hasBombAt(nx2, ny2)) continue;
                if (this.volatileCells.has(nx2 + ',' + ny2)) continue;
                const key = nx2 + ',' + ny2;
                if (bans.includes(nx2)) continue;
                if (!this.passable(nx2, ny2, false, false)) continue;
                neighbors.push(key);
            }

            if (neighbors.length === 0) {
                this.fleeFrozen[gi] = Math.max(18, Math.min(240, this.fleeFrozen[gi] | 0) + 240);
                this.escapeTarget[gi] = null;
                this.setMove(bot, 0, 0);
                continue;
            }

            let best = null;
            let minObs = this.gs.cols + this.gs.rows;
            for (const key of neighbors) {
                const [tx, ty] = key.split(',').map(Number);
                let obs = 0;
                const ln = Math.max(1, (this.gs.cols + this.gs.rows) >> 1);
                for (let d = 1; d <= ln; d++) {
                    const k = Math.min(d, ln - 1);
                    for (let i = -k; i <= k; i++) {
                        const j = d - Math.abs(i);
                        const [ox, oy] = [tx + i, ty + j];
                        if (ox >= 1 && oy >= 1 && ox < this.gs.cols - 1 && oy < this.gs.rows - 1) {
                            if (this.passable(ox, oy, false, false)) obs++;
                        }
                        const [ox2, oy2] = [tx - i, ty + j];
                        if (ox2 >= 1 && oy2 >= 1 && ox2 < this.gs.cols - 1 && oy2 < this.gs.rows - 1) {
                            if (this.passable(ox2, oy2, false, false)) obs++;
                        }
                    }
                }
                if (obs < minObs) { minObs = obs; best = key; }
            }
            if (best) {
                const [nx2, ny2] = best.split(',').map(Number);
                this.setMove(bot, nx2 - gridX, ny2 - gridY);
            } else {
                this.fleeFrozen[gi] = Math.max(18, Math.min(240, this.fleeFrozen[gi] | 0) + 240);
                this.escapeTarget[gi] = null;
                this.setMove(bot, 0, 0);
            }
        }
    }
    stepCollision(bot, monster, ghostWindows) {
        const i = this.botIndex(bot);
        if (i < 0) return;
        const fi = this.dm.getDangerInfo(monster.gridX, monster.gridY);
        if (fi.isFlameActive || fi.danger > 0) return;
        if (!ghostWindows) {
            if (this.botList[1 - i] && this.botList[1 - i].gridX === bot.gridX && this.botList[1 - i].gridY === bot.gridY) return;
            this.botList[i].die();
        } else {
            const j = 1 - i;
            if (ghostWindows[j]) this.setMove(bot, 0, 0);
            else this.botList[i].die();
        }
    }

    static bulgeLegend = (() => {
        const M = { 4: [], 6: [], 8: [], 9: [], 10: [], 11: [] };
        const R = 2;
        for (let dy = -R; dy <= R; dy++) {
            for (let dx = -R; dx <= R; dx++) {
                const k = Math.abs(dx) + Math.abs(dy);
                if (k <= R) { if (M[k] != null) continue; M[k] = []; }
                const k2 = Math.max(Math.abs(dx), Math.abs(dy));
                if (k2 === R) { if (M[k2] != null) continue; M[k2] = []; }
            }
        }
        return M;
    })();

    static canPlaceFire(x, y, range, ghostWindows) {
        const cells = [];
        const b = new BombManager(new GridSystem(13, 11), new MonsterManager(new GridSystem(13, 11), null, null), new ExplosionManager(new GridSystem(13, 11), null, null));
        cells.push({ x, y });
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            for (let k = 1; k <= range; k++) {
                cells.push({ x: x + dx * k, y: y + dy * k });
            }
        }
        for (const c of cells) {
            if (c.x < 1 || c.y < 1 || c.x >= 12 || c.y >= 10) return false;
            if (ghostWindows && ghostWindows[0] && ghostWindows[0].gridX === c.x && ghostWindows[0].gridY === c.y) return false;
            if (ghostWindows && ghostWindows[1] && ghostWindows[1].gridX === c.x && ghostWindows[1].gridY === c.y) return false;
            if (this.mm.isSolid(c.x, c.y)) return false;
            if (this.bm.hasBombAt(c.x, c.y)) return false;
        }
        return true;
    }

    setMove(bot, dx, dy) {
        // Clear the opposite direction so the bot does not receive conflicting inputs.
        bot.aiInput.up = dy < 0;
        bot.aiInput.down = dy > 0;
        bot.aiInput.left = dx < 0;
        bot.aiInput.right = dx > 0;
        if (dx < 0) bot.aiInput.up = false;
        if (dx > 0) bot.aiInput.down = false;
        if (dy < 0) bot.aiInput.left = false;
        if (dy > 0) bot.aiInput.right = false;

        bot.aiInput.bomb = false;
    }

    dirTo(tx, ty, x, y) {
        if (tx > x) return [1, 0];
        if (tx < x) return [-1, 0];
        if (ty > y) return [0, 1];
        if (ty < y) return [0, -1];
        return [1, 0];
    }

    botIndex(bot) {
        const p = this.botList.indexOf(bot);
        if (p < 0) return -1;
        const players = this.gm.getPlayers();
        for (let i = 0; i < this.n; i++) {
            if (players.get(i) === bot) return i;
        }
        return p;
    }

    passable(x, y, zone) {
        if (x < 1 || y < 1 || x >= this.gs.cols - 1 || y >= this.gs.rows - 1) return true;
        return this.mm.isSolid(x, y) === false;
    }
}




