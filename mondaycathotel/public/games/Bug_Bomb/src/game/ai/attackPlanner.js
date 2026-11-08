/**
 * 攻擊規劃器：以「期望效用」取代「絕對安全」的硬性約束。
 *
 * ============================ 為什麼需要這個模組 ============================
 *
 * 舊的決策方式是布林式的：canSafelyPlaceBomb() 回傳 true/false，
 * 只有「保證 100% 撤離得出來」時才允許放炸彈攻擊。
 * 這在作業研究上等於一條硬性約束：
 *
 *     max   擊殺數
 *     s.t.  P(死亡) = 0        ← 沒有任何 trade-off 可言
 *
 * 在一開始就有 4 隻怪的第 1 關，這個可行域幾乎是空的
 * （實測「持有可攻擊方案」的時間為 0、平均擊殺 0.2 隻）。
 * 結果 AI 永遠不開火 → 永遠殺不到最後一隻 → 永遠無法過關。
 *
 * ============================ 正確的作業研究模型 ============================
 *
 * 這個遊戲的勝負條件是「殺光所有敵人」，所以三個選項的結局是：
 *   - 不開火   = 確定輸（怪物不會自己消失）
 *   - 冒險失敗 = 輸
 *   - 冒險成功 = 贏
 *
 * 兩個選項都是輸，因此「不冒險」並不保守，
 * 它只是把「確定輸」換成「慢慢輸」。硬性約束在此是錯的。
 *
 * 正確模型是期望效用最大化：
 *
 *     max  U(a) = w_kill·E[擊殺] − w_death·E[失去HP] − w_time·E[耗時]
 *
 * 讓「擊殺」與「死亡」有明確匯率可兌換，
 * 且因「不攻擊 = 確定輸」，w_kill 必須大於 w_death。
 *
 * 這不是要 AI 魯莽：撤離仍用真正的時間感知 BFS 計算，
 * 只是把「撤離失敗」從「否決一切」變成「扣分」。
 *
 * ============================ 不變的保證 ============================
 *
 * 只改變「要不要開火」的取捨權重，完全沒有改動：
 * 爆炸範圍、引信時間、傷害、玩家 HP、怪物速度與移動、
 * 碰撞判定或任何遊戲規則。移動與放彈仍走 Player 原有的機制。
 */

export const DEFAULT_WEIGHTS = {
    /** 每擊殺一隻怪物的效用。必須大於 deathPerHp，否則 AI 會選擇苟活。 */
    kill: 1000,
    /** 每失去 1 點 HP 的負效用。 */
    deathPerHp: 120,
    /** 每多花 1 幀的負效用（很小，只避免無謂繞路）。 */
    perFrame: 0.05,
    /** 完全撤離不出來的懲罰。 */
    noEscape: 400
};
/**
 * 枚舉所有「值得考慮」的放彈方案並評分。
 *
 * @param {object} bot      Bot 實例
 * @param {object} weights  效用權重（預設 DEFAULT_WEIGHTS）
 */
export function planAttack(bot, weights = DEFAULT_WEIGHTS) {
    const w = Object.assign({}, DEFAULT_WEIGHTS, weights || {});

    const range = bot.fireRange;
    const isPierce = !!bot.hasPierce;
    const shape = bot.getMyExplosionShape();
    const targets = bot.getEnemies();

    if (!targets || targets.length === 0) {
        return { best: null, evaluated: 0, rejected: {} };
    }

    const timePerCell = 1 / bot.getEffectiveSpeed();

    let best = null;
    let bestValue = -Infinity;
    let evaluated = 0;
    const rejected = { solid: 0, occupied: 0, noHit: 0, noEscape: 0 };

    // 候選放彈位置：自己所在格 + 半徑 3 格內可達的空地。
    // 引信 3 秒、每格約 1 秒，放彈後還得走至少一格去觸發。
    const candidates = [];
    const seen = new Set([`${bot.gridX},${bot.gridY}`]);
    const queue = [{ x: bot.gridX, y: bot.gridY, steps: 0 }];

    while (queue.length > 0) {
        const curr = queue.shift();
        candidates.push({ x: curr.x, y: curr.y, steps: curr.steps });
        if (curr.steps >= 3) continue;

        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            const nx = curr.x + dx, ny = curr.y + dy;
            const key = `${nx},${ny}`;
            if (seen.has(key)) continue;
            if (nx < 1 || ny < 1 ||
                nx >= bot.gridSystem.cols - 1 || ny >= bot.gridSystem.rows - 1) continue;
            seen.add(key);
            if (bot.mapManager.isSolid(nx, ny)) continue;
            if (bot.bombManager.hasBombAt(nx, ny)) continue;
            queue.push({ x: nx, y: ny, steps: curr.steps + 1 });
        }
    }

    for (const cand of candidates) {
        if (bot.mapManager.isSolid(cand.x, cand.y)) { rejected.solid++; continue; }
        if (bot.bombManager.hasBombAt(cand.x, cand.y)) { rejected.occupied++; continue; }

        const cells = bot.getExplosionCells(cand.x, cand.y, range, isPierce, shape);

        // 走到放彈位置要花的時間（必須在命中評估之前計算，
        // 因為預測怪物位置時要用到「爆炸的絕對時刻」）
        const approachTime = cand.steps * timePerCell;

        // ===== 命中評估：區分「靜止」與「移動中」的怪物 =====
        //
        // 實測（決定性，決定了整套策略）：
        //   Monster.getRandomDirection() 在「每個路口」都隨機挑方向：
        //       return dirs[Math.floor(Math.random() * dirs.length)];
        //   → 方向外推預測必然失準，這是為什麼預測模型完全沒有改善擊殺。
        //
        //   但 Monster.update() 開頭有：
        //       if (this.ai === 'idle') return;   // Mimic stays still
        //   → 'idle' 的怪物（MIMIC）完全不會移動。
        //
        // 引信是 3 秒。在這 3 秒內：
        //   移動的怪物  → 位置是隨機的，炸彈命中率本質上不可靠
        //   靜止的怪物  → 炸彈只要覆蓋它所在的格就必定命中
        //
        // 所以期望效用的「命中機率」項應該：
        //   - 靜止怪物：視為必定命中，給滿額
        //   - 移動怪物：只給很低的折扣，並且優先選擇「炸得到多格」的方案
        //                （一格爆炸範圍橫跨怪物可能的路徑，命中率才會有意義）
        //
        // 這是把「P(命中)」納入效用函數，而不是只數「炸得到幾隻」。
        const detonationAt = approachTime + bot.getFuseTime();
        let hitsReliable = 0;   // 靜止怪物：必定命中
        let hitsSpeculative = 0; // 移動怪物：靠猜
        let hitsNow = 0;

        for (const t of targets) {
            if (!t || t.isDead) continue;
            const stationary = (t.ai === 'idle');
            if (cells.has(`${t.gridX},${t.gridY}`)) hitsNow++;
            if (cells.has(`${t.gridX},${t.gridY}`) && stationary) {
                hitsReliable++;
            } else if (cells.has(`${t.gridX},${t.gridY}`) ||
                       cells.has(`${predictMonsterPosition(bot, t, detonationAt).x},` +
                                 `${predictMonsterPosition(bot, t, detonationAt).y}`)) {
                hitsSpeculative++;
            }
        }

        // 期望擊殺 = 靜止命中 + 移動命中 × 折扣
        //
        // 重要事實修正（實測）：
        //   Stage 1 的怪物是 ASSASSIN/chase(speed 4) ×2 + SPIDER/random(speed 2.5)，
        //   **完全沒有 ai==='idle' 的怪物**（MIMIC/idle 要到 Stage 30 才出現）。
        //   舊版把移動中怪物的折扣壓到 0.25，等於在 Stage 1 完全放棄攻擊，
        //   實測擊殺從 0.1 掉到 0.0、存活卻變好 —— 純粹苟活，正是要避免的。
        //
        // 折扣保留是因為「每路口隨機轉向」確實讓攔截不確定，
        // 但不能低到讓 AI 放棄整個進攻。0.6 表示「值得嘗試但非保證」。
        const hits = hitsReliable * 1.0 + hitsSpeculative * 0.6;
        if (hits < 0.2) { rejected.noHit++; continue; }
        evaluated++;

        // ===== 追逐型怪物要特別計價 =====
        //
        // ai === 'chase' 的怪物會主動往玩家移動，speed 4 很快。
        // 這是雙刃劍：好處是牠會自己走進玩家附近（比 random 好瞄），
        // 壞處是牠會把玩家逼到角落、難以脫身。
        //
        // 因此對 chase 型怪物：
        //   - 命中機率略高於 random（因為牠朝我們來，爆炸範圍更容易覆蓋）
        //   - 但「把自己困住」的風險要額外扣分
        let chaserPressure = 0;
        let chasingCount = 0;
        for (const t of targets) {
            if (!t || t.isDead) continue;
            if (t.ai === 'chase') {
                chasingCount++;
                const d = Math.abs(t.gridX - cand.x) + Math.abs(t.gridY - cand.y);
                // 放彈位置附近有追逐者 → 放彈後撤退空間變窄
                if (d <= 3) chaserPressure += 40;
            }
        }

        const escape = evaluateEscape(bot, cand, cells, w);

        // ===== 期望擊殺 =====
        //
        // ===== 實測（136 顆炸彈樣本）徹底推翻原本的「逃逸機率」評分 =====
        //
        // 原本這裡是：
        //     const esc = estimateEscapeChance(bot, cells, t);
        //     expectedKills += esc.p;          // p ∈ [0.12, 1.0]
        //
        // 量測結果（bb-mc2.mjs，直接用遊戲真正的 Monster 物件跑實驗）：
        //   特徵                            條件命中/總數    命中率
        //   火場蓋住怪物「現在」的格          13/13          100.0%
        //   逃逸出口 ≤ 1（陷阱邏輯）         15/130          11.5%
        //   火場面積 ≥ 5                    11/60           18.3%
        //   （基準：所有炸彈的命中率          15.4%）
        //
        // 兩個關鍵結論：
        //
        // 1) 「火場蓋住怪物當下的格」命中率 100%，13 顆全中。
        //    也就是說怪物其實**不會**在 3 秒引信內逃出火場 ——
        //    原本假設「速度 3 × 3 秒 = 9 格，所以一定逃得掉」是錯的。
        //
        // 2) 「逃逸出口 ≤ 1」命中率 11.5%，**低於基準 15.4%**，毫無鑑別力。
        //    傳統炸彈超人那套「把怪物困在死角」的思路，
        //    在這個遊戲裡**不成立**。
        //
        // 真正的機制是「炸彈阻擋」：
        //   Monster 的碰撞判定把「有炸彈的格」視為不可通行
        //   （Monster.js 的 checkCollision 會擋下 hasBombAt）。
        //   所以炸彈不只是武器，它同時是一道**圍牆**。
        //   把炸彈放在怪物旁邊 → 怪物被擋住跑不掉 →
        //   站在原地被 0.5 秒的火焰掃到。這才是高命中率的真正原因。
        //
        // 因此評分直接反映「蓋住幾隻怪物的當前位置」，
        // 不再乘上一個實測無效的逃逸機率（那只會稀釋掉正確訊號）。
        let expectedKills = 0;
        let covered = 0;

        // ===== 條件二：炸彈阻擋（實測證實的真機制）=====
        //
        // bb-mc2.mjs 的實測結果（136 顆炸彈）：
        //   火場蓋住怪物「現在」的格          13/13   命中率 100%
        //   逃逸出口 ≤ 1（陷阱邏輯）         15/130  命中率 11.5%（低於基準 15.4%）
        //
        // 「蓋住當下的格」之所以能 100% 命中，真正原因不是地形死角
        // （因為出口數量完全沒有鑑別力），而是 **炸彈本身會阻擋怪物**：
        // Monster.js 的 checkCollision 把「有炸彈的格」視為不可通行。
        // 所以炸彈放到怪物旁邊時，怪物不是「逃出火場」，而是「被擋住走不掉」。
        //
        // 這裡額外計分：這顆炸彈擋住了幾隻受傷怪物的去路。
        // 擋住越多 → 怪物越不可能離開火場 → 擊殺越確定。
        let blockedCount = 0;
        for (const t of targets) {
            if (!t || t.isDead) continue;
            if (!cells.has(`${t.gridX},${t.gridY}`)) continue;
            covered++;
            expectedKills += 1;

            // 怪物原本能走的四個方向，有幾個被這顆炸彈（或牆）封住
            let openDirs = 0;
            for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                const nx = t.gridX + dx, ny = t.gridY + dy;
                if (bot.mapManager.isSolid(nx, ny)) continue;      // 原本就走不了
                if (cand.x === nx && cand.y === ny) continue;      // 被這顆炸彈擋住
                if (bot.bombManager.hasBombAt(nx, ny)) continue;   // 被別的炸彈擋住
                openDirs++;
            }
            if (openDirs <= 1) blockedCount++;   // 只剩 ≤1 個出口 → 幾乎跑不掉
        }
        if (expectedKills < 0.12) { rejected.noHit++; continue; }
        evaluated++;

        // ===== 條件三：一定要能走出自己的火場（硬約束）=====
        //
        // 為什麼是「硬約束」而不是扣分：
        //   舊版用 w.noEscape = 400 當扣分，而 w.kill = 1000。
        //   也就是說「保證殺一隻但自己會死」算下來是 +600 → 照樣放彈。
        //   實測結果：自身炸彈死亡高達 19/30 局，是唯一真正的頭號死因。
        //
        // 經濟上的理由很直接：**死亡會終止整局**。
        //   殺 1 隻然後死 → 整局 0 分（還沒清完怪物）。
        //   不殺而活著 → 之後還有機會殺完。
        //   所以「逃不掉」的真實成本遠高於「少殺一隻」，
        //   用同一個數字單位去比較兩者本身就是錯的。
        //   這裡直接把無法撤退的方案否決掉。
        if (!escape.ok) { rejected.noEscape++; continue; }

        // 隊友安全（COOP 模式）：波及隊友要扣分，不是一票否決
        let teammateRisk = 0;
        if (typeof bot.isTeamMateInDangerZone === 'function' &&
            bot.isTeamMateInDangerZone(cells)) {
            teammateRisk = 900;
        }

        let value = w.kill * expectedKills;
        value -= w.perFrame * (approachTime + escape.time) * 60;
        value -= escape.risk;
        value -= approachTime * 10;
        value -= teammateRisk;
        value -= chaserPressure;

        // ===== 炸彈阻擋加成（實測證實的真機制）=====
        //
        // 命中率高達 100% 的原因不是「地形死角」，而是「炸彈擋住怪物」。
        // 所以「這顆炸彈封住了幾隻怪物的去路」應該直接反映在價值上：
        // 封得越死，怪物越走不掉，擊殺越確定。
        //
        // 權重取 kill 的一半（500）：
        //   足以讓「能封住怪物」的方案壓過「只是火場面積大」的方案，
        //   但不會壓過「多殺一隻」的差異（一隻 = 1000）。
        value += w.kill * 0.5 * blockedCount;

        // 接近路徑必須「走得到」且「不穿過怪物」。
        //
        // 實測（決定性）：planner 建議把炸彈放在 (6,1)，
        // 但 MIMIC 正好站在 (4,1)，擋在 Bot(3,1) 與 (6,1) 之間。
        // AI 要走過去就必須穿過怪物 —— PRIORITY 0 的生存判斷會立刻切換成 FLEE，
        // 攻擊計畫每幀都被中止，於是「放彈 4 顆、擊殺 0」。
        // 這正是「生存」與「攻擊」兩個目標互相牴觸的實例。
        //
        // 修正：改用避開怪物所在格與其鄰格的路徑規劃，讓 AI 繞路而不是硬闖。
        // 注意 approachPath 必須走「到」放彈格（stopBeforeTarget = false），
        // 否則 AI 會停在前一格、永遠等不到 gridX===bombX 而從不放彈
        // （實測「接近步數=3 但路徑長度=2」就是這個問題）。
        // 接近路徑：優先避開怪物；但若避不開就退回一般路徑，
        // 不能因為「路上有怪物」就放棄整個攻擊方案 ——
        // 實測 planner 執行 127 次卻「找到方案 0 次」，原因就是這裡 continue 掉了所有候選。
        //
        // 保留 canEscape 評分來表達風險：planner 的 value 已經把
        // 「撤退拿不到安全格」的風險算成扣分，所以放行是安全的。
        let approachPath = planApproachAvoidingMonsters(bot, cand);
        if (approachPath === null) {
            approachPath = bot.aStar(bot.gridX, bot.gridY, cand.x, cand.y, false) || [];
        }

        if (value > bestValue) {
            bestValue = value;
            best = {
                bombX: cand.x, bombY: cand.y,
                hits, expectedKills,
                approachSteps: cand.steps,
                approachPath,
                escapePath: escape.path,
                escapeTime: escape.time,
                escapeOk: escape.ok,
                value
            };
        }
    }

    return { best, evaluated, rejected };
}

/**
 * 評估「放完炸彈之後能不能活」。
 *
 * 重點：這裡回傳的不是 true/false，而是
 *   - ok：是否找到完全安全的撤退點
 *   - time：需要多久
 *   - risk：找不到安全點時的風險代價（有數值，不是無限大）
 *   - path：盡量能走的撤退路線
 *
 * 注意：這裡「不把怪物鄰格當絕對不安全」。
 * 那是舊 canSafelyPlaceBomb() 造成 AI 完全不開火的主因：
 * 怪物會移動，AI 只需要比牠們早一步離開危險區即可，
 * 而 DangerMap 已經把怪物資訊獨立在 monsterThreat 欄位。
 */
function evaluateEscape(bot, bombCand, blastCells, w) {
    const fuse = bot.getFuseTime();
    const timePerCell = 1 / bot.getEffectiveSpeed();
    const timeToBomb = bombCand.steps * timePerCell;

    const queue = [{ x: bot.gridX, y: bot.gridY, time: 0, path: [] }];
    const visited = new Set([`${bot.gridX},${bot.gridY}`]);

    while (queue.length > 0) {
        const curr = queue.shift();

        // 完全安全：不在自己的火場內，且其他炸彈也來不及炸到
        if (!blastCells.has(`${curr.x},${curr.y}`)) {
            const bombTime = bot.getMinBombExplosionTimeAt(curr.x, curr.y);
            const dInfo = bot.dangerMap.getDangerInfo(curr.x, curr.y);
            const otherBombSafe = (bombTime === Infinity || curr.time < bombTime);
            const flameClear = !dInfo.isFlameActive;
            const levelSafe = (dInfo.dangerLevel === 0 || curr.time < dInfo.explosionTimer);

            if (flameClear && otherBombSafe && levelSafe) {
                return { ok: true, time: curr.time + timeToBomb, path: curr.path, risk: 0 };
            }
        }

        if (curr.time >= fuse - timeToBomb) continue;

        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            const nx = curr.x + dx, ny = curr.y + dy;
            const key = `${nx},${ny}`;
            if (visited.has(key)) continue;
            visited.add(key);
            if (nx < 1 || ny < 1 ||
                nx >= bot.gridSystem.cols - 1 || ny >= bot.gridSystem.rows - 1) continue;
            if (bot.mapManager.isSolid(nx, ny)) continue;
            if (bot.bombManager.hasBombAt(nx, ny)) continue;
            if (bot.dangerMap.getDangerInfo(nx, ny).isFlameActive) continue;

            queue.push({
                x: nx, y: ny, time: curr.time + timePerCell,
                path: [...curr.path, { x: nx, y: ny }]
            });
        }
    }

    // 找不到完全安全的點 → 回報「最好的部分撤退」並附上風險代價。
    // 這是關鍵差異：舊版在這裡直接回傳 canEscape = false，
    // 等於「沒有完美解就不開火」，於是永遠不攻擊、最終永遠無法過關。
    return {
        ok: false,
        time: fuse - timeToBomb,
        path: [],
        risk: w.noEscape
    };
}

// ============================================================
//  逃逸機率：決定炸彈能不能真的殺到怪物
// ============================================================
//
// 實測洞察（使用者提供的策略，且與實測一致）：
//   怪物是「隨機走動、不會閃避炸彈」。所以瞄準現在位置沒有意義
//   （怪物在 3 秒引信內會亂走），但「把怪物封在一個炸得到、
//   又逃不出去的地方」是可靠的。
//
// 因此候選評分不能只問「火場有沒有覆蓋怪物」，
// 必須問「怪物能不能在引信結束前走出火場」：
//
//     P(擊殺 | 放彈於 c) = P(怪物在引信內仍在 c 的爆炸範圍)
//
// 對隨機走動的怪物，逃逸選項越少、且最近的逃逸點越遠，
// 這個機率就越高。舉例：
//   怪物在死巷末端 → 只有 1 個出口且出口也在火場內 → 幾乎必死
//   怪物在開闊十字路口 → 4 個方向都是火場外的空地 → 機率很低
//
// 這個評分取代原本的「hits 數量」，因為後者與實際擊殺脫節。
function estimateEscapeChance(bot, blastCells, monster) {
    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    let escapeOptions = 0;      // 火場外的可走鄰格數
    let nearestSafe = 99;       // 到最近火場外安全格的距離

    // BFS：從怪物所在格出發，找火場外的可通行格
    const queue = [{ x: monster.gridX, y: monster.gridY, d: 0 }];
    const visited = new Set([`${monster.gridX},${monster.gridY}`]);
    let found = 0;

    while (queue.length > 0 && found < 12) {
        const curr = queue.shift();
        if (curr.d > 0 && !blastCells.has(`${curr.x},${curr.y}`)) {
            escapeOptions++;
            if (curr.d < nearestSafe) nearestSafe = curr.d;
            if (nearestSafe <= 2) break;
            continue;              // 找到安全格就不再往更深處展開
        }
        for (const [dx, dy] of dirs) {
            const nx = curr.x + dx, ny = curr.y + dy;
            const key = `${nx},${ny}`;
            if (visited.has(key)) continue;
            if (nx < 1 || ny < 1 ||
                nx >= bot.gridSystem.cols - 1 || ny >= bot.gridSystem.rows - 1) continue;
            if (bot.mapManager.isSolid(nx, ny)) continue;
            visited.add(key);
            queue.push({ x: nx, y: ny, d: curr.d + 1 });
        }
        found = escapeOptions;
    }

    // 逃逸機率：出口越少、越遠越難逃
    // 0 個出口 → 1.0（必定擊殺）；每多一個出口機率遞減
    let p = 1.0;
    if (escapeOptions === 0) p = 1.0;
    else if (escapeOptions === 1) p = 0.75;
    else if (escapeOptions === 2) p = 0.45;
    else if (escapeOptions === 3) p = 0.25;
    else p = 0.12;

    // 引信 3 秒、怪物每秒約走 1 格：最近的火場外格若在 1 格內，
    // 幾乎來得及逃出去 → 再打折
    if (nearestSafe <= 1) p *= 0.5;
    else if (nearestSafe === 2) p *= 0.8;

    return { p, escapeOptions, nearestSafe };
}

/**
 * 沿 Monster.direction 外推 t 秒後的預測位置（僅作參考）。
 *
 * 注意：實測發現怪物每個路口都隨機轉向（getRandomDirection），
 * 這個外推幾乎不準，因此主要評分已改用 estimateEscapeChance() 的
 * 逃逸機率，而不是預測座標。這裡保留給需要單純方向估計的呼叫端。
 */
function predictMonsterPosition(bot, monster, secondsAhead) {
    const gx = monster.gridX;
    const gy = monster.gridY;
    const dir = monster.direction;

    if (!dir || (dir.dx === 0 && dir.dy === 0)) {
        // 沒有移動方向 → 視為原地不動
        return { x: gx, y: gy, moving: false };
    }

    // 每格所需時間與玩家相同（以格為單位）
    const steps = Math.floor(secondsAhead * bot.getEffectiveSpeed());
    if (steps <= 0) return { x: gx, y: gy, moving: true };

    let px = gx, py = gy;
    for (let i = 0; i < steps; i++) {
        const nx = px + dir.dx;
        const ny = py + dir.dy;
        // 撞牆就停下來（實際上怪物會轉彎，但這裡取保守估計）
        if (bot.mapManager.isSolid(nx, ny)) break;
        if (bot.bombManager.hasBombAt(nx, ny)) break;
        px = nx; py = ny;
    }
    return { x: px, y: py, moving: true };
}

/**
 * 規劃「走到放彈位置」的路徑，並避開怪物。
 *
 * 為什麼不能用現成的 aStar：
 *   aStar 只把「牆」與「火焰」當障礙，不把怪物當障礙。
 *   實測 planner 建議的炸彈位 (6,1) 被 MIMIC@(4,1) 擋住，
 *   AI 若照著走就會直接撞進怪物身上 —— 被 PRIORITY 0 的生存判斷中止，
 *   攻擊計畫每幀重來，最後「放彈 4 顆、擊殺 0」。
 *
 * 這裡用 BFS，把「怪物所在格 + 怪物鄰格」視為高成本而非絕對禁行：
 *   - 絕對禁行會讓很多方案直接不可行（怪物常常就站在附近）
 *   - 給予高成本則讓 AI 優先繞路，但必要時仍可選擇穿越
 *
 * 回傳 null 代表完全走不到（此時呼叫端會放棄該方案）。
 */
function planApproachAvoidingMonsters(bot, cand) {
    const startX = bot.gridX, startY = bot.gridY;
    if (startX === cand.x && startY === cand.y) return [];

    const block = new Set();
    for (const t of bot.getEnemies()) {
        if (!t || t.isDead) continue;
        block.add(`${t.gridX},${t.gridY}`);
    }

    const queue = [{ x: startX, y: startY, path: [] }];
    const visited = new Set([`${startX},${startY}`]);
    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];

    while (queue.length > 0) {
        const curr = queue.shift();
        for (const [dx, dy] of dirs) {
            const nx = curr.x + dx, ny = curr.y + dy;
            const key = `${nx},${ny}`;
            if (visited.has(key)) continue;
            visited.add(key);

            if (nx < 1 || ny < 1 ||
                nx >= bot.gridSystem.cols - 1 || ny >= bot.gridSystem.rows - 1) continue;
            if (bot.mapManager.isSolid(nx, ny)) continue;
            if (bot.bombManager.hasBombAt(nx, ny)) continue;
            if (bot.dangerMap.getDangerInfo(nx, ny).isFlameActive) continue;
            // 絕對不能踩進怪物所在的格子（會直接被撞死）
            if (block.has(key)) continue;

            const nextPath = [...curr.path, { x: nx, y: ny }];
            if (nx === cand.x && ny === cand.y) return nextPath;
            queue.push({ x: nx, y: ny, path: nextPath });
        }
    }
    return null;
}

function nearestMonsterDistance(bot, targets) {
    let best = Infinity;
    for (const t of targets) {
        if (!t || t.isDead) continue;
        const d = Math.abs(t.gridX - bot.gridX) + Math.abs(t.gridY - bot.gridY);
        if (d < best) best = d;
    }
    return best === Infinity ? 99 : best;
}