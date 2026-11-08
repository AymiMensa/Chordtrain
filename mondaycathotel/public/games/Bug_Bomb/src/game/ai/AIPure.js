/**
 * 超級炸彈超人 AI - 純函式模組（可單元測試）
 *
 * 所有函式皆為純函式：不依賴遊戲實例，只依賴傳入的「世界描述」物件。
 * 世界描述（world）介面：
 * {
 *   cols: number, rows: number,
 *   isSolid(x, y): boolean,          // 牆壁/邊界
 *   getBlockType(x, y): number,      // 0空地 1硬磚 2軟磚
 *   bombs: [{ x, y, range, isPierce, shape, timer }],
 *   flames: string[],                // 目前正在燃燒的格子 "x,y"
 *   monsters: [{ x, y }],
 * }
 *
 * 對應 Bot.js 的五大核心能力：
 * 1. computeExplosionCells   → 計算炸彈危險格（含超級炸彈穿牆）
 * 2. findSafeEscapePath      → 判斷安全逃生路徑
 * 3. canSurviveAfterPlacingBomb → 判斷放炸彈後是否仍可存活
 * 4. evaluateKillSpots       → 評估敵人是否可安全擊殺
 * 5. chooseSafeWaitSpot      → 選擇安全等待位置
 */

export const DIRS4 = [
    { dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
];

function shapeDirections(shape) {
    if (shape === 'X') {
        return [{ dx: 1, dy: 1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: -1, dy: -1 }];
    }
    if (shape === 'ROUND' || shape === 'STAR') {
        return [
            { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
            { dx: 1, dy: 1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: -1, dy: -1 },
        ];
    }
    return DIRS4;
}

/**
 * 1. 計算一顆炸彈的爆炸危險格。
 * 規則：
 * - 硬磚(1)永遠阻擋火焰。
 * - 軟磚(2)會被燒到（本身也是危險格），但非穿透炸彈不會穿過它。
 * - 穿透炸彈（isPierce，超級炸彈）：不受軟磚阻擋 → 危險區域計算與普通炸彈不同。
 */
export function computeExplosionCells(world, gx, gy, range, isPierce = false, shape = 'CROSS') {
    const cells = new Set();
    cells.add(`${gx},${gy}`);

    for (const d of shapeDirections(shape)) {
        const maxI = (shape === 'ROUND' && d.dx !== 0 && d.dy !== 0) ? Math.floor(range / 2) : range;
        for (let i = 1; i <= maxI; i++) {
            const nx = gx + d.dx * i;
            const ny = gy + d.dy * i;
            if (nx < 0 || nx >= world.cols || ny < 0 || ny >= world.rows) break;
            const blockType = world.getBlockType(nx, ny);
            if (blockType === 1) break; // 硬磚永遠阻擋
            cells.add(`${nx},${ny}`);
            if (blockType === 2 && !isPierce) break; // 非穿透被軟磚擋住
        }
    }
    return cells;
}

/**
 * 計算整張地圖的時間感知危險表。
 * 回傳 grid[y][x] = { dangerLevel, explosionTimer, isFlameActive, isMonsterNear }
 */
export function computeDangerGrid(world) {
    const grid = [];
    for (let y = 0; y < world.rows; y++) {
        const row = [];
        for (let x = 0; x < world.cols; x++) {
            row.push({ dangerLevel: 0, explosionTimer: Infinity, isFlameActive: false, isMonsterNear: false });
        }
        grid.push(row);
    }

    const flameSet = new Set(world.flames || []);
    for (const key of flameSet) {
        const [fx, fy] = key.split(',').map(Number);
        if (grid[fy] && grid[fy][fx]) {
            grid[fy][fx].dangerLevel = 100;
            grid[fy][fx].explosionTimer = 0;
            grid[fy][fx].isFlameActive = true;
        }
    }

    for (const bomb of world.bombs || []) {
        if (bomb.isExploded) continue;
        const cells = computeExplosionCells(world, bomb.x, bomb.y, bomb.range, !!bomb.isPierce, bomb.shape || 'CROSS');
        for (const key of cells) {
            const [cx, cy] = key.split(',').map(Number);
            if (!grid[cy] || !grid[cy][cx]) continue;
            grid[cy][cx].dangerLevel += 50;
            grid[cy][cx].explosionTimer = Math.min(grid[cy][cx].explosionTimer, bomb.timer ?? Infinity);
        }
    }

    for (const m of world.monsters || []) {
        if (grid[m.y] && grid[m.y][m.x]) {
            grid[m.y][m.x].dangerLevel += 80;
            grid[m.y][m.x].isMonsterNear = true;
        }
        for (const d of DIRS4) {
            const nx = m.x + d.dx;
            const ny = m.y + d.dy;
            if (grid[ny] && grid[ny][nx] && !world.isSolid(nx, ny)) {
                grid[ny][nx].dangerLevel += 40;
                grid[ny][nx].isMonsterNear = true;
            }
        }
    }

    return grid;
}

/**
 * 取得某格最早爆炸時間（Infinity 代表不在任何炸彈範圍內）
 */
export function minExplosionTimeAt(world, x, y) {
    let minTime = Infinity;
    for (const bomb of world.bombs || []) {
        if (bomb.isExploded) continue;
        const cells = computeExplosionCells(world, bomb.x, bomb.y, bomb.range, !!bomb.isPierce, bomb.shape || 'CROSS');
        if (cells.has(`${x},${y}`)) {
            minTime = Math.min(minTime, bomb.timer ?? Infinity);
        }
    }
    return minTime;
}

/**
 * 時間感知 BFS：從起點找一條「抵達時該格仍然安全」的路徑。
 * 安全定義：無即時火焰、無怪物威脅、所有覆蓋此格的炸彈爆炸時間 > 抵達時間。
 *
 * @returns { path: [{x,y}], time } 或 null
 */
export function findSafeEscapePath(world, startX, startY, speedCellsPerSec, maxTime = 3.0) {
    const timePerCell = 1 / Math.max(speedCellsPerSec, 0.001);
    const danger = computeDangerGrid(world);

    const queue = [{ x: startX, y: startY, time: 0, path: [] }];
    const visited = new Map([[`${startX},${startY}`, 0]]);

    while (queue.length > 0) {
        queue.sort((a, b) => a.time - b.time);
        const curr = queue.shift();

        if (!(curr.x === startX && curr.y === startY)) {
            const info = danger[curr.y][curr.x];
            const bombTime = minExplosionTimeAt(world, curr.x, curr.y);
            // 終點必須「永久安全」：完全離開所有爆炸範圍，
            // 而非僅「抵達時間早於爆炸時間」（否則站著不動仍會被炸死）
            const safe = !info.isFlameActive && !info.isMonsterNear &&
                bombTime === Infinity &&
                info.dangerLevel === 0;
            if (safe) return { path: curr.path, time: curr.time };
        }

        if (curr.time >= maxTime) continue;

        for (const d of DIRS4) {
            const nx = curr.x + d.dx;
            const ny = curr.y + d.dy;
            const arriveTime = curr.time + timePerCell;

            if (world.isSolid(nx, ny)) continue;
            // 不能走進其他炸彈所在格（可以離開自己腳下的炸彈）
            const bombHere = (world.bombs || []).some(b => !b.isExploded && b.x === nx && b.y === ny);
            if (bombHere && !(nx === startX && ny === startY)) continue;

            const info = danger[ny][nx];
            if (info.isFlameActive) continue;

            const nBombTime = minExplosionTimeAt(world, nx, ny);
            if (nBombTime !== Infinity && arriveTime >= nBombTime) continue;
            if (info.explosionTimer !== Infinity && arriveTime >= info.explosionTimer) continue;

            const key = `${nx},${ny}`;
            const prev = visited.get(key);
            if (prev !== undefined && prev <= arriveTime) continue;
            visited.set(key, arriveTime);

            queue.push({ x: nx, y: ny, time: arriveTime, path: [...curr.path, { x: nx, y: ny }] });
        }
    }
    return null;
}

/**
 * 判斷在 (bombX,bombY) 放炸彈後，站在 (startX,startY) 的角色能否存活。
 * 綜合：模擬新炸彈爆炸範圍 + 既有炸彈 + 火焰 + 怪物。
 *
 * @returns { canSurvive: boolean, path: [{x,y}] }
 */
export function canSurviveAfterPlacingBomb(
    world,
    bombX, bombY, bombRange, isPierce, shape,
    fuseTime, speedCellsPerSec,
    startX, startY
) {
    const newBomb = { x: bombX, y: bombY, range: bombRange, isPierce, shape, timer: fuseTime };
    const simWorld = {
        ...world,
        bombs: [...(world.bombs || []), newBomb],
    };

    // 若起點不在新炸彈範圍內且本來就安全 → 直接存活
    const startInBlast = computeExplosionCells(simWorld, bombX, bombY, bombRange, isPierce, shape).has(`${startX},${startY}`);
    if (!startInBlast) {
        const direct = findSafeEscapePath(simWorld, startX, startY, speedCellsPerSec, 0.001);
        if (direct === null) {
            // 起點本身已安全（BFS 找不到更安全的也沒關係，原地即可）
            return { canSurvive: true, path: [] };
        }
    }

    const result = findSafeEscapePath(simWorld, startX, startY, speedCellsPerSec, fuseTime);
    if (result) return { canSurvive: true, path: result.path };
    return { canSurvive: false, path: [] };
}

/**
 * 評估各候選放炸彈位置是否能安全擊殺敵人。
 *
 * @param spots 候選位置 [{x, y}]
 * @param enemies 敵人 [{x, y}]
 * @returns 排序後的評分列表 [{ x, y, score, hitEnemies, canSurvive }]
 */
export function evaluateKillSpots(world, spots, enemies, myRange, isPierce, shape, fuseTime, speedCellsPerSec, startX, startY) {
    const results = [];

    for (const spot of spots) {
        if (world.isSolid(spot.x, spot.y)) continue;
        const occupied = (world.bombs || []).some(b => !b.isExploded && b.x === spot.x && b.y === spot.y);
        if (occupied && !(spot.x === startX && spot.y === startY)) continue;

        const blast = computeExplosionCells(world, spot.x, spot.y, myRange, isPierce, shape);
        const hitEnemies = enemies.filter(e => blast.has(`${e.x},${e.y}`));
        if (hitEnemies.length === 0) continue;

        const survival = canSurviveAfterPlacingBomb(
            world, spot.x, spot.y, myRange, isPierce, shape, fuseTime, speedCellsPerSec, startX, startY
        );
        if (!survival.canSurvive) continue;

        // 隊友保護：若隊友在爆炸範圍且無法逃脫則不放（此處以 teammates 參數簡化為敵我皆檢查 monsters）
        let distPenalty = 0;
        for (const e of hitEnemies) {
            distPenalty += Math.abs(e.x - spot.x) + Math.abs(e.y - spot.y);
        }

        const score = hitEnemies.length * 100 - distPenalty * 5 - (survival.path.length * 10);
        results.push({ x: spot.x, y: spot.y, score, hitEnemies, canSurvive: true });
    }

    results.sort((a, b) => b.score - a.score);
    return results;
}

/**
 * 選擇安全等待位置：優先有牆壁掩護、遠離炸彈與怪物、開放度適中。
 *
 * @returns { x, y, path } 或 null
 */
export function chooseSafeWaitSpot(world, startX, startY, speedCellsPerSec, maxDepth = 6) {
    const danger = computeDangerGrid(world);

    const isOpen = (x, y) => !world.isSolid(x, y) &&
        !(world.bombs || []).some(b => !b.isExploded && b.x === x && b.y === y);

    const wallCoverage = (x, y) => {
        let count = 0;
        for (const d of DIRS4) {
            const bt = world.getBlockType(x + d.dx, y + d.dy);
            if (bt === 1 || bt === 2) count++;
        }
        return count;
    };

    const queue = [{ x: startX, y: startY, path: [] }];
    const visited = new Set([`${startX},${startY}`]);
    let best = null;
    let bestScore = -Infinity;

    while (queue.length > 0) {
        const curr = queue.shift();

        if (curr.path.length > 0) {
            const info = danger[curr.y][curr.x];
            const safe = !info.isFlameActive && !info.isMonsterNear &&
                info.dangerLevel === 0 &&
                minExplosionTimeAt(world, curr.x, curr.y) === Infinity;
            if (safe) {
                let openCount = 0;
                for (const d of DIRS4) {
                    if (isOpen(curr.x + d.dx, curr.y + d.dy)) openCount++;
                }
                const score = wallCoverage(curr.x, curr.y) * 15 + openCount * 10 +
                    Math.min(curr.path.length, 3) * 5;
                if (score > bestScore) {
                    bestScore = score;
                    best = { x: curr.x, y: curr.y, path: curr.path };
                }
            }
        }

        if (curr.path.length >= maxDepth) continue;

        for (const d of DIRS4) {
            const nx = curr.x + d.dx;
            const ny = curr.y + d.dy;
            const key = `${nx},${ny}`;
            if (visited.has(key)) continue;
            if (!isOpen(nx, ny)) continue;
            const info = danger[ny][nx];
            if (info.isFlameActive || info.dangerLevel > 0) continue;
            visited.add(key);
            queue.push({ x: nx, y: ny, path: [...curr.path, { x: nx, y: ny }] });
        }
    }

    return best;
}