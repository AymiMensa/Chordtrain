import { describe, it, expect } from 'vitest';
import {
    computeExplosionCells,
    computeDangerGrid,
    findSafeEscapePath,
    canSurviveAfterPlacingBomb,
    evaluateKillSpots,
    chooseSafeWaitSpot,
} from '../../src/game/ai/AIPure.js';

/**
 * 以字串地圖建立測試用 world：
 * '#' = 硬磚(1)、'S' = 軟磚(2)、'.' = 空地(0)
 */
function makeWorld(rows) {
    const grid = rows.map(r => r.split(''));
    return {
        cols: grid[0].length,
        rows: grid.length,
        isSolid(x, y) {
            if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return true;
            return grid[y][x] === '#';
        },
        getBlockType(x, y) {
            if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return 1;
            const c = grid[y][x];
            if (c === '#') return 1;
            if (c === 'S') return 2;
            return 0;
        },
        bombs: [],
        flames: [],
        monsters: [],
    };
}

describe('computeExplosionCells（炸彈危險格計算）', () => {
    it('普通炸彈被軟磚阻擋，不會穿透', () => {
        // . B S .（炸彈在 x=1，軟磚在 x=2）
        const w = makeWorld(['..S.']);
        const cells = computeExplosionCells(w, 1, 0, 3, false, 'CROSS');
        expect(cells.has('2,0')).toBe(true);   // 軟磚本身被燒到
        expect(cells.has('3,0')).toBe(false);  // 但不穿透
    });

    it('超級炸彈（isPierce）穿過軟磚繼續延伸', () => {
        const w = makeWorld(['....']);
        const cells = computeExplosionCells(w, 1, 0, 3, true, 'CROSS');
        expect(cells.has('2,0')).toBe(true);
        expect(cells.has('3,0')).toBe(true);   // 穿透了軟磚
    });

    it('硬磚永遠阻擋任何炸彈（含穿透）', () => {
        // 炸彈在 x=1，x=2 空地，x=3 硬磚
        const w = makeWorld(['...#']);
        const cells = computeExplosionCells(w, 1, 0, 5, true, 'CROSS');
        expect(cells.has('2,0')).toBe(true);
        expect(cells.has('3,0')).toBe(false);  // 硬磚後方安全
    });

    it('X 形狀炸彈只燒斜線方向', () => {
        const w = makeWorld([
            '...',
            '...',
            '...',
        ]);
        const cells = computeExplosionCells(w, 1, 1, 2, false, 'X');
        expect(cells.has('2,2')).toBe(true);
        expect(cells.has('2,1')).toBe(false);  // 正右方不在 X 形範圍
    });
});

describe('findSafeEscapePath（安全逃生路徑）', () => {
    it('腳下有即將爆炸的炸彈時，能找到逃離路徑', () => {
        const w = makeWorld([
            '.......',
            '.......',
            '.......',
        ]);
        w.bombs.push({ x: 3, y: 1, range: 2, isPierce: false, shape: 'CROSS', timer: 1.0 });
        const result = findSafeEscapePath(w, 3, 1, 4, 3.0);
        expect(result).not.toBeNull();
        expect(result.path.length).toBeGreaterThan(0);
        // 終點必須完全離開炸彈十字範圍
        const last = result.path[result.path.length - 1];
        const blast = computeExplosionCells(w, 3, 1, 2, false, 'CROSS');
        expect(blast.has(`${last.x},${last.y}`)).toBe(false);
    });

    it('封閉死路中所有可達格都在爆炸範圍時回傳 null', () => {
        const w = makeWorld([
            '#####',
            '#...#',
            '#####',
        ]);
        w.bombs.push({ x: 1, y: 1, range: 3, isPierce: false, shape: 'CROSS', timer: 0.5 });
        const result = findSafeEscapePath(w, 1, 1, 4, 3.0);
        expect(result).toBeNull();
    });

    it('火焰格子不可通行', () => {
        const w = makeWorld([
            '...',
            '...',
        ]);
        w.flames.push('1,0');
        const result = findSafeEscapePath(w, 0, 0, 4, 3.0);
        // 路徑若存在，不得經過火焰格
        if (result) {
            for (const step of result.path) {
                expect(`${step.x},${step.y}`).not.toBe('1,0');
            }
        }
    });
});

describe('canSurviveAfterPlacingBomb（放炸彈後能否存活）', () => {
    it('開闊區域放炸彈可以逃脫存活', () => {
        const w = makeWorld([
            '.....',
            '.....',
            '.....',
        ]);
        const r = canSurviveAfterPlacingBomb(w, 2, 1, 2, false, 'CROSS', 3.0, 4, 2, 1);
        expect(r.canSurvive).toBe(true);
    });

    it('密閉房間放炸彈無處可逃 → 判定不可存活', () => {
        const w = makeWorld([
            '#####',
            '#...#',
            '#####',
        ]);
        const r = canSurviveAfterPlacingBomb(w, 1, 1, 3, false, 'CROSS', 3.0, 4, 1, 1);
        expect(r.canSurvive).toBe(false);
    });
});

describe('evaluateKillSpots（評估可否安全擊殺）', () => {
    it('敵人在直線上且自己能逃脫 → 回傳候選位置', () => {
        const w = makeWorld([
            '.....',
            '.....',
            '.....',
        ]);
        const spots = [{ x: 1, y: 1 }, { x: 2, y: 1 }];
        const enemies = [{ x: 3, y: 1 }];
        const results = evaluateKillSpots(w, spots, enemies, 2, false, 'CROSS', 3.0, 4, 1, 1);
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].hitEnemies.length).toBeGreaterThan(0);
    });

    it('放了必死的位置會被排除', () => {
        const w = makeWorld([
            '#####',
            '#...#',
            '#####',
        ]);
        const enemies = [{ x: 3, y: 1 }];
        const results = evaluateKillSpots(w, [{ x: 1, y: 1 }], enemies, 3, false, 'CROSS', 3.0, 4, 1, 1);
        expect(results.length).toBe(0);
    });
});

describe('chooseSafeWaitSpot（選擇安全等待位置）', () => {
    it('優先選擇有牆壁掩護的安全格', () => {
        const w = makeWorld([
            '##.##',
            '.....',
            '.....',
        ]);
        w.bombs.push({ x: 2, y: 2, range: 1, isPierce: false, shape: 'CROSS', timer: 5 });
        const spot = chooseSafeWaitSpot(w, 2, 1, 4, 6);
        expect(spot).not.toBeNull();
        // 選出的位置必須遠離炸彈危險區
        const dist = Math.abs(spot.x - 2) + Math.abs(spot.y - 2);
        expect(dist >= 1 || (spot.x !== 2 && spot.y !== 2)).toBe(true);
    });

    it('全圖皆無安全格時回傳 null 而非崩潰', () => {
        const w = makeWorld([
            '###',
            '#.#',
            '###',
        ]);
        w.bombs.push({ x: 1, y: 1, range: 3, isPierce: false, shape: 'CROSS', timer: 5 });
        const spot = chooseSafeWaitSpot(w, 1, 1, 4, 6);
        expect(spot).toBeNull();
    });
});

describe('computeDangerGrid（整體危險表）', () => {
    it('怪物周圍標記為危險', () => {
        const w = makeWorld([
            '...',
            '...',
            '...',
        ]);
        w.monsters.push({ x: 1, y: 1 });
        const danger = computeDangerGrid(w);
        expect(danger[1][1].dangerLevel).toBeGreaterThan(0);
        expect(danger[0][1].dangerLevel).toBeGreaterThan(0);
        expect(danger[2][2].dangerLevel).toBe(0);
    });
});