/**
 * 單一權威的爆炸範圍（blast cells）計算。
 *
 * ============================ 存在的理由 ============================
 *
 * 這個模組存在的唯一目的是：**消除「AI 以為的爆炸範圍」與
 * 「遊戲實際造成的爆炸範圍」之間的不一致。**
 *
 * 修復前專案裡有三套各自為政的實作：
 *
 *  1) ExplosionManager.createExplosion()  ← 真正造成傷害的那一套（權威）
 *  2) DangerMap.update()                  ← 危險地圖，AI 靠它判斷安全與否
 *  3) Bot.getExplosionCells()             ← AI 規劃攻擊站位時用
 *
 * 三者的不一致（實測造成 AI 站進火裡）：
 *
 *  A) DangerMap 把方向寫死成四方向十字形，完全忽略炸彈的 shape：
 *         const directions = [
 *             { dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }
 *         ];
 *     但真實的 createExplosion() 會依 shape 改成：
 *       - 'X'    → 四個對角線
 *       - 'ROUND'/'STAR' → 十字 + 對角（對角只有一半長）
 *       - 'LASER' → 十字、貫穿所有軟磚、range 直接變成 20
 *     於是對角線上的格子在危險地圖裡被標成「安全」，
 *     實際上卻會被火焰掃到 —— AI 就這樣走進火裡。
 *
 *  B) Bot.getExplosionCells() 沒處理 'LASER' 與 'ICE'，
 *     而且 Bot.getMinBombExplosionTimeAt() 的 shape 對應表也漏了這兩種。
 *
 *  C) DangerMap 的怪物迴圈在炸彈迴圈「之後」執行，
 *     會把怪物周圍格的 explosionTimer 強制寫成 0，
 *     覆蓋掉那些格原本正確的炸彈倒數。
 *
 * 結論：只要三套實作不一致，AI 對「哪裡安全」的判斷就必然出錯，
 *       而出錯的表現正是「AI 站在它自認為安全的地方，卻被火焰掃到」。
 *
 * ============================ 不變的保證 ============================
 *
 * 本模組**只重述 ExplosionManager.createExplosion() 已有的幾何規則**，
 * 不新增、不放寬、不收緊任何一條：
 *   - 硬磚(1) 一律阻擋
 *   - 軟磚(2) 本身會被炸到；非穿透炸彈到此為止，穿透炸彈繼續
 *   - 範圍計算、對角線長度、LASER 的 range=20 全部照抄
 *
 * 傷害、範圍、引信時間、磚塊摧毀等遊戲規則完全沒有被更動。
 */

/**
 * 依遊戲規則算出某顆炸彈會炸到哪些格子。
 *
 * 這是 ExplosionManager.createExplosion() 中「幾何」那一段的純函式版本，
 * 不產生任何副作用（不摧毀磚塊、不生成道具、不觸發連鎖爆炸）。
 *
 * @param {object} gridSystem 提供 cols / rows
 * @param {object} mapManager 提供 getBlockType(x, y)
 * @param {number} gridX     炸彈所在格 X
 * @param {number} gridY     炸彈所在格 Y
 * @param {number} range     射程
 * @param {boolean} isPierce 是否穿透軟磚
 * @param {string} shape     'CROSS' | 'X' | 'ROUND' | 'STAR' | 'LASER' | 'ICE'
 * @returns {Set<string>} 以 "x,y" 表示的被炸到格子（包含炸彈自身所在格）
 */
export function computeBlastCells(gridSystem, mapManager, gridX, gridY, range, isPierce, shape) {
    const cells = new Set();
    cells.add(`${gridX},${gridY}`);

    // 形狀 → 方向集合。這裡必須與 ExplosionManager.createExplosion() 完全一致。
    let directions = [
        { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }
    ];
    let useRange = range;
    let pierce = isPierce;

    if (shape === 'X') {
        directions = [
            { dx: 1, dy: 1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: -1, dy: -1 }
        ];
    } else if (shape === 'ROUND' || shape === 'STAR') {
        directions = [
            { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
            { dx: 1, dy: 1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: -1, dy: -1 }
        ];
    } else if (shape === 'LASER') {
        // 雷射：四方向貫穿，射程極長（與 createExplosion 的行為一致）
        directions = [
            { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }
        ];
        pierce = true;
        useRange = 20;
    }
    // 'ICE' 與 'CROSS' 同樣是四方向，依 createExplosion 的預設分支處理。

    for (const dir of directions) {
        for (let i = 1; i <= useRange; i++) {
            // ROUND 的對角線只有一半長，形成圓形
            if (shape === 'ROUND' && Math.abs(dir.dx) === 1 && Math.abs(dir.dy) === 1) {
                if (i > useRange / 2) break;
            }

            const x = gridX + dir.dx * i;
            const y = gridY + dir.dy * i;

            const blockType = mapManager.getBlockType(x, y);

            // 硬磚(1)：直接停止蔓延（越界時 getBlockType 回傳的也是阻擋值）
            if (blockType === 1) break;

            // 軟磚(2) 本身會被炸到；非穿透炸彈到此為止
            cells.add(`${x},${y}`);
            if (blockType === 2 && !pierce) break;
        }
    }

    return cells;
}

/**
 * 把炸彈物件的 shape 欄位正規化成 computeBlastCells 認得的字串。
 *
 * BombManager 建立炸彈時 shape 的取值可能不同（undefined / 'CROSS' / 'X' ...），
 * 這裡集中處理，避免各處各自猜測。
 */
export function normalizeShape(shape) {
    if (shape === 'X' || shape === 'ROUND' || shape === 'STAR' || shape === 'LASER' || shape === 'ICE') {
        return shape;
    }
    return 'CROSS';
}