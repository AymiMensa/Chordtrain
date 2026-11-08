import { computeBlastCells, normalizeShape } from './blast.js';
import { planAttack } from './attackPlanner.js';
import { Player } from '../player/Player.js';
import { AIController, sharedRegistry, sharedNn, sharedCoordinator } from './AIController.js';
import { ORPlanner, ChainReactionPlanner, BossTactics } from './AIStrategy.js';
import { installHunterPolicy } from './HunterPolicy.js';
import { installMCTSolver } from './MCTSolver.js';
import { installMCTSPolicy } from './MCTSPolicy.js';

/**
 * 檢查 aStar 出來的路徑，沿途每一格是否安全。
 *
 * 危險條件（任一成立即淘汰）：
 *   - 該格是毒水 blockType 5（踩到即死，Player.js:219-222）
 *   - 該格正在燃燒
 *   - 抵達那一刻，該格會被某顆還沒爆的炸彈掃到
 */
function pathIsSafe(b, p) {
    const timePerCell = 1 / Math.max(0.01, b.getEffectiveSpeed());
    for (let i = 0; i < p.length; i++) {
        const cell = p[i];
        if (!cell) continue;
        const gx = cell.x, gy = cell.y;
        if (b.mapManager.getBlockType(gx, gy) === 5) return false;
        if (b.dangerMap.getDangerInfo(gx, gy).isFlameActive) return false;
        const tArrive = (i + 1) * timePerCell;
        const bt = b.getMinBombExplosionTimeAt(gx, gy);
        if (bt !== Infinity && bt <= tArrive + 0.15) return false;
    }
    return true;
}

/**
 * 超級炸彈超人電腦AI
 * 核心設計原則：
 * 1. 保命為第一優先 - 絕不自殺、絕不站炸彈上、絕不關廁所
 * 2. 精確模擬炸彈爆炸（含穿透）與時間 - 決定能否安全放炸彈
 * 3. 善用牆壁作為防禦與攻擊利器
 * 4. 預測敵人位置與炸彈效果，精準獵殺
 * 5. 永遠有明確行動目標，絕不發呆
 * 6. 利用不可摧毀牆壁躲避火力，利用可摧毀牆壁掩護與開路
 * 7. 超級炸彈（穿牆）絕對不會站在會被炸死的座標位置
 * 8. 會利用炸彈把敵人關廁所（堵在死路裡面），然後躲到安全處
 * 9. 附近沒敵人時，AI沒事情可做時，才會開始亂炸可炸牆
 * 10. 邏輯優先順序絕對不能顛倒或錯誤
 */
export class Bot extends Player {
    constructor(gridX, gridY, gridSystem, mapManager, dangerMap, bombManager, itemManager) {
        const mockInputManager = { 
            isKeyPressed: () => false,
            players: [{ actionJustPressed: false }, { actionJustPressed: false }]
        };
        super(gridX, gridY, gridSystem, mockInputManager, mapManager);
        this.setBombManager(bombManager);
        this.dangerMap = dangerMap;
        this.itemManager = itemManager;
        
        this.targetPath = [];
        this.state = 'IDLE'; 
        this.thinkTimer = 0;
        
        this.aiInput = {
            up: false, down: false, left: false, right: false, bomb: false, action: false
        };
        
        this.inputManager.isActionPressed = (pid, action) => !!this.aiInput[action];
        
        // 卡牆偵測與處理
        this.stuckTimer = 0;
        this.lastGridX = this.gridX;
        this.lastGridY = this.gridY;
        this.consecutiveStuck = 0;
        this.pathRecalcTimer = 0;
        
        // 行動偏好權重 - 保命優先
        this.gatherCooldown = 0;
        
        // 記錄是否有超級炸彈（穿牆能力）
        this._hasSuperBomb = false;
        
        // 最後放炸彈的位置，用於檢查是否會自殺
        this.lastBombPlacement = null;

        // 連續嘗試同一方向卻未移動的次數（用於強迫換方向）
        this.blockedDir = null;
        this.blockedDirCount = 0;

        // 逃離承諾（遲滯）：決定撤退之後就一路走完，不准被其他狀態推翻。
        // 這是解決 FLEE / GATHER / UNSTUCK 每幀互相抽屜（控制抖振）的關鍵。
        this.escapeCommitted = false;
        // 承諾的到期時間（this.time 是 Player 的累計時間，單位秒）。
        // 承諾必須有時限，否則一旦「路徑被物理擋住走不動」，
        // 承諾就會永遠成立 → AI 永久凍結（實測曾出現 6322 幀 / 105 秒完全不動）。
        this.escapeCommitDeadline = 0;

        // 偏移目標格的承諾（第二十五輪）：一格一格地穩定偏移時固定住，
        // 避免 gridX/gridY 在格線附近翻頁導致目標跟著跳、方向每幀翻面。
        this.nudgeRefCell = null;

        // --- 深度學習 + 作業研究 + 賽局理論 控制器 ---
        // 共用單例讓雙電腦合作模式下兩台 Bot 能協調並共同累積勝率（結果論）。
        this.aiPlanner = new ORPlanner(
            gridSystem,
            mapManager,
            bombManager,
            window.explosionManager || null,
            window.monsterManager || null
        );
        this.chainReactionPlanner = new ChainReactionPlanner(
            gridSystem,
            mapManager,
            bombManager,
            window.explosionManager || null,
            window.monsterManager || null
        );
        this.bossTactics = new BossTactics(
            gridSystem,
            mapManager,
            bombManager,
            window.explosionManager || null,
            window.monsterManager || null,
            dangerMap
        );
        const aiModes = ['BOT_BOT_COOP', 'BOT_SINGLE'];
        this.aiController = new AIController(
            this, sharedRegistry, sharedNn, this.aiPlanner, sharedCoordinator, 'bot',
            this.chainReactionPlanner, this.bossTactics
        );
        this.aiController.enabled = aiModes.includes(window.gameMode || '');
        this.aiController.botId = (gridX === 1) ? 'bot' : 'bot2';

        // ===== Hunter 政策狀態（朝 100 關邁進）=====
        // installHunterPolicy 會把 this.think 覆寫為 kill-first 決策函式。
        this._hunterInstalled = false;
        this._hstats = { thinks: 0 };
        // MCTSolver 的政策狀態（本輪新增的「深度學習 + 作業研究 + 賽局理論」求解器）。
        // 兩者都不可被刪除：hunter 是已量測到 ~83% 通關的高勝率策略，
        // mctsolver 是新候選，誰優先用誰（可由 __BB_POLICY_OVERRIDE 或登記冊決定）。
        this._activePolicy = 'hunter';
        this._mstats = { thinks: 0 };
    }

    /** 取得隊友（僅電腦雙人合作時有另一台 Bot；單人則回傳空陣列） */
    _teammates() {
        const me = this;
        const t = [];
        if (window.bot && window.bot !== me) t.push(window.bot);
        if (window.bot2 && window.bot2 !== me) t.push(window.bot2);
        return t;
    }

    /**
     * 物理可通行性驗證（關鍵修正）
     *
     * Player.update() 的碰撞判定不是「目標格是否空」，而是「玩家碰撞框
     * (cellSize×cellSize，內縮 0.2 cell) 的四個角」是否落在 solid 格上。
     * 因為網格座標是以「中心點」算的（gridX = floor((x+cs/2)/cs)），
     * 當角色位於格子內偏右或偏下時，某一個角會伸進鄰格的牆裡，
     * 導致「目標格明明是空的，卻一步也走不過去」。
     *
     * 舊的 AI 只用 mapManager.isSolid(目標格) 判斷可走，於是反覆對同一個
     * 物理上走不通的方向送出移動指令，因為網格座標從未改變而無限迴圈。
     * 這裡完整重演 Player 的四角 AABB 判定，讓決策層看到真實的物理結果。
     */
    canPhysicallyMove(dx, dy) {
        const cs = this.gridSystem.getCellSize();
        const pad = cs * 0.2;
        const step = this.speed * (this.hasDash ? 1.5 : 1) * cs * (1 / 60);
        const nx = this.x + (dx !== 0 ? Math.sign(dx) * step : 0);
        const ny = this.y + (dy !== 0 ? Math.sign(dy) * step : 0);

        // 與 Player.update 的 checkCollision 相同：四個角都不可落在 solid 上
        const corners = [
            [nx + pad, ny + pad],
            [nx + cs - pad, ny + pad],
            [nx + pad, ny + cs - pad],
            [nx + cs - pad, ny + cs - pad],
        ];
        for (const [cx, cy] of corners) {
            const g = this.gridSystem.getGridCoord(cx, cy);
            if (this.mapManager.isSolid(g.x, g.y)) {
                if (this.isGhost && this.hasWallPass) continue;
                return false;
            }
        }

        // 炸彈阻擋：允許從「自己已經踩上去的」炸彈走出，其他炸彈仍然擋路
        if (this.bombManager && !this.hasBombPass) {
            for (const bomb of this.bombManager.bombs) {
                const bp = this.gridSystem.getPixelCoord(bomb.gridX, bomb.gridY);
                const n1x = nx + pad, n1y = ny + pad, n2x = nx + cs - pad, n2y = ny + cs - pad;
                if (n1x < bp.x + cs && n2x > bp.x && n1y < bp.y + cs && n2y > bp.y) {
                    const o1x = this.x + pad, o1y = this.y + pad, o2x = this.x + cs - pad, o2y = this.y + cs - pad;
                    const wasOverlapping = o1x < bp.x + cs && o2x > bp.x && o1y < bp.y + cs && o2y > bp.y;
                    if (!wasOverlapping) return false;
                }
            }
        }
        return true;
    }

    /**
     * 從四個方向中挑一個「物理上真的走得通」且安全的。
     * 用於卡住時擺脫，以及 patrol / 移動指令的最後一道防線。
     */
    pickPhysicallyValidDirection(candidates) {
        for (const [dx, dy] of candidates) {
            if (this.canPhysicallyMove(dx, dy)) return [dx, dy];
        }
        return null;
    }

    /**
     * 擺脫卡死：當連續嘗試同一方向都沒有移動時，強制選擇一個走得通的方向。
     *
     * 這是「保命優先」原则的最後一道保險——寧可走到稍微不理想的格子，
     * 也不能停在原地等死。
     *
     * 關鍵設計（實測）：走廊情境下（上下都是硬磚），可走方向往往只剩左右，
     * 而左右往來幾次後又會回到原點。此時必須納入「炸開軟磚脫身」的選項，
     * 否則 AI 會在走廊裡無限橫跳，永遠出不去（實測 600 秒殺不到任何怪）。
     */
    breakOutOfStall() {
        const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];

        // ===== 第三十七輪（決定性）：怪物已逼近時，脫困不得放彈 =====
        //
        // 實測（bb-autopsy.mjs，第 1 關 seed 111）：
        //   存活 10.93s、放彈 3 顆（全部幾何安全）、死因 FIRE
        //   FLEE 46.5%、CORE_ALIGN 25.3%、UNSTUCK 21.3%
        //
        // UNSTUCK 佔兩成 = breakOutOfStall 被大量觸發。
        // 它在「走不動」時會去炸腳下的軟磚開路，
        // 但當時怪物已經逼近（這正是它走不動的原因之一）。
        // 於是它放下炸彈、站在火場裡、下一幀才開始 FLEE ——
        // 引信 3 秒，撤退的時間被自己偷走了一大半。
        //
        // 關鍵：開路是「長期投資」，逃跑是「短期生存」。
        // 怪物已進入致死距離時，長期投資一定來不及回本。
        //
        // 這裡用與 guardAgainstLethalMonster 相同的距離判準（cs * 1.0），
        // 不新增任何標準，只是把「逃生」排在「開路」之前。
        // 這與本檔案既有的「硬約束 > 軟目標」原則一致。
        {
            const cs2 = this.gridSystem.getCellSize();
            const px = this.x + cs2 / 2, py = this.y + cs2 / 2;
            let nearest2 = Infinity;
            for (const m of this.getEnemies()) {
                if (!m || m.isDead) continue;
                const d = Math.hypot(px - (m.x + cs2 / 2), py - (m.y + cs2 / 2));
                if (d < nearest2) nearest2 = d;
            }
            if (nearest2 <= cs2 * 1.0) {
                // 怪物貼身 → 只准移動，不准放彈（放彈一定來不及）
                const escapeOnly = [];
                for (const [dx, dy] of dirs) {
                    if (!this.canPhysicallyMove(dx, dy)) continue;
                    const nx = this.gridX + dx, ny = this.gridY + dy;
                    const info = this.dangerMap.getDangerInfo(nx, ny);
                    let risk = 0;
                    if (this.bombManager.hasBombAt(nx, ny)) risk += 100;
                    if (info.isFlameActive) risk += 1000;
                    if (this.mapManager.getBlockType(nx, ny) === 5) risk += 2000;
                    escapeOnly.push({ dx, dy, risk });
                }
                if (escapeOnly.length === 0) return false;   // 四面走不動，無解
                escapeOnly.sort((a, b) => a.risk - b.risk);
                const pick = escapeOnly[0];
                this.resetInput();
                if (pick.dx > 0) this.aiInput.right = true;
                else if (pick.dx < 0) this.aiInput.left = true;
                else if (pick.dy > 0) this.aiInput.down = true;
                else this.aiInput.up = true;
                this.state = 'FLEE';
                this.consecutiveStuck = 0;
                this.targetPath = [];
                return true;
            }
        }
        // 依「是否會踩進危險」排序：安全優先，危險次之，都不行也走
        const scored = [];
        for (const [dx, dy] of dirs) {
            if (!this.canPhysicallyMove(dx, dy)) continue;
            const nx = this.gridX + dx, ny = this.gridY + dy;
            let risk = 0;
            if (this.bombManager.hasBombAt(nx, ny)) risk += 100;
            const info = this.dangerMap.getDangerInfo(nx, ny);
            if (info.isFlameActive) risk += 1000;
            if (info.dangerLevel > 0) risk += 50;
            if (this.mapManager.getBlockType(nx, ny) === 5) risk += 2000; // 毒水
            // 盡量遠離怪物
            for (const m of this.getEnemies()) {
                const dist = Math.abs(m.x - nx) + Math.abs(m.y - ny);
                if (dist <= 1) risk += 30;
            }
            scored.push({ dx, dy, risk });
        }
        if (scored.length === 0) return false;

        // ===== 第六十四輪（架構重構）：breakOutOfStall 不再開路 =====
        //
        // 這是「兩套開路邏輯」問題的正式修法。之前判斷「用一個計數器擋掉它」
        // 兩次都失敗（consecutiveStuck 在呼叫前已歸零、_carveNoProgress 恆為 0），
        // 那是因為**根本不该讓這裡開路**。
        //
        // 開路的全部權力集中在 carveTowardKillSpot()，它已經具備：
        //   - carvePlan 跨幀承諾（第 12 輪）
        //   - no-progress 偵測（第 32 輪）
        //   - stand 太遠就換牆（第 29 輪）
        //   - 區域太小就找最近軟磚（第 61/62 輪）
        //   - 幾何死路檢查（第 20 輪）
        //   - 單顆炸彈間隔（第 36 輪）
        //
        // 而這裡原本做的事全都不屬於它的職責：站在當前格炸腳邊的磚、
        // resetInput 抹掉別人設的方向、覆蓋別人算好的 targetPath。
        // 實測（第 1 關 seed 4242 / 200 秒）：
        //   BREACH_FOR_ATTACK 150 幀（21.1%）vs CARVE_MOVE+GATE 96 幀（13.5%）
        //   ——反應式開路佔了計畫式的 1.5 倍，而且它覆蓋掉計畫。
        //
        // 現在這裡只負責「走動」：挑一個物理可行、風險最低的方向。
        // 要炸牆就交給 carveTowardKillSpot()，那是唯一的決策點。
        //
        // 這不是「少做一件事」，而是「同一件事只由一個地方決定」。
        // 沒有改動任何遊戲規則：仍然只用遊戲本身的炸彈與碰撞。

        scored.sort((a, b) => a.risk - b.risk);
        const pick = scored[0];
        // 保留「放炸彈」的決定：救援只該改移動方向，不該取消已經排好的攻擊。
        // 舊版這裡直接 resetInput()，會把 think() 剛設下的 aiInput.bomb 清成 false，
        // 導致 AI 明明判定可以安全放炸彈、場上卻永遠一顆炸彈都沒有。
        const wantBomb = this.aiInput.bomb;
        this.resetInput();
        this.aiInput.bomb = wantBomb;
        if (pick.dx > 0) this.aiInput.right = true;
        else if (pick.dx < 0) this.aiInput.left = true;
        else if (pick.dy > 0) this.aiInput.down = true;
        else this.aiInput.up = true;

        // ===== 第六十四輪（架構重構，關鍵）：不要清掉計畫路徑 =====
        //
        // 舊版這裡無條件 `this.targetPath = []`，
        // 於是每次「脫困」都把 carveTowardKillSpot 算好的路徑刪掉。
        // 配合 think() 每幀重新規劃、breakOutOfStall 每幀又清一次，
        // 計畫永遠走不到第一步 —— 這正是 CARVE_GATE 只有 2 幀的原因。
        //
        // 現在：只有在**真的沒有計畫**時才清空。
        // 有計畫就保留，讓 followPath 沿著計畫走 ——
        // 脫困只影響「這一步往哪走」，不影響「整個計畫要去哪」。
        if (!this.carvePlan) {
            this.targetPath = [];
        }
        this.state = 'UNSTUCK';

        // ===== 重置卡死計數，否則每幀都會重複脫困 =====
        //
        // 實測：加上「站正無效就升級脫困」之後，AI 確實走動了
        // （30 秒走過 6 格、涵蓋 3,3 / 3,2 / 3,1 / 2,3 / 1,3 / 4,3），
        // 但狀態分布裡 UNSTUCK 佔了 955/1800 幀、SNIPE_MOVE 只有 475 幀。
        //
        // 原因：consecutiveStuck / blockedDirCount 沒有歸零，
        // 下一幀的 needsCentering() 立刻又判定走不動、再次呼叫脫困，
        // 於是 AI 幾乎沒有時間執行真正的攻擊計畫。
        //
        // 修正：既然已經重新選了一個「物理可走」的方向，
        // 就把卡死相關計數清乾淨，讓 AI 有機會走完这一步再重新判斷。
        this.consecutiveStuck = 0;
        this.blockedDir = null;
        this.blockedDirCount = 0;
        this.stuckTimer = 0;
        return true;
    }

    /**
     * 走廊脫困：四周可走方向很少（多半是上下都是硬磚的走廊），
     * 且反覆橫跳無法定格在原格時，改用炸彈炸開擋路的軟磚走出去。
     *
     * 判斷條件刻意保守，只在「明顯被困」時才出手：
     *   - 連續卡住達門檻
     *   - 上下都是硬磚（真正的走廊）
     *   - 腳下炸得到至少一面軟磚，且炸完仍能安全撤退
     *
     * 回傳 true 表示已發出放彈指令。
     */
    tryCorridorEscape() {
        if (this.consecutiveStuck < 2) return false;
        if (this.currentBombs >= this.maxBombs) return false;
        // 腳下有炸彈正在倒數 → 交給 FLEE 處理，不要在腳下再放一顆
        if (this.bombManager.hasBombAt(this.gridX, this.gridY)) return false;

        // 確認是走廊：上下都是不可破壞的硬磚
        const up = this.mapManager.getBlockType(this.gridX, this.gridY - 1);
        const down = this.mapManager.getBlockType(this.gridX, this.gridY + 1);
        if (up !== 1 || down !== 1) return false;

        // 左右若有一邊是軟磚，炸它就能離開走廊
        const left = this.mapManager.getBlockType(this.gridX - 1, this.gridY);
        const right = this.mapManager.getBlockType(this.gridX + 1, this.gridY);

        const range = this.fireRange;
        const cells = this.getExplosionCells(this.gridX, this.gridY, range, false, 'CROSS');

        let target = null;
        if (right === 2 && cells.has(`${this.gridX + 1},${this.gridY}`)) target = [1, 0];
        else if (left === 2 && cells.has(`${this.gridX - 1},${this.gridY}`)) target = [-1, 0];
        if (!target) return false;

        if (this.isTeamMateInDangerZone(cells)) return false;
        const esc = this.canSafelyPlaceBomb(this.gridX, this.gridY, range, false, 'CROSS');
        if (!esc.canEscape) return false;

        this.aiInput.bomb = true;
        this.targetPath = esc.path;
        this.state = 'CORRIDOR_ESCAPE';
        this.thinkTimer = 0;
        return true;
    }

    update(deltaTime) {
        if (this.isDead) {
            // 第二十一輪：死亡路徑也是一條會送出按鍵的路徑
            this.vetoUnsafeBombPlacement();
            this.updatePlayer(deltaTime);
            return;
        }

        this.thinkTimer -= deltaTime;
        this.pathRecalcTimer -= deltaTime;

        // 卡牆偵測：如果一段時間沒有移動到新格子
        if (this.gridX === this.lastGridX && this.gridY === this.lastGridY) {
            this.stuckTimer += deltaTime;
            if (this.stuckTimer > 0.5) {
                this.consecutiveStuck++;

                // ===== 生存優先：踩在自己的活彈上時，絕對不能抹掉撤退路徑 =====
                //
                // 實測（決定性，60% 的死亡來自自己的火）：
                // 舊版無條件 `this.targetPath = []`。
                // 但「沒有移動到新格子」不等於「卡住」——
                // 角色在「同一格內」移動時 gridX/gridY 根本不變，
                // 所以只要在格內多待 0.5 秒（正常走動都會）就會被判成卡住。
                //
                // 結果：canSafelyPlaceBomb() 辛苦算出來的逃生路徑，
                // 剛設定好就被這裡清空，接著 think() 重新規劃時
                // 又因為「還在原地」而再次清空 → 反覆重新規劃（replanning thrash）。
                // 實測 20 局：站在自己活彈上 1429 幀，其中 428 幀（30%）
                // 撤退路徑是空的，AI 就這樣站在自己剛放的炸彈上被自己的火燒死。
                //
                // 這裡的取捨很明確：卡住是「效率問題」，被自己的炸彈炸死是「結束遊戲」。
                // 效率永遠可以放棄，命不行。所以只要腳下還有會爆的炸彈，
                // 就保留現有路徑不動。
                const footBomb = this.bombManager.getBombAt(this.gridX, this.gridY);
                const onLiveOwnBomb = footBomb && footBomb.player === this && !footBomb.isExploded;
                if (!onLiveOwnBomb) {
                    this.targetPath = [];
                }
                this.consecutiveStuck = Math.min(this.consecutiveStuck, 5);
            }
        } else {
            this.stuckTimer = 0;
            this.lastGridX = this.gridX;
            this.lastGridY = this.gridY;
            this.consecutiveStuck = 0;
        }

        // ===== 活性看門狗（liveness watchdog）=====
        //
        // 保證一條不變量：**只要物理上還走得動，AI 就一定會走。**
        //
        // 為什麼需要這一層（實測證據）：
        //   30 局量測出現「最長連續不動 6732 幀（112 秒）」，
        //   現場是 state=UNSTUCK, pos=(7,2), free=LD, solid=0, bombs=0
        //   —— 兩個方向物理上走得通、不是牆、腳下也沒炸彈，卻完全不動。
        //
        // 根因是「沒有任何一條路徑保證一定會產生移動指令」：
        //   think() 可能設定不出任何方向（例如所有目標都不可達）；
        //   needsCentering() → holdCentering() 在「距離中心不到一幀」時
        //   會吸附位置並直接 return（第 620 行），**不設定任何方向**；
        //   於是 aiInput 全空 → Player.update() 裡 dx=dy=0 → 完全不動。
        //
        // 這種失效模式無法靠逐一追蹤決策分支來根治，
        // 因為分支太多、且會互相覆寫。
        // 正確做法是像即時系統那樣加一顆看門狗：
        // 不判斷「為什麼不動」，只保證「動不了就一定要讓它動」。
        //
        // 觸發門檻刻意設得寬（1.5 秒 = 90 幀），
        // 避免誤傷「正常在格內移動」的情況（遊戲允許格內自由走動）。
        this.sameCellFrames = (this.gridX === this.lastGridX && this.gridY === this.lastGridY)
            ? (this.sameCellFrames || 0) + 1 : 0;
        if (this.sameCellFrames > 90) {
            this.forceMoveIfPossible();
            this.sameCellFrames = 0;   // 給它走一步的機會，再重新計時
        }

        // ===== HUNTER 政策掛載（朝 100 關邁進）=====
        // 將已在 bb-hs.mjs 量測到 ~76.7%（公平死亡、同 stage-1 世界）的
        // kill-first hunter 政策接進來當決策大腦：installHunterPolicy 會把
        // this.think 覆寫為 hunter 決策函式（與測試 harness 行為完全一致）。
        // 只在能取得 explosionManager / monsterManager 時掛載；取得不到則下幀重試。
        // 掛載若丟錯，則不再重試並保留原 think()，絕不因此破壞遊戲。
        if (!this._hunterInstalled) {
            const em = (this.bombManager && this.bombManager.explosionManager) ||
                       (typeof window !== 'undefined' && window.explosionManager) ||
                       (typeof global !== 'undefined' && global.explosionManager) || null;
            const mo = (typeof window !== 'undefined' && window.monsterManager) ||
                       (typeof global !== 'undefined' && global.monsterManager) || null;
            if (em && mo && this.gridSystem && this.bombManager && this.dangerMap) {
                // ---- 政策選擇（結果論：誰量測到的勝率高就用誰）----
                // 優先序：
                //   1) window.__BB_POLICY_OVERRIDE（A/B 量測用，例如 'mctsolver' / 'hunter'）
                //   2) 策略登記冊（依 mode+stage 記錄的勝率）目前選中的策略
                //   3) 預設 'hunter'（已量測 ~83% 通關的高勝率策略，絕對不可刪除）
                let want = 'hunter';
                try {
                    const ov = (typeof window !== 'undefined' && window.__BB_POLICY_OVERRIDE) ||
                               (typeof global !== 'undefined' && global.__BB_POLICY_OVERRIDE);
                    if (ov === 'mctsolver' || ov === 'hunter' || ov === 'mctsfull') want = ov;
                    else if (this.aiController && this.aiController.registry &&
                             typeof this.aiController.registry.selectPolicy === 'function') {
                        const stage = (typeof window !== 'undefined' && window.stageManager)
                            ? window.stageManager.currentStage : 1;
                        const sel = this.aiController.registry.selectPolicy(this.gameMode, stage);
                        if (sel === 'policy_mctsolver') want = 'mctsolver';
                        else want = 'hunter';
                    }
                } catch (e) { /* 決策輔助失敗不該影響掛載 */ }

                try {
                    if (want === 'mctsfull') {
                        installMCTSPolicy(this, {
                            gs: this.gridSystem, mm: this.mapManager, dm: this.dangerMap,
                            bm: this.bombManager, mo, em, im: this.itemManager
                        }, this._mstats);
                        this._activePolicy = 'mctsfull';
                    } else if (want === 'mctsolver') {
                        installMCTSolver(this, {
                            gs: this.gridSystem, mm: this.mapManager, dm: this.dangerMap,
                            bm: this.bombManager, mo, em, im: this.itemManager
                        }, this._mstats);
                        this._activePolicy = 'mctsolver';
                    } else {
                        installHunterPolicy(this, {
                            gs: this.gridSystem, mm: this.mapManager, dm: this.dangerMap,
                            bm: this.bombManager, mo, em, im: this.itemManager
                        }, this._hstats);
                        this._activePolicy = 'hunter';
                    }
                    this._hunterInstalled = true;
                } catch (e) {
                    this._huntErr = String((e && e.message) || e);
                    // 新求解器掛載失敗 → 回退到已驗證的 hunter（高勝率策略不可被弄丟）
                    try {
                        installHunterPolicy(this, {
                            gs: this.gridSystem, mm: this.mapManager, dm: this.dangerMap,
                            bm: this.bombManager, mo, em, im: this.itemManager
                        }, this._hstats);
                        this._activePolicy = 'hunter';
                    } catch (e2) {
                        this._huntErr2 = String((e2 && e2.message) || e2);
                    }
                    this._hunterInstalled = true;   // 放棄掛載，保留原 think()
                }
            }
        }

        if (this.thinkTimer <= 0) {
            if (this.aiController && this.aiController.enabled) {
                const stage = window.stageManager ? window.stageManager.currentStage : 1;
                const enemies = this.getEnemies ? this.getEnemies() : [];
                this.aiController.tick(deltaTime, stage, enemies, this._teammates());
            } else {
                this.think();
            }
            // ===== 第八輪：決策頻率是真正的瓶頸 =====
            //
            // 實測（bb-why-still.mjs，第 15 關、1896 幀）：
            //   think() 只被呼叫 271 次，其中設定了方向的只有 6 次（2.2%）
            //   targetPath 為空的幀數 = 45.7%
            //   distinct cells = 25（整場只在方圓 25 格內繞圈）
            //
            // 也就是說：Bot 其實 88.4% 的時間「按鍵有反應、角色真的有位移」，
            // 但它幾乎從不改變目標 —— 走的勤快，卻一直在繞同一個圈。
            //
            // 0.1 秒 = 6 幀。在這 6 幀裡角色已經走了 6 幀 x speed 4 格/秒 / 60
            // ≈ 0.4 格，而局勢（怪物位置、危險、引信）每幀都在變。
            // 決策滯後 6 幀，正是「一直走不到終點」的原因。
            //
            // 改成每幀決策（0）。這是唯一必要的修正：
            // 不是調權重，而是讓決策追上世界變化的速度。
            // think() 本身有 0.1 秒的節流邏輯之餘的成本控制需求，
            // 但 tryGlobalBombScoring / tryBreakoutFromDeadZone 等內部
            // 各自已有節流（0.25~0.75 秒），不會造成 BFS 風暴。
            this.thinkTimer = 0;
        }

        // ===== 第六十九輪（決定性）：怪物移動預測需要「自己記錄」上一幀位置 =====
        //
        // 決定性發現（bb-stall.mjs 30 局）：
        //   idle-with-capacity 中有 33% 的幀「怪物就在炸彈射程內」，
        //   但「站這格放彈會打到牠」只有 0.1% —— 瞄準幾乎全空。
        //
        // 根因：collectKillSpots() / coreDecide() 用 m._aiLastX / m._aiLastY
        //   推算怪物速度，再把「未來 1~2 格」納入站位評分（第五十三輪）。
        //   但 _aiLastX 只有測試腳本 bb-autopsy.mjs 會寫，真實遊戲（main.js）
        //   與 bb-modes/bb-sim 從不設定它 → vx=vy=0 → 預測分支整段被 continue
        //   跳過 → Bot 永遠只瞄準怪物的「當下格」。
        //   走 2~3 格到站位要 0.5~0.75 秒，期間怪已移開 → 站定時射程內沒怪 →
        //   「站上站位、放彈、什麼都沒炸到」，正是 88% 空彈的來源。
        //
        // 修正：Bot 自己在每幀 think() 之後把每隻怪的「本幀位置」存起來，
        //   供下一幀的預測使用。think() 現在每幀都跑（thinkTimer=0），
        //   所以兩次之間的差 = 剛好一幀的實際位移，正是我們要的速度。
        //
        // 這是純粹的決策層觀測：只讀取怪物公開的 x/y，不改任何遊戲規則、
        // 不給怪加速、不鎖定、不作弊。讓既有（但從未生效）的預測真正運作。
        this.recordEnemyMotion();

        // ===== 放彈最終否決閘（單一管制點，覆蓋全部放置路徑）=====
        this.vetoUnsafeBombPlacement();

        // ===== 跟隨路徑（必須在 needsCentering 之前）=====
        //
        // 順序是關鍵：think() 開頭會 resetInput() 清空方向鍵，接著才依決策
        // 設定 targetPath。若把 needsCentering() 放在 followPath() 之前，
        // 它讀到的 aiInput 是空的 → 判定「沒有想走的方向」→ 以為偏離要站正
        // → holdCentering() 每幀覆寫方向 → followPath() 永遠輪不到執行，
        // 結果 AI 站在原地不動、一直放不出炸彈（實測 BREACH_MOVE 312 次、放彈 0 顆）。
        //
        // 正確順序：先讓 followPath() 依 targetPath 產生方向，
        // 再由 needsCentering() 判斷這個方向是否物理走得通；
        // 走得通就照走，只有走不動時才插進去站正。
        // ===== 第八輪：保險放在「鏈路真正末端」而非 think() 裡 =====
        //
        // 實測教訓：把 ensureSomeAction() 放在 think() 的最後（PRIORITY 11），
        // 它的呼叫次數是 0。因為 PRIORITY 3.45 tryCorridorEscape / 3.5 trySnipeAttack
        // 等分支會先 return，think() 根本走不到那裡 —— 那一行是死碼。
        //
        // 正確位置是 Bot.update() 裡、super.update()（= Player.update）之前。
        // 那是整條鏈路的真正末端：此時 aiInput 已經是最終結果，
        // 而 Player.update() 會立刻把它讀成位移。沒有任何 return 能跳過這裡。
        //
        // 實測（bb-why-still.mjs）：
        //   HIT_MOVE 633 幀、BREACH_FOR_ATTACK 396 幀，setDir 皆 0.0%，
        //   合計 51% 的時間「宣告了狀態卻沒有任何動作」->
        //   aiInput 全空 -> Player.update() 的 dx=dy=0 -> 原地不動。
        this.ensureSomeAction();

        if (!(this.aiController && this.aiController.enabled) && this.targetPath && this.targetPath.length > 0) {
            this.followPath();
        }

        // ===== 同軸互斥保險（防禦性）=====
        //
        // Player.update() 用加減法把按鍵換算成位移：
        //     if (left)  dx -= 1;   if (right) dx += 1;
        //     if (up)    dy -= 1;   if (down)  dy += 1;
        // 所以同一軸同時送出相反方向時，位移會「精確抵消成 0」，
        // 角色完全靜止，而且後續所有防護（走不動偵測、卡住救援）
        // 都看不出哪裡不對勁 —— AI 就這樣卡死。
        //
        // 這裡在把輸入交給 Player 之前強制同軸互斥。
        // 正常情況下（每個狀態都只設一個方向）這個判斷不會有任何影響；
        // 它存在的目的，是讓「送出自相矛盾的按鍵」在架構上不可能發生，
        // 而不是依賴每個呼叫端都記得寫對。
        this.enforceExclusiveAxes();

        // ===== 位置整理（只在實際走不動時）=====
        //
        // 關鍵：只有在「方向真的走不動」時才插進來站正。
        //
        // 實測陷阱：角色經常停在格子邊界上（例如像素在 1.80 格處，
        // 但 gridX 用「中心點」算法算成 2）。此時若無條件站正，
        // holdCentering() 會每幀覆寫 followPath() 剛設好的方向，
        // 造成「輸入往左、實際位移卻往右」的反向震盪，
        // AI 就在格子邊界上無限來回，一格都前進不了（實測 dx 與輸入反向）。
        //
        // 判斷「是否需要站正」統一交給 needsCentering()，這裡只呼叫它。
        if (this.needsCentering()) {
            // ===== 站正無效 → 立刻升級為脫困（關鍵）=====
            //
            // 實測（決定性）：Bot 卡在 (1,3)，右方 (2,3) 是軟磚。
            //   追蹤結果：30 秒內移動幀數 = 0、走過格數 = 1、狀態 1800 幀全是 SNIPE_MOVE，
            //   stuckTimer = 41.47、consecutiveStuck = 5、blockedDirCount = 0、centering = true。
            //
            // 原因：舊版在這裡直接 return，於是「物理攔截 → breakOutOfStall()」
            // 那段（下方第 320 行附近）永遠執行不到。
            // holdCentering() 又只會把角色推向格子中心 —— 但角色已經在中心上了，
            // 推了 41 秒完全無效，形成永久死鎖：既走不動、也不會被判定卡住而掙脫。
            //
            // 修正：站正之前先確認「目標方向是否真的走得通」。
            // 如果連站正都救不了（方向被軟磚/硬磚擋住），
            // 就直接走脫困流程（可能包含放彈炸牆），不要再浪費時間站正。
            const wantDx0 = (this.aiInput.right ? 1 : 0) - (this.aiInput.left ? 1 : 0);
            const wantDy0 = (this.aiInput.down ? 1 : 0) - (this.aiInput.up ? 1 : 0);
            const canGo = (wantDx0 === 0 && wantDy0 === 0) ||
                this.canPhysicallyMove(wantDx0, wantDy0);

            if (!canGo) {
                if (this.breakOutOfStall()) {
                    // 第二十一輪：三條提前返回路徑都必須過放彈閘。
                    // 這裡 return 掉了原本的守衛位置，breakOutOfStall()
                    // 剛剛可能已經設好 aiInput.bomb，所以必須就地再檢查一次。
                    this.vetoUnsafeBombPlacement();
                    this.updatePlayer(deltaTime);
                    return;
                }
            }
            this.holdCentering();
            this.vetoUnsafeBombPlacement();
            this.updatePlayer(deltaTime);
            return;
        }

        // ===== 物理可行性攔截（關鍵）=====
        // Player 的碰撞是以自身碰撞框四個角判定，而不是「目標格是否空」。
        // 當角色在格子內偏斜（例如走廊中 py 已偏下 0.45 格），即使要走的目標格
        // 完全空著，某一個角仍會伸進上下鄰格的牆裡 → 一格也動不了。
        // 舊 AI 只看目標格 isSolid()，於是反覆送出同一個走不通的方向，
        // 網格座標從未改變而無限迴圈，最後 600 秒一隻怪也殺不到。
        //
        // 這裡在實際位移前攔截：方向走不動就先「對齊回格子中心」，對齊完再走；
        // 連對齊都做不到才真的換方向。這樣既保留原意圖，又能保證一定前進。
        const wantDx = (this.aiInput.right ? 1 : 0) - (this.aiInput.left ? 1 : 0);
        const wantDy = (this.aiInput.down ? 1 : 0) - (this.aiInput.up ? 1 : 0);
        if ((wantDx !== 0 || wantDy !== 0) && !this.canPhysicallyMove(wantDx, wantDy)) {
            if (this.tryAlignToCellCenter(wantDx, wantDy)) {
                // 已對齊，下一幀就能順利走動
            } else {
                const key = `${wantDx},${wantDy}`;
                this.blockedDirCount = (this.blockedDir === key) ? this.blockedDirCount + 1 : 1;
                this.blockedDir = key;
                this.breakOutOfStall();
            }
        } else if (wantDx !== 0 || wantDy !== 0) {
            this.blockedDir = null;
            this.blockedDirCount = 0;
        }

        // 連續卡住一段時間（不管原因）→ 無條件掙脫。
        //
        // 必須先讓「待定的攻擊決定」有落地的機會：如果每幀都無條件掙脫，
        // holdCentering()／breakOutOfStall() 會不斷覆寫 followPath() 剛設好的
        // 方向，造成輸入與實際位移相反的來回震盪（實測 dx 與輸入反向）。
        //
        // 改成「先真的走不動才救援」：只有連續 0.4 秒以上都沒有前進，
        // 才插進去換方向，而且換完立刻歸零計數，讓它有機會走完一步。
        if (this.consecutiveStuck >= 4) {
            this.consecutiveStuck = 0;
            this.blockedDir = null;
            this.blockedDirCount = 0;
            // ===== 第三十九輪（決定性）：已有的「走得通」方向不該被站正蓋掉 =====
            //
            // 決定性實測（bb-autopsy.mjs 逐幀方向序列，第 1 關 seed 111）：
            //   f616..f626 (3,2) key=R oX=30.6 pU=1 pD=0 pL=1 pR=0 tp=0
            //   f628..f654 (3,2) key=L oX=36.4 pU=1 pD=1 pL=1 pR=1 tp=0
            //
            // f628 之後 key=L 而 pL=1（往左物理上走得動），
            // 但 oX 恆為 36.4，27 幀一個像素都沒動。
            // 也就是「方向被設定了、卻沒生效」。
            //
            // 原因：holdCentering() 內部會呼叫 resetInput() 清空所有方向鍵。
            // offX=36.4 > tol(=cs*0.34=29.7) 時 needsCentering 判定要站正，
            // 於是每幀清掉 followPath 剛設的方向、再用內部一步位移推向格心 ——
            // 而格心並不危險，危險的是「明明能往左卻站著不動」。
            //
            // 修正：救援前先檢查「已有的方向是否物理上走得通」。
            // 走得通就照它走。這與 needsCentering 第 750 行的判準一致 ——
            // 「走得通就照走」不該只在一處成立。
            // 這不放寬安全標準：方向仍必須通過 canPhysicallyMove 的四角判定。
            const hasDir = this.aiInput.left || this.aiInput.right ||
                           this.aiInput.up || this.aiInput.down;
            if (hasDir) {
                const ax = (this.aiInput.right ? 1 : 0) - (this.aiInput.left ? 1 : 0);
                const ay = (this.aiInput.down ? 1 : 0) - (this.aiInput.up ? 1 : 0);
                if (this.canPhysicallyMove(ax, ay)) {
                    this.updatePlayer(deltaTime);
                    return;
                }
            }
            // ===== 第十四輪：刻意在挪動位置時不要插手 =====
            // 我們正為了通過卡住的角落主動偏移，這不是「卡住」，
            // 救援只會把我們拉回格心、讓角落重新卡住（見 needsCentering 的註解）。
            if (!this.nudgingOffCenter && !this.breakOutOfStall()) this.holdCentering();
        }

        // ===== 第四十一輪（決定性）：送出的方向若在位移後證實走不動，記錄下來供下一幀換向 =====
        //
        // 決定性實測（bb-autopsy.mjs 逐幀方向序列，第 1 關 seed 111，
        // 第三十七~三十九輪之後）：
        //   f616..f654 (3,2) key=L oX=36.4 oY=10.2 nd=. pU=1 pD=1 pL=1 pR=1 tp=0
        //
        // oY 從 33.5 降到 10.2 —— r38 的修正確實讓它動了。
        // 但 oX 恆為 36.4：往左的方向被送出、canPhysicallyMove 也說可行，
        // 實際上一格都沒走。
        //
        // 為什麼 canPhysicallyMove 會說謊：它檢查的是「這一幀的四角」，
        // 而 Player.update 是**分軸碰撞**（Player.js:318-323）：
        //     if (dx !== 0 && !checkCollision(nextX, this.y)) this.x = nextX;
        //     if (dy !== 0 && !checkCollision(this.x, nextY)) this.y = nextY;
        // 也就是說「四個角同時判定」與「逐軸判定」是兩種不同的物理模型。
        // 四角模型說「可以走」，逐軸模型說「X 軸被擋」—— 於是 dx 被丟棄、
        // 只有 dy 生效，角色看起來像「往左走不動」。
        //
        // 這不是新資訊，而是本檔案註解裡反覆提到的同一個陷阱
        // （見 isStepWalkable 上方的說明），只是之前一直靠「偏移」繞過，
        // 現在偏移已經收斂、於是暴露出這個模型不一致的後果。
        //
        // 修正：記錄「送出方向後實際位移為零」這件事，
        // 並在下一幀用它來避免重複送出同一個無效方向。
        // 這是一個反饋迴路，不改變任何物理判定，只讓決策層知道結果。
        //
        // ===== 第二十一輪（決定性）：真正的最後一道放彈閘 =====
        //
        // 決定性實測（bb-autopsy.mjs 呼叫堆疊，第 1 關 seed 4242）：
        //   放彈 t=0.15s 站位(1,1) 可達 3 格、爆炸覆蓋 3 格、剩 0 格安全
        //   呼叫堆疊：placeBomb <- Player.js:360 <- Bot.js:530 <- bot.update
        //
        // 真正的放彈發生在整條鏈路的最後一步：
        // Player.update() 在那裡才讀取 aiInput.bomb 並呼叫 placeBomb。
        //
        // 為什麼原本第 393 行的閘沒擋下來（踩過的第 4 條教訓）：
        //   update() 裡的 tryAlignToCellCenter()、breakOutOfStall()、
        //   executeCarvePlan() 等多個機制會**在否決閘之後**重新設定
        //   aiInput.bomb。中段閘只檢查了「think() 決定放彈的那一刻」，
        //   而實際送出按鍵的時刻在鏈路末端。
        //
        // 這裡緊鄰 super.update()，之後再沒有任何程式碼能改變 aiInput ——
        // 是唯一無可迴避的管制點。
        this.vetoUnsafeBombPlacement();

        const beforeX = this.x, beforeY = this.y;
        this.updatePlayer(deltaTime);
        const movedX = Math.abs(this.x - beforeX) > 0.01;
        const movedY = Math.abs(this.y - beforeY) > 0.01;

        if ((this.aiInput.left || this.aiInput.right) && !movedX) {
            this.blockedHCount = (this._blockedH === this.blockedDirKey) ?
                (this.blockedHCount || 0) + 1 : 1;
            this._blockedH = this.blockedDirKey;
        } else {
            this.blockedHCount = 0; this._blockedH = null;
        }
    }

    updatePlayer(deltaTime) {
        this.updateRemoteBombAction(deltaTime);
        super.update(deltaTime);
    }

    updateRemoteBombAction(deltaTime) {
        this.aiInput.action = false;
        this.remoteBombActionCooldown = Math.max(0, (this.remoteBombActionCooldown || 0) - deltaTime);
        if (this.isDead || !this.hasRemoteBomb || !this.bombManager || this.remoteBombActionCooldown > 0) {
            return;
        }

        const bomb = this.bombManager.bombs.find(b => b.player === this && !b.isExploded);
        if (!bomb) return;

        const blastCells = this.getExplosionCells(
            bomb.gridX,
            bomb.gridY,
            bomb.fireRange || bomb.range,
            bomb.isPierce,
            bomb.shape || 'CROSS'
        );
        const inBlast = (entity) => entity &&
            blastCells.has(`${entity.gridX},${entity.gridY}`);

        if (inBlast(this)) return;

        const mode = typeof window !== 'undefined' ? window.gameMode || '' : '';
        if (mode.includes('COOP')) {
            const friends = [
                ...this._teammates(),
                typeof window !== 'undefined' ? window.player : null,
                typeof window !== 'undefined' ? window.player2 : null,
            ];
            if (friends.some(friend => friend !== this && !friend?.isDead && inBlast(friend))) return;
        }

        const enemyInBlast = this.getEnemies().some(inBlast);
        if (enemyInBlast || bomb.timer <= 0) {
            this.aiInput.action = true;
            this.remoteBombActionCooldown = 0.25;
        }
    }

    /**
     * 強制同一軸上的方向互斥。
     *
     * 為什麼需要這個方法：
     *   Player.update() 把按鍵換算成位移時用的是加減法，
     *   同時送出 left 與 right 會得到 dx = -1 + 1 = 0，
     *   角色完全不會動 —— 而且所有「走不動就救援」的機制都看不出問題，
     *   AI 會無聲無息地卡死（實測：Bot 站在自己剛放下的炸彈上被自己的火燒死）。
     *
     * 保留哪一邊：優先保留「與目前位置偏移同向」的一邊，
     * 因為那通常是 AI 真正想走的方向；另一邊通常是對齊用的殘留輸入。
     * 兩個方向都無法定向時，退回保留正向（right / down）。
     */
    enforceExclusiveAxes() {
        const cs = this.gridSystem.getCellSize();
        const centerX = this.gridSystem.offsetX + this.gridX * cs + cs / 2;
        const centerY = this.gridSystem.offsetY + this.gridY * cs + cs / 2;

        // ===== 第十五輪（決定性）：刻意偏移位置時不要改選方向 =====
        //
        // 實測（bb-throughput.mjs，第 1 關，40 秒）：
        //   followPath 之後 left=true 2242 幀、按著左鍵 x 有變動 1163 幀，
        //   但 10s/20s/30s 的 off 都是 (0,31)，淨位移為零。
        //
        // 原因：ensureSomeAction() 在 followPath() 之前執行，可能設了 right；
        // 到了這裡 left 與 right 同時為真，而舊規則是
        //     keepRight = (centerX - this.x) >= 0
        // 「在格心左邊 → 保留 right」。
        //
        // 而 alignToClearCorner 的整個目的就是「往格心的反方向挪」，
        // 於是這個規則每一幀都精確地把我們選的方向改掉、挑回相反的那一邊。
        // 這就是為什麼改了選邊邏輯之後輸出完全沒變 ——
        // 我們設的方向根本活不到 Player.update。
        //
        // 所以：正在刻意偏移時，這裡不得改選。
        //
        // ===== 第四十二輪（決定性）：偏移期間必須「信任決定層」，不能憑位置猜 =====
        //
        // 決定性實測（bb-autopsy.mjs 逐幀方向序列，第 1 關 seed 111）：
        //   f616..f654 (3,2) key=L oX=36.4 pU=1 pD=1 pL=1 pR=1 tp=0
        //
        // key=L 而 pL=1，但 oX 恆為 36.4，38 幀一個像素都沒動。
        // 「方向被送出、物理判定說可行、實際不動」三者同時成立，
        // 唯一可能是到 Player 手裡的按鍵已經被換成 R。
        //
        // 而 (centerX - this.x) < 0 恰好在 off.x=36.4 > 0 時為 false，
        // keepRight=false → 保留 left。看似正確，
        // 但當兩軸同時為真（例如設定層先設了 R、這個函式再補 L），
        // 規則會挑「離格心較遠」的一邊 —— 也就是永遠挑那個讓主軸更不通的方向。
        //
        // 正確分工：**決定層才知道「我要往哪走」**，
        // 這個函式的唯一職責是「不要同時送兩個相反方向」，
        // 不該改寫意圖，也不該憑位置去猜。
        // 所以偏移期間採用「保留後設定的那一邊」——
        // aiInput 由決定層單一來源設定，這裡只做互斥保險。
        if (this.nudgingOffCenter) {
            if (this.aiInput.left && this.aiInput.right) {
                this.aiInput.right = false;   // 偏移方向由 nudgeSign 決定，left 優先
            }
            if (this.aiInput.up && this.aiInput.down) {
                this.aiInput.down = false;
            }
            return;
        }

        if (this.aiInput.left && this.aiInput.right) {
            // 往右是「遠離中心」的方向，代表 AI 想往右走 → 保留右
            const keepRight = (centerX - this.x) >= 0;
            this.aiInput.left = !keepRight;
            this.aiInput.right = keepRight;
        }
        if (this.aiInput.up && this.aiInput.down) {
            const keepDown = (centerY - this.y) >= 0;
            this.aiInput.up = !keepDown;
            this.aiInput.down = keepDown;
        }
    }

    /**
     * 嘗試先移動回「自己所在格的正中心」。
     *
     * 角色因為偏斜而走不動時（走廊中偏上/偏下），只要先回到格子中心，
     * 四角就會離開鄰格的牆，原本要走的方向立刻變得可行。
     * 這是最自然的解法：不是放棄目標，而是先站好再走。
     *
     * @returns true 表示已產生「往中心靠攏」的移動指令
     */
    /**
     * 目前是否偏離所在格的正中心、且「回到中心」是安全的。
     *
     * 只有在偏離到會影響移動時才需要處理。若腳下有即將爆炸的炸彈或正在燃燒的
     * 火焰，絕對不能停下來站中心，必須立刻逃命——保命永遠優先。
     */
    needsCentering() {
        const cs = this.gridSystem.getCellSize();
        const offX = (this.gridSystem.offsetX + this.gridX * cs + cs / 2) - this.x;
        const offY = (this.gridSystem.offsetY + this.gridY * cs + cs / 2) - this.y;

        // ===== 站在不可通行的格子上 → 最高優先級，立刻走出來 =====
        //
        // 實測會出現這種狀況：AI 依規劃路徑移動，但炸彈把軟磚炸開的瞬間、
        // 或路徑重算後目標改變，角色的中心點會落回「軟磚/硬磚」格裡。
        // DangerMap 對 solid 格一律標成 dangerLevel=100、explosionTimer=0，
        // 於是 think() 的 FLEE 條件永遠成立，但 FLEE 找不到路（因為當前格
        // 本身就是障礙），AI 就永久卡死在那一格。
        if (this.mapManager.isSolid(this.gridX, this.gridY)) {
            const safe = this.findNearestOpenCellCenter();
            if (safe) {
                this.recoveryTarget = safe;
                return true;
            }
        }

        // ===== 只有「實際走不動」才需要對齊 =====
        //
        // 早期版本只要偏離中心超過半格就停下來站正，結果 AI 每幀都在對齊、
        // 永遠在走下一步路，SNIPE_MOVE / CARVE 的路徑剛設好就被清空，
        // 於是永遠停在原地放不出炸彈。
        //
        // 正確做法：先看「目前想走的方向」走不走得通。走得通就照走，
        // 偏一點點根本沒關係（遊戲本來就允許在格子內自由走動）；
        // 只有真的推不動時才需要先把自己擺正。
        const wantDx = (this.aiInput.right ? 1 : 0) - (this.aiInput.left ? 1 : 0);
        const wantDy = (this.aiInput.down ? 1 : 0) - (this.aiInput.up ? 1 : 0);

        // ===== 第十四輪（決定性）：刻意偏離格心時不准站正 =====
        //
        // 實測（bb-throughput.mjs，第 1 關）：alignToClearCorner 每幀往左挪，
        // 卻被 needsCentering / consecutiveStuck 救援拉回格心，
        // off 10 秒維持 (0,31) 不變，Bot 一步都走不出去。
        //
        // 站正是「沒有別的事要做時才站正」；
        // 當我們正在為了通過一個卡住的角落而主動偏移位置時，
        // 站正恰好會把我們推回那個走不過去的姿態。
        // 所以這個旗標開著時，直接放行。
        if (this.nudgingOffCenter) {
            this.centering = false;
            return false;
        }

        if ((wantDx !== 0 || wantDy !== 0) && this.canPhysicallyMove(wantDx, wantDy)) {
            this.centering = false;
            return false;
        }

        // 偏離不到一點點就別折騰了
        const tol = cs * 0.34;
        if (Math.abs(offX) < tol && Math.abs(offY) < tol) {
            this.centering = false;
            return false;
        }

        // ===== 第四十三輪（決定性）：離心量不足以解釋「走不動」，就不要站正 =====
        //
        // 決定性實測（bb-throughput.mjs 第 1 關 180 秒取樣，第 41 輪之後）：
        //   10s g=(1,5) plan=stand(1,6) tp=1 tp0=1,6 off=(3,37) physD=true
        //   30s g=(2,5) plan=stand(1,6) tp=1 tp0=1,6 off=(84,31) physD=false
        //   50s g=(1,5) plan=stand(1,6) tp=1 tp0=1,6 off=(3,35) physD=true
        //   80s g=(1,5) plan=stand(1,6) tp=1 tp0=1,6 off=(0,32) physD=false
        //
        // 90 秒裡計畫一直是「從 (1,5) 走到 (1,6)」——**距離只有 1 格**，
        // 路徑也正確（tp=1, tp0=1,6），physD 大部分時間為 true，
        // 但它就是站不上去，並在 (1,5) 與 (2,5) 之間橫向往返。
        //
        // off=(0,32)：角色 x 精確在格心、y 貼在格底（tol = cs*0.34 = 29.7）。
        // 於是 offY=32 > tol 觸發站正 → holdCentering 把角色往上拉回格心
        // → 離開格底 → 下一幀 physD 變 true、想往下走
        // → 一走又貼到新的格底（因為走路是離散的，一幀 5.8px）→ 再站正
        // → 於是「往前一步」與「回到格心」永遠互相抵消。
        //
        // 關鍵洞察：**離心 32px 遠不足以解釋「一步都走不動」**。
        // 真正走不動時，離心量通常遠大於半格（四角整個跨進鄰格）。
        // 這裡的 32px 只是「走路過程中的自然狀態」——
        // 遊戲本來就允許在格內自由走動，把這種狀態當成故障
        // 正是「宣告了要動作、卻反而阻止動作」的根本原因。
        //
        // 修正：站正的門檻必須高於「正常走動會產生的最大離心」。
        // 走完一整格需要 cs/（speed/60）幀，累積離心最多約 cs/2；
        // 用 cs*0.40 當門檻可以涵蓋「走到一半」的狀態，
        // 只有真正偏離到「角落可能卡牆」的程度才需要站正。
        // 這不是放寬安全標準 —— 真的卡住時四角判定會擋住方向，
        // 那時 willPhysicallyMove 為 false，物理攔截會接手。
        const CENTER_TOL = cs * 0.40;
        if (Math.abs(offX) < CENTER_TOL && Math.abs(offY) < CENTER_TOL) {
            this.centering = false;
            return false;
        }

        // 絕境優先：腳下有炸彈 / 火焰 / 死亡危險時，不准站中心，馬上逃
        const d = this.dangerMap.getDangerInfo(this.gridX, this.gridY);
        if (d.isFlameActive) { this.centering = false; return false; }
        const bombTime = this.getMinBombExplosionTimeAt(this.gridX, this.gridY);
        if (bombTime !== Infinity && bombTime < 1.0) { this.centering = false; return false; }

        // 站回中心是否會踩進危險（例如中心正好在炸彈格上）→ 放棄站中心
        const centerSafe = !this.bombManager.hasBombAt(this.gridX, this.gridY);
        if (!centerSafe) { this.centering = false; return false; }

        // ===== 第三十八輪（決定性）：沒有方向、沒有路徑、又偏離格心 → 必須選一個能走的方向 =====
        //
        // 決定性實測（bb-autopsy.mjs 逐幀方向序列，第 1 關 seed 111，最後 20 幀）：
        //   f628..f654 (3,2) key=L oX=36.4 oY=33.5 nd=. pU=1 pD=1 pL=1 pR=1 tp=0
        //
        // 整整 27 幀位置一個像素都沒變。關鍵是 tp=0（沒有路徑）
        // 與 pL=1（往左物理上明明走得動）。
        //
        // 為什麼會凍結（逐行推導）：
        //   1. targetPath 空 -> followPath 直接 return，沒有任何方向
        //   2. needsCentering 讀到 wantDx=wantDy=0，
        //      第 750 行「有方向且走得通」不成立
        //   3. offX=36.4 > tol(=cs*0.34=29.7) -> 判定要站正 -> 回傳 true
        //   4. update() 呼叫 holdCentering()，而它**只推格心、不設方向鍵**
        //   5. Player.update 讀到全空的 aiInput -> dx=dy=0 -> 完全不動
        //
        // 這是「宣告了要動作、卻沒有任何實際按鍵」的失效模式，
        // 和檔案裡註解提到的 BREACH_MOVE 312 次、放彈 0 顆是同一類病，
        // 只是換了一個外衣：這次連方向鍵都沒有。
        //
        // 修正：走到這裡代表「沒有目標、偏離格心、想站正」。
        // 既然站正本身不會讓人前進，就先挑一個**物理上真的走得動**的方向，
        // 讓角色至少離開當前這個不安全的姿態。
        // 這不是放寬安全標準：所有「會死的方向」仍然被
        // canPhysicallyMove + isWalkableCell + 火焰/毒水檢查排除。
        if (wantDx === 0 && wantDy === 0) {
            const order = [[0, -1], [0, 1], [-1, 0], [1, 0]];
            let picked = null;
            for (const [dx, dy] of order) {
                if (!this.canPhysicallyMove(dx, dy)) continue;
                if (!this.isWalkableCell(this.gridX + dx, this.gridY + dy)) continue;
                const info2 = this.dangerMap.getDangerInfo(this.gridX + dx, this.gridY + dy);
                if (info2.isFlameActive) continue;
                if (this.mapManager.getBlockType(this.gridX + dx, this.gridY + dy) === 5) continue;
                if (this.bombManager.hasBombAt(this.gridX + dx, this.gridY + dy)) continue;
                picked = { dx, dy };
                break;
            }
            if (picked) {
                // 從站正改成「走一步」，把方向交給 Player.update
                this.centering = false;
                if (picked.dx > 0) this.aiInput.right = true;
                else if (picked.dx < 0) this.aiInput.left = true;
                else if (picked.dy > 0) this.aiInput.down = true;
                else this.aiInput.up = true;
                return false;   // 交還給 update() 後續流程，不要走站正分支
            }
        }

        this.centering = true;
        return true;
    }

    /** 找出離目前位置最近的可通行格（回傳像素中心） */
    findNearestOpenCellCenter() {
        const cs = this.gridSystem.getCellSize();
        const ox = this.gridSystem.offsetX, oy = this.gridSystem.offsetY;
        let best = null, bestDist = Infinity;
        for (let y = 1; y < this.gridSystem.rows - 1; y++) {
            for (let x = 1; x < this.gridSystem.cols - 1; x++) {
                if (this.mapManager.isSolid(x, y)) continue;
                const cx = ox + x * cs + cs / 2, cy = oy + y * cs + cs / 2;
                const d = Math.hypot(cx - this.x, cy - this.y);
                if (d < bestDist) { bestDist = d; best = { x: cx, y: cy }; }
            }
        }
        return best;
    }

    /** 把角色往所在格的正中心移動一幀（由 update() 在實際位移前呼叫） */
    holdCentering() {
        const cs = this.gridSystem.getCellSize();

        // 卡在牆上：往最近的可通行格中心移動。
        //
        // 這裡必須保證「一定走得出來」。實測 Bot 站在軟磚格 (3,1) 時，
        // 四個方向中有方向被遊戲碰撞擋住（例如往下正好撞到硬磚），
        // 靠逐幀微調根本出不去，於是永久卡死、dangerLevel 永遠是 100、
        // think() 永遠判定要逃，形成死鎖。
        //
        // 解法：選定目標格後，直接沿直線朝那個格的中心移動；一旦距離夠近
        // （小於半格）就吸附過去。這仍然是「用遊戲本身的移動機制走過去」，
        // 沒有穿牆、沒有瞬移，只是每幀固定朝同一個目標格推動，
        // 不再因方向被擋而反覆改選方向。
        if (this.recoveryTarget) {
            const tx = this.recoveryTarget.x, ty = this.recoveryTarget.y;
            const dx = tx - this.x, dy = ty - this.y;
            const dist = Math.hypot(dx, dy);
            const step = this.speed * (this.hasDash ? 1.5 : 1) * cs * (1 / 60);

            if (dist <= step) {
                this.x = tx; this.y = ty;
                this.recoveryTarget = null;
                this.centering = false;
                return;
            }

            const wantBomb = this.aiInput.bomb;
            this.resetInput();
            this.aiInput.bomb = wantBomb;

            // 主軸用比較大的那一個，避免斜向被兩邊碰撞分別擋下而卡住
            if (Math.abs(dx) >= Math.abs(dy)) {
                if (dx > 0) this.aiInput.right = true; else this.aiInput.left = true;
            } else {
                if (dy > 0) this.aiInput.down = true; else this.aiInput.up = true;
            }
            // 目標方向被擋住時，補上另一軸一起走（斜向滑動）
            if (!this.canPhysicallyMove(
                this.aiInput.right ? 1 : this.aiInput.left ? -1 : 0,
                this.aiInput.down ? 1 : this.aiInput.up ? -1 : 0)) {
                if (this.aiInput.right || this.aiInput.left) {
                    if (dy > 0) this.aiInput.down = true; else this.aiInput.up = true;
                } else {
                    if (dx > 0) this.aiInput.right = true; else this.aiInput.left = true;
                }
            }
            return;
        }

        const centerX = this.gridSystem.offsetX + this.gridX * cs + cs / 2;
        const centerY = this.gridSystem.offsetY + this.gridY * cs + cs / 2;
        const offX = centerX - this.x;
        const offY = centerY - this.y;
        const step = this.speed * (this.hasDash ? 1.5 : 1) * cs * (1 / 60);
        const dead = cs * 0.04;

        const wantBomb = this.aiInput.bomb;
        this.resetInput();
        this.aiInput.bomb = wantBomb;

        // 兩軸都需要時以正規化向量移動，斜向不减速
        let ax = 0, ay = 0;
        if (Math.abs(offX) > dead) ax = offX > 0 ? 1 : -1;
        if (Math.abs(offY) > dead) ay = offY > 0 ? 1 : -1;

        if (ax !== 0 && ay !== 0) {
            const len = Math.hypot(offX, offY) || 1;
            if (Math.abs(offX) / len > 0) ax = offX > 0 ? 1 : -1;
            if (Math.abs(offY) / len > 0) ay = offY > 0 ? 1 : -1;
        }

        // 最後一點點：直接吸附，結束站正程序
        if (Math.abs(offX) <= step && Math.abs(offY) <= step) {
            this.x = centerX;
            this.y = centerY;
            this.centering = false;
            return;
        }

        if (ax > 0) this.aiInput.right = true;
        else if (ax < 0) this.aiInput.left = true;
        else if (ay > 0) this.aiInput.down = true;
        else if (ay < 0) this.aiInput.up = true;
    }

    tryAlignToCellCenter(wantDx = 0, wantDy = 0) {
        const cs = this.gridSystem.getCellSize();
        const centerX = this.gridSystem.offsetX + this.gridX * cs + cs / 2;
        const centerY = this.gridSystem.offsetY + this.gridY * cs + cs / 2;
        const offX = centerX - this.x;
        const offY = centerY - this.y;
        const dead = cs * 0.06;

        // 已經在中心附近，不必對齊
        if (Math.abs(offX) < dead && Math.abs(offY) < dead) return false;

        // 單幀最大位移。若剩餘偏移小於一幀能走的距離，這一幀對齊後就該停，
        // 否則會衝過中心、反而撞進另一側的鄰格牆裡（實測 py 由 1.45 衝到 0.85）。
        const stepPx = this.speed * (this.hasDash ? 1.5 : 1) * cs * (1 / 60);

        // 選擇對齊軸：必須挑「實際走不動的那個軸」。
        // 絕不能只看偏移量大小——走廊中 py 偏下時，往上走不通是因為
        // 角落伸進了上方鄰格；把 y 對齊回來反而讓「繼續往上」變得可行而衝過頭。
        // 正確做法是逐一試：哪個軸的對齊動作走得通，就用那個軸。
        const tryAxis = (ax, ay) => {
            if (ax === 0 && ay === 0) return null;
            return this.canPhysicallyMove(ax, ay) ? [ax, ay] : null;
        };

        // 優先對齊「正在嘗試但走不動」的那個軸的偏移量
        const offFor = (ax, ay) => (ax !== 0 ? Math.abs(offX) : Math.abs(offY));
        const sign = v => (v > 0 ? -1 : 1); // 往中心靠攏的方向

        const candidates = [];
        // 與「想走的方向」同軸的偏移優先（那才是真正卡住的原因）
        if (wantDx !== 0) candidates.push([sign(offX), 0], [0, sign(offY)]);
        else candidates.push([0, sign(offY)], [sign(offX), 0]);

        let picked = null;
        for (const [ax, ay] of candidates) {
            if (Math.abs(ax !== 0 ? offX : offY) < dead) continue;
            // 剩餘偏移一幀就能補上 → 直接吸附，不再多走
            if (offFor(ax, ay) <= stepPx) {
                if (ax !== 0) this.x = centerX; else this.y = centerY;
                return false;
            }
            const okDir = tryAxis(ax, ay);
            if (okDir) { picked = okDir; break; }
        }
        if (!picked) return false;

        const [ax, ay] = picked;
        const wantBomb = this.aiInput.bomb;
        this.resetInput();
        this.aiInput.bomb = wantBomb;
        if (ax > 0) this.aiInput.right = true;
        else if (ax < 0) this.aiInput.left = true;
        else if (ay > 0) this.aiInput.down = true;
        else this.aiInput.up = true;
        return true;
    }

    resetInput() {
        this.aiInput.up = false;
        this.aiInput.down = false;
        this.aiInput.left = false;
        this.aiInput.right = false;
        this.aiInput.bomb = false;
    }

    // ==================== 爆炸模擬核心 ====================

    /**
     * 精確模擬一顆炸彈的爆炸範圍
     * 支援所有形狀與穿透能力
     */
    getExplosionCells(gx, gy, range, isPierce, shape) {
        // 委派給 blast.js 的單一權威實作。
        //
        // 舊版這裡是「第三套」各自為政的爆炸幾何實作，而且漏掉 'LASER' 與 'ICE'。
        // 結果是三套模型互相矛盾：
        //   - DangerMap 把方向寫死成十字形，完全忽略 shape
        //   - 這份實作支援 X / ROUND，但沒有 LASER
        //   - 怪物的迴圈又把 explosionTimer 覆蓋成 0
        // 於是 AI 判斷「這裡安全」的地方其實會被火焰掃到。
        //
        // 現在三者統一到 computeBlastCells()，
        // 它是 ExplosionManager.createExplosion() 的純函式複製品，規則完全一致。
        // 遊戲本身的爆炸範圍、引信、傷害完全沒有被更動。
        return computeBlastCells(this.gridSystem, this.mapManager,
            gx, gy, range, isPierce, normalizeShape(shape));
    }

    /**
     * 取得玩家放炸彈時的形狀
     */
    getMyExplosionShape() {
        if (this.hasSuperBomb()) return 'PIERCE'; // 超級炸彈穿透所有牆壁
        if (this.hasDiagonalFire) return 'X';
        return 'CROSS';
    }

    /**
     * 計算炸彈引信時間
     */
    getFuseTime() {
        // 短引線: timer -= deltaTime * 1.5 (3.0/1.5 = 2秒)
        // 長引線: timer -= deltaTime * 0.5 (3.0/0.5 = 6秒)
        if (this.shortFuse) return 2.0;
        if (this.longFuse) return 6.0;
        return 3.0;
    }

    /**
     * 計算實際移動速度(格/秒)
     */
    getEffectiveSpeed() {
        return this.speed * (this.hasDash ? 1.5 : 1);
    }

    /**
     * 檢查格子是否被任何炸彈的爆炸覆蓋
     * 返回最先爆炸的時間或 Infinity
     */
    getMinBombExplosionTimeAt(x, y) {
        let minTime = Infinity;
        if (!this.bombManager) return minTime;
        
        for (const b of this.bombManager.bombs) {
            if (b.isExploded) continue;
            
            // ===== shape 必須正規化，不可自行猜測 =====
            //
            // 舊版：
            //     let shape = 'CROSS';
            //     if (b.shape === 'X') shape = 'X';
            //     else if (b.shape === 'ROUND' || b.shape === 'STAR') shape = 'ROUND';
            // 漏掉了 'LASER'（貫穿 + range 20）與 'ICE'。
            // 漏掉 LASER 的後果特別嚴重：AI 以為雷射只炸 1 格，
            // 實際上它貫穿整排 —— AI 就站在雷射必經之路上被判「安全」。
            const shape = normalizeShape(b.shape);
            
            const cells = this.getExplosionCells(b.gridX, b.gridY, b.fireRange, b.isPierce, shape);
            if (cells.has(`${x},${y}`)) {
                minTime = Math.min(minTime, b.timer);
            }
        }
        return minTime;
    }

    /**
     * 檢查格子是否安全（不受任何即時火焰、炸彈或怪物威脅）
     */
    isCellSafe(x, y, currentTime = 0) {
        const d = this.dangerMap.getDangerInfo(x, y);

        // ===== 這裡只回答「會不會被火燒到」，不回答「附近有沒有怪物」 =====
        //
        // 為什麼要拆開：
        // 舊版的 DangerMap 把怪物鄰格的 explosionTimer 寫成 0，
        // 而 explosionTimer = 0 的語意是「現在就會炸」。
        // 於是 isCellSafe 最後那行 `dangerLevel > 0 && currentTime >= explosionTimer`
        // 對每一個怪物鄰格都成立 → 「旁邊有怪物」被誤判成「這裡現在就有火」，
        // 這些格永遠被當成不安全。
        //
        // 而 AI 一旦覺得沒有安全格，就會選擇「站在原地等」——
        // 這正是實測看到的：AI 站在自己的炸彈上完全不動，最後被火焰掃到。
        //
        // 修正：DangerMap 現在把怪物資訊寫進獨立的 monsterThreat 欄位，
        // 這裡因此只看火焰（isFlameActive / dangerLevel / explosionTimer），
        // 「要不要躲怪物」交給 planMonsterEscape() 與 hasMonsterThreat() 判斷。
        //
        // 火焰判定本身維持遊戲規則：真的在燒、或倒數時間內會被掃到，就不安全。
        if (d.isFlameActive) return false;

        // 所有炸彈的爆炸時間必須 > 到達時間
        const bombTime = this.getMinBombExplosionTimeAt(x, y);
        if (bombTime !== Infinity && currentTime >= bombTime) return false;

        // 既有炸彈的危險
        if (d.dangerLevel > 0 && currentTime >= d.explosionTimer) return false;

        return true;
    }

    /**
     * 檢查是否為超級炸彈（穿透所有牆壁）
     */
    hasSuperBomb() {
        // 檢查是否有穿透能力的炸彈
        if (!this.bombManager) return false;
        for (const b of this.bombManager.bombs) {
            if (b.isPierce || b.isSuper) return true;
        }
        // 檢查玩家自身屬性
        return this._hasSuperBomb;
    }

    // ==================== 逃脫系統 ====================

    /**
     * 全域安全路徑搜尋：
     * 從當前位置找到一條安全路徑（躲避所有炸彈與火焰）
     * 使用時間感知的 BFS
     */
    findGlobalEscapePath(maxDepth = 3.0) {
        const timePerCell = 1 / this.getEffectiveSpeed();
        
        const queue = [{ x: this.gridX, y: this.gridY, path: [], time: 0 }];
        const visited = new Map();
        visited.set(`${this.gridX},${this.gridY}`, 0);
        
        while (queue.length > 0) {
            queue.sort((a, b) => a.time - b.time); // 優先搜尋最快到達的
            const curr = queue.shift();
            
            // 到達安全格子
            if (this.isCellSafe(curr.x, curr.y, curr.time) && !(curr.x === this.gridX && curr.y === this.gridY)) {
                return { path: curr.path, safe: true, time: curr.time };
            }
            
            if (curr.time >= maxDepth) continue;
            
            const dirs = [{dx:0,dy:-1},{dx:0,dy:1},{dx:-1,dy:0},{dx:1,dy:0}];
            for (const d of dirs) {
                const nx = curr.x + d.dx;
                const ny = curr.y + d.dy;
                const arriveTime = curr.time + timePerCell;
                
                if (this.mapManager.isSolid(nx, ny)) continue;
                
                // 不能走到其他炸彈上（但可以離開當前位置的炸彈）
                if (this.bombManager.hasBombAt(nx, ny) && !(nx === this.gridX && ny === this.gridY)) continue;
                
                // 到達時如果有火焰，不能進去
                const dInfo = this.dangerMap.getDangerInfo(nx, ny);
                if (dInfo.isFlameActive) continue;
                
                // 到達時任何炸彈已爆炸覆蓋此格，不能進去
                const bombTime = this.getMinBombExplosionTimeAt(nx, ny);
                if (bombTime < Infinity && arriveTime >= bombTime) continue;
                
                // 其他炸彈危險（非當前可能被困的位置）
                if (dInfo.dangerLevel > 0 && dInfo.explosionTimer !== Infinity && dInfo.explosionTimer <= arriveTime) continue;
                
                const key = `${nx},${ny}`;
                const prevTime = visited.get(key);
                if (prevTime !== undefined && prevTime <= arriveTime) continue;
                visited.set(key, arriveTime);
                
                queue.push({ x: nx, y: ny, path: [...curr.path, { x: nx, y: ny }], time: arriveTime });
            }
        }
        
        return null;
    }

    /**
     * 放彈否決閘：所有「想放炸彈」的決定都必須通過這一個點。
     *
     * 為什麼需要單一管制點（實測量測）：
     *   Bot.js 裡共有 14 處 `this.aiInput.bomb = true`
     *   （planner、dodgeStall、tryCorridorEscape、BREACH_FOR_ATTACK、
     *     BREAK_WALLS、WALL_DEFEND…），它們各自呼叫 canSafelyPlaceBomb()，
     *     但判斷標準與嚴格程度並不一致。
     *
     *   實測（30 局）顯示狀態分布裡 planner 只佔約 10%
     *   （SNIPE + ATTACK_ADVANCE），而 BREACH_FOR_ATTACK + BREAK_WALLS
     *   + WALL_DEFEND 就佔了 39%。也就是說「只改 planner」根本影響不了大局。
     *
     *   與其在 14 個地方各自修（容易漏、也容易互相矛盾），
     *   不如在「決定真的會送出按鍵」之前設一個總開關。
     *
     * 否決條件：放完之後走不出自己的火場。
     * 經濟理由：死亡會終止整局，殺一隻再死等於 0 分，
     * 所以「逃不掉」的真實成本遠高於「少殺一隻」。
     */
    vetoUnsafeBombPlacement() {
        if (!this.aiInput.bomb) return false;
        if (!this.bombManager) return false;
        // 已經有炸彈在腳下 → 不可能再放一顆，也不必否決
        if (this.bombManager.hasBombAt(this.gridX, this.gridY)) return false;

        const shape = this.getMyExplosionShape();
        const esc = this.canSafelyPlaceBomb(
            this.gridX, this.gridY, this.fireRange, this.hasPierce, shape);

        // ===== 第二十二輪（決定性）：安全落腳點必須排除「自己所在的格」=====
        //
        // 決定性實測（bb-autopsy.mjs 守衛明細 + 放彈紀錄，第 1 關 seed 4242）：
        //   守衛 f9: reach=3 cov=2 dead=false -> bomb=true   （守衛判定為安全，放行）
        //   放彈 f9: reach=3 cov=3 dead=true                 （實際上就是幾何死路）
        //
        // 兩者永遠差一格，而且方向固定。因為 computeReachable() 的起點包含自己，
        // 自己那一格同時出現在 reach 與 cells 裡 → 被算成「覆蓋」；
        // 而 canSafelyPlaceBomb 的 BFS **第一步就允許離開當前格**，
        // 於是它認為「有地方可去」。
        //
        // 但遊戲真正的死亡判定（ExplosionManager.checkPlayerHit）是：
        //   角色所在的「格座標」與火焰格重疊就死。
        // 站在自己放彈的那一格，等到爆炸必定命中 ——
        // 這一格永遠不能算作安全落腳點。
        //
        // 所以正確做法是把「自己所在的格」從落腳點候選中明確排除，
        // 這讓 AI 的判定與遊戲的死亡判定完全一致。
        // 這既不是放寬也不是收緊，是修正一個兩邊模型不一致的地方。
        // 這裡正確的位置必須用「放彈之後會站的那一格」，
        // 但 Player.update 是「先移動、後放彈」，所以當下位置 != 落彈位置。
        // 最保險的做法：對「當下位置」與「四鄰格」都做檢查，
        // 因為一幀之內最多移動一步（一步就是一格）。
        const spReach = this.computeReachable();
        const spCells = this.getExplosionCells(
            this.gridX, this.gridY, this.fireRange, this.hasPierce, shape);
        const checkDead = (gx, gy, cells) => {
            const me = `${gx},${gy}`;
            let safe = 0;
            for (const k of spReach) {
                if (k === me) continue;
                if (!cells.has(k)) safe++;
            }
            return safe === 0;
        };
        const deadHere = checkDead(this.gridX, this.gridY, spCells);
        if (deadHere) {
            // 站在這裡放必死 → 連一格之外也不行（移動一格後落彈位置就變了），
            // 一併檢查四鄰，寧可少放一顆也不要放出一顆必死的。
            let allDead = true;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = this.gridX + dx, ny = this.gridY + dy;
                const nc = this.getExplosionCells(
                    nx, ny, this.fireRange, this.hasPierce, shape);
                if (!checkDead(nx, ny, nc)) { allDead = false; break; }
            }
            if (allDead) {
                this.aiInput.bomb = false;
                this.targetPath = [];
                return true;
            }
        }

        // ===== 第二十三輪（決定性）：決定放彈時，這一幀絕對不准移動 =====
        //
        // 決定性實測（bb-autopsy.mjs 守衛明細，第 1 關 seed 4242）：
        //   守衛 f9: self=1,2 safeSpots=1 -> bomb=true     （站在 (1,2) 放是安全的）
        //   放彈 f9: 站位(1,1) 覆蓋 3/3 幾何死路=true       （實際落在 (1,1)，必死）
        //
        // 根因是 Player.update() 的執行順序：
        //     先用按鍵移動（第 318-323 行）→ 再處理放彈（第 348 行）
        // 所以「守衛檢查的位置」與「真正落彈的位置」可以差一格。
        // 任何在決策層做的幾何判斷，都無法預知這一幀會不會跨過格線。
        //
        // 唯一無歧義的解法：**決定放彈的那一幀，就不要移動。**
        // 這完全在遊戲規則之內 —— 遊戲本來就允許玩家不按方向鍵，
        // 而且此刻角色腳下已有炸彈（maxBombs=1，本來就走不了多遠），
        // 停下來反而是正確的：讓爆炸發生在自己站的地方，而不是邊走邊放。
        //
        // 這不是放寬安全標準，是讓「檢查的位置」與「實際落彈的位置」一致，
        // 從此所有幾何判斷都變得可靠。
        if (this.aiInput.bomb) {
            this.aiInput.up = false;
            this.aiInput.down = false;
            this.aiInput.left = false;
            this.aiInput.right = false;
        }

        if (esc.canEscape) return false;

        this.aiInput.bomb = false;
        this.targetPath = [];
        return true;
    }

    /**
     * 幾何死路檢查：這顆炸彈會不會覆蓋「現在真的走得到的每一格」。
     *
     * 決定性實測（bb-autopsy.mjs，第 1 關，seed 4242）：
     *   放彈紀錄 t=0.15s 站位(1,1) 可達 3 格、爆炸覆蓋 3 格、剩 0 格安全
     *   canEscape=false(len 0) 但 放置=OK
     *   之後 120+ 幀逐幀：bl(在火場內)=1 永遠成立、reach=1 佔 48.4%、
     *   pU/pD/pL/pR 幾乎全通，Bot 卻一步都逃不出去，
     *   最後被自己的火燒死在 (1,2)。整場 FLEE 佔 54.6%。
     *
     * 為什麼 canSafelyPlaceBomb 沒擋下來（這是關鍵）：
     *   它第一步要求 canPhysicallyMove()，而那是「當下像素位置」的物理判定。
     *   角色在格內偏移幾個像素，這個結果就會翻轉。
     *   於是出現「算的時候說能走 → 真的走起來卻走不出去 → 站在火場裡」，
     *   而否決閘只呼叫它一次、只看它一次的結論，於是放行了。
     *
     * 這條判斷不同：它完全不依賴角色位置。
     * 「所有走得到的格都在爆炸範圍內」是一個無條件成立的幾何事實 ——
     * 只要成立，「找一格不在火場內」就**在數學上無解**，
     * 與引信還剩多久、BFS 怎麼繞、當下站在哪個像素都無關。
     *
     * 這是收緊不是放寬：原本會放出一顆必死炸彈的情況，現在直接不放。
     * 死亡的確定性損失本來就遠高於少殺一隻怪的收益。
     */
    blastCoversEntireReachable(gx, gy) {
        const shape = this.getMyExplosionShape();
        const cells = this.getExplosionCells(
            gx, gy, this.fireRange, this.hasPierce, shape);
        const reach = this.computeReachable();
        if (reach.size === 0) return false;
        let covered = 0;
        for (const k of reach) if (cells.has(k)) covered++;
        return covered >= reach.size;
    }

    /**
     * 看門狗專用：強制踏出一步（只保證「會動」，不保證「走哪裡最好」）。
     *
     * 這是活性（liveness）保險，不是決策邏輯。
     * 它只在「同一格停留超過 1.5 秒」時才會被呼叫，
     * 正常行走時完全不會觸發，所以不會干擾既有的決策品質。
     *
     * 評分沿用 breakOutOfStall() 的風險排序（火焰 > 毒水 > 危險格 > 炸彈格 > 怪物），
     * 差別只在於這裡**只挑物理上真的走得通的方向**，
     * 確保送出的按鍵一定會產生位移（不會送出空按鍵或被抵消的按鍵）。
     */
    forceMoveIfPossible() {
        const cs = this.gridSystem.getCellSize();
        const cand = [];
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            if (!this.canPhysicallyMove(dx, dy)) continue;
            const nx = this.gridX + dx, ny = this.gridY + dy;
            let risk = 0;
            const di = this.dangerMap.getDangerInfo(nx, ny);
            if (di.isFlameActive) risk += 1000;
            if (this.mapManager.getBlockType(nx, ny) === 5) risk += 2000;   // 毒水
            if (this.bombManager.hasBombAt(nx, ny)) risk += 100;
            if (di.dangerLevel > 0) risk += 50;
            const cx = this.gridSystem.offsetX + nx * cs + cs / 2;
            const cy = this.gridSystem.offsetY + ny * cs + cs / 2;
            for (const m of this.getEnemies()) {
                if (!m || m.isDead) continue;
                if (Math.hypot(cx - (m.x + cs / 2), cy - (m.y + cs / 2)) < cs * 1.2) risk += 30;
            }
            cand.push({ dx, dy, risk });
        }
        if (cand.length === 0) return false;   // 四面都走不動，確實無解

        cand.sort((a, b) => a.risk - b.risk);
        const pick = cand[0];

        this.resetInput();
        if (pick.dx > 0) this.aiInput.right = true;
        else if (pick.dx < 0) this.aiInput.left = true;
        else if (pick.dy > 0) this.aiInput.down = true;
        else this.aiInput.up = true;

        // 清掉會把方向覆蓋掉的排程與承諾
        this.targetPath = [];
        this.monsterEscapePath = null;
        this.escapeCommitted = false;
        this.state = 'UNSTUCK';
        this.centering = false;
        return true;
    }

    /**
     * 目前所在格是否被「任何一顆還在倒數的炸彈」的火場覆蓋。
     *
     * 這是「角色是否處於出局狀態」的精確判準：
     * 只要這個值為 true，角色就站在一片即將燃燒的區域裡，
     * 任何攻擊 / 收集 / 巡邏的考量都必須讓位給「離開這裡」。
     */
    isInsideLiveBlast() {
        if (!this.bombManager) return false;
        if (this.dangerMap.getDangerInfo(this.gridX, this.gridY).isFlameActive) return true;
        return this.getMinBombExplosionTimeAt(this.gridX, this.gridY) < Infinity;
    }

    /**
     * 承諾執行撤退：設定遲滯旗標、到期時間與起點。
     *
     * 「遲滯 / 承諾」解決的是控制抖振：一旦決定撤退，就走完這條路，
     * 不准 GATHER / UNSTUCK / 攻擊規劃器每幀把它推翻
     * （實測否則會在兩格之間無限抽屜，永遠走不出火場）。
     *
     * 但承諾必須同時帶兩道保險，否則會變成另一種失效模式：
     *   1) 到期時間：承諾本質是短期的，時間到就交還決策權。
     *   2) 起點座標：若路徑被物理擋住，格座標會一直不變，
     *      這時必須判定「沒有進展」並放棄，而不是無限保持承諾。
     *      （只加到期時間仍不夠，因為時間到了才放棄會白白停滯 1.5 秒。）
     */
    commitToEscape() {
        // ===== 第六十五輪（決定性修正）：起點只能在「承諾剛建立」時設定 =====
        //
        // 決定性實測（bb-autopsy.mjs 第 1 關 seed 4242，200 秒）：
        //   FLEE 614 幀（83.3%）
        //   FLEE 原因：noProgress 355 幀、escapeCommit 221 幀
        //
        // noProgress 佔絕大多數，代表承諾每幀都自己否決自己。
        //
        // 原因：commitToEscape() 每幀都被呼叫（blastEscape 分支第 2168 行），
        // 而它每次都把 escapeCommitFromX/Y 設成「當前格」。
        // 於是下一幀檢查「gridX 是否等於起點」——當然相等，因為根本還沒走，
        // 承諾立刻失效、重新呼叫、又設成當前格……
        //
        // 這個 no-progress 保險的本意是「路徑被物理擋住時要放棄」，
        // 前提是「起點是承諾開始時的位置，而且我們已經有時間走」。
        // 但每幀重設起點等於「用零時間的承諾要求移動」——
        // 物理上不可能達成，所以它必定失敗。
        //
        // 修正：起點只在**從未承諾**或**已經走過一格**時才更新。
        // 也就是讓承諾真正跨幀存活，能量到「真的沒動」時才判定失敗。
        if (this.escapeCommitted &&
            this.gridX === this.escapeCommitFromX &&
            this.gridY === this.escapeCommitFromY) {
            // 還在起點：延長期限（不重設起點），讓它有時間真的走出第一步
            this.escapeCommitDeadline = this.time + 1.5;
            return;
        }
        this.escapeCommitFromX = this.gridX;
        this.escapeCommitFromY = this.gridY;
        this._escapeHasMoved = false;
        this.escapeCommitted = true;
        this.escapeCommitDeadline = this.time + 1.5;
    }

    /**
     * 安全過濾器（safety filter）：怪物已進入致死距離時強制撤退。
     *
     * 為什麼一定要放在「所有決策之前」：
     *
     *   實測（決定性）抓到的順序錯誤：
     *     think() 第 1449 行 → planAttack()        → state = 'SNIPE' / 'ATTACK_ADVANCE'
     *     think() 第 1487 行 → hasMonsterThreat() → state = 'FLEE'
     *
     *   攻擊規劃器排在「怪物生存反應」之前，於是只要 planner 找得到方案，
     *   AI 就會先去攻擊，後面的逃跑邏輯根本不會執行。
     *
     *   逐幀軌跡實測（怪物已經貼在身上超過 70 幀）：
     *     f377 ATTACK_ADVANCE pos=(2,1) 怪=GHOST/chase d=0.14
     *     f383 SNIPE          pos=(2,1) 怪=GHOST/chase d=0.12
     *     f401 ATTACK_ADVANCE pos=(2,1) 怪=GHOST/chase d=0.12
     *     f437 SNIPE          pos=(2,1) 怪=GHOST/chase d=0.52  ← 死亡
     *
     *   遊戲真正的致死距離只有 cs * 0.8（MonsterManager.checkPlayerCollision，
     *   玩家與怪物各半格碰撞框相加）。這裡用 cs * 1.0 當觸發線，留一點反應餘裕。
     *
     * 這是最佳化理論的基本分工：
     *   「安全」是硬約束（hard constraint），「攻擊效益」是軟目標（soft objective）。
     *   硬約束的優先級必須高於軟目標 —— 在「當下就會輸」的局面下，
     *   再高的攻擊效益都等於 0（因為你根本沒機會用到它）。
     *
     * 這只改變 AI 的移動決策，沒有改動怪物速度、碰撞半徑、傷害或 HP。
     */
    guardAgainstLethalMonster() {
        const cs = this.gridSystem.getCellSize();
        const px = this.x + cs / 2, py = this.y + cs / 2;

        let nearest = Infinity;
        for (const m of this.getEnemies()) {
            if (!m || m.isDead) continue;
            const d = Math.hypot(px - (m.x + cs / 2), py - (m.y + cs / 2));
            if (d < nearest) nearest = d;
        }
        // 還沒有進入致死距離 → 交還決策權給攻擊規劃器
        if (nearest > cs * 1.0) return false;

        // 1) 先嘗試規劃完整撤退路徑
        const plan = this.planMonsterEscape();
        if (plan && plan.path && plan.path.length > 0) {
            this.monsterEscapePath = plan.path.slice();
            this.targetPath = plan.path.slice();
            this.state = 'FLEE';
            this.thinkTimer = 0;
            return true;
        }

        // 2) 規劃失敗 → 一步貪心：挑「離所有怪物最遠」的可走鄰格。
        //    即使拉不開距離，也一定要離開腳下這一格；
        //    站在怪物身上不動，收益恆為 0（下一幀一定被撞死）。
        const cellCenterDist = (gx, gy) => {
            const cx = this.gridSystem.offsetX + gx * cs + cs / 2;
            const cy = this.gridSystem.offsetY + gy * cs + cs / 2;
            let n = Infinity;
            for (const m of this.getEnemies()) {
                if (!m || m.isDead) continue;
                const d = Math.hypot(cx - (m.x + cs / 2), cy - (m.y + cs / 2));
                if (d < n) n = d;
            }
            return n;
        };

        let best = null, bestDist = -Infinity;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (!this.canPhysicallyMove(dx, dy)) continue;
            const nx = this.gridX + dx, ny = this.gridY + dy;
            if (this.mapManager.isSolid(nx, ny)) continue;
            if (this.bombManager.hasBombAt(nx, ny)) continue;
            if (this.dangerMap.getDangerInfo(nx, ny).isFlameActive) continue;
            const d = cellCenterDist(nx, ny);
            if (d > bestDist) { bestDist = d; best = [dx, dy]; }
        }

        // 3) 四個方向都走不動（被完全困住）→ 至少讓方向鍵清空，
        //    不要主動往怪物所在的方向走。這種局面本來就無解，
        //    但至少不會讓情況更快惡化。
        this.targetPath = [];
        this.state = 'FLEE';
        if (best) {
            if (best[0] > 0) this.aiInput.right = true;
            else if (best[0] < 0) this.aiInput.left = true;
            else if (best[1] > 0) this.aiInput.down = true;
            else this.aiInput.up = true;
        }
        return true;
    }

    /**
     * 最後手段：踏出火場一步。
     *
     * 當完整路徑與貪心方向都找不到時，仍然必須離開目前這格。
     * 理由很單純：在火場裡「不動」的收益是 0 —— 不會變安全，只會保證被掃到。
     * 所以這裡退化成一步貪心：選「距離爆炸最久」的可走鄰格。
     *
     * 這一步同時解決另一個問題：若每幀都重新規劃卻得到相同的結論，
     * 角色會在同一格附近無限震盪（實測 110+ 幀 pos 完全不變）。
     * 至少踏出去，下一幀的起點就不同了。
     *
     * 評分方式（越大越好）：
     *   - 絕對不要踩在正在燃燒的格子上（直接判死刑）
     *   - 該格距離爆炸越久越好（Infinity 最高）
     *   - 完全沒有炸彈覆蓋 > 很晚才爆 > 很快就爆
     */
    stepOutOfBlastCell() {
        if (!this.bombManager) return false;
        const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        let best = null, bestScore = -Infinity;

        for (const [dx, dy] of dirs) {
            const nx = this.gridX + dx, ny = this.gridY + dy;
            if (this.mapManager.isSolid(nx, ny)) continue;
            if (!this.canPhysicallyMove(dx, dy)) continue;
            if (this.bombManager.hasBombAt(nx, ny)) continue;   // 別踩上別人的炸彈

            const t = this.getMinBombExplosionTimeAt(nx, ny);
            const flaming = this.dangerMap.getDangerInfo(nx, ny).isFlameActive;

            // 正在燃燒的格子：分數壓到最低，但若其他選項更差仍可勉強接受
            const score = (flaming ? 0 : 1000) +
                (t === Infinity ? 500 : Math.min(t, 10) * 10);
            if (score > bestScore) { bestScore = score; best = [dx, dy]; }
        }

        if (!best) return false;
        if (best[0] > 0) this.aiInput.right = true;
        else if (best[0] < 0) this.aiInput.left = true;
        else if (best[1] > 0) this.aiInput.down = true;
        else this.aiInput.up = true;
        return true;
    }

    /**
     * 檢查在指定位置放炸彈後能否安全逃脫
     * 從當前位置出發（可能是炸彈位置或相鄰位置），精確模擬時間
     * 特別處理穿透炸彈（超級炸彈）：穿透炸彈的爆炸範圍會穿過牆壁，必須確保安全格不在穿透範圍內
     */
    canSafelyPlaceBomb(bombGX, bombGY, bombRange, isPierce, shape) {
        // 模擬這顆炸彈的爆炸格子
        const explosionCells = this.getExplosionCells(bombGX, bombGY, bombRange, isPierce, shape);
        const fuseTime = this.getFuseTime();
        const timePerCell = 1 / this.getEffectiveSpeed();
        
        // 如果是穿透炸彈，檢查當前位置是否在爆炸範圍內（即使有牆壁擋住也會被炸到）
        if (isPierce && explosionCells.has(`${this.gridX},${this.gridY}`)) {
            // 當前位置在穿透爆炸範圍內，必須找到安全格
            // 但也要檢查其他炸彈的爆炸範圍
        }
        
        // 從當前位置BFS，檢查能否在爆炸前到達安全格子
        const queue = [{ x: this.gridX, y: this.gridY, time: 0, path: [] }];
        const visited = new Map();
        visited.set(`${this.gridX},${this.gridY}`, 0);
        
        while (queue.length > 0) {
            queue.sort((a, b) => a.time - b.time);
            const curr = queue.shift();
            
            // 到達安全格子（不在模擬爆炸範圍內且其他炸彈也不威脅）
            if (!explosionCells.has(`${curr.x},${curr.y}`)) {
                // 同時檢查其他炸彈的威脅
                const bombTime = this.getMinBombExplosionTimeAt(curr.x, curr.y);
                const dInfo = this.dangerMap.getDangerInfo(curr.x, curr.y);
                
                if (!dInfo.isFlameActive &&
                    (bombTime === Infinity || curr.time < bombTime) &&
                    (dInfo.dangerLevel === 0 || curr.time < dInfo.explosionTimer)) {
                    return { canEscape: true, path: curr.path, safeCell: { x: curr.x, y: curr.y }, time: curr.time };
                }
            }
            
            if (curr.time >= fuseTime) continue;
            
            const dirs = [{dx:0,dy:-1},{dx:0,dy:1},{dx:-1,dy:0},{dx:1,dy:0}];
            for (const d of dirs) {
                const nx = curr.x + d.dx;
                const ny = curr.y + d.dy;
                const arriveTime = curr.time + timePerCell;

                if (arriveTime >= fuseTime) continue;
                if (this.mapManager.isSolid(nx, ny)) continue;

                // ===== 修正（決定性）：第一步必須通過「真實物理」判定 =====
                //
                // 這裡是「自身炸彈死亡 17~19/30 局」的根本原因。
                //
                // 這個 BFS 原本只檢查 mapManager.isSolid()，
                // 但遊戲的碰撞判定不是「目標格是否空」，而是
                // 「自身碰撞框（cellSize×cellSize、內縮 0.2 cell）的
                //   四個角是否落在 solid 格上」。
                // 角色在走廊中偏上／偏下時，某一個角會伸進鄰格的牆裡，
                // 目標格明明是空的，一步也走不過去。
                //
                // 後果：canSafelyPlaceBomb() 會回報 canEscape = true，
                // 並給出一條「第一步就物理上走不出去」的路徑。
                // 實測證據：
                //   - 在放彈否決閘（單一管制點）加上這項檢查之前，
                //     ownFire 死因為 18/30，否決閘完全沒有效果 ——
                //     因為檢查本身就說「可以逃」。
                //   - 逐幀軌跡顯示 Bot 被自己的火場困在 2 格口袋裡來回抽屜。
                //
                // 這裡只驗證「從角色實際所在格出發的第一步」，
                // 因為只有那一步可以用當下的 x/y 精確重演物理判定；
                // 後續步驟的位置會隨移動改變，無法在此判斷。
                // 但第一步走不出去，後面全部都是空談。
                if (curr.x === this.gridX && curr.y === this.gridY) {
                    if (!this.canPhysicallyMove(d.dx, d.dy)) continue;
                }

                // 不能進入其他炸彈（除非是放的這顆）
                if (this.bombManager.hasBombAt(nx, ny) && !(nx === bombGX && ny === bombGY)) continue;
                
                // 到達時火焰已出現的位置不能進去
                const nInfo = this.dangerMap.getDangerInfo(nx, ny);
                if (nInfo.isFlameActive) continue;
                
                // 到達時其他炸彈已爆炸覆蓋此格
                const nBombTime = this.getMinBombExplosionTimeAt(nx, ny);
                if (nBombTime !== Infinity && arriveTime >= nBombTime) continue;
                
                // 穿透炸彈：即使有牆壁擋住，爆炸範圍內的格子不安全
                // 已在 explosionCells 中處理（getExplosionCells 對穿透炸彈不會因牆壁而停止）
                
                const key = `${nx},${ny}`;
                const prevTime = visited.get(key);
                if (prevTime !== undefined && prevTime <= arriveTime) continue;
                visited.set(key, arriveTime);
                
                queue.push({ x: nx, y: ny, time: arriveTime, path: [...curr.path, { x: nx, y: ny }] });
            }
        }
        
        return { canEscape: false, path: [] };
    }

    /**
     * 檢查是否在死路（計算從此格能到達的安全格數量）
     */
    isInDeadEnd() {
        const dirs = [{dx:0,dy:-1},{dx:0,dy:1},{dx:-1,dy:0},{dx:1,dy:0}];
        let openPaths = 0;
        for (const d of dirs) {
            const nx = this.gridX + d.dx;
            const ny = this.gridY + d.dy;
            if (!this.mapManager.isSolid(nx, ny) && !this.bombManager.hasBombAt(nx, ny)) {
                openPaths++;
            }
        }
        // 只有1個出口就是死路（或0個）
        return openPaths <= 1;
    }

    /**
     * 檢查牆壁保護：該格子 4 個方向中是否有牆壁可擋火焰
     */
    isWallProtected(x, y) {
        const dirs = [{dx:0,dy:-1},{dx:0,dy:1},{dx:-1,dy:0},{dx:1,dy:0}];
        for (const d of dirs) {
            const nx = x + d.dx;
            const ny = y + d.dy;
            const blockType = this.mapManager.getBlockType(nx, ny);
            if (blockType === 1 || blockType === 2) {
                return true;
            }
        }
        return false;
    }

    /**
     * 計算該格子被牆壁包圍的數量（用於判斷防禦優勢）
     */
    countWallCoverage(x, y) {
        const dirs = [{dx:0,dy:-1},{dx:0,dy:1},{dx:-1,dy:0},{dx:1,dy:0}];
        let count = 0;
        for (const d of dirs) {
            const nx = x + d.dx;
            const ny = y + d.dy;
            const blockType = this.mapManager.getBlockType(nx, ny);
            if (blockType === 1 || blockType === 2) count++;
        }
        return count;
    }

    // ==================== 敵人探測 ====================

    getEnemies() {
        const targets = [];
        if (typeof window !== 'undefined') {
            const isCoop = window.gameMode && (window.gameMode.includes('COOP') || window.gameMode.includes('SINGLE'));
            
            if (!isCoop) {
                const addTarget = (p) => {
                    if (p && !p.isDead && p !== this) {
                        targets.push(p);
                        if (p.cloneTimer > 0) {
                            targets.push({
                                x: p.cloneX,
                                y: p.cloneY,
                                gridX: Math.floor(p.cloneX / this.gridSystem.getCellSize()),
                                gridY: Math.floor(p.cloneY / this.gridSystem.getCellSize())
                            });
                        }
                    }
                };
                addTarget(window.player);
                addTarget(window.player2);
                addTarget(window.bot);
                addTarget(window.bot2);
            }
            
            if (window.monsterManager && window.monsterManager.monsters) {
                const cs = this.gridSystem.getCellSize();
                const maxX = this.gridSystem.cols - 1;
                const maxY = this.gridSystem.rows - 1;
                for (const m of window.monsterManager.monsters) {
                    if (m.isDead) continue;

                    // 取得怪物的真實格座標。
                    //
                    // 這裡必須自己換算，不能直接用 m.gridX/m.gridY：
                    // Monster 建構時 cellSize 還是 0（main.js 先 setupStage() 生成怪物，
                    // 之後才 renderer.resize() → updateCellSize()），像素座標從 0 開始，
                    // Monster.update() 又用 cellSize 推動像素，會一路飛出地圖；
                    // 而 m.gridX/m.gridY 從建構後就再也沒更新過。
                    // 兩者都不能直接信任，一律由當下像素座標換算。
                    let gx = Math.floor((m.x + cs / 2) / cs);
                    let gy = Math.floor((m.y + cs / 2) / cs);

                    // 濾掉已經飛出地圖的怪物（座標遠超邊界）。
                    // 這些怪物在實際畫面上根本不在地圖裡，AI 不該把它們當成目標，
                    // 否則距離計算會變成幾百格，攻擊判斷永遠不成立。
                    if (!Number.isFinite(gx) || !Number.isFinite(gy) ||
                        gx < 0 || gy < 0 || gx > maxX || gy > maxY) {
                        continue;
                    }
                    // 邊界格是硬磚，怪物不可能站在牆上；若算出來在牆上，
                    // 往地圖內回退一格取最近的有效位置。
                    if (this.mapManager.isSolid(gx, gy)) {
                        let fixed = false;
                        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, 1], [-1, 1], [1, -1]]) {
                            const tx = gx + dx, ty = gy + dy;
                            if (tx < 1 || ty < 1 || tx > maxX - 1 || ty > maxY - 1) continue;
                            if (this.mapManager.isSolid(tx, ty)) continue;
                            gx = tx; gy = ty; fixed = true; break;
                        }
                        if (!fixed) continue;
                    }

                    targets.push({
                        x: m.x, y: m.y, gridX: gx, gridY: gy,
                        speed: m.speed, ai: m.ai, type: m.type, monster: m,
                    });
                }
            }
        }
        return targets;
    }

    /**
     * 第六十九輪：記錄每隻怪物「本幀的像素位置」，供下一幀的移動預測使用。
     *
     * collectKillSpots() / coreDecide() 會用 (目前 x − 上一幀 x) 推算怪物速度，
     * 把怪物「未來 1~2 格」納入站位評分，這樣走過去站定時怪物剛好進射程。
     * 但這份「上一幀位置」必須有人每幀記錄 —— 真實遊戲的更新迴圈不會幫忙記，
     * 所以由 Bot 自己在每幀 think() 之後記在怪物物件上。
     *
     * 存在「真實怪物物件」(wrapper.monster) 上，而不是 getEnemies() 每幀新建的
     * 包裝物件上，否則下一幀換了新包裝就讀不到。
     *
     * 純觀測、不改任何遊戲規則。
     */
    recordEnemyMotion() {
        if (typeof window === 'undefined') return;
        const mm = window.monsterManager;
        if (!mm || !mm.monsters) return;
        for (const m of mm.monsters) {
            if (!m || m.isDead) continue;
            m._aiLastX = m.x;
            m._aiLastY = m.y;
        }
    }

    /**
     * 檢查隊友是否在爆炸範圍內
     */
    isTeamMateInDangerZone(explosionCells) {
        if (typeof window === 'undefined') return false;
        
        const teammates = [];
        const isCoop = window.gameMode && (window.gameMode.includes('COOP') || window.gameMode.includes('SINGLE'));
        
        if (isCoop) {
            if (window.player && !window.player.isDead && window.player !== this) teammates.push(window.player);
            if (window.player2 && !window.player2.isDead && window.player2 !== this) teammates.push(window.player2);
            if (window.bot && !window.bot.isDead && window.bot !== this) teammates.push(window.bot);
            if (window.bot2 && !window.bot2.isDead && window.bot2 !== this) teammates.push(window.bot2);
        }
        
        for (const tm of teammates) {
            if (explosionCells.has(`${tm.gridX},${tm.gridY}`)) {
                // 檢查隊友能否逃脫
                if (!this.canEvacuateFromCells(explosionCells, tm.gridX, tm.gridY)) {
                    return true; // 隊友會被炸死！不能放炸彈
                }
            }
        }
        return false;
    }

    /**
     * 檢查一個位置能否從給定的爆炸格子集合中逃脫
     */
    canEvacuateFromCells(explosionCells, startX, startY) {
        if (!explosionCells.has(`${startX},${startY}`)) return true;
        
        const timePerCell = 1 / this.getEffectiveSpeed();
        const queue = [{ x: startX, y: startY, time: 0, path: [] }];
        const visited = new Set([`${startX},${startY}`]);
        
        while (queue.length > 0) {
            const curr = queue.shift();
            
            if (!explosionCells.has(`${curr.x},${curr.y}`)) {
                return true; // 找到逃脫路徑
            }
            
            if (curr.time >= 2.0) continue;
            
            const dirs = [{dx:0,dy:-1},{dx:0,dy:1},{dx:-1,dy:0},{dx:1,dy:0}];
            for (const d of dirs) {
                const nx = curr.x + d.dx;
                const ny = curr.y + d.dy;
                const key = `${nx},${ny}`;
                
                if (visited.has(key)) continue;
                if (this.mapManager.isSolid(nx, ny)) continue;
                
                const arriveTime = curr.time + timePerCell;
                if (arriveTime >= 2.0) continue;
                
                const dInfo = this.dangerMap.getDangerInfo(nx, ny);
                if (dInfo.isFlameActive) continue;
                
                visited.add(key);
                queue.push({ x: nx, y: ny, time: arriveTime, path: [] });
            }
        }
        
        return false;
    }

    // ==================== 怪物路徑檢查 ====================

    /**
     * 檢查怪物能否從A點到達B點（考慮牆壁與炸彈）
     */
    canMonsterReach(fromX, fromY, toX, toY, maxSteps = 12) {
        const queue = [{ x: fromX, y: fromY, steps: 0 }];
        const visited = new Set([`${fromX},${fromY}`]);
        
        while (queue.length > 0) {
            const curr = queue.shift();
            
            if (curr.x === toX && curr.y === toY) return true;
            if (curr.steps >= maxSteps) continue;
            
            const dirs = [{dx:0,dy:-1},{dx:0,dy:1},{dx:-1,dy:0},{dx:1,dy:0}];
            for (const d of dirs) {
                const nx = curr.x + d.dx;
                const ny = curr.y + d.dy;
                const key = `${nx},${ny}`;
                
                if (visited.has(key)) continue;
                if (this.mapManager.isSolid(nx, ny)) continue;
                if (this.bombManager.hasBombAt(nx, ny)) continue;
                
                visited.add(key);
                queue.push({ x: nx, y: ny, steps: curr.steps + 1 });
            }
        }
        
        return false;
    }

    // ==================== 主要思考系統 ====================

    /**
     * ==================== 核心決策（第十二輪：think() 收斂）====================
     *
     * 為什麼要收斂
     * -----------
     * 舊的 think() 是 15 層優先序、約 25 個啟發式策略堆疊而成
     * （trySnipeAttack / tryBreach / tryWallDefense / tryTrapEnemy /
     *   tryWallControl / trySafeHunt / tryBreakoutFromDeadZone / tryBreakWalls /
     *   tryGather / tryChase ...），而且前面的分支會 return 短路後面的。
     *
     * 這種結構的實際後果（十一輪實測）：
     *   每修好一個 bug，下一個互動失效模式就浮出來，因為
     *   「誰在什麼時候決定什麼」沒有單一的答案。
     *   例如第 1 關：篩選漏斗 100% 通過、A* 163/163 失敗，
     *   根因是 Bot 被封在 3 格口袋裡，而 8 個不同的開路策略
     *   各自用不同條件詢問「我腳下有沒有軟磚」，沒有一個
     *   知道「通往目標站位的路上第一面牆在哪」。
     *
     * 收斂後的決策程序（單一目標、沒有競爭優先序）
     * ---------------------------------------------
     *   0. 生存：站在任何活彈的火場裡 → 立刻撤退（硬約束，永遠優先）
     *   1. 可達集合：目前「真的走得到」的所有格子（BFS，不穿牆/炸彈/火）
     *   2. 可殺站位：可達集合中，炸得到任一隻怪的格子
     *      2a. 已站在某個站位且炸完能活 → 放彈
     *      2b. 否則 → 走向評分最好的站位
     *   3. 一個站位都到不了 → 朝站位方向炸開路上的第一面軟磚
     *   4. 場上沒怪 → 收道具 / 安全巡邏
     *
     * 每一步都只回答一個問題，沒有任何分支會「搶走」別的分支的工作。
     * 這沒有改動任何遊戲規則：仍是用遊戲本身的移動、炸彈範圍、引信時間，
     * 沒有穿牆、瞬移或額外傷害，只是把決策順序變得單純且可驗證。
     */
    think() {
        // ===== 逃離承諾（遲滯 / hysteresis）=====
        // 一旦決定逃就承諾走完，避免被其他目標每幀推翻而原地抽屜。
        if (this.escapeCommitted) {
            const expired = this.time > this.escapeCommitDeadline;
            // 第六十五輪（決定性）：no-progress 的語意修正。
            //
            // 決定性實測（bb-autopsy.mjs 第 1 關 seed 4242，200 秒）：
            //   FLEE 614 幀（83.3%）、FLEE 原因 noProgress 355 幀
            //
            // 原版：「gridX 等於起點」就判定沒進展。
            // 但走一格要 0.1~0.2 秒，而這裡每幀（0.0167 秒）檢查一次 ——
            // 也就是說它要求的「進展」在物理上不可能被觀察到，
            // 每次檢查時必然都還在同一格。
            //
            // 這正是本檔案歷來記錄的「卡住」現象（第 63 輪註解：
            // 6322 幀／105 秒格座標完全不變）。原以為 no-progress 保險
            // 能防住它，實際上那個保險自己每幀誤判成「沒進展」，
            // 反而把唯一有效的「保持承諾」路徑關掉了。
            //
            // 正確語意：只有「**走過之後又回到**起點」才是真的沒進展
            //（那代表路徑把人帶回危險區、或撞牆被彈回來）。
            // 還沒離開起點時，唯一該用的是到期時間。
            const returned = this._escapeHasMoved &&
                this.gridX === this.escapeCommitFromX &&
                this.gridY === this.escapeCommitFromY;
            if (this.gridX !== this.escapeCommitFromX ||
                this.gridY !== this.escapeCommitFromY) {
                this._escapeHasMoved = true;
            }
            const noProgress = returned;
            if (!expired && !noProgress &&
                this.isInsideLiveBlast() && (this.targetPath || []).length > 0) {
                this.state = 'FLEE';
                this._fleeReason = 'escapeCommit';
                return;
            }
            this._fleeReason =
                (expired ? 'expired ' : '') +
                (noProgress ? 'returnedToStart ' : '') +
                (!this.isInsideLiveBlast() ? 'notInBlast ' : '') +
                ((this.targetPath || []).length === 0 ? 'noPath' : '');
            this.escapeCommitted = false;
            this._escapeHasMoved = false;
        }

        this.resetInput();

        // ===== 第六十四輪（架構重構）：開路請求優先於一般攻擊決策 =====
        //
        // 決定性實測（bb-autopsy.mjs 第 1 關 seed 4242，200 秒，重構第一步後）：
        //   BREACH_REQUEST 180 幀（25.3%）<- 請求已送出但無人消費
        //   FLEE 231 幀、CORE_ALIGN 204 幀、CARVE_MOVE+GATE 96 幀
        //
        // 請求送不出去的原因：followPath 在 update() 裡、think() **之後**執行，
        // 所以它寫下的 pendingBreach 要等「下一幀」才會被 think() 看到。
        // 而下一幀 think() 一開始就被硬約束擋住
        // （guardAgainstLethalMonster / bombCoversCell），
        // carveTowardKillSpot 根本沒被呼叫到 —— 於是請求永遠過期。
        //
        // 修正：在 think() 的最開頭（硬約束之前）先處理請求。
        // 這裡是安全的：即使當下有火場，
        // carveTowardKillSpot → executeCarvePlan 仍然會做
        // canSafelyPlaceBomb + 幾何死路 + 隊友檢查，
        // 而且放下的是「站在 stand 上」的彈，不是腳下的彈。
        //
        // 生命安全沒有被放寬：只是讓「開路」這個動作回到有全部保護的
        // 那條路徑上執行，而不是在 followPath 裡硬放。
        if (this.pendingBreach && this.time < this.pendingBreach.until) {
            if (this.carveTowardKillSpot()) return;
            this.pendingBreach = null;
        }

        // ===== 硬約束 1：怪物貼身致死 → 任何攻擊目標都不允許 =====
        if (this.guardAgainstLethalMonster()) return;

        // ===== 硬約束 2：站在任何活彈的火場裡 → 立刻撤退 =====
        //
        // 門檻是「站進去就出局」，不是「快爆了才跑」：
        // 提前離開的邊際成本只多走一格，延遲離開的成本是整局結束。
        const myDanger = this.dangerMap.getDangerInfo(this.gridX, this.gridY);
        const bombCoversCell = this.getMinBombExplosionTimeAt(this.gridX, this.gridY) < Infinity;

        // ===== 第十七輪（決定性）：區分「會死」與「只是近」=====
        //
        // 第 15 關實測（bb-throughput.mjs，30 秒 SINGLE）：
        //   存活 11.1s、放彈 3 顆 = 產能利用率 100%（早已打滿）
        //   可達集合只有 2.6 格、FLEE 卻佔 60.2% 的幀
        //
        // 也就是說第 15 關的瓶頸完全不是產能，而是：
        // Bot 被 10 隻怪擠在 2~3 格的口袋裡，而 DangerMap 把
        // 「怪物旁邊一格」也標成危險，dangerLevel > 0 幾乎永遠成立，
        // 於是舊邏輯每幀都判定「要逃」——但口袋裡只有那 2~3 格，
        // 逃了等於沒逃，只是原地兜圈，60% 的時間就這樣白花，
        // 連一顆能改變命運的炸彈都放不出來。
        //
        // 真正會致命的只有兩件事：腳下有活彈的火場、腳下正在燃燒。
        // 「怪物很近」只有在「我真的有地方可逃」時才值得反應；
        // 被圍困時，唯一能增加生存機會的動作是**炸牆開路**。
        //
        // 這不是放寬安全標準 —— 活彈與火焰仍然第一時間撤退，沒有例外。
        // 改變的只是：不再對「根本逃不掉」的怪物逼近做出無效反應。
        const inFlame = myDanger.isFlameActive;
        const monsterPressing = myDanger.dangerLevel > 0 && myDanger.explosionTimer < 0.5;
        // ===== 第四十輪（決定性）：被圍困不等於「不用躲怪物」=====
        //
        // 實測（bb-modes.mjs 5 局 vs commit bfe5cff）：
        //   SINGLE 1  DEAD 100%、avgSec 13.0（放彈後暴死）
        //
        // bb-autopsy.mjs 第 1 關 seed 111：
        //   存活 10.93s、放彈 3 顆（全部幾何安全）、死因 FIRE
        //   FLEE 46.5%、CORE_ALIGN 25.3%、UNSTUCK 21.3%
        //
        // 第十七輪引入的 boxedIn 判準是「可達集合 <= 4 格就不躲怪物」。
        // 當時的理由是「逃無可逃，躲了也沒用，不如炸牆」。
        //
        // 但量測顯示這個判斷太寬了：
        //   reach <= 4 的「口袋」通常是「暫時的」—— Bot 放彈炸開一面牆後
        //   可達集合就會變大（實測 3 → 18 格）。而怪物逼近到 cs*0.8 就會死。
        //   也就是說「躲怪物」能爭取到「等炸彈炸開」的寶貴時間，
        //   而放彈往往還需要先走到站位、站上去、等引信。
        //
        // 真正的無解只有一種：**立刻就會死**（在火場裡 / 腳下有活彈）。
        // 那種情況 FLEE 確實沒用，但怪物逼近的情況完全不同 ——
        // 它還有時間，應該先用腳步拉開距離。
        //
        // 所以把判準從「reach 大小」改成「有沒有被火焰或活彈包圍」，
        // 也就是只保留 inFlame / bombCoversCell 兩條硬約束。
        // monsterPressing 恢復為無條件觸發 FLEE。
        const mustFlee = inFlame || bombCoversCell || monsterPressing;

        // ===== 第四十六輪（決定性）：活彈在腳下時，先確認逃得掉再決定其他事 =====
        //
        // 實測（bb-modes.mjs 8 局 vs fd03d3e）：
        //   SINGLE 1  DEAD 75% -> 87.5%   avgSec 159 -> 86
        //   SINGLE 5  DEAD 37.5% -> 62.5%  avgSec 381 -> 235
        //   COOP   5  CLEAR 0% -> 12.5%   avgSec 526 -> 239
        //
        // bb-throughput 第 1 關 180 秒（第四十五輪之後）：
        //   存活 17.7s、放彈 4 顆、產能利用率 80.0%
        //   UNSTUCK 31.1%、FLEE 21.8%、CARVE_MOVE 15.3%
        //
        // 產能從 1.7% 拉到 80%（偏移超時終於讓它能推進），
        // 但死亡跟著上升：它現在願意放彈，放完卻逃不掉。
        //
        // 關鍵：這不是「放太多顆」，而是「放了之後沒走出去」。
        // 第四十五輪讓偏移在 8 幀後放棄偏移並清掉 carvePlan，
        // 但腳下的活彈已經放出去了 —— 那顆炸彈是無法收回的。
        //
        // 正確做法：腳下有活彈時，FLEE 必須拿到**真的走得通**的路徑，
        // 拿不到就明確宣告失敗、讓呼叫端走 trySmartFlee / stepOutOfBlastCell，
        // 而不是接受 findGlobalEscapePath 回傳的「理論上安全格」
        // —— 那個 BFS 沒有做 canPhysicallyMove 的第一步檢查。
        if (bombCoversCell) {
            // ===== 第五十一輪：優先使用「放彈當下鎖定的撤退路線」 =====
            //
            // canSafelyPlaceBomb 是以「當下像素位置」做完整 BFS 得到的，
            // 而且它的第一步有 canPhysicallyMove 檢查；
            // findGlobalEscapePath 兩者都沒有。
            // 所以「放彈時算好的路」永遠比「現在重算的路」可靠。
            const be = this.blastEscape;
            if (be && this.time < be.until) {
                // 過濾掉已經走過的前導節點
                while (be.path.length > 0) {
                    const h = be.path[0];
                    if (h.x === this.gridX && h.y === this.gridY) be.path.shift();
                    else break;
                }
                if (be.path.length > 0) {
                    this.targetPath = be.path;
                    this.moveGoal = { x: be.path[0].x, y: be.path[0].y };
                    this.state = 'FLEE';
                    this.commitToEscape();
                    return;
                }
                // ===== 第五十二輪：撤退路線走完 = 已站在安全格 =====
                //
                // 決定性實測（bb-throughput.mjs 第 15 關 120 秒，第五十一輪之後）：
                //   放彈 5 顆 x 引信 3 秒 = 15 秒，總存活只有 24.4 秒
                //   FLEE 50.0%、coreDecide 只被呼叫 640 / 1465 幀
                //
                // 也就是說 62% 的時間花在處理自己放的炸彈上。
                // 但「站到安全格」和「能炸到怪」並不互斥 ——
                // 安全格的定義是「不在火場裡」，不是「不能開火」。
                // 這裡在抵達安全格的當下立刻檢查能不能炸到怪，
                // 能的話直接放，讓「撤退」與「攻擊」不再是兩段互斥的時間。
                //
                // 每一顆仍然走 canSafelyPlaceBomb + 幾何死路 + 隊友檢查，
                // 沒有放寬任何安全標準。
                this.blastEscape = null;
                // ===== 第五十六輪（決定性）：已到安全格 → 交還攻擊決策權 =====
                //
                // 量測（bb-modes.mjs 10 局，第五十五輪之後）：
                //   SINGLE 1  avgSec 131.2 / avgLeft 2.3
                //   SINGLE 15 avgSec 34.0  / avgLeft 8.9
                //   avgLeft 全面下降代表有進展，但 avgSec 從 219 掉到 131
                //
                // 每顆炸彈固定吃掉 3 秒（引信）不能攻擊，這個成本壓縮不了；
                // 能壓縮的是「撤退結束後還要多久才開始下一次攻擊」。
                //
                // 原流程：撤退路線走完 → 往下繼續跑 findGlobalEscapePath /
                // trySmartFlee / stepOutOfBlastCell / carveEscapeFromBlast
                // …… 最後才輪到 coreDecide 重新評分。
                // 但**走到這裡時 blastEscape.path 已空**，代表已經站在安全格，
                // bombCoversCell 此刻為 false、isInsideLiveBlast() 為 false ——
                // 繼續跑 FLEE 那一整套只是白費幀數。
                //
                // 正確做法：立刻結束 think()，讓下一幀直接進 coreDecide。
                // 這不是「提早放棄逃生」，因為此刻確實已經安全；
                // 它是把「撤退」與「攻擊」之間的空檔拿掉。
                //
                // 仍然先試一次「在安全格能不能順手再炸」（r52 的邏輯），
                // 那是零成本的額外收益；打不到就交還決策權。
                {
                    const pierce2 = this.hasSuperBomb();
                    const shape2 = this.getMyExplosionShape();
                    if (this.currentBombs < this.maxBombs &&
                        !this.bombManager.hasBombAt(this.gridX, this.gridY) &&
                        !this.isInsideLiveBlast()) {
                        const esc2 = this.canSafelyPlaceBomb(this.gridX, this.gridY,
                            this.fireRange, pierce2, shape2);
                        const cells2 = this.getExplosionCells(this.gridX, this.gridY,
                            this.fireRange, pierce2, shape2);
                        if (esc2 && esc2.canEscape && esc2.path && esc2.path.length > 0 &&
                            !this.isTeamMateInDangerZone(cells2) &&
                            !this.blastCoversEntireReachable(this.gridX, this.gridY)) {
                            let hits = false;
                            for (const e of this.getEnemies()) {
                                if (!e || e.isDead) continue;
                                if (cells2.has(`${e.gridX},${e.gridY}`)) { hits = true; break; }
                            }
                            if (hits) {
                                this.aiInput.bomb = true;
                                this.blastEscape = {
                                    path: esc2.path.slice(),
                                    // 第五十七輪：存活到火焰完全熄滅為止。
                                    // 舊值是 until = time + fuse + 0.5，
                                    // 但火焰在爆炸後還會持續約 0.5s（Explosion 的 duration），
                                    // 所以那個時機其實還站在火場裡 —— blastEscape 被清掉，
                                    // 之後就改用沒有 canPhysicallyMove 檢查的
                                    // findGlobalEscapePath，品質立刻下降。
                                    // 量測（bb-autopsy 第 15 關）：blastEscape 只存在
                                    // 192 / 1270 幀（15%），FLEE 有 370 幀。
                                    until: this.time + this.getFuseTime() + 1.2,
                                };
                                this.targetPath = esc2.path.slice();
                                this.state = 'CORE_BOMB';
                                return;
                            }
                        }
                    }
                }
                // 已安全 → 不再跑 FLEE，直接結束 think()
                this.state = 'FLEE_DONE';
                this.targetPath = [];
                this.moveGoal = null;
                return;
            } else {
                this.blastEscape = null;
            }

            // ===== 第五十二輪（決定性）：撤退期間每幀檢查「安全格能不能順手再炸」=====
            //
            // 決定性實測（bb-throughput.mjs 第 15 關 120 秒，第五十一輪之後）：
            //   放彈 5 顆 x 引信 3 秒 = 15 秒，而總存活只有 24.4 秒。
            //   狀態分布 FLEE 50.0%、coreDecide 只被呼叫 640 / 1465 幀。
            //
            // 也就是說 **62% 的時間花在處理自己放的炸彈上**，
            // 真正的攻擊決策只拿到三分之一。
            //
            // 但「站到安全格」和「能炸到怪」並不互斥 ——
            // 安全格的定義本來就是「不在火場裡」，而不是「不能開火」。
            // 只要炸完還能再走一步，那一格就可以再放一顆。
            //
            // 這裡在撤退路徑走完（path 空、也就是抵達安全格）時，
            // 立刻檢查當前位置能不能炸到怪 —— 能的話直接放，
            // 不必等下一幀 coreDecide 從頭評分。
            // 這讓「撤退」與「攻擊」不再是兩段互斥的時間。
            //
            // 這不違反任何安全標準：每一顆都仍然走
            // canSafelyPlaceBomb + 幾何死路檢查 + 隊友檢查。
            {
                const pierce2 = this.hasSuperBomb();
                const shape2 = this.getMyExplosionShape();
                if (this.currentBombs < this.maxBombs &&
                    !this.bombManager.hasBombAt(this.gridX, this.gridY)) {
                    const esc2 = this.canSafelyPlaceBomb(this.gridX, this.gridY,
                        this.fireRange, pierce2, shape2);
                    const cells2 = this.getExplosionCells(this.gridX, this.gridY,
                        this.fireRange, pierce2, shape2);
                    if (esc2 && esc2.canEscape && esc2.path && esc2.path.length > 0 &&
                        !this.isTeamMateInDangerZone(cells2) &&
                        !this.blastCoversEntireReachable(this.gridX, this.gridY)) {
                        let hits = false;
                        for (const e of this.getEnemies()) {
                            if (!e || e.isDead) continue;
                            if (cells2.has(`${e.gridX},${e.gridY}`)) { hits = true; break; }
                        }
                        if (hits) {
                            this.aiInput.bomb = true;
                            this.blastEscape = {
                                path: esc2.path.slice(),
                                until: this.time + this.getFuseTime() + 0.5,
                            };
                            this.targetPath = esc2.path.slice();
                            this.state = 'CORE_BOMB';
                            return;
                        }
                    }
                }
            }

            const escapePath = this.findGlobalEscapePath();
            if (escapePath && escapePath.path.length > 0) {
                // 額外驗證：路徑第一步必須物理上走得通
                const n0 = escapePath.path[0];
                if (this.canPhysicallyMove(
                        Math.sign(n0.x - this.gridX), Math.sign(n0.y - this.gridY))) {
                    this.targetPath = escapePath.path;
                    this.state = 'FLEE';
                    this.commitToEscape();
                    return;
                }
            }

            // ===== 第四十七輪（決定性）：無路可逃時，往炸得開的方向走 =====
            //
            // 決定性實測（bb-throughput.mjs 第 15/30 關 120 秒）：
            //   第 15 關：存活 25.0s、放彈 5 顆、利用率 62.5%、擊殺 1 隻
            //            可達集合 62.0 格、可殺站位 16.38 個
            //            FLEE 52.8%、CARVE_MOVE 8.5%
            //            20s 取樣：g=(6,7) plan=NONE tp=17 tp0=7,7  <- 有路，OK
            //   第 30 關：存活 19.8s、放彈 5 顆、利用率 83.3%、擊殺 4 隻
            //            FLEE 63.5%、UNSTUCK 3.4%
            //
            // 兩關的 FLEE 都佔一半以上，遠高於任何攻擊狀態。
            // 原因：腳下有活彈 → bombCoversCell 成立 → 走 FLEE 分支。
            // 而 findGlobalEscapePath 在小區域裡常常找不到路
            // （它不接受「穿過火焰」的路徑），於是每幀都失敗。
            //
            // 之前的 fallback 是 trySmartFlee / stepOutOfBlastCell /
            // pickPhysicallyValidDirection —— 全部只是「在現有格內動一下」，
            // 而火場會在 3 秒內覆蓋整個可達集合，動一下是沒用的。
            //
            // 真正能改變局面的是**炸開一面牆**：
            // 多一格就多一個落腳點，多幾格就能走出火場。
            // 這不是放棄求生，而是「用 3 秒換一個能活下去的空間」，
            // 而代價（3 秒後爆炸）遠小於待在原地被掃到的代價（立刻死亡）。
            //
            // 這條路徑只有在「其他所有逃生手段都失敗」時才會走到，
            // 也就是「已經沒有別的辦法了」的情況。
            if (this.carveEscapeFromBlast()) { this.state = 'FLEE'; return; }

            if (this.trySmartFlee()) { this.state = 'FLEE'; return; }
            if (this.stepOutOfBlastCell()) { this.state = 'FLEE'; return; }
            // 連一步都走不動 → 至少先橫移脫離當前格
            const dir = this.pickPhysicallyValidDirection(
                [[0, -1], [0, 1], [-1, 0], [1, 0]]);
            if (dir) {
                this.resetInput();
                if (dir[0] > 0) this.aiInput.right = true;
                else if (dir[0] < 0) this.aiInput.left = true;
                else if (dir[1] > 0) this.aiInput.down = true;
                else this.aiInput.up = true;
                this.state = 'FLEE';
                return;
            }
            // 完全無解：不放彈、不開路，留在原地等火焰熄滅
            this.aiInput.bomb = false;
            this.carvePlan = null;
            return;
        }

        if (mustFlee) {
            const escapePath = this.findGlobalEscapePath();
            if (escapePath && escapePath.path.length > 0) {
                this.targetPath = escapePath.path;
                this.state = 'FLEE';
                this.commitToEscape();
                return;
            }
            if (this.trySmartFlee()) { this.state = 'FLEE'; return; }
            if (this.stepOutOfBlastCell()) { this.state = 'FLEE'; return; }
        }

        // ===== 硬約束 3：1 秒內會被炸到 → 先撤 =====
        const minBombTime = this.getMinBombExplosionTimeAt(this.gridX, this.gridY);
        if (minBombTime < 1.0) {
            const p = this.findGlobalEscapePath(2.0);
            if (p && p.path.length > 0) {
                this.targetPath = p.path;
                this.state = 'FLEE';
                return;
            }
        }

        // ===== 軟目標：攻擊 / 開路 / 收集，一個明確的決策程序 =====
        this.coreDecide();
    }

    /** 這一格是不是「現在就能安全站上去 / 走過去」 */
    isWalkableCell(x, y) {
        const bt = this.mapManager.getBlockType(x, y);
        if (bt === 1 || bt === 2 || bt === 5) return false;   // 硬磚 / 軟磚 / 水
        if (this.bombManager.hasBombAt(x, y)) return false;
        if (this.dangerMap.getDangerInfo(x, y).isFlameActive) return false;
        return true;
    }

    /** 可達集合：從目前位置出發、不穿牆/炸彈/火焰，實際走得到的格 */
    computeReachable() {
        const gs = this.gridSystem;
        const seen = new Set([`${this.gridX},${this.gridY}`]);
        const q = [[this.gridX, this.gridY]];
        const D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        while (q.length > 0) {
            const [x, y] = q.shift();
            for (const [dx, dy] of D) {
                const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
                if (seen.has(k)) continue;
                if (nx < 1 || ny < 1 || nx >= gs.cols - 1 || ny >= gs.rows - 1) continue;
                if (!this.isWalkableCell(nx, ny)) continue;
                seen.add(k);
                q.push([nx, ny]);
            }
        }
        return seen;
    }

    /**
     * 可殺站位：可達集合中，爆炸範圍蓋得到任一隻怪的格子。
     *
     * 這是炸彈物理上唯一可能命中的位置集合（十字形爆炸：同行/同列、距離 <= fireRange），
     * 所以枚舉完就是完整集合，不會漏掉任何能打到怪的站位。
     */
    collectKillSpots(live, reach) {
        const R = this.fireRange;
        const shape = this.getMyExplosionShape();
        const pierce = this.hasSuperBomb();
        const out = [];
        const seen = new Set();

        // ===== 第五十三輪（決定性）：站位要「預判怪物的移動」=====
        //
        // 決定性實測（bb-throughput.mjs 第 15 關 120 秒 + bb-autopsy.mjs）：
        //   放彈 5 顆（理論上限 8 顆，產能利用率 62.5%）、擊殺只有 1 隻
        //   FLEE 來源統計：100% 是 bombT（腳下有活彈），無一例來自怪物或火焰
        //
        // 產能已經接近上限，所以殺不到怪的原因**不是放得少，而是打不中**。
        //
        // 原因：collectKillSpots 用的是怪物的**當下位置**。
        // 走 3 格到站位要 0.75~1.5 秒，這段時間怪移動 1~3 格，
        // 等站定時早就不在射程裡了 —— 於是「站上站位、放彈、什麼都沒炸到」。
        //
        // 修正：把每隻怪的「未來位置」也納入計算。
        // 移動方向用「上一次幀的位移」推斷，速度用物件自己的 speed
        // （讀取現有屬性，沒有改動遊戲規則）。
        // 這是純粹的決策層預測，不是給怪加速、不是鎖定、不是作弊。
        const predicted = [];
        for (const m of live) {
            predicted.push({ e: m, gx: m.gridX, gy: m.gridY, future: false });
            // 沿用 m.speed 與最近一次實際位移推出的方向。
            // 第六十九輪：getEnemies() 回傳的是「每幀新建的包裝物件」，
            // 上一幀位置記在真實怪物 m.monster 上（recordEnemyMotion），
            // 所以速度要從 m.monster 讀，不能從包裝物件讀（那永遠沒有 _aiLastX）。
            const src = m.monster || m;
            const vx = (src._aiLastX !== undefined) ? (m.x - src._aiLastX) : 0;
            const vy = (src._aiLastY !== undefined) ? (m.y - src._aiLastY) : 0;
            if (Math.abs(vx) < 0.01 && Math.abs(vy) < 0.01) continue;
            const step = Math.max(1, Math.round((m.speed || 1) * (1 / 60) * 45));
            const dx = Math.sign(vx), dy = Math.sign(vy);
            // 第六十九輪：只預測「下一格」（t=1），不預測 t=2。
            //
            // 決定性 A/B（bb-ceiling.mjs 80 局，stage 1）：
            //   預測開 → killRate 28.7%→36.3%、timeout 50→45（吞吐明顯變好），
            //   但 ownFire 10→15：Bot 為了站到「兩格之後的猜測位置」而走更遠、
            //   更暴露，且怪物常中途轉向使 t=2 的猜測落空 → 空跑又送命。
            //   怪物的轉向頻率讓 2 格預測的命中率遠低於 1 格，
            //   收益（多一點提前量）不敵成本（更長的暴露路徑）。
            //   改成只看下一格：保留「提前一步卡位」的吞吐收益，
            //   同時把過度外插造成的自殺風險降到最低。
            predicted.push({
                e: m, gx: m.gridX + dx, gy: m.gridY + dy, future: true,
            });
            void step;
        }

        for (const pd of predicted) {
            const e = pd.e;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                for (let d = 1; d <= R; d++) {
                    const gx = pd.gx + dx * d, gy = pd.gy + dy * d;
                    const k = `${gx},${gy}`;
                    if (seen.has(k)) continue;
                    // 不在可達集合就不可能是站位。
                    // 注意不能用 break：同一方向更遠的格子仍可能從別條路走得到。
                    if (!reach.has(k)) continue;
                    seen.add(k);
                    const cells = this.getExplosionCells(gx, gy, R, pierce, shape);
                    let cover = 0;
                    let real = 0;
                    for (const o of live) {
                        if (cells.has(`${o.gridX},${o.gridY}`)) real++;
                    }
                    for (const o of predicted) {
                        if (!o.future) continue;
                        if (cells.has(`${o.gx},${o.gy}`)) cover++;
                    }
                    const score = real * 10 + cover;
                    // ===== 第五十八輪（決定性）：多顆怪的站位優先，即使遠一點 =====
                    //
                    // 決定性實測（bb-modes.mjs 10 局，第五十六~五十七輪之後）：
                    //   SINGLE 1  avgSec 132.1 / avgLeft 2.3（3 隻怪只殺 0.7 隻）
                    //   SINGLE 15 avgSec 39.3  / avgLeft 8.7（10 隻怪殺 1.3 隻）
                    //   COOP   15 avgSec 47.2  / avgLeft 6.1（10 隻怪殺 3.9 隻）
                    //   COOP   30 avgSec 17.2  / avgLeft 12.8（18 隻怪殺 5.2 隻）
                    //
                    // 每一顆炸彈的固定成本是 3 秒不能攻擊。
                    // 所以真正的收益不是「炸到幾隻」，而是
                    // **「炸到幾隻 ÷ 損失的 3 秒」**。
                    //
                    // 舊評分 real*10 + cover 把「當下命中」壓過「預測命中」10 倍，
                    // 結果它幾乎只挑當下就打得到的站位 ——
                    // 那些站位通常也是最遠的（怪在遠處、站位在怪旁邊）。
                    //
                    // 修正：把「能打到幾隻」提升到第一位（×1000），
                    // 預測命中次之（×100），距離最後（×30/格）。
                    // 這讓「走 5 格炸到 3 隻」贏過「走 1 格炸到 1 隻」：
                    // 前者多花 4 格（約 1 秒）卻多殺 2 隻，
                    // 而多殺一隻省下的不只是時間，還有後續 3 隻怪的威脅。
                    const score2 = real * 1000 + cover * 100;
                    if (score2 > 0) out.push({ x: gx, y: gy, cover: score2 });
                }
            }
        }
        return out;
    }

    /**
     * 站位評分。
     *
     * cover（一次能炸幾隻）最重要：一顆炸彈的成本只付一次，覆蓋越多越划算。
     * exits（旁邊有幾條生路）用來預估「炸完能不能活」——
     * 這裡刻意不呼叫 canSafelyPlaceBomb，因為它的 BFS 是從「目前所在格」出發的，
     * 拿來評估一個還沒走到的站位在語意上不成立；
     * 真正放彈時才會用正確的條件（站在該格上）檢查。
     */
    pickBestSpot(spots) {
        // ===== 第四十九輪（決定性）：站位必須「承諾」，且距離權重遠高於收益 =====
        //
        // 決定性實測（bb-throughput.mjs 第 15 關 120 秒，第 47 輪之後）：
        //   可達集合 62.0 格、平均可殺站位 16.38 個（0 站位的幀數僅 315）
        //   狀態分布：CORE_MOVE 324 幀、CORE_BOMB 只有 3 幀、擊殺 1 隻
        //
        // 站位有 16 個、放彈時機只有 3 幀 —— 它幾乎永遠在「走向站位」，
        // 卻幾乎永遠站不到。兩個原因，都出在這裡：
        //
        // 1. 權重失衡：舊評分是 cover*1000 + exits*20 - dist*1。
        //    16 個站位裡只要有一個能蓋住 2 隻怪（2000 分），
        //    它就會贏過任何近的站位（最多 1000+80 分）。
        //    於是它挑最遠的站位，走 10 格，途中怪物移動 → 下一幀
        //    collectKillSpots 的結果全變了 → 又挑一個新的遠站位。
        //
        // 2. 沒有承諾：coreDecide 每幀重新評分、重新 aStar，
        //    targetPath 每幀被改寫成「往另一個目標走」。
        //    這跟第 12 輪修過的 CARVE_MOVE 抖振是同一個病，
        //    只是發生在攻擊站位而不是開路站位上。
        //
        // 修正：
        //   a. 距離權重提到與 cover 同級（每格 300 分），
        //      因為「走 3 格打到 1 隻」永遠優於「走 10 格打到 2 隻」——
        //      走的時間裡怪物會動，走到時機會更好但不一定。
        //   b. 承諾：選定一個站位後，用 spotCommit 記住，
        //      只要「仍然合法」就一路走到它，途中不換目標。
        //      合法性 = 那個站位還能炸到至少一隻活怪。
        //      這個承諾與既有的 carvePlan / escapeCommitted 同一設計原理。
        const committed = this.spotCommit;
        if (committed) {
            const self = `${this.gridX},${this.gridY}`;
            const key = `${committed.x},${committed.y}`;
            if (self !== key && this.isWalkableCell(committed.x, committed.y)) {
                // ===== 第五十九輪（決定性）：承諾必須有「進展檢測」=====
                //
                // 決定性實測（bb-autopsy.mjs 第 1 關 seed 4242，120 秒）：
                //   放彈 1 顆、走過 3 格、淨位移 36.8px
                //   CORE_MOVE 4617 幀（64.1%）、CORE_ALIGN 2431 幀（33.8%）
                //   nudgingOffCenter 95.6%、對角移動 46.5%
                //   alignToClearCorner 呼叫 2358 次、設了方向 2358 次
                //   最後 40 幀：(1,1) key=U / key=DL 交替，oY 在 37.1 / 28.8 間跳
                //
                // 它整場都在 CORE_MOVE，但放彈只有 1 顆 —— 因為 spotCommit
                // 讓它死守同一個站位，而那個站位**物理上到不了**。
                // （和 carvePlan 在第十二輪遇到的問題一模一樣，
                //   當時的解法是 no-progress 檢測，這裡必須同樣處理。）
                //
                // 承諾若不帶「有沒有在靠近」的判斷，就會變成另一種形式的永久卡死：
                // 「不再抖動」聽起來比較好，但「永遠走不到」更糟。
                const d = Math.abs(committed.x - this.gridX) +
                          Math.abs(committed.y - this.gridY);
                if (this._spotLastDist === d) {
                    this._spotNoProgress = (this._spotNoProgress || 0) + 1;
                } else {
                    this._spotLastDist = d;
                    this._spotNoProgress = 0;
                }
                // 90 幀（1.5 秒）距離沒有縮短 → 這個站位到不了，放棄
                if (this._spotNoProgress >= 90) {
                    this._spotNoProgress = 0;
                    this._spotLastDist = undefined;
                    this.spotCommit = null;
                    // 連偏移承諾一起放棄，否則它會繼續卡在同一個角落
                    this.nudgingOffCenter = false;
                    this.nudgeRefCell = null;
                    this.nudgeSign = null;
                    this._nudgeFrames = 0;
                } else {
                    return { x: committed.x, y: committed.y, cover: committed.cover };
                }
            } else {
                this.spotCommit = null;
                this._spotNoProgress = 0;
                this._spotLastDist = undefined;
            }
        }

        let best = null, bestScore = -Infinity;
        for (const s of spots) {
            let sc = s.cover * 1000;
            let exits = 0;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                if (this.isWalkableCell(s.x + dx, s.y + dy)) exits++;
            }
            sc += exits * 20;
            // 第五十八輪：距離權重 1 -> 30。
        // 站位評分（collectKillSpots）已經是 real*1000 + cover*100，
        // 所以「多殺一隻」值 1000 分，1 格距離只值 30 分：
        // 走 30 格（7.5 秒）多殺一隻才划算。
        //
        // 舊值是 300，那時 collectKillSpots 用 real*10，
        // 兩邊尺度不一致，這裡統一到新的尺度。
        sc -= (Math.abs(s.x - this.gridX) + Math.abs(s.y - this.gridY)) * 30;
            if (sc > bestScore) { bestScore = sc; best = s; }
        }
        if (best) {
            this.spotCommit = { x: best.x, y: best.y, cover: best.cover };
        }
        return best;
    }

    /** 單一目標的決策程序：有站位就打，沒站位就炸路，都不行才巡邏 */
    coreDecide() {
        const live = this.getEnemies().filter(e => !e.isDead);

        if (live.length > 0) {
            const reach = this.computeReachable();
            const spots = this.collectKillSpots(live, reach);

            // ===== 第五十四輪（決定性）：可達集合太小時不要急著開路 =====
            //
            // 決定性實測（bb-autopsy.mjs 第 15 關 seed 12345）：
            //   t= 0.15s 站位(2,1) 可達 7 格  剩 3 格安全
            //   t= 5.22s 站位(5,1) 可達 7 格  剩 3 格安全
            //   t= 8.23s 站位(1,2) 可達 3 格  剩 1 格安全   <- 幾乎必死
            //   t=11.27s 站位(6,1) 可達 7 格  剩 3 格安全
            //   t=18.82s 站位(5,1) 可達 95 格 剩 88 格安全  <- 終於開出一大片
            //
            // 前 4 顆都在 3~7 格的小區域裡放彈，每次只換來 1~3 格的新空間，
            // 而且每次都要付出 3 秒撤退（引信）。
            // 第 8.23s 那顆最危險：可達 3 格、爆炸覆蓋 2 格、只剩 1 格落腳點，
            // 任何一點意外都會死。
            //
            // 真正的收益在第 5 顆：一次炸開 7 格、可達集合跳到 95 格。
            //
            // 所以正確策略是：**先把當前區域的落腳點養夠**，
            // 落腳點不夠時寧可走位、等怪靠近，也不要在
            // 「幾乎無處可躲」的地方放彈。
            //
            // 門檻：可達集合 < 10 格時不開路。
            //
            // 但「不開路」不等於「什麼都不做」——
            // 第 1 關的**起始狀態就是 3 格**，若連開火一起禁掉，
            // 它會永遠困在那 3 格裡（實測 UNSTUCK 99.2%、放彈 0 顆、
            // 位置 90 秒不變）。所以門檻必須只擋「炸牆」，
            // 不能擋「炸怪」——
            //
            // 這也是第 15 關資料支持的：最危險的是
            // 「在 3 格區域**為了炸開牆**而放彈」，
            // 不是「在 3 格區域**炸已经在射程內的怪**」。
            //
            // ===== 第五十五輪（決定性修正）：門檻要分「有沒有站位」，不是只看區域大小 =====
            //
            // 量測（bb-throughput.mjs 第 1 關 180 秒，第五十四輪之後）：
            //   存活 180s、放彈 0 顆、產能 0.0%、可達集合 3.0 格
            //   可殺站位 0.00 個（0 站位的幀數 10800 = 100%）
            //   UNSTUCK 10710 幀（99.2%）、格座標變化 1 次
            //   20s~90s 取樣完全一致：g=(1,2) plan=NONE tp=0 off=(26,84)
            //
            // 第 1 關的瓶頸不是「區域太小不該開路」，
            // 而是「**永遠沒有站位、所以永遠走不到開路的位置**」：
            // spots 為空 → 2a/2b 都不走 → smallRegion 擋掉 carveTowardKillSpot
            // → 只剩 approachNearestEnemy，而它也需要走過去。
            //
            // 3 格的口袋是第 1 關的**起始狀態**，不是意外。
            // 永遠不炸開第一面牆，就永遠是 3 格 —— 這是死鎖。
            //
            // 正確判準：**只有在「還有站位可打」時才挑剔區域大小**。
            // 沒有站位時，唯一能擴大區域的動作就是開路，
            // 此時不放彈就永遠出不來 —— 那 3 格才是真正必死的地方。
            //
            // 這與「收緊安全標準」不衝突：開路本身仍走
            // canSafelyPlaceBomb + 幾何死路檢查 + 隊友檢查，
            // 只放能炸開牆又不會死的炸彈。差別是「不因為區域小就放棄開路」。
            const smallRegion = reach.size < 10 && spots.length > 0;

            // ===== 第六十輪（決定性）：站位存在但走不到時，必須開路 =====
            //
            // 決定性實測（bb-journey.mjs 6 局 × 3 模式）：
            //   SINGLE  平均死在第 1.0 關、6/6 局全死在第 1 關、全破 0
            //   COOP    同上
            //
            // bb-autopsy 第 1 關 seed 4242 / 120 秒：
            //   放彈 1 顆、走過 3 格、淨位移 36.8px
            //   CORE_MOVE 4617 幀（64.1%）、nudgingOffCenter 95.6%
            //   alignToClearCorner 呼叫 2358 次
            //
            // 第 1 關的結構（bb-map.mjs）：13x11、43 格地板、
            // **從出生點只走得到 3 格**、6 個可殺站位**全部在牆外**。
            //
            // 所以 collectKillSpots 恆回空（它只枚舉 reach 內的站位），
            // 每幀都走「開路」分支。但開路要先走到 stand=gate 前一格，
            // 而 3 格口袋裡那個位置**物理上走得到、走不到**——
            // 於是 CARVE_MOVE 佔了大半時間，放彈只有 1 顆。
            //
            // 這裡補上「站位存在（牆外）但當前位置只有開火能力」時，
            // 直接檢查「站在當前格能不能炸開通往那個站位的路」。
            // 也就是把「要走過去」與「炸開路」並列，而不是排隊。
            //
            // 這不放寬任何規則：仍然是炸軟磚、仍然要 canSafelyPlaceBomb
            // 通過、仍然排除幾何死路、仍然檢查隊友。
            if (spots.length === 0 && reach.size <= 6) {
                if (this.carveTowardKillSpot()) return;
            }

            if (spots.length > 0) {
                // --- 2a. 已經站在可殺站位 → 炸 ---
                //
                // ===== 第五十一輪（決定性）：放彈當下就鎖定撤退路線 =====
                //
                // 決定性實測（bb-throughput.mjs 第 15 關 120 秒，第五十輪之後）：
                //   可達集合 57.1 格、可殺站位 15.73 個
                //   CORE_MOVE 310 幀、CORE_BOMB 只有 3 幀、FLEE 861 幀（58.9%）
                //
                // 這三個數字放在一起就是完整的因果鏈：
                //   站位有 15.73 個 → 幾乎都在走向站位（CORE_MOVE 310）
                //   但真正站上去放彈只有 3 幀
                //   而 FLEE 佔 861 幀（58.9%），遠多於任何攻擊狀態
                //
                // FLEE 佔這麼高不是因為怪物（guardAgainstLethalMonster 實測 0 次），
                // 而是因為 bombCoversCell：腳下有活彈就必須撤退。
                // 也就是說：**它放的每一顆炸彈都讓自己損失整整 3 秒**，
                // 3 秒之後回到攻擊決策 → 又在走向站位的中途被下一顆打斷。
                //
                // 更深一層的問題：canSafelyPlaceBomb 回傳的 esc.path
                // 設定進 targetPath 之後，下一幀 think() 的 FLEE 分支
                // 會用 findGlobalEscapePath **覆蓋它**，
                // 而 findGlobalEscapePath 的 BFS 沒有做 canPhysicallyMove 檢查，
                // 常常回傳「理論上安全、實際走不到」的路徑。
                // 於是撤退路線每幀被改寫，實際上沒走出來。
                //
                // 修正：放彈的同時把「撤退路線」鎖進 blastEscape，
                // 只要還在活彈火場裡就**優先用它**，不再重新規劃。
                // 這與 escapeCommitted 是同一個設計原理，
                // 只是對象從「怪」換成「自己剛放的炸彈」。
                const here = spots.find(s => s.x === this.gridX && s.y === this.gridY);
                if (here) {
                    const pierce = this.hasSuperBomb();
                    const shape = this.getMyExplosionShape();
                    const esc = this.canSafelyPlaceBomb(this.gridX, this.gridY,
                        this.fireRange, pierce, shape);
                    const cells = this.getExplosionCells(this.gridX, this.gridY,
                        this.fireRange, pierce, shape);

                    // ===== 第五十三輪：站定時用「預測位置」確認值不值得放 =====
                    //
                    // spots 已經把未來位置納入評分，所以站上站位不代表
                    // 「此刻真的有怪在射程內」—— 怪的當下位置可能已經走開，
                    // 放下去就是白放一顆、再損失 3 秒撤退時間。
                    //
                    // 這裡在放彈前確認「當下或預測上有怪會被打到」，
                    // 都沒有就不放 —— 寧可多走一步，也不要空放。
                    // 這不放寬安全標準，是收緊：只在確定有收益時才付出代價。
                    let willHit = false;
                    for (const o of live) {
                        if (!o || o.isDead) continue;
                        if (cells.has(`${o.gridX},${o.gridY}`)) { willHit = true; break; }
                    }
                    if (!willHit) {
                        for (const o of live) {
                            // 第六十九輪：速度從真實怪物 o.monster 讀（見 collectKillSpots）
                            const osrc = o.monster || o;
                            const vx = (osrc._aiLastX !== undefined) ? (o.x - osrc._aiLastX) : 0;
                            const vy = (osrc._aiLastY !== undefined) ? (o.y - osrc._aiLastY) : 0;
                            if (Math.abs(vx) < 0.01 && Math.abs(vy) < 0.01) continue;
                            const sdx = Math.sign(vx), sdy = Math.sign(vy);
                            for (let t = 1; t <= 2; t++) {
                                if (cells.has(`${o.gridX + sdx * t},${o.gridY + sdy * t}`)) {
                                    willHit = true; break;
                                }
                            }
                            if (willHit) break;
                        }
                    }

                    if (willHit && esc && esc.canEscape && !this.isTeamMateInDangerZone(cells)) {
                        // 第二十輪：幾何死路必須擋下來（不依賴角色位置，無條件成立）
                        if (this.blastCoversEntireReachable(this.gridX, this.gridY)) {
                            this.aiInput.bomb = false;
                            this.targetPath = [];
                            this.state = 'CORE_BOMB_BLOCKED';
                            return;
                        }
                        this.aiInput.bomb = true;
                        // 鎖定撤退路線（第五十一輪）
                        this.blastEscape = {
                            path: esc.path.slice(),
                            // 第五十七輪：到火焰完全熄滅為止（見另一處的說明）
                            until: this.time + this.getFuseTime() + 1.2,
                            // 第五十六輪：撤退終點本身就是下一個攻擊起點，
                            // 它已經被驗證是「炸完能活」的位置。
                            nextGoal: esc.safeCell ?
                                { x: esc.safeCell.x, y: esc.safeCell.y } : null,
                        };
                        this.targetPath = esc.path.slice();
                        this.state = 'CORE_BOMB';
                        return;
                    }
                }

                // --- 2b. 走向最佳站位 ---
                //
                // ===== 第五十六輪（決定性）：走向站位時就同步規劃「到位後立刻放」=====
                //
                // 量測（bb-modes.mjs 10 局，第五十五輪之後）：
                //   SINGLE 1  avgSec 131.2 / avgLeft 2.3
                //   SINGLE 15 avgSec 34.0  / avgLeft 8.9
                //   COOP   15 avgSec 44.6  / avgLeft 6.5
                //
                // avgLeft 全面下降代表「有進展」，但 avgSec 從 219 掉到 131，
                // 代表它死得比以前快 —— 因為每一顆炸彈都要用 3 秒撤退，
                // 而它在撤退期間完全不能攻擊。
                //
                // 也就是說：**放彈 = 3 秒不能打**。這個成本是固定的，
                // 唯一能壓縮的是「站到能打的格子所需的時間」。
                //
                // 目前：先花時間走到站位 → 站定 → 重新評估 → 放彈。
                // 若能在「還差幾格就到位」時就決定好放彈，
                // 就能把「到位」與「放彈」之間的延遲降到 0。
                //
                // 這裡記錄承諾的站位與它當下的距離；
                // followPath 的偏移機制（第四十五輪）已經有時間上限，
                // 不會再出現「走到一半被卡住」的情況。
                const best = this.pickBestSpot(spots);
                if (best && (best.x !== this.gridX || best.y !== this.gridY)) {
                    this.moveGoal = { x: best.x, y: best.y };
                    const p = this.aStar(this.gridX, this.gridY, best.x, best.y, false);
                    if (p && p.length && pathIsSafe(this, p)) {
                        this.targetPath = p;
                        this.state = 'CORE_MOVE';
                        return;
                    }
                }

                // 站著不安全又走不過去 → 先脫離腳下危險，再重新規劃
                if (this.trySmartFlee()) { this.state = 'FLEE'; return; }
            }

            // --- 3. 一個站位都到不了 → 朝站位方向炸開第一面牆 ---
            //
            // 注意：開路失敗時「不要」掉去 tryGather()。
            // 實測（bb-throughput.mjs，第 1 關 120 秒 COOP）：
            //   GATHER 佔 2848 幀 / 39.6%，而怪物還活著。
            // 那是因為開路只要有一幀失敗就掉去撿道具，
            // 等於把「打不到怪」誤判成「沒事做」。
            // 場上有怪卻打不到，正確的結論是「繼續想辦法靠近」，
            // 不是「去拿道具」。
            if (!smallRegion && this.carveTowardKillSpot()) return;

            // 開路也走不通 → 往最近那隻怪的方向移動（朝著牆走也會推進開路）
            this.approachNearestEnemy(live);
            return;
        }

        // --- 4. 場上沒怪 → 收集 / 安全巡邏 ---
        if (this.tryGather()) return;
        this.state = 'CORE_PATROL';
        this.patrolToSafeArea();
    }

    /**
     * 朝最近的怪物推進（放寬版：允許軟磚當高成本路徑）。
     *
     * 這是「炸路」與「攻擊」都失敗時的最後手段——
     * 站在原地永遠打不到怪，往怪的方向走至少會讓開放區逐步擴大。
     * 它不會放彈（放彈一律由 canSafelyPlaceBomb 把關），
     * 所以不會引入任何自殺行為。
     */
    approachNearestEnemy(live) {
        let target = null, bestD = Infinity;
        for (const m of live) {
            const d = Math.abs(m.gridX - this.gridX) + Math.abs(m.gridY - this.gridY);
            if (d < bestD) { bestD = d; target = m; }
        }
        if (!target) return false;

        // 優先走到「與怪同行/同列」的位置（那才是能開火的地方）
        const spots = [];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            for (let d = 1; d <= this.fireRange; d++) {
                const gx = target.gridX + dx * d, gy = target.gridY + dy * d;
                if (gx < 1 || gy < 1 || gx >= this.gridSystem.cols - 1 || gy >= this.gridSystem.rows - 1) break;
                if (!this.isWalkableCell(gx, gy)) break;
                spots.push({ x: gx, y: gy, d: Math.abs(gx - this.gridX) + Math.abs(gy - this.gridY) });
            }
        }
        spots.sort((a, b) => a.d - b.d);
        for (const s of spots) {
            if (s.x === this.gridX && s.y === this.gridY) continue;
            this.moveGoal = { x: s.x, y: s.y };
            const p = this.aStar(this.gridX, this.gridY, s.x, s.y, false);
            if (p && p.length && pathIsSafe(this, p)) {
                this.targetPath = p;
                this.state = 'CORE_ADVANCE';
                return true;
            }
        }
        // 連同列的位置都走不到 → 至少往怪的方向走一步
        const dirs = [];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = this.gridX + dx, ny = this.gridY + dy;
            if (!this.isWalkableCell(nx, ny)) continue;
            const gain = (Math.abs(target.gridX - this.gridX) + Math.abs(target.gridY - this.gridY)) -
                         (Math.abs(target.gridX - nx) + Math.abs(target.gridY - ny));
            dirs.push({ dx, dy, gain });
        }
        dirs.sort((a, b) => b.gain - a.gain);
        for (const d of dirs) {
            if (d.gain <= 0) break;
            if (this.canPhysicallyMove(d.dx, d.dy)) {
                if (d.dx > 0) this.aiInput.right = true; else if (d.dx < 0) this.aiInput.left = true;
                if (d.dy > 0) this.aiInput.down = true; else if (d.dy < 0) this.aiInput.up = true;
                this.state = 'CORE_ADVANCE';
                return true;
            }
        }
        return false;
    }

    /** 舊的 15 層優先序決策鏈，已停用（保留作為參考，think() 不再呼叫） */
    legacyThink() {
        // ===== 逃離承諾（遲滯 / hysteresis）：還在火場裡就不要重新規劃 =====
        //
        // 實測（決定性）：這是控制理論上的「抖振（chattering）」失效模式。
        // 加入「站進火場就立刻撤退」之後，TIMEOUT 從 5 降到 1（震盪消失），
        // 但死亡反而從 15 升到 19，逐幀軌跡顯示原因是：
        //
        //   f1213 GATHER  pos=(7,1) danger=0  path=2
        //   f1219 FLEE    pos=(7,1) danger=0  path=1
        //   f1225 FLEE    pos=(7,1) danger=0  path=0
        //   f1231 UNSTUCK pos=(7,1) danger=0  path=0
        //   f1237 GATHER  pos=(7,1) danger=0  path=2     ← 又走回火場
        //   f1273 FLEE    pos=(7,2) danger=50             ← 被自己的火掃到
        //
        // 也就是說：FLEE 把它拉出來 → GATHER 又把它拉回去 → UNSTUCK 換方向
        // → 三個互相矛盾的目標每幀重算一次，角色在兩格之間來回抽屜，
        // 永遠走不出火場。
        //
        // 根本原因：這是一個 bang-bang 控制器（只有「逃／不逃」兩態），
        // 卻沒有一點遲滯。任何單一物件的決策都會被下一幀的另一個決策推翻。
        //
        // 正確做法（混合系統的標準做法）：一旦決定逃，就**承諾**走完這條路，
        // 直到「確定已經離開所有活彈的火場」才解除承諾。
        // 承諾期間不允許 GATHER / UNSTUCK / 任何其他目標插話。
        //
        // 這完全不改動遊戲規則：只是讓 AI 把「已經決定好的撤退」真正走完。
        if (this.escapeCommitted) {
            // ===== 承諾必須有「到期」與「沒進展就放棄」兩道保險 =====
            //
            // 實測教訓：只判斷「還在火場裡 && 有路徑」會造成永久凍結。
            // 因為若路徑被物理擋住（走不動），targetPath 永遠不會變短，
            // 承諾就永遠成立 → AI 每幀都「保持承諾」但一步都沒走。
            // 實測曾出現連續 6322 幀（105 秒）格座標完全不變，整局報廢。
            //
            // 所以除了「已經安全」，還必須檢查：
            //   1) 時間到期（承諾本來就該是短期的）
            //   2) 有沒有實際進展（有路徑卻走不動 → 路徑是壞的）
            const expired = this.time > this.escapeCommitDeadline;
            // 第六十五輪：與 think() 開頭同一個語意修正（見該處完整說明）
            const returned = this._escapeHasMoved &&
                this.gridX === this.escapeCommitFromX &&
                this.gridY === this.escapeCommitFromY;
            if (this.gridX !== this.escapeCommitFromX ||
                this.gridY !== this.escapeCommitFromY) {
                this._escapeHasMoved = true;
            }
            const noProgress = returned;
            if (!expired && !noProgress &&
                this.isInsideLiveBlast() && (this.targetPath || []).length > 0) {
                // 還在火場裡、有撤退路徑、而且還有進展 → 保持承諾，
                // 讓 update() 的 followPath() 繼續走。不做任何重新規劃。
                this.state = 'FLEE';
                return;
            }
            // 已經安全／到期／走不動 → 解除承諾，恢復正常決策
            this.escapeCommitted = false;
            this._escapeHasMoved = false;
        }

        this.resetInput();

        // ========== 安全過濾器：硬約束優先於所有軟目標 ==========
        //
        // 必須排在「攻擊規劃器」之前。實測抓到的原始順序是
        //   planAttack()        （第 1449 行）→ state = 'SNIPE' / 'ATTACK_ADVANCE'
        //   hasMonsterThreat()  （第 1487 行）→ state = 'FLEE'
        // 也就是「攻擊」排在「怪物生存反應」之前。
        //
        // 結果：怪物已經貼到 0.12 格（致死距離是 0.8 格）時，
        // AI 狀態仍然是 SNIPE / ATTACK_ADVANCE，怎麼打都是死。
        // 逐幀軌跡實測該場景持續 70+ 幀，最後被撞死。
        //
        // 這裡不去搬動既有程式碼（風險高），而是建立一個「入口不變量」：
        //   只要當下就會輸，絕不允許進入任何攻擊狀態。
        // 這是最佳化理論的基本分工——安全是硬約束，攻擊效益是軟目標，
        // 硬約束的優先級必須高於軟目標。
        if (this.guardAgainstLethalMonster()) {
            return;
        }
        
        // ========== PRIORITY 0: 檢查即時生存威脅（立即逃開炸彈與火焰） ==========
        const myDanger = this.dangerMap.getDangerInfo(this.gridX, this.gridY);
        
        // 腳下有炸彈要爆炸了
        if (this.bombManager.hasBombAt(this.gridX, this.gridY)) {
            const bomb = this.bombManager.getBombAt(this.gridX, this.gridY);
            if (bomb) {
                // 1. 如果是自己的炸彈且引信時間短，立即逃離
                if (bomb.player === this && bomb.timer < 1.5) {
                    const escapeResult = this.fleeFromBombUnderfoot();
                    if (escapeResult === true) {
                        this.state = 'FLEE';
                        return;
                    } else if (escapeResult && escapeResult.path && escapeResult.path.length > 0) {
                        this.targetPath = escapeResult.path;
                        this.state = 'FLEE';
                        this.commitToEscape();
                        return;
                    }
                }
                // 2. 如果是敵人的炸彈在腳下，優先逃離
                else if (bomb.player !== this) {
                    const escapeResult = this.fleeFromBombUnderfoot();
                    if (escapeResult === true) {
                        this.state = 'FLEE';
                        return;
                    } else if (escapeResult && escapeResult.path && escapeResult.path.length > 0) {
                        this.targetPath = escapeResult.path;
                        this.state = 'FLEE';
                        return;
                    }
                }
                // 3. 預判式撤離：引信還沒短到 1.5s，但已經在倒數。
                //
                // 實測發現舊 AI 會站在自己的炸彈上「等」到 timer<1.5 才反應，
                // 中間整整 1.35 秒站在即將爆炸的位置上，還反覆因為「還沒到 1.5s」
                // 而重新規劃路線，結果一步都沒走出去。
                //
                // 引線只有 3 秒、爆炸會涵蓋整個十字，所以只要腳下是自己的炸彈，
                // 就立刻往安全格撤退。這不影響任何遊戲規則，只是把決策提前，
                // 讓「放彈 → 撤退」這個動作真的能完成。
                else if (bomb.player === this && bomb.timer < this.getFuseTime()) {
                    const escapeResult = this.fleeFromBombUnderfoot();
                    if (escapeResult === true) {
                        this.state = 'FLEE';
                        return;
                    } else if (escapeResult && escapeResult.path && escapeResult.path.length > 0) {
                        this.targetPath = escapeResult.path;
                        this.state = 'FLEE';
                        return;
                    }
                }
            }
        }

        // ===== 站在任何一顆「還在倒數的炸彈」的火場裡 → 立刻撤退 =====
        //
        // 實測（決定性，這是剩下最大的死因）：
        // 舊版門檻是 `myDanger.explosionTimer < 1.5`，
        // 等於「已經站進火場之後，還要再等 1.5 秒才開始跑」。
        //
        // 逐幀軌跡抓到這個場景（20 局量測）：
        //   pos=(7,2) solid=0 danger=100 free=RLDU path=0 bombs=2
        //   pos=(7,2) solid=0 danger=100 free=RLDU path=0 bombs=2   ← 重複 110+ 幀
        //
        // 逐項拆解這一幀：
        //   solid=0  → 角色不在牆裡
        //   free=RLDU→ 四個方向「全部」物理可走
        //   danger=100 → 這格同時被兩顆活彈的火場覆蓋（50+50）
        //   path=0   → 卻沒有任何撤退路徑
        //
        // 也就是說：角色站在必死格裡、手上有四條出路，卻什麼都沒做，
        // 在 WALL_DEFEND / UNSTUCK 之間震盪了 18 秒，最後被自己的火燒死。
        //
        // 為什麼門檻該是「站進去就出局」而不是「快爆了才跑」：
        //   提前離開的邊際成本幾乎是 0（只多走一格）；
        //   延遲離開的邊際成本是「整局結束」。
        // 這是不變量：只要目前所在格被任何活彈覆蓋，就必須「立刻」開始移動。
        const bombCoversCell = this.getMinBombExplosionTimeAt(this.gridX, this.gridY) < Infinity;
        if (myDanger.isFlameActive || bombCoversCell ||
            (myDanger.dangerLevel > 0 && myDanger.explosionTimer < 1.5)) {
            // 找到全域安全路徑
            const escapePath = this.findGlobalEscapePath();
            if (escapePath && escapePath.path.length > 0) {
                this.targetPath = escapePath.path;
                this.state = 'FLEE';
                // 承諾走完這條撤退路線，避免被 GATHER / UNSTUCK 每幀推翻
                this.commitToEscape();
                return;
            }

            // 找不到完整路徑，找最近安全方向移動
            if (this.trySmartFlee()) {
                this.state = 'FLEE';
                return;
            }

            // 連貪心方向都找不到 → 至少踏出一步。
            //
            // 站在火場裡「不動」是 0 收益的選擇：不會更安全，只會保證被掃到。
            // 即使找不到完美路線，也應該朝「離火場最遠」的那一格先走一步，
            // 讓下幀重新規劃時至少有一個不同的起點（否則會無限震盪在原地）。
            if (this.stepOutOfBlastCell()) {
                this.state = 'FLEE';
                return;
            }
        }
        
        // ========== PRIORITY 1: 檢查是否會被即將爆炸的炸彈波及（1秒內） ==========
        const minBombTime = this.getMinBombExplosionTimeAt(this.gridX, this.gridY);
        if (minBombTime < 1.0) { // 1秒內會爆炸且我在此範圍
            // 5秒內被狙擊，立即逃離！
            const escapePath = this.findGlobalEscapePath(2.0);
            if (escapePath && escapePath.path.length > 0) {
                this.targetPath = escapePath.path;
                this.state = 'FLEE';
                return;
            }
        } else if (minBombTime < this.getFuseTime() && minBombTime < 2.5 && !this.isCellSafe(this.gridX, this.gridY, 0)) {
            // 即將被炸彈波及，需要移動
            const escapePath = this.findGlobalEscapePath();
            if (escapePath && escapePath.path.length > 0) {
                this.targetPath = escapePath.path;
                this.state = 'FLEE';
                return;
            }
        }
        
        // ========== PRIORITY 0.4：以期望效用決定要不要開火 ==========
        //
        // 實測（決定性）：狀態分布長期只有 FLEE / PATROL / BREAK_WALLS /
        // WALL_DEFEND / GATHER，完全沒有任何攻擊狀態；
        // 20 顆炸彈裡「火場內曾出現怪物」= 0 次。
        // 也就是說 AI 一次都沒有主動朝怪物開火，擊殺自然是 0。
        //
        // 根因是「優先序」而不是權重：
        //   trySmartFlee()（怪物威脅）在 think() 裡排在所有攻擊策略之前，
        //   只要判定要躲就直接 return，把後面整排攻擊分支全部短路掉。
        //   實測 FLEE 佔 71/126 次決策，SNIPE 一次都沒出現過。
        //
        // 修正：把「開火決策」提到怪物防禦之前。
        // 但要保留「腳下有炸彈 / 火焰正在燒」這類真正的生死狀況優先（見上方）。
        //
        // 這不意味著要魯莽：planner 內部仍然用期望效用比較
        // 「擊殺收益」與「撤退失敗風險」，撤離評估照舊使用時間感知 BFS。
        // 注意：這裡刻意不寫 `this.currentBombs < this.maxBombs`。
        //
        // 實測（決定性）：加上那個守衛之後，所有測試結果「位元組完全相同」，
        // 狀態分布完全沒有出現 ATTACK_ADVANCE / SNIPE。
        //
        // 原因是 Bot.js 裡 maxBombs 只被「讀取」（8 處 `currentBombs >= maxBombs`）
        // 卻從未被賦值 → maxBombs 是 undefined →
        // `this.currentBombs < undefined` 恆為 false → 整個開火決策永遠被擋掉。
        //
        // 這也代表那些「炸彈數量上限」的守衛從來沒有真正生效過
        // （`undefined >= undefined` 為 false，條件一律不成立）。
        // 真正的炸彈數量是由 Player/BombManager 內部管理的，
        // placeBomb 會自己處理，所以這裡不需要重複判斷。
        if (this.getEnemies().length > 0) {
            this._p04count = (this._p04count || 0) + 1;   // 診斷用：確認此區塊是否真的被執行
            const plan = planAttack(this);
            this.lastAttackPlan = plan;
            const cand = plan.best;
            if (cand && cand.value > 0) {
                this._p04found = (this._p04found || 0) + 1;
                if (this.gridX === cand.bombX && this.gridY === cand.bombY) {
                    this.resetInput();
                    this.aiInput.bomb = true;
                    this.targetPath = cand.escapePath.slice();
                    this.state = 'SNIPE';
                    this.thinkTimer = 0;
                    return;
                }
                if (cand.approachPath.length > 0) {
                    this.targetPath = cand.approachPath.slice();
                    this.state = 'ATTACK_ADVANCE';
                    this.pendingAttack = cand;
                    return;
                }
            }
        }

        // ========== PRIORITY 0：怪物逼近的生存反應 ==========
        //
        // 實測（最主要的死因）：Bot 在 (4,1) 與怪物曼哈頓距離 0，
        // AI 每幀在 L / R 之間翻轉、位置在 (3,1) ↔ (4,1) 震盪 240 幀（4 秒），
        // 火焰=0、腳下彈=0，全程沒有被任何爆炸碰到 —— 純粹是被怪物撞到，
        // HP 3 → 2 → 1 → 0 慢慢磨死，7/8 局在 9~15 秒內 DEAD。
        //
        // 原因：trySmartFlee() 原本只被呼叫在
        // 「myDanger.isFlameActive 或即將爆炸」兩個條件之下（第 1175 行附近），
        // 也就是說「怪物貼上來」這種情況根本不會觸發任何撤退邏輯 ——
        // 而怪物碰撞是 checkPlayerCollision() 裡的瞬間擊殺，
        // 根本沒有時間讓 AI 反應。
        //
        // 修正：在所有攻擊策略之前，先檢查有沒有怪物已經貼到會撞到的距離，
        // 有的話立刻拉開距離。這只是讓 AI 用自己的移動機制走開，
        // 沒有改動怪物速度、碰撞半徑、傷害或 HP 等任何遊戲規則。
        if (this.hasMonsterThreat()) {
            // ===== 已有逃離路徑就持續走，不要每幀重新規劃 =====
            //
            // 實測（決定性）：Bot 在 (5,1)，HP=1，怪距從 76.7 一路降到 69.1，
            // threat=true 但位置完全不動、連續 20+ 幀零位移。
            //
            // 原因：每幀重新呼叫 planMonsterEscape()，
            // 而 BFS 要求「找到離所有怪物都 > 2 格的安全格」才回傳路徑。
            // Bot 已經在 (5,1)、怪物也很近，BFS 常常找不到符合條件的安全格就回傳 null，
            // 於是每幀都重新計算、每幀都失敗、每幀都原地不動 ——
            // 「想逃但逃不掉」比「不逃」更糟，因為連一格都沒拉開距離。
            //
            // 修正：一旦規劃出逃離路徑，就把它走完（走完或失效才重新規劃）。
            // 這樣 AI 每幀都在真正前進、距離一定會拉開。
            if (this.monsterEscapePath && this.monsterEscapePath.length > 0) {
                const nextEsc = this.monsterEscapePath[0];
                const edx2 = Math.sign(nextEsc.x - this.gridX);
                const edy2 = Math.sign(nextEsc.y - this.gridY);

                // 已經站在下一格 → 把它移出佇列，繼續往後走
                if (edx2 === 0 && edy2 === 0) {
                    this.monsterEscapePath.shift();
                } else if (this.canPhysicallyMove(edx2, edy2)) {
                    if (edx2 > 0) this.aiInput.right = true;
                    else if (edx2 < 0) this.aiInput.left = true;
                    else if (edy2 > 0) this.aiInput.down = true;
                    else this.aiInput.up = true;
                    // 每幀走一步，並移除已經抵達的節點
                    this.monsterEscapePath.shift();
                    this.state = 'FLEE';
                    return;
                } else {
                    // 方向走不動 → 放棄這條路徑重新規劃
                    this.monsterEscapePath = null;
                }
            }

            const escapePlan = this.planMonsterEscape();
            if (escapePlan && escapePlan.path.length > 0) {
                this.monsterEscapePath = escapePlan.path.slice();
                const nextE = this.monsterEscapePath.shift();
                const edx = Math.sign(nextE.x - this.gridX);
                const edy = Math.sign(nextE.y - this.gridY);
                if (edx !== 0 || edy !== 0) {
                    if (edx > 0) this.aiInput.right = true;
                    else if (edx < 0) this.aiInput.left = true;
                    else if (edy > 0) this.aiInput.down = true;
                    else this.aiInput.up = true;
                }
                this.targetPath = this.monsterEscapePath.slice();
                this.state = 'FLEE';
                this.thinkTimer = 0;
                return;
            }
            if (this.trySmartFlee()) {
                this.state = 'FLEE';
                return;
            }
            // 拉不開距離 → 至少往物理走得動的方向挪一步
            const escapeDirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (const [edx, edy] of escapeDirs) {
                if (!this.canPhysicallyMove(edx, edy)) continue;
                if (edx > 0) this.aiInput.right = true;
                else if (edx < 0) this.aiInput.left = true;
                else if (edy > 0) this.aiInput.down = true;
                else this.aiInput.up = true;
                this.targetPath = [];
                this.state = 'FLEE';
                return;
            }
        }

        // 注意：原先掛在這裡的「期望效用攻擊規劃器」已停用，
        // 原因見下方 PRIORITY 0.5 的說明區塊。
        // 決策核心重寫時會以「走廊阻斷」形式重新整合。

        // ================================================================
        // PRIORITY 0.5（攻擊規劃器）—— 暫時停用
        // ================================================================
        //
        // 停用原因（實測，非推測）：
        //   掛上之後，SINGLE 擊殺 0.1 → 0.0、COOP 擊殺 1.3 → 0.0、VS 0.8 → 0.0，
        //   而存活時間反而變長（COOP 70s → 99s）。也就是說 planner 把 AI 推回
        //   「純粹苟活」—— 正是這個遊戲最不需要的行為。
        //
        // 根本原因：Stage 1 的怪物是
        //   ASSASSIN/chase speed=4 ×2 + SPIDER/random speed=2.5，
        //   「每路口隨機轉向 + 主動追人 + 引信 3 秒」這個組合，
        //   讓「一步前瞻 + 期望效用」算出來的方案，命中率遠低於
        //   原本那種「把炸彈直接放在怪物正旁邊」的做法 ——
        //   後者雖然不保證，但怪物會自己走進去，實際命中率更高。
        //
        // planner 本身（src/game/ai/attackPlanner.js）保留，
        // 會在決策核心重寫時以「走廊阻斷」的形式重新整合，
        // 因為它列舉候選站位與評估撤離的框架是可用的，
        // 缺的是「把炸彈下在怪物必須經過的位置」這個概念。
        //
        // const plan = planAttack(this);            // ← 暫時不掛載
        // this.lastAttackPlan = plan;
        // ...（其餘邏輯保留在 attackPlanner.js，未刪除）
        // ================================================================

        // ================================================================
        // （說明：ensureSomeAction() 放在 think() 的最後、PATROL 之後執行，
        //   因為它必須在「所有優先序都沒有設定方向」時才接手。）

        // ===== 第九輪：真正的空閒行為 —— 朝怪物推進 =====
        //
        // 決定性實測（bb-stage1.mjs，第 1 關，6 場）：
        //   平均存活 97.6 秒、放彈 1.8 顆、擊殺 0.17 隻、剩 2.8 隻
        //   與怪物的最近距離 = 5 格（從不靠近）
        //
        // 關鍵計算：97.6 秒 x 0.333 顆/秒 = 最多能放 32 顆，
        // 而它只放了 1.8 顆 = 產能的 5.6%。
        // 成因是 maxBombs=1：放一顆後要等 3 秒爆炸才有下一顆，
        // 所以絕大多數時間它「手上沒炸彈、也不知道該去哪」。
        //
        // 而它為什麼找不到能炸到怪的站位？因為它從不靠近：
        // state 在 WALL_DEFEND / PATROL / FLEE / BREAK_WALLS 之間震盪，
        // 位置只在出生點附近 2~3 格內打轉，與怪物的距離維持 5~8 格。
        //
        // 修正：當「手上沒有炸彈可用」且「沒有任何緊急危險」時，
        // 主動朝最近的怪物推進到「站上去能炸到它」的距離。
        // 這不是新策略，而是補上決策鏈缺失的最後一環：
        // 之前的策略都在「已經在某個位置」時做取捨，沒有一個負責「移動到好位置」。
        if (this.currentBombs >= this.maxBombs) {
            if (this.advanceTowardKillSpot()) {
                return;
            }
        }

        // ========== PRIORITY 0.1: 保證炸彈命中（單點修正）==========
        //
        // ===== 決定性實測依據（bb-probe + bb-whykill，第 15 關）=====
        //
        // 基準線：存活 26.5 秒、放彈 5 顆、殺死 0 隻怪、還剩 8 隻。
        //
        // 炸彈數量不是瓶頸（由遊戲規則直接算出，不是估計）：
        //   maxBombs=1（Player.js:25）+ 引信 3 秒（Bomb.js:16/77）
        //   => 每 3 秒才能放一顆 = 0.333 顆/秒
        //   => 26.5 秒上限 8.8 顆，實際放 5 顆 = 上限的 57%
        //
        // 所以 5 顆炸彈一顆都沒炸到東西 —— 這是純粹的瞄準失敗。
        //
        // 而命中機率早已量過（bb-mc2.mjs，546 顆炸彈樣本）：
        //   火焰蓋住怪物「當下的格」 => 46/46 = 100.0% 擊殺
        //   其他條件                 => 16.2% 基準命中率
        //
        // 也就是說：站對位置就必定擊殺，站錯就幾乎打不到。
        // 那麼唯一要做的事就是「放的每一顆炸彈都必須蓋住某隻怪當下的格」。
        //
        // 實作放在 think() 的最前面（PRIORITY 0.1）：
        //   1. 枚舉所有「與任一隻怪同行/同列、距離 <= fireRange」的格子
        //      —— 這是十字形爆炸物理上唯一可能命中的位置集合；
        //   2. 挑一個「炸完能活」的（canSafelyPlaceBomb）；
        //   3. 站得到就放，站不到就走過去。
        //
        // 為什麼放最前面：後面每一層都會 return，
        // 實測 trySnipeAttack 65% 的時候會攔截，
        // 排在後面等於永不執行（這是今天實測踩過的坑）。
        //
        // 不改動任何遊戲規則：只是讓 Bot 選站位時，
        // 從「附近隨便找」改成「一定找得到怪的格子」。
        if (this.tryGuaranteedHitBomb()) {
            return;
        }

        // ========== PRIORITY 2: 主動踢炸彈攻擊 ==========
        if (this.hasKick && this.tryKickAttack()) {
            this.state = 'KICK_ATTACK';
            return;
        }
        
        // ========== PRIORITY 3.45: 走廊脫困 ==========
        // 被困在「上下都是硬磚」的走廊、左右橫跳無法定格時，
        // 用炸彈炸開擋路的軟磚走出去。沒有這一步，AI 會在走廊裡
        // 無限來回，600 秒殺不到任何怪物（實測）。
        if (this.tryCorridorEscape()) {
            return;
        }

        // ========== PRIORITY 3.4: 期望收益炸彈站位（全域評分）==========
        //
        // ===== 第七輪：這是整個遊戲真正的瓶頸所在 =====
        //
        // 探針實測（第 15 關，1588 幀 / 26.5 秒）：
        //   bombs placed            = 5      （8 隻怪一隻沒殺）
        //   trySnipeAttack 候選篩選：
        //     沒有炸彈容量可用 = 29   <-- 唯一非零的攔路虎
        //     站位全是牆/活彈   = 0
        //     被火焰/怪物擋掉   = 0
        //     炸得到但無法逃   = 0
        //     完全接受（可開火）= 0
        //   empty targetPath = 49.2%、distinct cells = 25、cell-change = 7.6%
        //
        // 解讀：trySnipeAttack 只看「自己 + 四鄰」五個格子，
        //   幾乎永遠找不到既炸得到怪又能逃的站位，於是長期空手。
        //   同時 SNIPE_MOVE 佔 22.7%，代表它「決定要去」卻走不過去。
        //
        // 這裡改成「全域評分」：枚舉所有與某隻怪同行/同列、
        //   距離 <= fireRange 的格子（炸彈物理上唯一可能命中的位置），
        //   依「能殺幾隻 / 炸完能不能活 / 順便炸開幾面牆 / 距離」評分，
        //   並且要求「實際路徑安全」才會走過去。
        //
        // 必須排在 PRIORITY 3.5 trySnipeAttack 之前：
        //   trySnipeAttack 65% 的時候會 return true，排在後面永遠輪不到。
        if (this.tryGlobalBombScoring()) {
            return;
        }

        // ========== PRIORITY 3.5: 攻擊（能打到就直接打）==========
        //
        // 順序修正：這一組原本排在開路之後，實測造成 AI「只開路、不攻擊」——
        // tryBreach 幾乎每幀都會找到合法站位並回傳 true，於是 trySnipeAttack
        // 永遠輪不到執行；就算炸開了整張地圖的軟磚，也不會對怪物開一炮。
        // 超時的 7 局裡平均還剩 4 隻怪物、一隻都沒殺掉，就是這個原因。
        //
        // 攻擊優先於開路：能安全擊殺就該先打，打不到再想辦法開路。
        if (this.trySnipeAttack()) {
            return;
        }

        // ========== PRIORITY 3.55: 啃牆突圍（最優先的開路手段）==========
        //
        // 實測發現 tryBreach 反而會害 AI 卡住：它評分挑「一次能炸到最多軟磚」的
        // 位置，但那些位置常常遠離當前區域、走過去要繞路或根本走不到，
        // 於是 Bot 在幾個方案間反覆橫跳，放兩顆彈之後就停在 BREACH_MOVE 不動。
        //
        // ===== 第十輪：carveTowardKillSpot 排在最前面 =====
        //
        // 決定性實測（bb-map.mjs + bb-stage1.mjs，第 1 關）：
        //   空地 43 格，但從出生點走得到的只有 3 格；軟磚 36 塊。
        //   可殺站位 6 個，落在開放區內的 0 個。
        //   篩選漏斗 100% 通過（站位全部合格），但 aStar 163/163 回傳 null。
        //
        // 也就是說 Bot 被封在一個 3 格的口袋裡，而它所有的開路策略
        // （tryCarveTowardGoal / tryBreach / tryBreakWalls）都在問
        // 「我腳下的爆炸範圍有沒有軟磚」——在 3 格口袋裡這個問題
        // 常常 答案是「沒有」，於是全部 return false，Bot 就地空轉。
        //
        // carveTowardKillSpot 反過來問：
        // 「通往攻擊站位的路上，第一面擋路的軟磚在哪裡？」
        // 目標明確、有方向性，因此能真正把牆炸開、讓開放區逐步擴大。
        //
        // 它只在「完全沒有任何站位可以立刻走到」時才動作（內部安全閥），
        // 所以不會搶掉攻擊分支——能打的時候照打。
        if (this.carveTowardKillSpot()) {
            return;
        }

        if (this.tryCarveTowardGoal()) {
            return;
        }

        // ========== PRIORITY 3.6: 開路爆破 ==========
        // 目標被軟磚隔開時，先炸開擋路的牆。
        if (this.tryBreach()) {
            return;
        }

        // ========== PRIORITY 4: 用炸彈擋住追殺自己的怪物 ==========
        // 只有在自己絕對安全的情況下才嘗試
        if (this.tryBlockWithBomb()) {
            return;
        }
        
        // ========== PRIORITY 4: 牆壁防禦（附近有敵人但被牆擋住） ==========
        if (this.tryWallDefense()) {
            return;
        }
        
        // ========== PRIORITY 5: 陷阱敵人 ==========
        // 只有在不會犧牲自身安全的情況下才陷阱
        if (this.tryTrapEnemy()) {
            return;
        }
        
        // ========== PRIORITY 6: 牆壁控制（利用牆壁放炸彈殺敵） ==========
        if (this.tryWallControl()) {
            return;
        }
        
        // ========== PRIORITY 7: 安全獵殺 ==========
        // 只有在能安全逃脫的情況下才獵殺
        if (this.trySafeHunt()) {
            return;
        }
        
        // ========== PRIORITY 7.5: 反困（只在完全打不到任何怪時才出手）==========
        //
        // 必須排在 tryBreakWalls 之前，因為 tryBreakWalls 在狹小區域裡
        // 因為 canEscape 恆為假而永遠不動作，會把 Bot 永久卡在封閉區域裡。
        // （實測：第 10 關 420 秒時可達格只剩 36 格，7 隻怪全部在牆外。）
        if (this.tryBreakoutFromDeadZone()) {
            return;
        }

        // ========== PRIORITY 8: 炸軟磚開路 ==========
        // 只有在安全情況下才炸軟磚
        if (this.tryBreakWalls()) {
            return;
        }
        
        // ========== PRIORITY 9: 收集道具（安全時） ==========
        if (this.tryGather()) {
            return;
        }
        
        // ========== PRIORITY 10: 追擊遠處敵人 ==========
        if (this.tryChase()) {
            return;
        }
        
        // ========== PRIORITY 11: 最後手段 - 巡邏但絕不發呆 ==========
        //
        // 註：原本在這裡呼叫 ensureSomeAction()，實測呼叫次數為 0（死碼），
        // 因為前面的優先序分支會先 return。已移到 Bot.update() 的鏈路末端。
        // 即使巡邏也要確保安全，優先選擇有牆壁保護的方向
        this.state = 'PATROL';
        this.patrolToSafeArea();
    }

    // ==================== 逃脫系統 ====================

    /**
     * 從腳下炸彈逃脫（特別處理）
     * 返回 { path } 找到完整路徑，或 true 找到直接移動方向，或 false 失敗
     */
    fleeFromBombUnderfoot() {
        // 腳下是「自己的」炸彈時，退讓只需走出它的爆炸範圍
        const _under = this.bombManager.getBombAt(this.gridX, this.gridY);
        const myBomb = (_under && _under.player === this) ? _under : null;
        const timePerCell = 1 / this.getEffectiveSpeed();
        
        const queue = [{ x: this.gridX, y: this.gridY, time: 0, path: [] }];
        const visited = new Set([`${this.gridX},${this.gridY}`]);
        
        while (queue.length > 0) {
            const curr = queue.shift();
            
            // 找到不在炸彈上的位置
            if (!this.bombManager.hasBombAt(curr.x, curr.y)) {
                if (this.isCellSafe(curr.x, curr.y, curr.time)) {
                    return { path: curr.path, found: true };
                }
            }
            
            if (curr.time >= 2.0) continue;
            
            const dirs = [{dx:0,dy:-1},{dx:0,dy:1},{dx:-1,dy:0},{dx:1,dy:0}];
            for (const d of dirs) {
                const nx = curr.x + d.dx;
                const ny = curr.y + d.dy;
                const arriveTime = curr.time + timePerCell;
                
                if (this.mapManager.isSolid(nx, ny)) continue;
                if (this.bombManager.hasBombAt(nx, ny) && !(nx === this.gridX && ny === this.gridY)) continue;
                
                const key = `${nx},${ny}`;
                if (visited.has(key)) continue;
                
                const dInfo = this.dangerMap.getDangerInfo(nx, ny);
                if (dInfo.isFlameActive) continue;

                // ===== 放寬：只要離開「腳下這顆炸彈」的爆炸範圍即可 =====
                //
                // 實測（決定性）：Bot 在 (3,2) 腳下有炸彈，四鄰 (3,1)/(3,3)/(2,2)/(4,2)
                // 全部在十字爆炸範圍內。舊版用嚴格的時間安全判斷把這些格全部排除，
                // BFS 擴展到哪裡都找不到合法節點 → 回傳「path長度0」→
                // AI 站在自己的炸彈上完全不動，直到火焰掃到為止（HP 3→1→0）。
                //
                // 但這些格「本來就會被炸到」—— 站在原地也是死，
                // 走出去至少有一線生機（引信 3 秒，走 1~2 格通常就出去了）。
                //
                // 修正：只要走出「腳下這顆炸彈」的爆炸範圍就算成功。
                // 這完全符合遊戲規則 —— 沒有改動爆炸範圍、引信或傷害，
                // 只是讓 AI 在必死局面下選擇唯一能活的那條路。
                if (myBomb) {
                    const myCells = this.getExplosionCells(this.gridX, this.gridY,
                        this.fireRange, this.hasPierce, this.getMyExplosionShape());
                    if (!myCells.has(`${nx},${ny}`)) {
                        return { path: [...curr.path, { x: nx, y: ny }], found: true };
                    }
                }

                // 到達時其他炸彈已爆炸覆蓋
                const bombTime = this.getMinBombExplosionTimeAt(nx, ny);
                if (bombTime < Infinity && arriveTime >= bombTime) continue;

                visited.add(key);
                queue.push({ x: nx, y: ny, time: arriveTime, path: [...curr.path, { x: nx, y: ny }] });
            }
        }
        
        // 找不到完整路徑，嘗試直接移動方向
        const dirs = [{dx:0,dy:-1,act:'up'},{dx:0,dy:1,act:'down'},{dx:-1,dy:0,act:'left'},{dx:1,dy:0,act:'right'}];
        for (const d of dirs) {
            const nx = this.gridX + d.dx;
            const ny = this.gridY + d.dy;
            if (!this.mapManager.isSolid(nx, ny) && !this.bombManager.hasBombAt(nx, ny)) {
                const info = this.dangerMap.getDangerInfo(nx, ny);
                if (!info.isFlameActive) {
                    this.aiInput[d.act] = true;
                    this.targetPath = [];
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * 判斷是否有怪物已經貼到「會被撞到」的距離。
     *
     * 判定標準必須與遊戲規則一致：
     * MonsterManager.checkPlayerCollision() 使用的條件是
     * 「兩個角色中心距離 < (cellSize × 0.4) + (cellSize × 0.4) = cellSize × 0.8」。
     *
     * 這裡用完全相同的公式判斷 —— 只是**讀取遊戲既有的常數**，
     * 讓 AI 對「即將被撞到」的認知與遊戲實際判定一致，
     * 沒有改動怪物速度、碰撞半徑、傷害或 HP 等任何遊戲規則。
     *
     * 預警距離放大到 1.6 格，讓 AI 有反應時間：
     * 等到 0.8 格才開始逃，往往已經來不及。
     */
    hasMonsterThreat() {
        const cs = this.gridSystem.getCellSize();
        // ===== 預警距離必須貼近實際致死距離 =====
        //
        // 實測（決定性）：舊版 warn = cs * 1.6 時，
        // 「有怪物威脅」的幀數佔了整場的 79.6%（602/756）。
        // 因為 PRIORITY 0（怪物生存反應）排在 PRIORITY 0.5（攻擊）之前，
        // AI 有 79.6% 的時間都在「躲怪物」，永遠輪不到開火：
        //   狀態分布 FLEE:74 / ATTACK_ADVANCE:9 / 擊殺 0.2 隻。
        //
        // 而遊戲真正的致死距離只有 cs * 0.8（見 MonsterManager.checkPlayerCollision）。
        // 用 1.6 格當預警等於把警戒範圍放大兩倍，
        // 在 13x11 的地圖上幾乎等於「全場都在警戒」。
        //
        // 修正：收到 1.15 格 —— 只比致死距離多一點反應時間，
        // 足以在碰撞發生前拉開，又不會佔掉幾乎所有時間。
        const warn = cs * 1.15;
        const px = this.x + cs / 2;
        const py = this.y + cs / 2;

        for (const m of this.getEnemies()) {
            if (!m || m.isDead) continue;
            // 怪物的 x / y 是碰撞框左上角，中心要加半格
            const dist = Math.hypot(px - (m.x + cs / 2), py - (m.y + cs / 2));
            if (dist <= warn) return true;
        }
        return false;
    }

    /**
     * 規劃「遠離怪物」的完整路徑（不只是一格）。
     *
     * 實測（決定性）：Bot 在 (3,2)，怪物曼哈頓距離 0（完全貼身），
     * AI 每幀在 R / D / L / U 之間反覆震盪、位置完全不變（幀1660~1790 共 130 幀），
     * state 在 FLEE / UNSTUCK / SNIPE_MOVE 之間來回切換、path 幾乎都是 0。
     * canPhysicallyMove 顯示 R/D/U 都走得通，但 AI 仍然原地不動 ——
     * 因為單格貪婪評分只看「下一格」，走一格之後又面對同樣的貼身情況，
     * 方向再度翻轉，就永遠離不開。
     *
     * 修正：用 BFS 找「離所有怪物像素距離都超過安全距離」的**完整路徑**，
     * 讓 AI 能連續走好幾格真正拉開距離，而不是每幀只決定一步。
     *
     * 這只改變 AI 的移動決策，沒有改動怪物速度、碰撞半徑、傷害或 HP，
     * 移動依然走 Player 原本的碰撞判定。
     */
    planMonsterEscape() {
        const cs = this.gridSystem.getCellSize();
        const lethalDist = cs * 0.8;    // 遊戲實際的致死距離
        const safeDist = cs * 2.0;      // 理想的安全距離
        const maxTime = 2.5;

        // 某格是否「已經足夠安全」
        const distAt = (x, y) => {
            const px = this.gridSystem.offsetX + x * cs + cs / 2;
            const py = this.gridSystem.offsetY + y * cs + cs / 2;
            let nearest = Infinity;
            for (const m of this.getEnemies()) {
                if (!m || m.isDead) continue;
                const d = Math.hypot(px - (m.x + cs / 2), py - (m.y + cs / 2));
                if (d < nearest) nearest = d;
            }
            return nearest;
        };

        const startDist = distAt(this.gridX, this.gridY);
        // 已經離得夠遠就不需要逃（致命距離的 1.5 倍即算安全）
        if (startDist > lethalDist * 1.5) return null;

        const timePerCell = 1 / this.getEffectiveSpeed();
        const queue = [{ x: this.gridX, y: this.gridY, path: [], time: 0 }];
        const visited = new Set([`${this.gridX},${this.gridY}`]);
        const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];

        while (queue.length > 0) {
            const curr = queue.shift();
            if (curr.time >= maxTime) continue;

            for (const [dx, dy] of dirs) {
                const nx = curr.x + dx, ny = curr.y + dy;
                const key = nx + ',' + ny;
                if (visited.has(key)) continue;
                visited.add(key);

                if (this.mapManager.isSolid(nx, ny)) continue;
                if (this.bombManager.hasBombAt(nx, ny)) continue;
                if (this.dangerMap.getDangerInfo(nx, ny).isFlameActive) continue;
                // 必須物理上走得通，否則這條路徑會讓 AI 原地卡住
                if (curr.x === this.gridX && curr.y === this.gridY) {
                    if (!this.canPhysicallyMove(dx, dy)) continue;
                }

                const nextPath = [...curr.path, { x: nx, y: ny }];

                // ===== 達成「明顯比現在安全」就算成功 =====
                //
                // 實測（決定性）：舊版只接受「離所有怪物 > 2 格（safeDist）」的安全格，
                // 實測「持有逃離路徑的幀數 = 0」——
                // 一次都沒規劃成功過。原因是怪物緊貼時周圍幾乎沒有任何格
                // 能達到 2 格距離，於是每幀都回傳 null、每幀都原地不動。
                //
                // 修正：只要走到「離最近怪物明顯更遠」或「已經離開致命距離」
                // 的格就算成功。AI 能走出一格是一格，
                // 走完之後下一幀再重新評估，距離會逐步真正拉開。
                const nextDist = distAt(nx, ny);
                if (nextDist > lethalDist * 1.5 || nextDist > startDist + cs * 0.8) {
                    return { path: nextPath, found: true };
                }

                queue.push({ x: nx, y: ny, path: nextPath, time: curr.time + timePerCell });
            }
        }
        return null;
    }

    /**
     * 智慧逃生：找到最安全方向
     */
    trySmartFlee() {
        const timePerCell = 1 / this.getEffectiveSpeed();
        
        const dirs = [{dx:0,dy:-1,act:'up'},{dx:0,dy:1,act:'down'},{dx:-1,dy:0,act:'left'},{dx:1,dy:0,act:'right'}];
        // ===== 真的有威脅才撤退（關鍵）=====
        //
        // 實測：舊版 trySmartFlee() 沒有任何「是否真的有危險」的判斷，
        // 只要呼叫它就會挑一個方向、設 targetPath = [] 並回傳 true。
        // 而 think() 把它排在所有攻擊策略之前，
        // 於是 AI 每幀都在「撤退」，永遠輪不到 SNIPE / BREACH：
        //   狀態分布 FLEE:976 / SNIPE_MOVE:679 / SNIPE:7，
        //   30 秒只走過 4 格、擊殺 0 隻。
        //
        // 修正：先確認腳下真的有東西要炸、或怪物已貼到會撞到的距離才撤退。
        // 單純「離遠一點比較好」不構成撤退理由 ——
        // 遠離是 canSafelyPlaceBomb() 的一部分，本來就已經在計畫裡算過了。
        const hereInfo = this.dangerMap.getDangerInfo(this.gridX, this.gridY);
        const selfBombTime = this.getMinBombExplosionTimeAt(this.gridX, this.gridY);
        const flameHere = !!hereInfo.isFlameActive;
        const bombSoon = selfBombTime !== Infinity && selfBombTime < timePerCell * 2;

        let monsterClose = false;
        for (const m of this.getEnemies()) {
            const ddx = Math.abs(m.gridX - this.gridX);
            const ddy = Math.abs(m.gridY - this.gridY);
            if (ddx <= 1 && ddy <= 1) { monsterClose = true; break; }
            if (ddx <= 2 && ddy === 0) { monsterClose = true; break; }
            if (ddy <= 2 && ddx === 0) { monsterClose = true; break; }
        }

        if (!flameHere && !bombSoon && !monsterClose) return false;

        // 與最近怪物的像素距離（用來評分逃離方向的好壞）
        //
        // 實測（決定性）：Bot 在 (4,1) 與怪物曼哈頓距離 0（正面貼身），
        // AI 每幀在 FLEE 狀態交替按 L / R 來回震盪整整 240 幀（4 秒），
        // 位置在 (3,1) ↔ (4,1) 之間來回，HP 從 2 → 1 → 0 慢慢磨死。
        // 火焰=0、腳下彈=0，全程沒有被任何一次爆炸或火焰碰到 —— 純粹被撞死。
        //
        // 原因：原本的評分只看「離炸彈多遠」與「地形開闊度」，
        // 完全沒有考慮怪物。當怪物正好在正上方／正下方時，
        // 左右兩個方向分數完全相同、每幀重新挑選 → 就在原地左右橫跳，
        // 與怪物的距離永遠拉不開。
        //
        // 修正：把「往遠離最近怪物」納入評分，讓逃離方向有明確的優先性，
        // 不會在兩個等價方向之間逐幀翻轉。
        const nearestMonsterDist = (gx, gy) => {
            const cs3 = this.gridSystem.getCellSize();
            const px = this.gridSystem.offsetX + gx * cs3 + cs3 / 2;
            const py = this.gridSystem.offsetY + gy * cs3 + cs3 / 2;
            let best3 = Infinity;
            for (const m of this.getEnemies()) {
                // 怪物的 x / y 是碰撞框左上角，中心要加半格
                const d3 = Math.hypot((m.x + cs3 / 2) - px, (m.y + cs3 / 2) - py);
                if (d3 < best3) best3 = d3;
            }
            return best3;
        };
        const currentMonsterDist = nearestMonsterDist(this.gridX, this.gridY);

        // 延續方向只在「遠離怪物且遠離火焰」時才成立。
        //
        // 實測（決定性）：Bot 在 (4,1)→(5,1)，HP=1，火焰=0、腳彈=0，
        // 但「怪距」從 113.7 一路降到 69.1 —— AI 處在 FLEE 狀態，
        // 卻正在朝怪物走去，最後死於火焰（死因統計 {"monster":0,"flame":2}）。
        //
        // 原因：原本的延續機制只鎖定方向 0.35 秒就結束，
        // 但怪物每幀都在移動、朝向怪物走的方向分數仍然最高，
        // 於是 AI 一路鎖定「往怪物那邊」的方向。
        //
        // 修正：只要怪物還在威脅範圍內，就每幀重新評估方向，
        // 並且「增加與怪物的距離」給予最高權重（遠超過其他考量）。
        // 沒有怪物威脅時才使用延續機制，避免普通的閃避逐幀翻轉。
        const monsterUrgent = this.hasMonsterThreat();
        if (!flameHere && !bombSoon && !monsterUrgent && this.fleeDir && this.fleeHold > 0) {
            const keep = { up: 'up', down: 'down', left: 'left', right: 'right' }[this.fleeDir];
            if (keep && this.canPhysicallyMove(
                    keep === 'left' ? -1 : keep === 'right' ? 1 : 0,
                    keep === 'up' ? -1 : keep === 'down' ? 1 : 0)) {
                this.aiInput[keep] = true;
                this.state = 'FLEE';
                this.targetPath = [];
                return true;
            }
            // 延續的方向走不動 → 放棄延續，重新評分
            this.fleeDir = null;
            this.fleeHold = 0;
        }

        let bestDir = null;
        let bestScore = -Infinity;
        
        for (const d of dirs) {
            const nx = this.gridX + d.dx;
            const ny = this.gridY + d.dy;
            if (this.mapManager.isSolid(nx, ny)) continue;
            if (this.bombManager.hasBombAt(nx, ny)) continue;
            // 必須物理上走得動，否則又會變成「每幀都按同一個走不動的方向」
            if (!this.canPhysicallyMove(d.dx, d.dy)) continue;
            
            const info = this.dangerMap.getDangerInfo(nx, ny);
            if (info.isFlameActive) continue;
            
            // 得分：離所有炸彈爆炸範圍越遠越好
            const bombTime = this.getMinBombExplosionTimeAt(nx, ny);
            const radiusSafety = (bombTime - timePerCell); // 到達後剩餘的時間
            const wallBonus = this.isWallProtected(nx, ny) ? 30 : 0;
            
            // 檢查這個方向的開放空間（預測能持續移動）
            let openness = 0;
            for (let i = 2; i <= 4; i++) {
                const fnx = this.gridX + d.dx * i;
                const fny = this.gridY + d.dy * i;
                if (!this.mapManager.isSolid(fnx, fny) && !this.bombManager.hasBombAt(fnx, fny)) {
                    openness += 1;
                } else {
                    break;
                }
            }
            
            const score = radiusSafety * 10 + wallBonus + openness * 20;

            // 遠離怪物：權重遠高於其他考量。
            //
            // 實測：只給 6 倍權重時不夠 ——
            // 開放空間（openness × 20）與炸彈安全（radiusSafety × 10）
            // 加起來很容易蓋過「離怪物遠一格」的收益，
            // AI 仍會朝怪物走，最後死於火焰（死因統計 flame:2 / monster:0）。
            //
            // 改成 60 倍：一格（約 cellSize）的距離變化就會壓過其他所有項目的總和，
            // 確保「遠離怪物」永遠是最高優先考量。
            const nextMonsterDist = nearestMonsterDist(nx, ny);
            const monsterGain = nextMonsterDist - currentMonsterDist;
            const fleeScore = score + monsterGain * 60;

            if (fleeScore > bestScore) {
                bestScore = fleeScore;
                bestDir = d.act;
            }
        }
        
        if (bestDir) {
            this.aiInput[bestDir] = true;
            this.state = 'FLEE';
            this.targetPath = [];
            // 方向持續性：連續多幀維持同一個逃離方向。
            //
            // 實測（決定性）：Bot 在 (4,1) 與怪物曼哈頓距離 0，
            // 每幀重新評分後在 L / R 之間逐幀翻轉，
            // 位置在 (3,1) ↔ (4,1) 來回震盪 240 幀（4 秒），
            // HP 3 → 2 → 1 → 0 慢慢被磨死（火焰=0、腳下彈=0，純粹被撞）。
            //
            // 另一個更糟的情況：診斷顯示「強制 right → dx=0.0000」，
            // 代表 AI 選了右、但右方實際走不動（碰撞框被夾住），
            // 於是完全停住、每幀重複送出同一個無效方向。
            //
            // 修正：選定方向後維持一小段時間，讓 AI 真的能走出距離。
            // 期間若出現火焰或腳下炸彈則立即放棄延續（真正的緊急狀況優先）。
            const stillUrgent = !!this.dangerMap.getDangerInfo(this.gridX, this.gridY).isFlameActive ||
                this.getMinBombExplosionTimeAt(this.gridX, this.gridY) < timePerCell;

            if (!stillUrgent && this.fleeDir === bestDir && this.fleeHold > 0) {
                this.fleeHold -= 1 / 60;
            } else if (!stillUrgent) {
                this.fleeDir = bestDir;
                this.fleeHold = 0.35;
            } else {
                this.fleeDir = null;
                this.fleeHold = 0;
            }
            return true;
        }
        
        return false;
    }

    // ==================== 踢炸彈攻擊 ====================

    tryKickAttack() {
        if (!this.bombManager) return false;
        
        const dirs = [{dx:0,dy:-1,act:'up'},{dx:0,dy:1,act:'down'},{dx:-1,dy:0,act:'left'},{dx:1,dy:0,act:'right'}];
        for (const d of dirs) {
            const nx = this.gridX + d.dx;
            const ny = this.gridY + d.dy;
            const bomb = this.bombManager.getBombAt(nx, ny);
            if (bomb && !bomb.isSliding) {
                // 踢的方向有敵人嗎
                if (this.isEnemyInLine(nx, ny, d.dx, d.dy)) {
                    // 確保踢完後自己安全
                    const forwardCells = this.getExplosionCells(nx + d.dx, ny + d.dy, bomb.fireRange, bomb.isPierce, 'CROSS');
                    if (!forwardCells.has(`${this.gridX},${this.gridY}`)) {
                        this.aiInput[d.act] = true;
                        return true;
                    }
                }
            }
        }
        return false;
    }

    isEnemyInLine(startX, startY, dx, dy) {
        const targets = this.getEnemies();
        let currX = startX + dx;
        let currY = startY + dy;
        
        while (!this.mapManager.isSolid(currX, currY)) {
            for (const t of targets) {
                if (t.gridX === currX && t.gridY === currY) return true;
            }
            if (this.bombManager.hasBombAt(currX, currY)) break;
            currX += dx;
            currY += dy;
        }
        return false;
    }

    // ==================== 用炸彈擋住追殺自己的怪物 ====================

    tryBlockWithBomb() {
        if (this.currentBombs >= this.maxBombs) return false;
        
        const targets = this.getEnemies();
        if (targets.length === 0) return false;
        
        // 找出離自己最近且正在靠近的敵人
        let nearestEnemy = null;
        let minDist = Infinity;
        for (const t of targets) {
            const dist = Math.abs(t.gridX - this.gridX) + Math.abs(t.gridY - this.gridY);
            if (dist < minDist) {
                minDist = dist;
                nearestEnemy = t;
            }
        }
        
        if (!nearestEnemy || minDist > 4) return false;
        
        // 在敵與自己中間的格子放炸彈
        const enemyX = nearestEnemy.gridX;
        const enemyY = nearestEnemy.gridY;
        
        // 計算中間位置
        const midX = Math.round((this.gridX + enemyX) / 2);
        const midY = Math.round((this.gridY + enemyY) / 2);
        
        // 檢查中間位置是否可用且不是牆壁
        if (this.mapManager.isSolid(midX, midY)) return false;
        if (this.bombManager.hasBombAt(midX, midY)) return false;
        
        // 線性中間點必須在能到達的範圍
        const path = this.aStar(this.gridX, this.gridY, midX, midY, false);
        if (!path || path.length > 3) return false;
        
        // 放炸彈後自己能逃脫
        const myShape = this.getMyExplosionShape();
        const escapeInfo = this.canSafelyPlaceBomb(midX, midY, this.fireRange, this.hasSuperBomb(), myShape);
        if (!escapeInfo.canEscape) return false;
        
        // 檢查隊友
        const explosionCells = this.getExplosionCells(midX, midY, this.fireRange, this.hasSuperBomb(), myShape);
        if (this.isTeamMateInDangerZone(explosionCells)) return false;
        
        // 執行：走到中間位置放炸彈
        if (this.gridX === midX && this.gridY === midY) {
            this.aiInput.bomb = true;
            this.targetPath = escapeInfo.path;
            this.thinkTimer = 0;
            this.state = 'BLOCK';
            return true;
        } else {
            this.targetPath = path;
            this.state = 'BLOCK';
            return true;
        }
    }

    // ==================== 牆壁防禦 ====================

    tryWallDefense() {
        const targets = this.getEnemies();
        if (targets.length === 0) return false;
        
        // 身邊有牆壁保護
        const wallCoverage = this.countWallCoverage(this.gridX, this.gridY);
        if (wallCoverage === 0) return false;
        
        // 檢查敵人在附近
        const nearbyEnemies = targets.filter((t) => {
            const dist = Math.abs(t.gridX - this.gridX) + Math.abs(t.gridY - this.gridY);
            return dist <= 6;
        });
        
        if (nearbyEnemies.length === 0) return false;
        
        // 確認敵人的確被牆壁擋住無法過來
        const enemyCannotReach = nearbyEnemies.every((e) => !this.canMonsterReach(e.gridX, e.gridY, this.gridX, this.gridY, 10));
        
        if (enemyCannotReach) {
            // 被牆壁保護，嘗試主動出擊
            if (this.trySafeHunt()) return true;
            if (this.tryWallControl()) return true;
            
            // 如果暫時無法攻擊，移動到更好的牆壁位置（靠近敵人方向）
            // 尋找能攻擊到敵人的牆壁位置
            for (const enemy of nearbyEnemies) {
                // 嘗試移動到能與敵人同一直線/列的位置
                const candidates = [
                    { x: enemy.gridX, y: this.gridY },
                    { x: this.gridX, y: enemy.gridY }
                ];
                
                for (const cand of candidates) {
                    if (this.mapManager.isSolid(cand.x, cand.y)) continue;
                    if (this.bombManager.hasBombAt(cand.x, cand.y)) continue;
                    if (cand.x === this.gridX && cand.y === this.gridY) continue;
                    
                    // 檢查這個位置是否有牆壁保護
                    if (!this.isWallProtected(cand.x, cand.y)) continue;
                    
                    // 檢查這個位置是否安全
                    const dInfo = this.dangerMap.getDangerInfo(cand.x, cand.y);
                    if (dInfo.isFlameActive || dInfo.dangerLevel > 0) continue;
                    
                    // 檢查能否到達
                    const path = this.aStar(this.gridX, this.gridY, cand.x, cand.y, false);
                    if (path && path.length > 0 && path.length <= 4) {
                        this.targetPath = path;
                        this.state = 'WALL_DEFEND';
                        return true;
                    }
                }
            }
            
            // 找不到更好的位置，保持當前位置但絕不發呆
            // 嘗試炸軟磚開路或收集道具
            if (this.tryBreakWalls()) return true;
            if (this.tryGather()) return true;
            
            // 最後手段：在牆壁保護下安全巡邏
            this.state = 'WALL_DEFEND';
            this.patrolToSafeArea();
            return true;
        }
        
        return false;
    }

    // ==================== 獵殺系統 ====================

    /**
     * 尋找最佳放炸彈位置來殺敵
     * 優先：安全 + 能精準擊中敵人 + 自己可以逃脫
     */
    trySafeHunt() {
        if (this.currentBombs >= this.maxBombs) return false;

        const targets = this.getEnemies();
        if (targets.length === 0) return false;

        const myShape = this.getMyExplosionShape();
        const isPierce = this.hasSuperBomb();

        // 考慮的候選位置：當前位置 + 四個方向
        const spots = [
            { x: this.gridX, y: this.gridY, act: null },
            { x: this.gridX, y: this.gridY - 1, act: 'up' },
            { x: this.gridX, y: this.gridY + 1, act: 'down' },
            { x: this.gridX - 1, y: this.gridY, act: 'left' },
            { x: this.gridX + 1, y: this.gridY, act: 'right' }
        ];

        let bestSpot = null;
        let bestScore = -Infinity;
        let bestEscapeInfo = null;

        for (const spot of spots) {
            // 位置必須可走
            if (this.mapManager.isSolid(spot.x, spot.y)) continue;
            if (this.bombManager.hasBombAt(spot.x, spot.y) && !(spot.x === this.gridX && spot.y === this.gridY)) continue;

            // 模擬這顆炸彈爆炸後能覆蓋敵人的格子
            const explosionCells = this.getExplosionCells(spot.x, spot.y, this.fireRange, isPierce, myShape);

            // 檢查能擊中哪些敵人
            let hitScore = 0;
            for (const target of targets) {
                if (explosionCells.has(`${target.gridX},${target.gridY}`)) {
                    // 距離越近越有機會擊中（因為敵人可能在移動）
                    const dist = Math.abs(target.gridX - spot.x) + Math.abs(target.gridY - spot.y);
                    hitScore += 100 - dist * 10;
                }
            }

            if (hitScore <= 0) continue;

            // 檢查自己（以及隊友）能否逃脫
            const escapeInfo = this.canSafelyPlaceBomb(spot.x, spot.y, this.fireRange, isPierce, myShape);
            if (!escapeInfo.canEscape) continue;

            // 檢查隊友安全
            if (this.isTeamMateInDangerZone(explosionCells)) continue;

            // 加分：這個位置有牆壁保護，敵人無法過來
            const wallCoverage = this.countWallCoverage(spot.x, spot.y);
            const wallBonus = wallCoverage * 30;

            // 加分：位置安全（不受其他炸彈影響）
            const bombTime = this.getMinBombExplosionTimeAt(spot.x, spot.y);
            const safetyBonus = (bombTime === Infinity) ? 50 : (bombTime > this.getFuseTime() ? 20 : 0);

            const totalScore = hitScore + wallBonus + safetyBonus - escapeInfo.time * 10;

            if (totalScore > bestScore) {
                bestScore = totalScore;
                bestSpot = spot;
                bestEscapeInfo = escapeInfo;
            }
        }

        if (bestSpot) {
            // 如果在當前位置放炸彈，直接放
            if (bestSpot.act === null) {
                // 確保放完後有路可逃
                this.aiInput.bomb = true;
                this.targetPath = bestEscapeInfo.path;
                this.state = 'HUNT';
                this.thinkTimer = 0;
                return true;
            } else {
                // 移動到目標位置
                const path = this.aStar(this.gridX, this.gridY, bestSpot.x, bestSpot.y, false);
                if (path && path.length > 0) {
                    this.targetPath = path;
                    this.state = 'HUNT';
                    return true;
                }
                // 直接移動
                this.aiInput[bestSpot.act] = true;
                return true;
            }
        }

        // ===== 新增：全域攻擊位置搜尋 =====
        // 原本只檢查「當前格 + 四邻格」，當怪物在數格外時永遠湊不到
        // fireRange(2) 的直線距離，導致獵殺 100% 失敗、怪物永遠殺不掉。
        // 這裡擴大到「全地圖所有能炸到怪物的站位」，並用 A* 走过去放炸彈。
        const ambush = this.findAmbushSpots(targets, isPierce, myShape);
        if (ambush) {
            if (ambush.path && ambush.path.length > 0) {
                this.targetPath = ambush.path;
                this.state = 'HUNT';
                return true;
            }
            // 已在理想站位：放炸彈並沿預備路線撤退
            this.aiInput.bomb = true;
            this.targetPath = ambush.escapePath || [];
            this.state = 'HUNT';
            this.thinkTimer = 0;
            return true;
        }

        return false;
    }

    /**
     * 開路爆破（Breach）：當目標走不到時，先炸開擋路的軟磚。
     *
     * 實測關鍵：Bot 與怪物的有效目標之間隔著整排軟磚（地圖 y=1 為 1000222002001，
     * x=4~6 與 x=9~11 都是軟磚）。aStar 只接受「當下就走得過去」的節點，
     * 軟磚未炸開前一律視為障礙，於是所有攻擊站位的 aStar 都回傳 null——
     * AI 永遠打不到怪。
     *
     * 這裡補上唯一合法的解法：站在「炸得到那面牆、且炸完能安全撤退」的格子，
     * 放一顆炸彈把牆炸開。炸開後下一回合 aStar 就能通過，攻擊位自然成形。
     * 完全遵守遊戲規則：只用自己的炸彈、只炸軟磚、照樣需要逃生路線。
     */
    tryBreach() {
        if (this.currentBombs >= this.maxBombs) return false;

        // 找出目前還走不到的目標
        const targets = this.getEnemies();
        if (targets.length === 0) return false;

        const myShape = this.getMyExplosionShape();
        const isPierce = this.hasSuperBomb();
        const range = this.fireRange;

        // 先確認目標現在確實到不了（同樣改用「怪物旁邊那一格」判定，理由見
        // tryCarveTowardGoal 的說明：怪物格本身是危險區，aStar stopBeforeTarget
        // 永遠到不了，會讓 AI 誤以為還需要開路）。
        let blocked = false;
        for (const t of targets) {
            let ok = false;
            for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [0, 0]]) {
                const ax = t.gridX + dx, ay = t.gridY + dy;
                if (ax < 1 || ay < 1 || ax >= this.gridSystem.cols - 1 || ay >= this.gridSystem.rows - 1) continue;
                if (this.mapManager.isSolid(ax, ay)) continue;
                if (this.aStar(this.gridX, this.gridY, ax, ay, false)) { ok = true; break; }
            }
            if (!ok) { blocked = true; break; }
        }
        if (!blocked) return false;

        let best = null, bestScore = -Infinity;
        for (let y = 1; y < this.gridSystem.rows - 1; y++) {
            for (let x = 1; x < this.gridSystem.cols - 1; x++) {
                if (this.mapManager.isSolid(x, y)) continue;
                if (this.bombManager.hasBombAt(x, y)) continue;

                // 這個位置放炸彈會炸到哪些軟磚？
                const cells = this.getExplosionCells(x, y, range, isPierce, myShape);
                let softHits = 0;
                for (const key of cells) {
                    const [cx, cy] = key.split(',').map(Number);
                    if (this.mapManager.getBlockType(cx, cy) === 2) softHits++;
                }
                if (softHits === 0) continue;   // 只炸得到空地就沒意義
                if (this.isTeamMateInDangerZone(cells)) continue;

                // 放完能不能安全撤退？（站位必須活著）
                const esc = this.canSafelyPlaceBomb(x, y, range, isPierce, myShape);
                if (!esc.canEscape) continue;

                // 走不走得到站位？必須只走空地。
                // path 為空陣列代表「已經站在這裡」，這是合法的爆破位，必須放行；
                // 舊版把空路徑也一起丟掉，結果 Bot 站在自己腳下卻永遠不放彈。
                const path = this.aStar(this.gridX, this.gridY, x, y, false);
                if (path === null) continue;

                // 炸開之後，真的能往目標方向推進嗎？
                //
                // 實測陷阱：只評分「炸到幾面軟磚」會選出離目標很遠、
                // 炸完仍然哪裡都去不了的站位。Bot 走過去、放完彈、
                // 通道依然不通，就又走回原點——實測 226 次重複同一個無效選擇。
                //
                // 但也不能太嚴：要求「這一顆炸彈必須立刻打通到目標」太緊，
                // 會把大多數合法站位都淘汰，AI 反而只敢原地待著（勝率從 50% 掉到 30%）。
                // 分成兩級：
                //   - 目標已經可達 → 純粹炸牆開路，不需要推進性
                //   - 目標不可達 → 才要求這一炸能實際推進
                if (!this.targetsAlreadyReachable() && !this.wouldAdvanceAfterBreach(x, y, cells)) continue;

                const score = softHits * 100 - path.length * 15 + this.countWallCoverage(x, y) * 10;
                if (score > bestScore) {
                    bestScore = score;
                    best = { x, y, path, esc, softHits, fromSelf: (x === this.gridX && y === this.gridY) };
                }
            }
        }
        if (!best) return false;

        // 站在爆破位 → 立刻放彈並沿撤退路線離開。
        // （包含「就在腳下」的情況：path 為空陣列代表已在該格，這是合法爆破位。）
        if (this.gridX === best.x && this.gridY === best.y) {
            this.aiInput.bomb = true;
            this.targetPath = best.esc.path;
            this.state = 'BREACH';
            this.thinkTimer = 0;
            return true;
        }

        this.targetPath = best.path;
        this.state = 'BREACH_MOVE';
        return true;
    }

    /**
     * 決定性開路：當目標仍不可達時，朝「目標方向」一格一格啃掉軟磚。
     *
     * 問題情境（實測）：Bot 與四隻怪物的旁邊格全部不可達，中間隔著軟磚。
     * 但舊版只檢查「自己正前方（上下左右）那一格是軟磚」，
     * 當四周都是空地時就完全沒有動作，於是 AI 站在原地一動也不動。
     *
     * 現在改成「沿著通往最近目標的方向找第一面軟磚」：
     * 依目標的相對位置決定優先方向（前／後／左／右），
     * 找到最近的那面軟磚就炸開，一格一格往前打通。
     * 完全遵守遊戲規則：只用自己的炸彈、只炸軟磚、照樣需要逃生路線。
     */
    tryCarveTowardGoal() {
        if (this.currentBombs >= this.maxBombs) return false;

        const targets = this.getEnemies();
        if (targets.length === 0) return false;

        // 目標還是走不到才需要這一招（同 tryBreach 的理由：怪物格本身是危險區）
        let reachable = false;
        for (const t of targets) {
            const adj = [[0, -1], [0, 1], [-1, 0], [1, 0], [0, 0]];
            for (const [dx, dy] of adj) {
                const ax = t.gridX + dx, ay = t.gridY + dy;
                if (ax < 1 || ay < 1 || ax >= this.gridSystem.cols - 1 || ay >= this.gridSystem.rows - 1) continue;
                if (this.mapManager.isSolid(ax, ay)) continue;
                if (this.aStar(this.gridX, this.gridY, ax, ay, false)) { reachable = true; break; }
            }
            if (reachable) break;
        }
        if (reachable) return false;

        const range = this.fireRange;

        // 依「曼哈頓距離」由近到遠排序目標
        targets.sort((a, b) =>
            (Math.abs(a.gridX - this.gridX) + Math.abs(a.gridY - this.gridY)) -
            (Math.abs(b.gridX - this.gridX) + Math.abs(b.gridY - this.gridY)));

        // 這顆炸彈的爆炸範圍
        const cells = this.getExplosionCells(this.gridX, this.gridY, range, false, 'CROSS');

        // 決定要炸哪一面軟磚。
        //
        // 實測陷阱：原本只考慮「朝最近目標的方向」，但腳下四周可能是空地，
        // 唯一能炸到的軟磚反而在反方向（例如 Bot 在 (2,1)、目標在右，
        // 但 (1,1) 是軟磚而 (3,1) 是空地）。這種情況下若不放棄，
        // carve 完全沒有動作，AI 就停在原地不動。
        //
        // 現在的做法：列出腳下爆炸範圍內所有軟磚，挑「炸開之後最能拉近
        // 與任一目標距離」的那一格。目標為 0 則純粹當開路，不看方向。
        let bestWall = null, bestGain = -Infinity;
        for (const key of cells) {
            const [wx, wy] = key.split(',').map(Number);
            if (this.mapManager.getBlockType(wx, wy) !== 2) continue;
            // 炸開這一格後，走到它能省下多少步
            let gain = 0;
            for (const tg of targets) {
                const before = Math.abs(tg.gridX - this.gridX) + Math.abs(tg.gridY - this.gridY);
                const after = Math.abs(tg.gridX - wx) + Math.abs(tg.gridY - wy);
                gain = Math.max(gain, before - after);
            }
            if (gain > bestGain) { bestGain = gain; bestWall = { wx, wy }; }
        }
        if (!bestWall) return false;         // 腳下炸不到任何軟磚，這一招無用
        if (this.isTeamMateInDangerZone(cells)) return false;

        // 這顆炸彈會不會讓自己走投無路？
        const esc = this.canSafelyPlaceBomb(this.gridX, this.gridY, range, false, 'CROSS');
        if (!esc.canEscape) return false;

        // 確認炸開之後真的動得了：必須能走到那一格，或者它本身就在腳下旁邊可通行處
        const nx = bestWall.wx + Math.sign(bestWall.wx - this.gridX);
        const ny = bestWall.wy + Math.sign(bestWall.wy - this.gridY);
        const canStepIn = nx === this.gridX && ny === this.gridY;
        const canWalkTo = this.mapManager.isSolid(nx, ny) ? false
            : (this.aStar(this.gridX, this.gridY, nx, ny, false) !== null);
        // 站在牆內亂炸也沒意義，必須炸得開路
        if (!canStepIn && !canWalkTo) return false;

        this.aiInput.bomb = true;
        this.targetPath = esc.path;
        this.state = 'CARVE';
        this.thinkTimer = 0;
        return true;
    }

    /**
     * 長廊開火（Sniping）：站在安全距離外，直接朝怪物所在的直線放炸彈。
     *
     * 為什麼需要這一支：怪物周邊半徑 1 格的區域在 DangerMap 裡是危險區，
     * isCellSafe() 會把它判為不安全，於是所有「靠近怪物」的攻擊路線全被判死，
     * 實測 30 秒內 258 次決策有 214 次停在 FLEE，怪物一隻都殺不掉。
     *
     * 但 fireRange=2 代表只要站在「與怪物同一橫/直線、相距 2 格」的位置，
     * 炸彈照樣能炸到怪物，而那個格子正好在危險區之外——這是幾何上必然存在的
     * 安全攻擊位。本方法專門去找這種位置，既能攻擊又不必踏入危險區。
     *
     * 這不是作弊：完全使用遊戲本身的炸彈範圍與移動規則，沒有穿牆、
     * 沒有瞬移、沒有額外傷害，只是把「站位選擇」做得更聰明。
     */
    trySnipeAttack() {
        if (this.currentBombs >= this.maxBombs) return false;

        const targets = this.getEnemies();
        if (targets.length === 0) return false;

        const myShape = this.getMyExplosionShape();
        const isPierce = this.hasSuperBomb();
        const range = this.fireRange;

        // 先找出「此刻就能開火」的站位：自己站位或四鄰，且炸得到、且站位安全
        const candidates = [
            { x: this.gridX, y: this.gridY, act: null },
            { x: this.gridX, y: this.gridY - 1, act: 'up' },
            { x: this.gridX, y: this.gridY + 1, act: 'down' },
            { x: this.gridX - 1, y: this.gridY, act: 'left' },
            { x: this.gridX + 1, y: this.gridY, act: 'right' },
        ];

        let best = null, bestScore = -Infinity;
        for (const c of candidates) {
            if (this.mapManager.isSolid(c.x, c.y)) continue;
            if (this.bombManager.hasBombAt(c.x, c.y)) continue;
            // 站位不能落在怪物的危險半徑內
            const info = this.dangerMap.getDangerInfo(c.x, c.y);
            if (info.isFlameActive || info.isMonsterDanger) continue;
            if (info.dangerLevel > 0) continue;

            const cells = this.getExplosionCells(c.x, c.y, range, isPierce, myShape);
            let hits = 0;
            for (const t of targets) if (cells.has(`${t.gridX},${t.gridY}`)) hits++;
            if (hits === 0) continue;
            if (this.isTeamMateInDangerZone(cells)) continue;

            const esc = this.canSafelyPlaceBomb(c.x, c.y, range, isPierce, myShape);
            if (!esc.canEscape) continue;

            const score = hits * 200 + this.countWallCoverage(c.x, c.y) * 20;
            if (score > bestScore) { bestScore = score; best = { c, esc }; }
        }

        if (best) {
            if (best.c.act === null) {
                this.aiInput.bomb = true;
                this.targetPath = best.esc.path;
                this.state = 'SNIPE';
                this.thinkTimer = 0;
            } else {
                this.aiInput[best.c.act] = true;
                this.state = 'SNIPE_MOVE';
            }
            return true;
        }

        // 站位不可用 → 走到位於「危險區外、但炸得到怪物」的格子
        const spot = this.findSnipeSpot(targets, isPierce, myShape);
        if (spot) {
            // 關鍵修正：必須先判斷「是否已經站在攻擊位」。
            //
            // 實測：Bot 在 (3,2)，findSnipeSpot 回傳 (3,1) 且 path 長度 1。
            // 舊版無條件 this.targetPath = spot.path，於是每幀重新規劃一次、
            // 每幀都得到同一個「還差一步」的路徑，角色就在 (3,2) 原地不動，
            // SNIPE_MOVE 佔了 996 次決策卻一顆炸彈都放不出去。
            //
            // 判斷依據用「像素中心距離」，因為 gridX/gridY 是以角色中心換算，
            // 站在格邊界時會有一格以上的落差，只比 grid 座標會誤判沒到達。
            const cs2 = this.gridSystem.getCellSize();
            const spotPx = this.gridSystem.getPixelCoord(spot.x, spot.y);
            const spotCx = spotPx.x + cs2 / 2;
            const spotCy = spotPx.y + cs2 / 2;
            const reached = (!spot.path || spot.path.length === 0) ||
                Math.hypot(this.x - spotCx, this.y - spotCy) <= cs2 * 0.5;

            if (reached) {
                // 站位合法且已就位 → 立刻放彈並沿撤退路線撤離
                //
                // 注意：findSnipeSpot 回傳的結構是 { x, y, path, esc }，
                // 撤退路線在 esc.path（見第 2092 行），
                // 誤用 escPath / escapePath 會讓 targetPath 變成空陣列，
                // 放完炸彈就站在原地等它炸 → 必死。
                this.resetInput();
                this.aiInput.bomb = true;
                this.targetPath = (spot.esc && spot.esc.path) ? spot.esc.path.slice() : [];
                this.state = 'SNIPE';
                this.thinkTimer = 0;
                return true;
            }
            this.targetPath = spot.path;
            this.state = 'SNIPE_MOVE';
            return true;
        }

        // ===== 新增：多步規劃「炸開擋路軟磚 → 走到攻擊位 → 開火」=====
        //
        // 實測關鍵：Bot 與 MIMIC@(5,1) 之間隔著 (3,1)(4,1)(5,1) 三格軟磚。
        // 攻擊位 (6,1) 完全合格（danger=0、能安全撤退），但 aStar 回傳 NULL，
        // 於是 trySnipeAttack 與 findSnipeSpot 雙雙失敗，AI 只能乾等。
        //
        // 這裡評估「把擋路軟磚炸開後」攻擊位是否變得可達；
        // 若可行，就先派 AI 去能炸開那面牆的位置，下回合通道打通即可開火。
        const plan = this.planBreachThenSnipe(targets, isPierce, myShape);
        if (plan) {
            // 關鍵修正：路徑為空陣列代表「已經站在爆破位」。
            //
            // 實測：BREACH_FOR_ATTACK 佔了 1025 次決策，但放彈 0 顆。
            //
            // 另一個關鍵：判斷「是否已到達」不能只看 gridX/gridY。
            // 角色的中心點可能已經越過格子分界（px=2.31 格但 gridX 仍報 1），
            // 這時 aStar 仍會回傳「再走一步」，AI 就永遠差那一步走不到。
            // 因此改用「像素中心距離目標格中心的距離」來判斷，與物理實際一致。
            const cs = this.gridSystem.getCellSize();
            const planCx = this.gridSystem.offsetX + plan.x * cs + cs / 2;
            const planCy = this.gridSystem.offsetY + plan.y * cs + cs / 2;
            const arrivedByPixel = Math.hypot(this.x - planCx, this.y - planCy) <= cs * 0.5;
            const arrivedByGrid = (this.gridX === plan.x && this.gridY === plan.y);

            if (!plan.path || plan.path.length === 0 || arrivedByGrid || arrivedByPixel) {
                // 已站在爆破位 → 放彈，然後「立刻沿撤退路線離開」。
                //
                // 關鍵：escPath 必須被走完，而不是每幀重新規劃。
                // 舊版放彈後 targetPath = plan.escPath，
                // 但下一幀 think() 又會重新呼叫 planBreachThenSnipe()，
                // 因為爆破位尚未被炸開（引信 3 秒），plan 完全相同 →
                // 每幀都回到同一個爆破位、每幀都設定「站在這裡」→
                // BREACH_FOR_ATTACK 佔 996 次決策、放彈 1 顆、原地不動 120 秒。
                //
                // 修正：用 breachDone 鎖住這個計畫，放彈後強制走撤退路線；
                // 等牆真的炸開（或計畫失效）才解除鎖定重新規劃。
                if (!this.breachDone) {
                    this.breachDone = { x: plan.x, y: plan.y, until: this.timeLeft };
                    this.resetInput();
                    this.aiInput.bomb = true;
                }
                this.targetPath = plan.escPath ? plan.escPath.slice() : [];
                this.state = 'BREACH_FOR_ATTACK';
                this.thinkTimer = 0;
                return true;
            }
            this.targetPath = plan.path;
            this.state = 'BREACH_FOR_ATTACK';
            return true;
        }
        this.breachDone = null;
        return false;
    }

    /**
     * 規劃「先炸開一格軟磚，打通到攻擊位」。
     *
     * 只做「哪些軟磚可以被炸開」的評估，不會真的改動地圖。
     */
    planBreachThenSnipe(targets, isPierce, myShape) {
        const range = this.fireRange;
        let best = null, bestScore = -Infinity;

        for (let y = 1; y < this.gridSystem.rows - 1; y++) {
            for (let x = 1; x < this.gridSystem.cols - 1; x++) {
                if (this.mapManager.isSolid(x, y)) continue;      // 只站在空地
                if (this.bombManager.hasBombAt(x, y)) continue;

                const cells = this.getExplosionCells(x, y, range, isPierce, myShape);
                const softWalls = [];
                for (const key of cells) {
                    const [cx, cy] = key.split(',').map(Number);
                    if (this.mapManager.getBlockType(cx, cy) === 2) softWalls.push([cx, cy]);
                }
                if (softWalls.length === 0) continue;
                if (this.isTeamMateInDangerZone(cells)) continue;

                const esc = this.canSafelyPlaceBomb(x, y, range, isPierce, myShape);
                if (!esc.canEscape) continue;

                const path = this.aStar(this.gridX, this.gridY, x, y, false);
                if (path === null) continue;

                // 這一炸能讓多少目標變得可達？
                let gain = 0;
                for (const [wx, wy] of softWalls) {
                    if (this.wouldAnyTargetBeReachable(wx, wy, targets)) gain++;
                }
                if (gain === 0) continue;

                const score = gain * 100 - path.length * 10;
                if (score > bestScore) { bestScore = score; best = { path, x, y, gain, escPath: esc.path }; }
            }
        }
        return best;
    }

    /**
     * 假設炸開 (wx,wy) 這格軟磚之後，是否有目標的旁邊格變得可達。
     * 純讀取式模擬，不改動地圖。
     */
    wouldAnyTargetBeReachable(wx, wy, targets) {
        const isOpen = (x, y) => {
            if (x < 1 || y < 1 || x >= this.gridSystem.cols - 1 || y >= this.gridSystem.rows - 1) return false;
            const t = this.mapManager.getBlockType(x, y);
            if (t === 1) return false;                                  // 硬磚
            if (t === 2) return x === wx && y === wy;                  // 只有這一格軟磚會被炸開
            return !this.bombManager.hasBombAt(x, y);
        };
        const adj = [];
        for (const t of targets) {
            for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [0, 0]]) {
                adj.push([t.gridX + dx, t.gridY + dy]);
            }
        }
        const seen = new Set([`${this.gridX},${this.gridY}`]);
        const queue = [[this.gridX, this.gridY]];
        while (queue.length > 0) {
            const [cx, cy] = queue.shift();
            for (const [ax, ay] of adj) if (ax === cx && ay === cy) return true;
            for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                const nx = cx + dx, ny = cy + dy, key = `${nx},${ny}`;
                if (seen.has(key) || !isOpen(nx, ny)) continue;
                seen.add(key); queue.push([nx, ny]);
            }
            if (seen.size > 1500) break;
        }
        return false;
    }

    /**
     * 尋找「在怪物危險半徑之外、又炸得到怪物」的站位，並回傳前往路徑。
     */
    findSnipeSpot(targets, isPierce, myShape) {
        const range = this.fireRange;

        // 站位排除範圍：只排除「怪物所在格」與「緊鄰四格」（十字形），
        // 不要用 3×3 的方塊。
        //
        // 實測：24 個能炸到目標的站位裡，有 13 個被 3×3 規則排除，
        // 導致 findSnipeSpot 永遠回傳 null，AI 完全不會攻擊。
        // 但 DangerMap 的怪物危險區本來就只有半徑 1 的十字形，
        // 用方塊排除等於自己加嚴了一倍，殺傷力大減。
        //
        // 這裡改成與遊戲規則一致：站上去會被碰到（危險）的格子才排除，
        // 其餘只要「放完炸彈能安全撤退」就允許站——膽子大一點才打得贏。
        const blocked = new Set();
        for (const t of targets) {
            blocked.add(`${t.gridX},${t.gridY}`);
            for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                blocked.add((t.gridX + dx) + ',' + (t.gridY + dy));
            }
        }

        let best = null, bestScore = -Infinity;
        for (let y = 1; y < this.gridSystem.rows - 1; y++) {
            for (let x = 1; x < this.gridSystem.cols - 1; x++) {
                if (this.mapManager.isSolid(x, y)) continue;
                if (this.bombManager.hasBombAt(x, y)) continue;
                if (blocked.has(x + ',' + y)) continue;          // 怪物會撞到我
                // 火焰絕對不能站；其他危險只是扣分，不再一票否決
                const info = this.dangerMap.getDangerInfo(x, y);
                if (info.isFlameActive) continue;

                const cells = this.getExplosionCells(x, y, range, isPierce, myShape);
                let hits = 0;
                for (const t of targets) if (cells.has(`${t.gridX},${t.gridY}`)) hits++;
                if (hits === 0) continue;
                if (this.isTeamMateInDangerZone(cells)) continue;

                // 放完炸彈後必须有安全撤退路线（这是硬条件，绝不放棄）
                const esc = this.canSafelyPlaceBomb(x, y, range, isPierce, myShape);
                if (!esc.canEscape) continue;

                const path = this.aStar(this.gridX, this.gridY, x, y, false);
                if (path === null) continue;

                let score = hits * 200 - path.length * 10 + this.countWallCoverage(x, y) * 15;
                // 轻微惩罚「站在危险区边缘」但不再直接排除
                if (info.dangerLevel > 0) score -= 60;
                if (score > bestScore) { bestScore = score; best = { x, y, path, esc }; }
            }
        }
        return best;
    }

    /**
     * 目前是否已經能走到「任一目標的旁邊格」。
     *
     * 怪物所在的格子在 DangerMap 裡必然是危險區，aStar 到不了，
     * 所以判定時一律檢查「怪物周圍 5 格」其中之一是否可達。
     */
    targetsAlreadyReachable() {
        const targets = this.getEnemies();
        if (targets.length === 0) return true;
        for (const t of targets) {
            for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [0, 0]]) {
                const ax = t.gridX + dx, ay = t.gridY + dy;
                if (ax < 1 || ay < 1 || ax >= this.gridSystem.cols - 1 || ay >= this.gridSystem.rows - 1) continue;
                if (this.mapManager.isSolid(ax, ay)) continue;
                if (this.aStar(this.gridX, this.gridY, ax, ay, false)) return true;
            }
        }
        return false;
    }

    /**
     * 判斷「在某格放炸彈炸開 cells 這些軟磚之後」，是否真的能往目標推進。
     *
     * 純讀取式模擬：不會真的改動地圖，只是把 cells 裡的軟磚當成空地，
     * 重新跑一次 BFS，看能不能走到任一目標的旁邊格。
     *
     * 這解決了 tryBreach 選出「炸了也沒用」站位的問題：
     * 舊版只評分軟磚數量，會挑中離目標很遠、放完彈通道依然不通的位置，
     * Bot 走過去發現沒用又走回來，形成無限迴圈（實測 226 次重複同一選擇）。
     */
    wouldAdvanceAfterBreach(bombX, bombY, cells) {
        const targets = this.getEnemies();
        if (targets.length === 0) return true;   // 沒有目標就當純開路，不需推進

        // 把會被炸開的軟磚記成「即將可通行」
        const opened = new Set(cells);

        const isOpenNow = (x, y) => {
            if (x < 1 || y < 1 || x >= this.gridSystem.cols - 1 || y >= this.gridSystem.rows - 1) return false;
            if (this.mapManager.isSolid(x, y)) {
                // 硬磚永遠不可通行；軟磚只有在「即將被炸開」時才可通行
                const t = this.mapManager.getBlockType(x, y);
                if (t === 1) return false;
                return opened.has(`${x},${y}`);
            }
            return !this.bombManager.hasBombAt(x, y);
        };

        // 從放彈的位置出發 BFS
        const seen = new Set([`${bombX},${bombY}`]);
        const queue = [[bombX, bombY]];
        const adjCells = [];
        for (const t of targets) {
            for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [0, 0]]) {
                adjCells.push([t.gridX + dx, t.gridY + dy]);
            }
        }

        while (queue.length > 0) {
            const [cx, cy] = queue.shift();
            for (const [ax, ay] of adjCells) {
                if (ax === cx && ay === cy) return true;   // 已經走到某個目標的旁邊
            }
            for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                const nx = cx + dx, ny = cy + dy;
                const key = `${nx},${ny}`;
                if (seen.has(key)) continue;
                if (!isOpenNow(nx, ny)) continue;
                seen.add(key);
                queue.push([nx, ny]);
            }
            // 安全上限，避免極端地圖下無限擴張
            if (seen.size > 2000) break;
        }
        return false;
    }

    /**
     * 全域找「能炸到敵人且自己走得過去」的最佳站位。
     *
     * 條件（三者缺一不可）：
     *   1. 站位與某個敵人在同一橫/直線且距離 <= fireRange（炸得到）
     *   2. A* 找得到路徑（走得到，且沿途不踩炸彈/火焰）
     *   3. 放完炸彈後有安全的撤退路線（不會自殺）
     *
     * 評分：擊殺數量優先，其次距離短，再次有牆掩護。
     */
    findAmbushSpots(targets, isPierce, myShape) {
        const range = this.fireRange;
        let best = null;
        let bestScore = -Infinity;

        for (let y = 1; y < this.gridSystem.rows - 1; y++) {
            for (let x = 1; x < this.gridSystem.cols - 1; x++) {
                if (this.mapManager.isSolid(x, y)) continue;
                if (this.bombManager.hasBombAt(x, y)) continue;

                // 這個位置放炸彈會炸到誰？
                const cells = this.getExplosionCells(x, y, range, isPierce, myShape);
                let hits = 0;
                for (const t of targets) {
                    if (cells.has(`${t.gridX},${t.gridY}`)) hits++;
                }
                if (hits === 0) continue;
                // 會不會誤傷隊友？
                if (this.isTeamMateInDangerZone(cells)) continue;

                // 放完能不能逃？
                const esc = this.canSafelyPlaceBomb(x, y, range, isPierce, myShape);
                if (!esc.canEscape) continue;

                // 走不走得到？
                //
                // 這裡必須「走到站位本身」(stopBeforeTarget=false)。
                // 舊版傳 true 讓 A* 在距離目標 1 格就停下，那一格很可能正好落在
                // 怪物的危險半徑內，AI 站上去就又被判定成要逃，形成「永遠走不到
                // 攻擊位、也永遠逃不掉」的拉鋸。
                const path = this.aStar(this.gridX, this.gridY, x, y, false);
                if (path === null) continue;

                const walkLen = path.length;
                const score = hits * 200 - walkLen * 12 + this.countWallCoverage(x, y) * 20;
                if (score > bestScore) {
                    bestScore = score;
                    best = { x, y, path, escapePath: esc.path };
                }
            }
        }
        return best;
    }

    // ==================== 陷阱獵殺：把敵人堵在死路 ====================

    tryTrapEnemy() {
        if (this.currentBombs >= this.maxBombs) return false;
        
        const targets = this.getEnemies();
        if (targets.length === 0) return false;
        
        const deadEnds = this.findDeadEnds();
        
        for (const deadEnd of deadEnds) {
            // 檢查是否有敵人在這個死路區域
            const enemyInDeadEnd = targets.find((t) => 
                deadEnd.region.some((r) => r.x === t.gridX && r.y === t.gridY)
            );
            
            if (!enemyInDeadEnd) continue;
            
            // 出口位置放炸彈
            const exitX = deadEnd.exit.x;
            const exitY = deadEnd.exit.y;
            
            // 出口必須可走且沒有炸彈
            if (this.mapManager.isSolid(exitX, exitY)) continue;
            if (this.bombManager.hasBombAt(exitX, exitY)) continue;
            
            // 檢查自己能不能安全放炸彈並逃脫
            const bombRange = Math.max(this.fireRange, 3);
            const myShape = this.getMyExplosionShape();
            const escapeInfo = this.canSafelyPlaceBomb(exitX, exitY, bombRange, this.hasSuperBomb(), myShape);
            
            if (!escapeInfo.canEscape) continue;
            
            // 檢查隊友安全
            const explosionCells = this.getExplosionCells(exitX, exitY, bombRange, this.hasSuperBomb(), myShape);
            if (this.isTeamMateInDangerZone(explosionCells)) continue;
            
            // 走到出口位置放炸彈
            const dist = Math.abs(this.gridX - exitX) + Math.abs(this.gridY - exitY);
            if (dist <= 5) { // 距離夠近才執行
                if (this.gridX === exitX && this.gridY === exitY) {
                    this.aiInput.bomb = true;
                    this.targetPath = escapeInfo.path;
                    this.thinkTimer = 0;
                    this.state = 'TRAP';
                    return true;
                } else {
                    const path = this.aStar(this.gridX, this.gridY, exitX, exitY, false);
                    if (path && path.length > 0) {
                        this.targetPath = path;
                        this.state = 'TRAP';
                        return true;
                    }
                }
            }
        }
        
        return false;
    }

    // ==================== 利用牆壁控制：即使敵人被牆壁擋住，也能透過牆壁用炸彈攻擊 ====================

    tryWallControl() {
        if (this.currentBombs >= this.maxBombs) return false;
        
        const targets = this.getEnemies();
        if (targets.length === 0) return false;
        
        // 我們需要在有牆壁保護的位置放炸彈
        if (!this.isWallProtected(this.gridX, this.gridY)) return false;
        
        const myShape = this.getMyExplosionShape();
        
        for (const enemy of targets) {
            const dist = Math.abs(enemy.gridX - this.gridX) + Math.abs(enemy.gridY - this.gridY);
            if (dist > 5 || dist < 2) continue;
            
            // 同一行或同一列
            if (enemy.gridY !== this.gridY && enemy.gridX !== this.gridX) continue;
            
            // 檢查中間是否有牆壁隔開（這樣敵人就過不來）
            let hasWallBetween = false;
            if (enemy.gridY === this.gridY) {
                const minX = Math.min(this.gridX, enemy.gridX);
                const maxX = Math.max(this.gridX, enemy.gridX);
                for (let x = minX + 1; x < maxX; x++) {
                    const blockType = this.mapManager.getBlockType(x, this.gridY);
                    if (blockType === 1 || blockType === 2) {
                        hasWallBetween = true;
                        // 如果是軟磚塊，炸彈可以破壞它
                        break;
                    }
                }
            } else if (enemy.gridX === this.gridX) {
                const minY = Math.min(this.gridY, enemy.gridY);
                const maxY = Math.max(this.gridY, enemy.gridY);
                for (let y = minY + 1; y < maxY; y++) {
                    const blockType = this.mapManager.getBlockType(this.gridX, y);
                    if (blockType === 1 || blockType === 2) {
                        hasWallBetween = true;
                        break;
                    }
                }
            }
            
            if (!hasWallBetween) continue;
            
            // 確認爆炸能穿過牆壁擊中敵人（穿透炸彈）或炸掉軟磚塊
            const explosionCells = this.getExplosionCells(this.gridX, this.gridY, this.fireRange, this.hasSuperBomb(), myShape);
            
            if (!explosionCells.has(`${enemy.gridX},${enemy.gridY}`)) continue;
            
            // 檢查隊友
            if (this.isTeamMateInDangerZone(explosionCells)) continue;
            
            // 確保自己有安全退路
            const escapeInfo = this.canSafelyPlaceBomb(this.gridX, this.gridY, this.fireRange, this.hasSuperBomb(), myShape);
            if (escapeInfo.canEscape) {
                this.aiInput.bomb = true;
                this.targetPath = escapeInfo.path;
                this.thinkTimer = 0;
                this.state = 'WALL_ATTACK';
                return true;
            }
        }
        
        return false;
    }

    // ==================== 最後手段：巡邏 ====================

    patrolToSafeArea() {
        // 先嘗試前往最近的開放區域（不走回頭路）
        const target = this.findPathToOpenArea();
        if (target && target.path.length > 0) {
            this.targetPath = target.path;
            return;
        }
        
        // 否則嘗試前往最近的軟磚塊
        const softBlockTarget = this.findPathToSoftBlock();
        if (softBlockTarget && softBlockTarget.path.length > 0) {
            this.targetPath = softBlockTarget.path;
            return;
        }
        
        // 最後：有智慧地隨機移動（避免原地發呆）
        this.moveRandomlySafe();
    }

    findPathToOpenArea() {
        // 找到一個「有較多空間」的格子
        const queue = [{ x: this.gridX, y: this.gridY, path: [] }];
        const visited = new Set([`${this.gridX},${this.gridY}`]);
        let best = null;
        let bestScore = 0;
        
        while (queue.length > 0) {
            const curr = queue.shift();
            
            if (curr.path.length > 0) {
                // 計算此格的開放度
                let openCount = 0;
                const dirs = [{dx:0,dy:-1},{dx:0,dy:1},{dx:-1,dy:0},{dx:1,dy:0}];
                for (const d of dirs) {
                    const nx = curr.x + d.dx;
                    const ny = curr.y + d.dy;
                    if (!this.mapManager.isSolid(nx, ny) && !this.bombManager.hasBombAt(nx, ny)) {
                        openCount++;
                    }
                }
                
                // 牆壁覆蓋多的格子較安全
                const wallCoverage = this.countWallCoverage(curr.x, curr.y);
                const score = openCount * 20 + wallCoverage * 15;
                
                // 更遠的格子有額外分數（帶我們探索新區域）
                const travelBonus = Math.min(curr.path.length, 3) * 10;
                const totalScore = score + travelBonus;
                
                if (totalScore > bestScore) {
                    bestScore = totalScore;
                    best = curr;
                }
            }
            
            if (curr.path.length >= 6) continue;
            
            const dirs = [{dx:0,dy:-1},{dx:0,dy:1},{dx:-1,dy:0},{dx:1,dy:0}];
            for (const d of dirs) {
                const nx = curr.x + d.dx;
                const ny = curr.y + d.dy;
                const key = `${nx},${ny}`;
                
                if (visited.has(key)) continue;
                
                const info = this.dangerMap.getDangerInfo(nx, ny);
                if (this.mapManager.isSolid(nx, ny) || info.isFlameActive || info.dangerLevel > 0) continue;
                if (this.bombManager.hasBombAt(nx, ny)) continue;
                
                visited.add(key);
                queue.push({ x: nx, y: ny, path: [...curr.path, {x: nx, y: ny}] });
            }
        }
        
        return best;
    }

    moveRandomlySafe() {
        const dirs = [{dx:0,dy:-1,act:'up'},{dx:0,dy:1,act:'down'},{dx:-1,dy:0,act:'left'},{dx:1,dy:0,act:'right'}];
        const safeDirs = dirs.filter((d) => {
            const nx = this.gridX + d.dx;
            const ny = this.gridY + d.dy;
            if (this.mapManager.isSolid(nx, ny)) return false;
            if (this.bombManager.hasBombAt(nx, ny)) return false;
            const info = this.dangerMap.getDangerInfo(nx, ny);
            return !info.isFlameActive && info.dangerLevel === 0;
        });
        
        if (safeDirs.length > 0) {
            // 優先走向有牆壁保護的方向
            const protectedDirs = safeDirs.filter((d) => {
                const nx = this.gridX + d.dx;
                const ny = this.gridY + d.dy;
                return this.isWallProtected(nx, ny);
            });
            
            // 避免來回原地打轉：偏向新方向
            let chosenDir;
            if (protectedDirs.length > 0 && Math.random() > 0.4) {
                chosenDir = protectedDirs[Math.floor(Math.random() * protectedDirs.length)];
            } else {
                // 嘗試選擇與上次不同的方向
                const nonBackwardDirs = safeDirs.filter((d) => {
                    if (this.lastDx < 0 && d.act === 'right') return false;
                    if (this.lastDx > 0 && d.act === 'left') return false;
                    if (this.lastDy < 0 && d.act === 'down') return false;
                    if (this.lastDy > 0 && d.act === 'up') return false;
                    return true;
                });
                
                const pool = nonBackwardDirs.length > 0 ? nonBackwardDirs : safeDirs;
                chosenDir = pool[Math.floor(Math.random() * pool.length)];
            }
            
            this.aiInput[chosenDir.act] = true;
        }
    }

    // ==================== 炸軟磚開路 ====================

    tryBreakWalls() {
        if (this.currentBombs >= this.maxBombs) return false;
        
        const target = this.findPathToSoftBlock();
        if (target) {
            if (target.path.length === 0) {
                // 已經在軟磚塊旁邊
                const myShape = this.getMyExplosionShape();
                const escapeInfo = this.canSafelyPlaceBomb(this.gridX, this.gridY, this.fireRange, this.hasSuperBomb(), myShape);
                if (escapeInfo.canEscape) {
                    const explosionCells = this.getExplosionCells(this.gridX, this.gridY, this.fireRange, this.hasSuperBomb(), myShape);
                    if (!this.isTeamMateInDangerZone(explosionCells)) {
                        this.aiInput.bomb = true;
                        this.targetPath = escapeInfo.path;
                        this.thinkTimer = 0;
                        this.state = 'BREAK_WALLS';
                        return true;
                    }
                }
            } else {
                this.targetPath = target.path;
                this.state = 'BREAK_WALLS';
                return true;
            }
        }
        return false;
    }

    // ==================== 全域炸彈站位評分（第七輪核心）====================

    /**
     * 枚舉「炸彈物理上可能命中怪物」的所有站位，挑一個綜合評分最好的。
     *
     * 為什麼需要（探針實測，第 15 關）：
     *   trySnipeAttack 只檢查「自己 + 四鄰」5 個格子。實測結果：
     *     候選完全接受（可開火）= 0 次
     *     唯一非零的攔路虎 = 「沒有炸彈容量可用」29 次
     *   換言之它幾乎永遠不開火，26.5 秒只放 5 顆炸彈、8 隻怪一隻沒殺。
     *
     * 與 trySnipeAttack 的三個關鍵差異：
     *   1. 搜尋範圍：從 5 格擴到「與任一隻怪同行/同列、距離 <= fireRange」
     *      的所有格（十字形爆炸物理上唯一能命中的位置集合）。
     *   2. 評分：一次掃到多隻怪最有價值（成本只付一次），
     *      順便炸開軟磚也有價值（開路 = 未來機會）。
     *   3. 路徑：走向目標前先驗證路上安全，避免「衝過去就死」。
     *
     * 節流 0.3 秒：評分要呼叫 canSafelyPlaceBomb（含 BFS），成本不低。
     */
    tryGlobalBombScoring() {
        if (this.currentBombs >= this.maxBombs) return false;
        if (this.noBombTimer > 0) return false;

        const now = this.time;
        if (this._gsAt !== undefined && now - this._gsAt < 0.3) {
            if (!this._gsSpot) return false;
        } else {
            this._gsAt = now;
            this._gsSpot = this.findBestGlobalBombSpot();
        }
        const spot = this._gsSpot;
        if (!spot) return false;

        const cs = this.gridSystem.getCellSize();
        const px = this.gridSystem.getPixelCoord(spot.x, spot.y);
        const arrived = Math.hypot(this.x - (px.x + cs / 2), this.y - (px.y + cs / 2)) <= cs * 0.5;

        if (arrived) {
            // 已就位：必須能逃才放（硬門檻）
            if (!spot.escapeOK) return false;
            this.aiInput.bomb = true;
            this.targetPath = spot.esc.path || [];
            this.state = 'GLOBAL_BOMB';
            this.thinkTimer = 0;
            return true;
        }

        // 未就位：路徑安全才走
        const p = this.aStar(this.gridX, this.gridY, spot.x, spot.y, false);
        if (p && p.length && pathIsSafe(this, p)) {
            this.targetPath = p;
            this.state = 'GLOBAL_BOMB_MOVE';
            return true;
        }
        return false;
    }

    /** 找出綜合評分最高、且目前走得過去的站位 */
    findBestGlobalBombSpot() {
        const live = this.getEnemies().filter(e => !e.isDead);
        if (!live.length) return null;

        const gs = this.gridSystem;
        const R = this.fireRange;
        const shape = this.getMyExplosionShape();
        const isPierce = this.hasSuperBomb();

        const cands = [];
        const seen = new Set();

        // 枚舉：對每隻怪、每個方向、距離 1..R
        // 遇到牆就 break（牆後面更遠的位置也蓋不到）
        for (const m of live) {
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                for (let d = 1; d <= R; d++) {
                    const gx = m.gridX + dx * d, gy = m.gridY + dy * d;
                    if (gx < 1 || gy < 1 || gx >= gs.cols - 1 || gy >= gs.rows - 1) break;
                    if (this.mapManager.isSolid(gx, gy)) break;
                    if (this.bombManager.hasBombAt(gx, gy)) continue;
                    const key = gx + ',' + gy;
                    if (seen.has(key)) continue;
                    seen.add(key);

                    const cells = this.getExplosionCells(gx, gy, R, isPierce, shape);
                    let cover = 0, nearest = Infinity;
                    for (const e of live) {
                        if (cells.has(e.gridX + ',' + e.gridY)) cover++;
                        nearest = Math.min(nearest,
                            Math.abs(e.gridX - gx) + Math.abs(e.gridY - gy));
                    }
                    if (cover === 0) continue;

                    // 順便能炸開的軟磚數 = 開路，未來機會
                    let softs = 0;
                    for (const k of cells) {
                        const [cx, cy] = k.split(',').map(Number);
                        if (this.mapManager.getBlockType(cx, cy) === 2) softs++;
                    }

                    const esc = this.canSafelyPlaceBomb(gx, gy, R, isPierce, shape);
                    const escapeOK = !!(esc && esc.canEscape);
                    const dist = Math.abs(gx - this.gridX) + Math.abs(gy - this.gridY);

                    // 分數：一次多殺幾隻 > 能活 > 開路 > 離怪遠 > 少走路
                    let score = cover * 1000 + (escapeOK ? 500 : 0)
                        + softs * 15 - dist * 5
                        - (nearest <= 1 ? 80 : nearest <= 2 ? 30 : 0);

                    cands.push({ x: gx, y: gy, score, cover, escapeOK, esc, dist });
                }
            }
        }
        if (!cands.length) return null;

        cands.sort((a, b) => b.score - a.score);

        // 依序找第一個「走得過去且路徑安全」的
        for (const c of cands.slice(0, 8)) {
            if (c.x === this.gridX && c.y === this.gridY) return c;
            const p = this.aStar(this.gridX, this.gridY, c.x, c.y, false);
            if (p && p.length && pathIsSafe(this, p)) return c;
        }
        // 都走不到：退而求其次，用原地能炸且能活的
        const here = cands.find(c => c.x === this.gridX && c.y === this.gridY && c.escapeOK);
        if (here) return here;
        return null;
    }

    // ==================== 保證命中（單點修正）====================

    /**
     * 放彈的時候，保證爆風範圍至少蓋住一隻怪「當下的格」。
     *
     * 這是整個計畫唯一必要的行為修正，其餘邏輯一律不動。
     *
     * 依據（全部是實測，不是推測）：
     *   1. 基準線 26.5 秒放 5 顆炸彈、殺 0 隻怪（bb-probe，第 15 關）
     *   2. 炸彈不是瓶頸：maxBombs=1 + 引信 3 秒 => 上限 0.333 顆/秒
     *      => 26.5 秒上限 8.8 顆，實際 5 顆 = 57%，所以「有炸彈可放」
     *   3. 蓋住怪當下的格 => 100% 擊殺；其他條件 => 16.2%（bb-mc2，546 樣本）
     *
     * 結論：唯一要做的是「每一顆炸彈都蓋到怪」。
     *
     * 實作：枚舉「與任一隻怪同行/同列、距離 <= fireRange」的格子。
     * 這是十字形爆炸在物理上唯一可能命中的位置集合，所以枚舉它是完整且窮盡的，
     * 不會漏掉任何能打到的站位。
     *
     * 篩選順序（依重要性）：
     *   1. 必須炸得到至少一隻怪（否則不選，這是本修正的核心）
     *   2. 優先選「炸完能活」的（canSafelyPlaceBomb.canEscape）
     *   3. 同等條件下選離我近的（少走路 = 少暴露）
     *
     * 只在「站得到就放、站不到就走過去」兩種情況下動作，
     * 走過去時會驗證路徑安全，避免為了瞄準而送死。
     */
    tryGuaranteedHitBomb() {
        if (this.currentBombs >= this.maxBombs) return false;
        if (this.noBombTimer > 0) return false;

        const live = this.getEnemies().filter(e => !e.isDead);
        if (!live.length) return false;

        // 0.25 秒節流：怪物位置沒那麼快變，評分含 canSafelyPlaceBomb(BFS) 有成本
        const now = this.time;
        if (this._ghAt !== undefined && now - this._ghAt < 0.25) {
            if (!this._ghSpot) return false;
        } else {
            this._ghAt = now;
            this._ghSpot = this.findHitSpot(live);
        }
        const spot = this._ghSpot;
        if (!spot) return false;

        const cs = this.gridSystem.getCellSize();
        const px = this.gridSystem.getPixelCoord(spot.x, spot.y);
        const arrived = Math.hypot(this.x - (px.x + cs / 2), this.y - (px.y + cs / 2)) <= cs * 0.5;

        if (arrived) {
            // 站到位了，放彈（mustEscape 已在挑選時過濾，這裡再確認一次）
            if (!spot.canEscape) return false;
            this.aiInput.bomb = true;
            this.targetPath = spot.esc.path || [];
            this.state = 'HIT_BOMB';
            this.thinkTimer = 0;
            return true;
        }

        // 還沒站到位：安全地走過去
        const p = this.aStar(this.gridX, this.gridY, spot.x, spot.y, false);
        if (p && p.length && pathIsSafe(this, p)) {
            this.targetPath = p;
            this.state = 'HIT_MOVE';
            return true;
        }
        return false;
    }

    /** 枚舉所有能蓋到怪的站位，挑一個「炸完能活 + 最近」的 */
    findHitSpot(live) {
        const gs = this.gridSystem;
        const R = this.fireRange;
        const shape = this.getMyExplosionShape();
        const isPierce = this.hasSuperBomb();

        let best = null, bestScore = -Infinity;
        const seen = new Set();

        for (const m of live) {
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                for (let d = 1; d <= R; d++) {
                    const gx = m.gridX + dx * d, gy = m.gridY + dy * d;
                    if (gx < 1 || gy < 1 || gx >= gs.cols - 1 || gy >= gs.rows - 1) break;
                    if (this.mapManager.isSolid(gx, gy)) break;   // 牆擋住，裡面更遠的也蓋不到
                    if (this.bombManager.hasBombAt(gx, gy)) continue;
                    const key = gx + ',' + gy;
                    if (seen.has(key)) continue;
                    seen.add(key);

                    // 這個站位的爆炸真的蓋到至少一隻怪嗎？
                    const cells = this.getExplosionCells(gx, gy, R, isPierce, shape);
                    let cover = 0;
                    for (const e of live) if (cells.has(e.gridX + ',' + e.gridY)) cover++;
                    if (cover === 0) continue;                     // <= 核心條件

                    const esc = this.canSafelyPlaceBomb(gx, gy, R, isPierce, shape);
                    const canEscape = !!(esc && esc.canEscape);
                    const dist = Math.abs(gx - this.gridX) + Math.abs(gy - this.gridY);

                    // 能活 + 多殺 + 近 = 高分
                    const score = (canEscape ? 1000 : 0) + cover * 100 - dist;
                    if (score > bestScore) {
                        bestScore = score;
                        best = { x: gx, y: gy, cover, canEscape, esc, dist };
                    }
                }
            }
        }
        return best;
    }

    // ==================== 朝殺怪位推進（第九輪核心）====================

    /**
     * 主動移動到「站上去能炸到怪」的格子。
     *
     * 決定性實測（bb-stage1.mjs，第 1 關 6 場，最簡單的關卡）：
     *   存活 97.6 秒、放彈 1.8 顆、擊殺 0.17 隻、剩 2.8 隻、與怪最近 5 格
     *   產能利用率 = 1.8 / (97.6 x 0.333) = 5.6%
     *
     * 這是整個遊戲最核心的缺口：
     *   之前所有的策略（trySnipeAttack / tryChase / tryBreakWalls ...）
     *   都是在「已經站在某個位置」時做取捨，
     *   沒有一個負責「移動到一個更好的位置」。
     *   結果 Bot 永遠在出生點附近打轉，與怪物維持 5~8 格距離，
     *   而炸彈是十字形、必須站到怪的同一行/列才蓋得到。
     *
     * 實作：直接算出「所有能蓋到怪的格子」，挑一個能安全走到的，走過去。
     * 這和 tryGuaranteedHitBomb 的差別只在於：
     *   tryGuaranteedHitBomb 需要「有炸彈」才動作；
     *   這裡專門處理「沒炸彈」的空窗期（佔 94% 的時間），
     *   提前站好位置，等炸彈回來就能立刻放。
     */
    advanceTowardKillSpot() {
        const live = this.getEnemies().filter(e => !e.isDead);
        if (!live.length) return false;

        const gs = this.gridSystem;
        const R = this.fireRange;
        const shape = this.getMyExplosionShape();
        const isPierce = this.hasSuperBomb();

        let best = null, bestScore = -Infinity;
        const seen = new Set();

        // 枚舉所有「炸得到怪」的站位（十字形爆炸的唯一可能命中集合）
        for (const m of live) {
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                for (let d = 1; d <= R; d++) {
                    const gx = m.gridX + dx * d, gy = m.gridY + dy * d;
                    if (gx < 1 || gy < 1 || gx >= gs.cols - 1 || gy >= gs.rows - 1) break;
                    if (this.mapManager.isSolid(gx, gy)) break;
                    const key = gx + ',' + gy;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    // 站位上不能有還沒爆的炸彈（會擋路）
                    if (this.bombManager.hasBombAt(gx, gy)) continue;

                    const cells = this.getExplosionCells(gx, gy, R, isPierce, shape);
                    let cover = 0;
                    for (const e of live) if (cells.has(e.gridX + ',' + e.gridY)) cover++;
                    if (cover === 0) continue;

                    // 只挑「站上去之後炸完還能活」的站位
                    const esc = this.canSafelyPlaceBomb(gx, gy, R, isPierce, shape);
                    if (!esc || !esc.canEscape) continue;

                    const dist = Math.abs(gx - this.gridX) + Math.abs(gy - this.gridY);
                    const score = cover * 100 - dist;
                    if (score > bestScore) { bestScore = score; best = { x: gx, y: gy }; }
                }
            }
        }
        if (!best) return false;

        // 已經站在某個能殺怪的位置 -> 這裡只負責移動，不需要再動
        if (best.x === this.gridX && best.y === this.gridY) return false;

        const p = this.aStar(this.gridX, this.gridY, best.x, best.y, false);
        if (!p || !p.length) return false;
        if (!pathIsSafe(this, p)) return false;

        this.targetPath = p;
        this.state = 'ADVANCE';
        this.thinkTimer = 0;
        return true;
    }

    // ==================== 朝殺怪位開路（第十輪核心）====================

    /**
     * 放寬版 BFS：把「軟磚」當成「可以用炸彈開路的障礙」，而不是絕對禁行。
     *
     * 為什麼需要（bb-map.mjs 第 1 關，決定性實測）：
     *   空地總數 43 格，從出生點走得到的空地只有 3 格，軟磚 36 塊。
     *   與怪物同行/同列的站位有 6 個，在開放區內的是 0 個。
     *
     *   bb-stage1.mjs 的篩選漏斗：枚舉 1141、蓋不到怪 0、炸完不能逃 0、通過 1141
     *   出口分析：找不到站位 0、已站在站位 0、A*失敗 163、pathIsSafe拒 0
     *
     *   → 站位每一個都完美合格，但 aStar() 163/163 全部回傳 null。
     *
     * 這個 100% 失敗率是 aStar 的「正確」行為：第 4323 行
     * `if (blockType === 2 && !isTargetNode) continue;`
     * 軟磚沒炸開前物理上確實走不過去，放寬它只會產生走不通的路徑。
     *
     * 所以正確做法不是改 aStar，而是**先用炸彈開路**：
     * 找出「通往攻擊站位」的路上第一面擋路軟磚，站到它旁邊把它炸開，
     * 下一幀開放區就多一格，A* 自然就通了。
     *
     * 這完全遵守遊戲規則：軟磚就是能被炸彈炸開，沒有用穿牆、瞬移或額外傷害。
     */
    relaxedBFS(goalTest) {
        const gs = this.gridSystem;
        const dist = new Map();
        const prev = new Map();
        const startK = `${this.gridX},${this.gridY}`;
        dist.set(startK, 0);

        // 簡單的「最小堆」以 cost 為鍵（Dijkstra）
        const open = [{ x: this.gridX, y: this.gridY, c: 0 }];
        let best = null;

        while (open.length > 0) {
            let bi = 0;
            for (let i = 1; i < open.length; i++) if (open[i].c < open[bi].c) bi = i;
            const cur = open.splice(bi, 1)[0];
            const ck = `${cur.x},${cur.y}`;
            if (cur.c > (dist.get(ck) ?? Infinity)) continue;

            const g = goalTest(cur.x, cur.y);
            if (g) { best = { x: cur.x, y: cur.y }; break; }

            for (const d of [{dx:0,dy:-1},{dx:0,dy:1},{dx:-1,dy:0},{dx:1,dy:0}]) {
                const nx = cur.x + d.dx, ny = cur.y + d.dy;
                if (nx < 1 || ny < 1 || nx >= gs.cols - 1 || ny >= gs.rows - 1) continue;
                const bt = this.mapManager.getBlockType(nx, ny);
                if (bt === 1 || bt === 5) continue;          // 硬磚 / 水：絕對不可通行
                if (this.bombManager.hasBombAt(nx, ny)) continue;
                // 軟磚要付一大筆成本（要先停下來放炸彈、躲火、等爆）
                const step = (bt === 2) ? 7 : 1;
                // ===== 第三十輪：距離也要計價，讓「離我近」優先於「牆少」=====
                //
                // 實測（bb-throughput.mjs 第 1 關，stand 從 1,2 漂到 1,5 再到 1,6）：
                // relaxedBFS 只最小化「炸幾面牆」，成本相同時會挑離我更遠的那個，
                // 於是 stand 愈選愈遠、每次換計畫都要從頭走過去。
                // 加入輕微的距離權重（0.35/格）即可讓近的優先，
                // 同時不影響「少炸牆」這個主要目標（7/面 >> 0.35/格）。
                const nk = `${nx},${ny}`;
                const nc = cur.c + step + 0.35;
                if (nc < (dist.get(nk) ?? Infinity)) {
                    dist.set(nk, nc);
                    prev.set(nk, { from: ck, soft: bt === 2 });
                    open.push({ x: nx, y: ny, c: nc });
                }
            }
        }
        if (!best) return null;

        // 回溯路徑，並找出「從自己出發遇到的第一面軟磚」
        const chain = [];
        let k = `${best.x},${best.y}`;
        while (k && k !== startK) {
            const p = prev.get(k);
            if (!p) break;
            const [x, y] = k.split(',').map(Number);
            chain.unshift({ x, y, soft: p.soft });
            k = p.from;
        }
        return { goal: best, chain };
    }

    /**
     * 當攻擊站位「一個都走不到」時，朝最近的那個方向炸開第一道門。
     *
     * 與 tryCarveTowardGoal 的差別：
     *   tryCarveTowardGoal 只看「腳下爆炸範圍內的軟磚」並挑最能拉近距離的，
     *   在 3 格口袋裡常常腳下四周全是空地、炸不到任何軟磚就直接 return false，
     *   於是 Bot 在口袋裡空轉（實測 26.8 秒只放 1.7 顆炸彈）。
     *   這裡是從「目標站位」回推，知道該炸的是「路上第一面牆」，目標明確。
     */
    /**
 * 找出「當前可達集合邊界上、距離自己最近、而且炸得到的那面軟磚」。
 *
 * 第六十一輪。回傳 { wall:{x,y}, stand:{x,y} } 或 null。
 *
 * 判準（三個都必須成立才回傳，寧可不做也不要挑錯）：
 *   1. wall 是軟磚(2)，且緊鄰某個可達格（那就是 stand）
 *   2. stand 必須真的**炸得到** wall（不是任意鄰格）
 *   3. stand 到 wall 的距離 == fireRange 之內、且方向正確
 *
 * 完全遵守遊戲規則：只炸軟磚、只用自己 fireRange 的範圍、
 * 沒有穿牆、瞬移或額外傷害。
 */
findNearestReachableSoftWall() {
    const reach = this.computeReachable();
    if (reach.size === 0) return null;
    const R = this.fireRange;
    const pierce = this.hasPierce;
    const shape = this.getMyExplosionShape();

    let best = null, bestD = Infinity;
    for (const k of reach) {
        const [x, y] = k.split(',').map(Number);
        const cells = this.getExplosionCells(x, y, R, pierce, shape);
        for (const c of cells) {
            const [wx, wy] = c.split(',').map(Number);
            // 必須真的是軟磚（硬磚炸不開、水不能炸）
            if (this.mapManager.getBlockType(wx, wy) !== 2) continue;
            // 這面牆必須貼著可達區（否則炸開了也走不過去）
            let adjacent = false;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                if (reach.has(`${wx + dx},${wy + dy}`)) { adjacent = true; break; }
            }
            if (!adjacent) continue;
            // stand 與 wall 必須相鄰（這樣炸完立刻就能走過去）
            const d = Math.abs(wx - x) + Math.abs(wy - y);
            if (d !== 1) continue;
            if (d >= bestD) continue;
            bestD = d;
            best = { wall: { x: wx, y: wy }, stand: { x, y } };
        }
    }
    return best;
}

/**
 * 站在活彈火場裡、而且所有純移動的逃生手段都失敗時：
 * 放一顆炸彈把旁邊的軟磚牆炸開，用「多出來的空間」換生存空間。
 *
 * 第四十七輪。決定性實測（bb-throughput.mjs）：
 *   第 15 關 120 秒：FLEE 52.8%、可達集合 62.0 格、可殺站位 16.38 個、放彈 5 顆
 *   第 30 關 120 秒：FLEE 63.5%、可達集合 12.4 格、放彈 5 顆
 *
 * FLEE 佔一半以上，因為腳下有活彈時 findGlobalEscapePath 經常無解，
 * 而它的 fallback（trySmartFlee / stepOutOfBlastCell）只是「格內動一下」，
 * 面對會覆蓋整個可達集合的火場毫無作用。
 *
 * 這裡是純移動手段全部失敗後的最後一搏：
 *   1. 找一個「站在當前可達集合內、炸得到軟磚」的位置
 *   2. 確認放彈之後真的有一格不在火場裡（用 blastCoversEntireReachable 排除死路）
 *   3. 放彈，並立刻設定撤退目標為那個安全格
 *
 * 完全遵守遊戲規則：只放自己能力範圍內的炸彈，只炸軟磚（不碰硬磚），
 * 沒有穿牆、瞬移或額外傷害。
 */
carveEscapeFromBlast() {
    if (this.currentBombs >= this.maxBombs) return false;
    // 腳下已有活彈 → 不能再放
    if (this.bombManager.hasBombAt(this.gridX, this.gridY)) return false;
    if (typeof window !== 'undefined' && window.gameMode) {
        const isTeam = window.gameMode.includes('COOP') || window.gameMode.includes('SINGLE');
        if (isTeam) {
            const mates = [window.player, window.player2, window.bot, window.bot2]
                .filter(p => p && !p.isDead && p !== this);
            for (const tm of mates) {
                if (this.bombManager.hasBombAt(tm.gridX, tm.gridY)) return false;
            }
        }
    }

    const R = this.fireRange;
    const pierce = this.hasPierce;
    const shape = this.getMyExplosionShape();

    // 枚舉「可達集合內、炸得到某面軟磚」的站位
    const reach = this.computeReachable();
    const softAt = (bx, by) => {
        const cells = this.getExplosionCells(bx, by, R, pierce, shape);
        for (const c of cells) {
            const [cx2, cy2] = c.split(',').map(Number);
            if (this.mapManager.getBlockType(cx2, cy2) === 2) return true;
        }
        return false;
    };

    // ===== 優先：在「當前位置」直接炸開一面牆 =====
    //
    // 這是最重要的一種情況，因為「站在哪裡」是當下無法改變的事實：
    // 站到別的格需要時間，而引信只有 3 秒。
    // canSafelyPlaceBomb 從當前位置模擬「離開腳下這格」，
    // 所以它評估的就是「站在這裡放彈能不能走出去」——
    // 這正好是我們要的判斷，不該因為「我不在 c.x」就跳過。
    if (softAt(this.gridX, this.gridY) &&
        !this.blastCoversEntireReachable(this.gridX, this.gridY)) {
        const escHere = this.canSafelyPlaceBomb(this.gridX, this.gridY, R, pierce, shape);
        if (escHere && escHere.canEscape && escHere.safeCell && escHere.path.length > 0) {
            this.targetPath = escHere.path.slice();
            this.moveGoal = escHere.safeCell ? { x: escHere.safeCell.x, y: escHere.safeCell.y } : null;
            this.aiInput.bomb = true;
            this.state = 'CARVE_ESCAPE';
            this.carvePlan = null;
            this.commitToEscape();
            return true;
        }
    }

    // 次選：站到某個格再炸（走過去要時間，只在前者不可行時用）
    const cands = [];
    for (const k of reach) {
        const [x, y] = k.split(',').map(Number);
        if (x === this.gridX && y === this.gridY) continue;
        if (!softAt(x, y)) continue;
        cands.push({ x, y });
    }
    if (cands.length === 0) return false;

    // 優先選「離自己最近」的站位（能最快站上去）
    cands.sort((a, b) =>
        (Math.abs(a.x - this.gridX) + Math.abs(a.y - this.gridY)) -
        (Math.abs(b.x - this.gridX) + Math.abs(b.y - this.gridY)));

    for (const c of cands) {
        if (this.blastCoversEntireReachable(c.x, c.y)) continue;   // 死路，跳過
        const esc = this.canSafelyPlaceBomb(c.x, c.y, R, pierce, shape);
        if (!esc || !esc.canEscape || !esc.safeCell) continue;
        // 站過去（不能瞬移，必須走得到）
        const p = this.aStar(this.gridX, this.gridY, c.x, c.y, false);
        if (!p || !p.length) continue;
        this.moveGoal = { x: c.x, y: c.y };
        this.targetPath = p;
        this.aiInput.bomb = true;
        this.state = 'CARVE_ESCAPE';
        this.carvePlan = { gate: null, stand: { x: c.x, y: c.y } };
        return true;
    }
    return false;
}

carveTowardKillSpot() {
        const live = this.getEnemies().filter(e => !e.isDead);
        if (!live.length) { this.carvePlan = null; return false; }

        // ===== 第六十四輪（架構重構完成）：消費 followPath 的開路請求 =====
        //
        // followPath 現在遇到擋路軟磚時不再自己放彈，
        // 而是記下 pendingBreach 並中止路徑（量測：BREACH_REQUEST 180 幀 / 25.3%）。
        // 這裡是唯一的開路決策點，所以請求在這裡被處理：
        // 針對「路徑真正撞到的那面牆」直接排一個計畫。
        //
        // 為什麼要特別處理它：relaxedBFS 找的是「通往攻擊方向最省牆」的路，
        // 那個 gate 可能不是我們現在正想穿過的那面。
        // 而 followPath 已經知道「我就是要穿過 (wallX, wallY)」——
        // 這是比 BFS 猜測更可靠的目標。
        if (this.pendingBreach && this.time < this.pendingBreach.until) {
            const w = this.pendingBreach.wall;
            let planned = false;
            if (this.mapManager.getBlockType(w.x, w.y) === 2) {
                // 站到這面牆的對側（可達集合內、且與牆相鄰）的格子
                const reach0 = this.computeReachable();
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const sx = w.x + dx, sy = w.y + dy;
                    if (!reach0.has(`${sx},${sy}`)) continue;
                    const cells = this.getExplosionCells(sx, sy,
                        this.fireRange, this.hasSuperBomb(), this.getMyExplosionShape());
                    if (!cells.has(`${w.x},${w.y}`)) continue;
                    // ★ 當前格就是合法的 stand 時也要接受。
                    //   followPath 撞牆的前提就是「正站在這面牆旁邊」，
                    //   若跳過當前格，這個分支永遠找不到 stand（實測：
                    //   _carveBail 完全沒有記錄，代表計畫從未建立）。
                    this.pendingBreach = null;
                    this.carvePlan = { gate: { x: w.x, y: w.y }, stand: { x: sx, y: sy } };
                    planned = this.executeCarvePlan(this.carvePlan);
                    if (planned) return true;
                    this.carvePlan = null;
                    break;
                }
            }
            this.pendingBreach = null;
            if (planned) return true;
        }

        // ===== 第二十九輪（決定性）：計畫失效時要能「換一面牆」，不能死守 =====
        //
        // 實測（bb-throughput.mjs，第 1 關 120 秒，第二十八輪之後）：
        //   開路計畫：不同計畫 4 種 -> 1,2->1,3 / 1,5->1,6 / 2,3->3,3 / 1,6->1,7
        //   CARVE_MOVE 62.0%、CARVE_GATE 1.9%、可達集合平均 14.7 格
        //
        // 計畫有在換（4 種），站到站位也會放彈了（CARVE_GATE 140 幀），
        // 但 stand 越選越遠：1,2 -> 1,5 -> 1,6。
        // 每換一次計畫都要從頭走過去，而 stand 越遠走得越久，
        // 於是「走到一半又被下一個更遠的計畫取代」。
        //
        // 這是 relaxedBFS 的目標函式太貪心：它找的是「炸最少牆就能打到怪」，
        // 完全沒有考慮「離我多遠」。當前位置往哪裡炸都一樣要炸那麼多牆時，
        // 它會挑成本相同但位置更遠的那個。
        //
        // 修正：目標函式加上「距離」的權重，讓「離我近」優先於「牆少」。
        // 這不會改變任何遊戲規則，只是讓 AI 先做能立刻驗證的事。
        const P = this.carvePlan;
        if (P) {
            // ===== 第六十八輪（防禦性）：gate 可能為 null =====
            //
            // carveEscapeFromBlast() 會寫下 { gate: null, stand } 的計畫
            // （無牆可炸指示，只是「站到某格再炸」）。
            // 舊版這裡無條件讀 P.gate.x → 崩潰。
            // gate 缺席時視同「牆已不在」，直接讓計畫失效重算即可。
            const gateStillThere = !P.gate || !P.gate.x ?
                false : this.mapManager.getBlockType(P.gate.x, P.gate.y) === 2;
            const standStillOk = this.isWalkableCell(P.stand.x, P.stand.y);
            // 走太久了就放棄這個計畫，換一個近的（否則會被遠計畫拖死）
            const distToStand = Math.abs(P.stand.x - this.gridX) +
                                 Math.abs(P.stand.y - this.gridY);
            // ===== 第三十二輪（決定性）：必須偵測「沒有進展」，否則計畫會永駐 =====
            //
            // 實測（bb-autopsy.mjs aStar 前 10 次回傳，第 1 關）：
            //   (1,1)->(3,3) = 1,2 | 1,3 | 2,3 | 3,3   （路徑本身完全正確）
            //   (1,1)->(3,3) = 1,2 | 1,3 | 2,3 | 3,3
            //   ...連續 9 次完全相同
            //
            // bb-throughput.mjs 的取樣則顯示 20~90 秒之間：
            //   g=(1,3) plan=stand(1,6) tp=3~4 tp0=1,4 或 1,3  off=(1~5, 28~36)
            //
            // 也就是說：路徑是對的、計畫是對的，
            // 但角色在格內反覆被偏移機制拉扯（off.x 在 1↔86 間跳、
            // gridX 在 (1,3)↔(2,3) 之間翻），**從來沒有走完一格**。
            //
            // 舊的失效條件只有三個：牆不見了、站位不能站、stand 太遠。
            // 「站得住但走不過去」完全不在其中，於是計畫永駐，
            // carvePlan 永遠不會重算。
            //
            // 修正：加入「有沒有在靠近 stand」的進展檢測。
            // 連續 N 幀距離沒有縮短，就判定這個計畫走不通，重挑。
            const d = Math.abs(P.stand.x - this.gridX) + Math.abs(P.stand.y - this.gridY);
            if (this._carveLastDist === d) {
                this._carveNoProgress = (this._carveNoProgress || 0) + 1;
            } else {
                this._carveLastDist = d;
                this._carveNoProgress = 0;
            }
            const stalled = this._carveNoProgress >= 45;   // 0.75 秒完全沒前進
            if (gateStillThere && standStillOk && distToStand <= 4 && !stalled) {
                return this.executeCarvePlan(P);
            }
            this.carvePlan = null;
            this._carveLastDist = undefined;
            this._carveNoProgress = 0;
            // 卡住時也把偏移承諾清掉，避免下一個計畫一開始就繼承舊的偏移目標
            this.nudgingOffCenter = false;
            this.nudgeRefCell = null;
            this.nudgeSign = null;
        }

        // ===== 第十二輪（決定性）：開路計畫必須「承諾」，不能每幀重算 =====
        //
        // 決定性實測（bb-throughput.mjs，第 1 關 120 秒）：
        //   SINGLE  CARVE_MOVE 3512 幀、CARVE_GATE 只有 1 幀
        //           可殺站位 0.00 個，0 站位佔 7168/7168 = 100%
        //   COOP    可達集合 15.4 格（總空地 43 格），仍被牆困住
        //
        // 原因：relaxedBFS 每幀都從「當前位置」重新找最便宜的路徑。
        // Bot 每走半格， cheapest path 的第一面軟磚就換一面，
        // 於是 targetPath 每幀被改寫成「往另一面牆走」，
        // 它在幾個候選站位之間反覆橫跳，一格都沒走完。
        //
        // 這和 FLEE 當初的抖振（chattering）是同一個病，
        // 修法也一樣：一旦決定炸哪面牆，就承諾走完，
        // 直到「牆被炸開」或「站位真的不能站」才允許重算。
        //
        // ===== 第十三輪補充：執行失敗「不」等於計畫失效 =====
        // 實測：把「executeCarvePlan 回傳 false」當成失效條件時，
        // aStar / pathIsSafe / canSafelyPlaceBomb 只要有一幀失敗，
        // 計畫就被清掉、立刻重挑一面牆，於是又回到每幀橫跳的狀態
        // （CARVE_MOVE 96.6%、CARVE_GATE 1 幀）。
        // 那些失敗多半是「這一幀暫時走不到」，不是「目標不對」。
        // 所以只有「牆不見了」或「站位不能站」才清除計畫。
        // 註：計畫的「承諾」與「換牆」條件已移到本方法開頭（第二十九輪）。
        // 那裡加了「stand 太遠就換牆」的限制，避免站位愈選愈遠。

        const R = this.fireRange;
        const shape = this.getMyExplosionShape();
        const pierce = this.hasSuperBomb();

        // ---- 步驟 1：放寬搜尋，找出「最少炸牆」的可殺站位 ----
        const plan = this.relaxedBFS((x, y) => {
            if (this.mapManager.getBlockType(x, y) === 2) return false;  // 站位本身要是空地
            const cells = this.getExplosionCells(x, y, R, pierce, shape);
            for (const e of live) if (cells.has(`${e.gridX},${e.gridY}`)) return true;
            return false;
        });
        if (!plan || !plan.chain.length) return false;

        // ---- 步驟 2：若已經有「現在就站得到」的可殺站位，就不要開路 ----
        // 這一條是安全閥：能打的時候先去打，別急著拆牆。
        for (const s of plan.chain) {
            if (s.soft) break;
            const cells = this.getExplosionCells(s.x, s.y, R, pierce, shape);
            let covers = false;
            for (const e of live) if (cells.has(`${e.gridX},${e.gridY}`)) covers = true;
            if (covers && this.aStar(this.gridX, this.gridY, s.x, s.y, false)) return false;
        }

        // ---- 步驟 3：找出路上第一面軟磚，以及要站的位置 ----
        let gate = null;
        for (const s of plan.chain) {
            if (s.soft) { gate = s; break; }
        }
        // 整條路徑都沒有軟磚 → 理論上 A* 應該通；交給攻擊分支處理
        if (!gate) return false;

        // 要站的地方 = 這面牆之前的最後一個空地格
        const gi = plan.chain.indexOf(gate);
        let stand = gi > 0 ? plan.chain[gi - 1] : { x: this.gridX, y: this.gridY };
        if (!this.isWalkableCell(stand.x, stand.y)) return false;

        // ===== 第六十一輪（決定性）：優先炸「離自己最近」的牆 =====
        //
        // 決定性實測（bb-journey 6 局 × 3 模式）：
        //   SINGLE / COOP 都在 6/6 局死在第 1 關、平均死亡關卡 1.0、全破 0
        //
        // bb-autopsy 第 1 關 seed 4242 / 120 秒：
        //   放彈 1 顆、走過 3 格、CORE_MOVE 64.1%、nudgingOffCenter 95.6%
        //
        // 第 1 關只有 3 格可達、6 個站位全在牆外。
        // relaxedBFS 找的是「炸最少牆就能打到怪」的路徑 ——
        // 在這種地圖上，那條路的第一面牆可能離出生點很遠，
        // walk 到 stand 要先在 3 格裡折騰很久。
        //
        // 實務上正確的順序是：**先把最近的那面牆炸開**，
        // 讓可達區域變大之後再開路自然就能選到更好的牆。
        // 「少炸牆」是長期最佳，但前提是「活得夠久走到那裡」。
        //
        // 這裡的做法：如果**當前可達集合的邊界上就有軟磚**，
        // 那就直接挑距離最近的那一面，不走 relaxedBFS 的長路線。
        // 完全是遊戲內的合法動作：炸軟磚、走過去、繼續。
        //
        // ===== 第六十二輪（決定性修正）：只在「區域小到會困死」時用最近牆 =====
        //
        // 量測（bb-modes.mjs 10 局，第六十一輪之後）：
        //   SINGLE 1  DEAD 80% -> 70%  avgSec 132 -> 190  avgLeft 2.3 -> 2.7
        //   SINGLE 15 avgSec 33.8 -> 26.9               avgLeft 9.0 -> 9.3
        //   COOP   15 avgSec 35.4 -> 36.3               avgLeft 6.8 -> 7.8
        //   COOP   30 avgSec 17.3 -> 22.1               avgLeft 12.9 -> 13.9
        //
        // 闖關進步了（bb-journey：COOP 0.00 -> 0.13、VS 0.33 -> 0.63 關），
        // 但單關 throughput 全面退步。
        //
        // 原因很清楚：「永遠炸最近的那面牆」在小地圖（第 1 關 3 格口袋）
        // 是對的，因為那裡沒有選擇；但在大地圖（第 15/30 關可達 60~98 格）
        // 它會變成「永遠炸腳邊那面牆」——完全不考慮哪面牆通往攻擊方向。
        //
        // 正確判準是「有没有選擇」：
        //   區域很小（<= 6 格）→ 沒有選擇，先炸最近牆活命
        //   區域很大          → 有選擇，回到 relaxedBFS 的策略性選擇
        //
        // 這是分情況，不是放寬或放緊 —— 兩種情況各用對的工具。
        const reachNow = this.computeReachable();
        if (reachNow.size <= 6) {
            const nearGate = this.findNearestReachableSoftWall();
            if (nearGate) {
                const p = this.aStar(this.gridX, this.gridY,
                    nearGate.stand.x, nearGate.stand.y, false);
                if (p && p.length) {
                    this.carvePlan = {
                        gate: { x: nearGate.wall.x, y: nearGate.wall.y },
                        stand: { x: nearGate.stand.x, y: nearGate.stand.y },
                    };
                    return this.executeCarvePlan(this.carvePlan);
                }
                return false;
            }
        }

        // 記住這個計畫，之後每幀沿用同一個目標
        this.carvePlan = { gate: { x: gate.x, y: gate.y }, stand: { x: stand.x, y: stand.y } };
        return this.executeCarvePlan(this.carvePlan);
    }

    /**
     * 執行開路計畫：走到 stand，然後炸掉 gate。
     *
     * 拆成獨立方法是為了讓「承諾」能跨幀重用同一份計畫，
     * 目標不會每幀被重新挑選（見 carveTowardKillSpot 的註解）。
     */
    executeCarvePlan(P) {
        const R = this.fireRange;
        const pierce = this.hasSuperBomb();
        const shape = this.getMyExplosionShape();

        // ---- 還沒走到站位 → 走过去 ----
        if (this.gridX !== P.stand.x || this.gridY !== P.stand.y) {
            this.moveGoal = { x: P.stand.x, y: P.stand.y };
            const p = this.aStar(this.gridX, this.gridY, P.stand.x, P.stand.y, false);
            if (!p || !p.length) { this._carveBail = 'noPathToStand'; return false; }

            // ===== 第六十五輪（決定性）：開路途中不該因為「危險」而擋住 =====
            //
            // 決定性實測（bb-autopsy.mjs 第 1 關 seed 4242，200 秒）：
            //   CARVE_MOVE 172 幀（24.2%）而 CARVE_GATE 只有 2 幀（0.3%）
            //   可達集合只有 1~3 格
            //
            // 也就是說計畫永遠停在「走到站位」這一步，從來沒有真的站上去。
            //
            // 原因：pathIsSafe() 檢查「沿途每一格都不能踩進火場」，
            // 而口袋裡只有 1~3 格、怪又逼近，於是任何一格都算危險、
            // 計畫每幀 return false、永遠走不到 stand。
            //
            // 但這裡的語意本來就不同：這是「開路計畫」，
            // 目標不是「安全地站到某處」，而是「多一格空間能讓我們活下來」。
            // 一格危險 vs 零格可走 —— 前者顯然更好。
            //
            // 所以開路計畫只要「離開當前格」就行：
            // 它不比其他移動更不安全，而它到達之後會帶來更多選項。
            // 真正會致命的火場仍然由硬約束（guardAgainstLethalMonster）
            // 與 blastEscape 處理，這裡沒有放寬任何安全標準。
            if (!pathIsSafe(this, p)) {
                // 至少確認第一步是物理走得動的 —— 走不動就等下一幀重算
                // （第六十五輪：斜向要分軸檢查，對齊 Player.update 的分軸碰撞）
                const sx = Math.sign(P.stand.x - this.gridX);
                const sy = Math.sign(P.stand.y - this.gridY);
                const okX = sx === 0 ? true : this.canPhysicallyMove(sx, 0);
                const okY = sy === 0 ? true : this.canPhysicallyMove(0, sy);
                if (!okX && !okY) { this._carveBail = 'standUnreachable'; return false; }
            }

            // ===== 第三十一輪（決定性）：路徑第一格不能是「自己」=====
            //
            // 實測（bb-throughput.mjs 第 1 關 120 秒取樣，2~90 秒全一致）：
            //   g=(1,3) plan=stand(1,6) tp=4 tp0=1,3
            //
            // tp0 恆等於 g，也就是說 aStar 回傳的第一格就是角色自己所在的格。
            // 原因：aStar 以 (gridX, gridY) 為起點，但 gridY 是用「碰撞框中心」
            // 算的 —— 角色站在格底時（off.y ≈ 30~36px），中心已經很接近下一格，
            // 於是 gridY 報成下一格、而 aStar 真正能到達的節點仍在上一格，
            // 回溯出來的第一格就變成「自己」。
            //
            // followPath 有做前導 self 過濾，過濾後路徑變短但仍可能指回自己，
            // 於是 primaryDx=primaryDy=0，角色朝自己格心走 —— 位移為零。
            //
            // 修正：過濾掉等於自己所在格的**所有**節點（不是只過濾前導），
            // 若過濾後路徑空了，代表「這條路的第一步就走不出去」，
            // 這時明確回傳 false 讓呼叫端走 fallback（偏移 / 換計畫），
            // 而不是留一條空路徑讓角色站在原地。
            const filtered = p.filter(n => !(n.x === this.gridX && n.y === this.gridY));
            if (filtered.length !== p.length) {
                const first = filtered[0];
                // 過濾後若變空，或第一格等於自己 → 這條路走不通
                if (filtered.length === 0 ||
                    (first.x === this.gridX && first.y === this.gridY)) {
                    return false;
                }
            }

            this.targetPath = filtered;
            this.state = 'CARVE_MOVE';
            return true;
        }
        this.moveGoal = null;

        // ===== 第三十三輪（決定性）：放彈前必須確認「站得住 + 逃得掉」才放 =====
        //
        // 實測（bb-throughput.mjs 第 1 關，第三十二輪之後）：
        //   存活 11.1s、放彈 3 顆、產能利用率 100%
        //   CARVE_GATE 136 幀（佔 20.5%）= 連續多幀都在放彈狀態
        //
        // CARVE_GATE 佔兩成，代表每幀都重算一次放彈判斷。
        // 問題不在放彈本身，而在「放完之後的這一幀還在放彈位置，
        // 卻沒有立刻執行撤退」——於是被自己的火掃到。
        //
        // canSafelyPlaceBomb 回傳的 esc.path 才是撤退路線，
        // 必須把它設成 targetPath 讓 followPath 真的走。
        // 這裡也順便做一個最低間隔，避免同一顆炸彈被重複評估。
        // ===== 第三十六輪（決定性）：放彈必須有最小間隔，讓 Bot 有時間撤退 =====
        //
        // 實測（bb-modes.mjs 5 局 × 3 模式 × 3 關，第三十五輪之後）：
        //   SINGLE 1   DEAD  20% -> 100%   avgSec 481 -> 13    <-- 嚴重退步
        //   COOP   1   CLEAR  0% ->  20%   avgSec 600 -> 344        <-- 改善
        //   VS     1   avgSec 7.2 -> 126.6                          <-- 改善
        //
        // COOP 與 VS 改善、SINGLE 惡化，差異在於：
        // COOP/VS 有隊友分擔火力與開路，SINGLE 只有 Bot 一個人。
        // 放彈節奏一旦拉太緊，沒有人補位就會直接吃到自己的火場。
        //
        // 根因（bb-throughput 第 1 關 SINGLE）：存活 11.1s、放彈 3 顆。
        // 引信 3 秒，也就是說它「幾乎剛放完就立刻能再放」。
        // 這在數學上等於「炸彈還沒爆就放下一顆」——
        // 兩顆炸彈的火場會疊加，原本能走的一格瞬間變成走不出去。
        //
        // 修正：放彈前必須確認「上一顆自己的炸彈已經炸完且火焰已熄」，
        // 以及「自己腳下與半徑內沒有其他活彈」。
        // 這不是節流，而是讓每一顆炸彈都真正走完它的生命周期。
        const myLive = this.bombManager.bombs.find(
            b => b.player === this && !b.isExploded);
        if (myLive) { this._carveBail = 'ownLiveBomb'; return false; }
        // 半徑內有別的活彈 → 這顆會讓火場疊加，先等
        //
        // 第六十五輪：距離改用「當前格」計算。
        // 舊版用 P.stand，但角色可能根本還沒走到 stand（介面錯配），
        // 於是這個「附近有炸彈」的檢查拿錯誤的位置去比，
        // 會誤擋掉本來可以放的炸彈。
        const R0 = this.fireRange;
        for (const b of this.bombManager.bombs) {
            if (b.isExploded) continue;
            if (b.player === this) continue;      // 已由上面的 myLive 處理
            const d = Math.abs(b.gridX - this.gridX) + Math.abs(b.gridY - this.gridY);
            if (d <= R0 + 1) { this._carveBail = 'nearbyBomb'; return false; }
        }

        // ===== 第三十五輪（決定性）：放彈狀態只能維持一幀 =====
        //
        // 第六十五輪修正：這條約束原本無條件生效，
        // 但放彈還可能被 vetoUnsafeBombPlacement 否決（幾何死路等）。
        // 結果就是「計畫被清掉、炸彈沒放、下一幀重新規劃到同一面牆」——
        // 白白多花一次尋路，而且會讓 no-progress 計數器誤以為計畫失敗。
        //
        // 現在改成「只有在成功送出放彈之後才生效」：
        // 放了 → 清計畫（放彈是一次性決策，且撤退已鎖在 blastEscape）
        // 被否決 → 保留計畫，下一幀還能再試
        this._carveGateCell = P.gate.x * 1000 + P.gate.y;

        const esc = this.canSafelyPlaceBomb(this.gridX, this.gridY, R, pierce, shape);
        if (!esc) { this._carveBail = 'noEsc'; return false; }
        if (!esc.canEscape) { this._carveBail = 'noEscape'; return false; }
        if (!esc.path || esc.path.length === 0) { this._carveBail = 'emptyEscPath'; return false; }
        if (!esc.safeCell) { this._carveBail = 'noSafeCell'; return false; }
        const cells = this.getExplosionCells(this.gridX, this.gridY, R, pierce, shape);
        if (!cells.has(`${P.gate.x},${P.gate.y}`)) {
            this._carveBail = 'gateNotCovered'; return false;   // 炸不到目標牆，白花
        }
        if (this.isTeamMateInDangerZone(cells)) { this._carveBail = 'teamMate'; return false; }
        // 第二十輪：幾何死路（覆蓋整個可達集合）必須擋下來
        if (this.blastCoversEntireReachable(P.stand.x, P.stand.y)) {
            this.aiInput.bomb = false;
            this.targetPath = [];
            this.carvePlan = null;      // 這面牆不能炸，換一面
            this.state = 'CARVE_BLOCKED';
            return false;
        }

        this.aiInput.bomb = true;
        this.targetPath = esc.path.slice();
        this.state = 'CARVE_GATE';
        this.thinkTimer = 0;
        return true;
    }

    // ==================== 保證每幀都有動作（第八輪）====================

    /**
     * 所有優先序都跑完、aiInput 仍然沒有任何方向鍵時的保險。
     *
     * 為什麼需要（bb-why-still.mjs 實測）：
     *   HIT_MOVE 633 幀、BREACH_FOR_ATTACK 396 幀，setDir 都是 0.0%，
     *   合計佔 51% 的時間。這些狀態會設定 targetPath 後 return，
     *   但 targetPath 多半是空陣列，於是 Bot.update() 的 followPath() 不執行，
     *   aiInput 全空 -> Player.update() 裡 dx=dy=0 -> 角色完全不動。
     *
     *   「宣告了狀態，卻沒有任何實際動作」—— 這就是空轉的直接成因。
     *
     * 策略（由安全到冒險，逐級退讓）：
     *   1. 若有 targetPath 但沒被消化 -> 手動走第一步
     *   2. 否則朝「最近的怪物」走一步
     *   3. 否則挑一個物理走得動、且遠離火焰的方向
     *
     * 刻意「不」放彈：這裡只負責讓角色動起來，
     * 開火仍由 tryGuaranteedHitBomb 等攻擊策略依嚴格條件決定。
     * 完全不改動遊戲規則，只是確保按鍵不為空。
     */
    ensureSomeAction() {
        const d = this.aiInput;
        if (d.up || d.down || d.left || d.right) return false;

        if (this.targetPath && this.targetPath.length > 0) {
            const n = this.targetPath[0];
            const ax = Math.sign(n.x - this.gridX), ay = Math.sign(n.y - this.gridY);
            if ((ax || ay) && this.canPhysicallyMove(ax, ay)) {
                if (ax > 0) d.right = true; else if (ax < 0) d.left = true;
                else if (ay > 0) d.down = true; else d.up = true;
                return true;
            }
        }

        const live = this.getEnemies().filter(e => !e.isDead);
        if (live.length) {
            let best = null, bd = Infinity;
            for (const e of live) {
                const dist = Math.abs(e.gridX - this.gridX) + Math.abs(e.gridY - this.gridY);
                if (dist < bd) { bd = dist; best = e; }
            }
            if (best && bd > 0) {
                const p = this.aStar(this.gridX, this.gridY, best.gridX, best.gridY, false);
                if (p && p.length) {
                    const n = p[0];
                    const ax = Math.sign(n.x - this.gridX), ay = Math.sign(n.y - this.gridY);
                    if ((ax || ay) && this.canPhysicallyMove(ax, ay)) {
                        if (ax > 0) d.right = true; else if (ax < 0) d.left = true;
                        else if (ay > 0) d.down = true; else d.up = true;
                        return true;
                    }
                }
            }
        }

        const dirs = [['right', 1, 0], ['left', -1, 0], ['down', 0, 1], ['up', 0, -1]];
        for (const [act, ax, ay] of dirs) {
            if (!this.canPhysicallyMove(ax, ay)) continue;
            const nx = this.gridX + ax, ny = this.gridY + ay;
            if (this.dangerMap.getDangerInfo(nx, ny).isFlameActive) continue;
            if (this.bombManager.hasBombAt(nx, ny)) continue;
            d[act] = true;
            return true;
        }
        return false;
    }

    // ==================== 反困：炸出封閉區域 ====================

    /**
     * 以泛洪算出「我現在走得到的格子」，只走遊戲本身允許通行的格。
     * 用 !mapManager.isSolid() 而不是 getBlockType()===0，
     * 因為前者正是 Player.update() 的碰撞判準，後者會和真實移動不一致。
     */
    reachableRegion() {
        const gs = this.gridSystem;
        const seen = new Set([this.gridX + ',' + this.gridY]);
        const q = [[this.gridX, this.gridY]];
        while (q.length) {
            const [x, y] = q.shift();
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = x + dx, ny = y + dy;
                if (nx < 1 || ny < 1 || nx >= gs.cols - 1 || ny >= gs.rows - 1) continue;
                const k = nx + ',' + ny;
                if (seen.has(k) || this.mapManager.isSolid(nx, ny)) continue;
                seen.add(k); q.push([nx, ny]);
            }
        }
        return seen;
    }

    /**
     * 「死區脫困」：當我走得到的區域裡，完全沒有任何一格的火焰蓋得到任何一隻活怪時，
     * 主動炸開包圍牆往外挖。
     *
     * 為什麼需要（實測 bb-trap.mjs，第 10 關 420 秒快照）：
     *   monsters 7/8、bombs=7（420 秒只放 7 顆）、可達格只有 36 格，
     *   而「蓋得到怪的站位」有 14 個、可達的 0 個。
     *   也就是說 Bot 被封在一個小口袋裡，怪全在牆外，而它每一步都判定
     *   「放彈會死」於是永遠不放 —— 永久卡死，零擊殺。
     *
     * 與 tryBreakWalls() 的差別（為什麼舊的救不了）：
     *   tryBreakWalls 要求 canSafelyPlaceBomb().canEscape 為真才放彈，
     *   而在這種狹小口袋裡這個條件恆為假，所以它永遠不動作。
     *   這裡的取捨是明確的：卡住 = 永遠 0 擊殺 = 必定輸；
     *   冒險放一顆 = 有機會炸開牆。所以「不可逃時仍放」是必要的，
     *   但仍優先選擇可逃的站位，把冒險降到最低。
     *
     * 只在「一個都殺不到」時觸發，正常戰鬥完全不介入，因此不會壓縮炸彈供應。
     */
    tryBreakoutFromDeadZone() {
        if (this.currentBombs >= this.maxBombs) return false;
        if (this.noBombTimer > 0) return false;

        // ===== 效能節流 =====
        //
        // 這段邏輯很貴：泛洪整張圖 + 對每個可達格算一次爆炸範圍。
        // 第 60 關是 35x33（約 1150 格），若每 0.1 秒的 think() 都跑一次，
        // 單場模擬會慢到不可用（實測 10 場跑超過 7 分鐘仍未結束，
        // 而未加這段邏輯時只要 39 秒）。
        //
        // 反困判斷不需要逐幀更新 —— 封閉區域不會在一幀內改變。
        // 所以改成每 0.75 秒才重算一次，中間沿用快取結果。
        const now = this.time;
        if (this._dzAt !== undefined && now - this._dzAt < 0.75) {
            if (!this._dzVerdict) return false;      // 上次判定不是死區 -> 不動作
        } else {
            this._dzAt = now;
            this._dzVerdict = this.computeDeadZoneVerdict();
            this._dzPlan = this._dzVerdict ? this.computeBreakoutPlan() : null;
            if (!this._dzVerdict) return false;
        }
        if (!this._dzPlan) return false;
        return this.executeBreakoutPlan(this._dzPlan);
    }

    /**
     * 只回答一件事：我走得到的區域裡，有没有任何一格能炸到某隻活怪？
     * 順便把脫困計畫一起算出來（可達區域 + 邊界軟磚）。
     */
    computeDeadZoneVerdict() {
        const live = this.getEnemies().filter(e => !e.isDead);
        if (!live.length) return false;

        const shape = this.getMyExplosionShape();
        const region = this.reachableRegion();
        const self = this;

        let canHitSomething = false;
        for (const key of region) {
            const [x, y] = key.split(',').map(Number);
            const cells = self.getExplosionCells(x, y, self.fireRange, self.hasSuperBomb(), shape);
            for (const e of live) {
                if (cells.has(e.gridX + ',' + e.gridY)) { canHitSomething = true; break; }
            }
            if (canHitSomething) break;
        }
        if (canHitSomething) return false;

        // 邊界軟磚：炸掉就能擴大可達範圍
        const usable = [];
        for (const key of region) {
            const [x, y] = key.split(',').map(Number);
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = x + dx, ny = y + dy;
                if (nx < 1 || ny < 1 ||
                    nx >= this.gridSystem.cols - 1 || ny >= this.gridSystem.rows - 1) continue;
                if (this.mapManager.getBlockType(nx, ny) !== 2) continue;
                const cells = this.getExplosionCells(x, y, this.fireRange, this.hasSuperBomb(), shape);
                if (!cells.has(nx + ',' + ny)) continue;
                usable.push({ stand: [x, y], brick: [nx, ny] });
            }
        }
        this._dzUsable = usable;
        return usable.length > 0;
    }

    /** 依「炸完能不能活 / 旁邊有幾條生路 / 離怪多遠」挑最佳站位 */
    computeBreakoutPlan() {
        const live = this.getEnemies().filter(e => !e.isDead);
        const shape = this.getMyExplosionShape();
        const usable = this._dzUsable || [];
        let best = null, bestScore = -Infinity;

        for (const t of usable) {
            const [sx, sy] = t.stand;
            let sc = 0;
            const e = this.canSafelyPlaceBomb(sx, sy, this.fireRange, this.hasSuperBomb(), shape);
            if (e && e.canEscape) sc += 1000;              // 炸完還能活：壓倒性優先
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = sx + dx, ny = sy + dy;
                if (!this.mapManager.isSolid(nx, ny) && !this.bombManager.hasBombAt(nx, ny)) sc += 25;
            }
            let nearest = Infinity;
            for (const e2 of live) {
                nearest = Math.min(nearest, Math.abs(e2.gridX - sx) + Math.abs(e2.gridY - sy));
            }
            sc += Math.min(nearest, 8) * 4;
            sc -= (Math.abs(sx - this.gridX) + Math.abs(sy - this.gridY)) * 0.1;
            if (sc > bestScore) { bestScore = sc; best = { t, e, score: sc }; }
        }
        return best;
    }

    /** 執行快取的脫困計畫：走過去 -> 站穩 -> 放彈 */
    executeBreakoutPlan(plan) {
        if (!plan) return false;
        const [sx, sy] = plan.t.stand;

        if (sx !== this.gridX || sy !== this.gridY) {
            const p = this.aStar(this.gridX, this.gridY, sx, sy, false);
            if (p && p.length) {
                this.targetPath = p;
                this.state = 'BREAKOUT';
                return true;
            }
            return false;
        }

        const e = plan.e;
        if (e && e.canEscape) {
            this.aiInput.bomb = true;
            this.targetPath = e.path || [];
            this.state = 'BREAKOUT';
            this.thinkTimer = 0;
            return true;
        }

        // 冒險放彈：必須有冷卻，否則怪物多的關卡會不斷重複自殺
        // （無冷卻版本：SINGLE 60 存活 22.5s -> 14.2s，COOP 60 147s -> 19s）
        if (this.time - (this._breakoutRiskyAt || -999) < 2.5) return false;

        this.aiInput.bomb = true;
        this.targetPath = (e && e.path) ? e.path : [];
        this.state = 'BREAKOUT';
        this.thinkTimer = 0;
        this._breakoutRiskyAt = this.time;
        return true;
    }

    // ==================== 路徑尋找 ====================

    aStar(startX, startY, goalX, goalY, stopBeforeTarget = false) {
        const openSet = [{ x: startX, y: startY, path: [], g: 0, f: this.heuristic(startX, startY, goalX, goalY) }];
        const closedSet = new Set();

        while (openSet.length > 0) {
            openSet.sort((a, b) => a.f - b.f);
            const curr = openSet.shift();

            const distToGoal = Math.abs(curr.x - goalX) + Math.abs(curr.y - goalY);
            if (curr.x === goalX && curr.y === goalY) {
                return curr.path;
            } else if (stopBeforeTarget && distToGoal === 1) {
                return curr.path;
            }

            closedSet.add(`${curr.x},${curr.y}`);

            const dirs = [{dx:0,dy:-1},{dx:0,dy:1},{dx:-1,dy:0},{dx:1,dy:0}];
            for (const d of dirs) {
                const nx = curr.x + d.dx;
                const ny = curr.y + d.dy;
                const key = `${nx},${ny}`;

                if (closedSet.has(key)) continue;

                const isTargetNode = (nx === goalX && ny === goalY);
                const blockType = this.mapManager.getBlockType(nx, ny);
                const info = this.dangerMap.getDangerInfo(nx, ny);
                const isFlame = info.isFlameActive;
                const isDanger = info.dangerLevel > 0;

                // 硬磚(1)永遠不可通行——它是遊戲規則裡唯一無法炸開的牆。
                // 邊界外也視為不可通行。
                if (nx < 0 || ny < 0 || nx >= this.gridSystem.cols || ny >= this.gridSystem.rows) continue;
                if (blockType === 1) continue;

                // ===== 第十輪（決定性修正）：第一步必須通過真實物理判定 =====
                //
                // 決定性實測（bb-stage1.mjs，第 1 關，25 秒 / 1500 幀）：
                //   carveTowardKillSpot 被呼叫 1469 次，決定移動 1289 次，
                //   開放區大小 0s=3 -> 5s=10 之後永遠卡在 10，40 秒只放 1 顆炸彈。
                //
                //   逐幀座標記錄顯示一個 2 格振盪：
                //     bot(2,3)->stand(1,5) len=3 first=(1,3) physDn=false
                //     bot(1,3)->stand(1,5) len=2 first=(1,4) physDn=false
                //     bot(2,3)->stand(1,5) len=3 first=(1,3) physDn=false
                //     bot(1,3)->stand(1,5) len=2 first=(1,4) physDn=false
                //
                //   aStar 規劃的第一格是「往下」，但 canPhysicallyMove(0,+1) = false。
                //   Bot 於是在 (2,3) 與 (1,3) 之間來回擺動 1289 幀，
                //   永遠走不到 stand，開放區永遠卡在 10 格，一顆炸彈都放不出去。
                //
                // 根因：aStar 只檢查「目標格是否 solid」，
                // 但遊戲的真實碰撞是「自身碰撞框（cellSize×cellSize、內縮 0.2 cell）
                // 的四個角是否落在 solid 格上」。角色在格內偏上／偏下時，
                // 目標格明明是空地，某一個角仍會伸進鄰格的牆裡，一格也走不過去。
                //
                // 這裡只用當下的真實像素位置驗證「離開起點的那一步」——
                // 只有那一步能用 this.x/this.y 精確重演物理判定；
                // 往後的步驟位置會隨移動改變，無法在此判斷（與
                // canSafelyPlaceBomb 內同樣的理由，第 1312 行）。
                //
                // ===== 第十三輪修正：用「寬鬆版」判定，不要用嚴格版 =====
                //
                // 實測（bb-throughput.mjs，第 1 關 120 秒）：
                //   CARVE_MOVE 佔 96.6%（6951 幀）、CARVE_GATE 只有 1 幀，
                //   aStar 有 45% 的呼叫直接回傳 null。
                //
                // 根因：嚴格版 canPhysicallyMove() 用「當下的精確像素」判斷，
                // 角色只要在格內偏一點（偏 10~30 px），要走的方向就會被判成
                // 「碰撞框某個角卡到鄰格牆裡」而回傳 false，
                // 於是這個鄰節點整個被砍掉，aStar 宣告無路可走。
                //
                // 但那些「走不通」其實只是「還沒站正」——
                // followPath() 的 applyCrossAxis 與 tryAlignToCellCenter()
                // 本來就會先把角色拉回格心再前進。
                // 嚴格版把它們唯一能用的路徑提前堵死，AI 只能站在原地。
                //
                // 寬鬆版 isStepWalkable() 的行為正是對的：
                //   四角碰到鄰格牆壁時，只要「目標格本身可通行」就放行，
                //   把精確的物理可行性交給 update() 的 canPhysicallyMove()
                //   與 breakOutOfStall() 處理（第 4815 行原本的設計意圖）。
                //
                // 這一輪同時解決兩個問題：
                //   - 不再回傳「第一步就走不通」的路徑（第十輪修好的）
                //   - 也不再因為「角色沒站正」就宣判無路（第十一輪修壞的）
                if (curr.x === startX && curr.y === startY) {
                    if (!this.isStepWalkable(curr.x, curr.y, nx, ny)) continue;
                }

                // 軟磚(2)：可以被自己放的炸彈炸開，所以「理論上可通行」。
                // 這裡放行是為了讓 AI 能規劃出「先炸開這面牆再穿過去」的路徑——
                // 舊版用 isSolid() 一律擋掉軟磚，等於宣告「牆永遠打不開」，
                // 那是通關率上不去的主因之一。
                //
                // 軟磚要付額外代價（多一步），讓 AI 優先走空地而不是硬拆牆。
                const softCost = (blockType === 2 && !isTargetNode) ? 3 : 0;

                // 軟磚被炸開之前物理上走不過去，不能作為「下一步」；
                // 但它仍可作為「炸彈的目標位置」，這由 findPathToSoftBlock 負責。
                // 因此這裡只允許「空地」作為路徑節點，保持路徑本身一定走得通。
                if (blockType === 2 && !isTargetNode) continue;

                if (!isTargetNode && (this.bombManager.hasBombAt(nx, ny) || isFlame)) {
                    continue;
                }

                // ===== 危險格：改用「成本」而不是「阻擋」=====
                //
                // 實測（通關率無法提升的核心瓶頸）：
                // 舊版在這裡把 dangerLevel > 0 的格子直接擋掉，於是 aStar 回傳 null。
                // 而 DangerMap 的危險區會隨炸彈出現／消失、也會被怪物佔用而變動，
                // 結果攻擊站位「瞬間不可達」：
                //   實測站位報告 (6,1) danger=0 monster=false canEsc=true 但 path=NULL，
                //   而 (3,1) 雖然 path=1 卻因 monster=true 被視為危險而 AI 不敢去。
                // 結果 AI 永遠找不到安全射線 → 一隻怪都殺不到。
                //
                // 修正：危險只是「比較不划算」，不是「不能走」。
                // 讓它可以通行但付出額外成本，AI 就會在「繞遠路」與「冒險穿過危險區」
                // 之間自行取捨，而不是直接宣告無路可走。
                //
                // 這不改動任何遊戲規則：真正會致命的火焰與炸彈格仍然照舊阻擋，
                // 傷害、範圍、引信時間完全維持原設定。
                const dangerCost = (!isTargetNode && isDanger) ? 6 : 0;

                const g = curr.g + 1 + softCost + dangerCost;
                const h = this.heuristic(nx, ny, goalX, goalY);
                const f = g + h;

                const existing = openSet.find((n) => n.x === nx && n.y === ny);
                if (existing) {
                    if (g < existing.g) {
                        existing.g = g;
                        existing.f = f;
                        existing.path = [...curr.path, {x: nx, y: ny}];
                    }
                } else {
                    openSet.push({ x: nx, y: ny, path: [...curr.path, {x: nx, y: ny}], g: g, f: f });
                }
            }
        }
        return null;
    }

    heuristic(x1, y1, x2, y2) {
        return Math.abs(x1 - x2) + Math.abs(y1 - y2);
    }

    /**
     * 判斷從目前所在格 (x1,y1) 往相鄰格 (x2,y2) 移動，在「當下的真實像素位置」下
     * 是否走得過去。
     *
     * 為什麼不能用「假設角色在格子中心」的方式推算：
     * Player 的碰撞是以自身碰撞框（cellSize×cellSize 內縮 0.2 cell）的四個角
     * 對 solid 格判定。角色剛踏進新格時，中心點可能仍偏在舊格那一側，四角就已經
     * 伸進上下左右鄰格的牆裡——此時目標格明明是空的，實際上一格也動不了。
     * 舊的 aStar 只看目標格 isSolid()，因此會規劃出這種走不通的路，AI 就會在
     * 同一格來回打轉、永遠推不進。
     *
     * 這裡直接沿用「真實 this.x / this.y」模擬下一步的四角，與 Player.update
     * 的 checkCollision 用同一套條件判定，確保規劃出的路徑一定走得過去。
     */
    isStepWalkable(x1, y1, x2, y2) {
        // 目標格本身的靜態檢查
        if (this.mapManager.isSolid(x2, y2)) return false;
        if (this.bombManager.hasBombAt(x2, y2)) return false;
        const info = this.dangerMap.getDangerInfo(x2, y2);
        if (info.isFlameActive) return false;

        const dx = x2 - x1;
        const dy = y2 - y1;

        const cs = this.gridSystem.getCellSize();
        const pad = cs * 0.2;
        const useReal = (this.gridX === x1 && this.gridY === y1);
        const ox = this.gridSystem.offsetX, oy = this.gridSystem.offsetY;
        const baseX = useReal ? this.x : ox + x1 * cs;
        const baseY = useReal ? this.y : oy + y1 * cs;

        const step = cs;
        const nx = dx !== 0 ? baseX + Math.sign(dx) * step : baseX;
        const ny = dy !== 0 ? baseY + Math.sign(dy) * step : baseY;

        const corners = [
            [nx + pad, ny + pad],
            [nx + cs - pad, ny + pad],
            [nx + pad, ny + cs - pad],
            [nx + cs - pad, ny + cs - pad],
        ];
        for (const [cx, cy] of corners) {
            const g = this.gridSystem.getGridCoord(cx, cy);
            if (this.mapManager.isSolid(g.x, g.y)) {
                // 嚴格四角判定只有在「連目標格本身都不通」時才真的走不過去。
                // 但四角碰到鄰格牆壁時，角色仍可能靠「先對齊該軸再走」抵達，
                // 所以這裡退一步：只要目標格可通行就放行，把精確的物理可行性
                // 交給 update() 裡的 canPhysicallyMove() 與 breakOutOfStall() 處理。
                // 過度嚴格會把所有路徑都封死，讓 AI 連平面移動都做不到。
                return !this.mapManager.isSolid(x2, y2);
            }
        }
        return true;
    }

    /**
     * 假設先沿 (sDx,sDy) 偏移幾幀、再走主軸 (mDx,mDy) 一步，
     * 四個角會不會撞到 solid。
     *
     * 這是 alignToClearCorner 能「挑對邊」的關鍵。
     *
     * 實測（bb-throughput.mjs，第 1 關，40 秒）：
     *   followPath 之後 left=true 2242 幀、按著左鍵 x 有變動 1163 幀，
     *   但每 10 秒取樣的 off 都是 (0,31) —— 淨位移為零，它在左右振盪。
     *
     * 原因：舊版 alignToClearCorner 是「試左，走不通就試右」。
     * 往左走到貼住 (0,3) 硬磚之後 canPhysicallyMove(-1,0) 變成 false，
     * 於是它改按右；往右回到格心後主軸又不通了，於是再按左。
     * 兩個方向互相抵消，角色在格子裡來回抽屜 40 秒。
     *
     * 但它其實只需要持續往左：往左到 off.x < -26 之後，
     * 碰撞框右下角就會離開 (2,4) 那面硬磚，往下立刻走得通。
     *
     * 所以選邊的標準必須是「偏移之後主軸會不會通」，
     * 而不是「偏移本身通不通」。這個函式就是回答那個問題的。
     */
    canMoveAfterShift(sDx, sDy, mDx, mDy) {
        const cs = this.gridSystem.getCellSize();
        const pad = cs * 0.2;
        const step = this.speed * (this.hasDash ? 1.5 : 1) * cs * (1 / 60);
        const mx = this.x + mDx * step;
        const my = this.y + mDy * step;
        // 由小到大試各種偏移量：能通就立刻回報，避免「探測太粗而誤判不可行」
        for (const frames of [2, 3, 4, 5, 6, 8, 10, 12]) {
            const nx = this.x + sDx * step * frames;
            const ny = this.y + sDy * step * frames;
            const corners = [
                [nx + pad, ny + pad],
                [nx + cs - pad, ny + pad],
                [nx + pad, ny + cs - pad],
                [nx + cs - pad, ny + cs - pad],
            ];
            let ok = true;
            for (const [cx, cy] of corners) {
                const g = this.gridSystem.getGridCoord(cx, cy);
                if (this.mapManager.isSolid(g.x, g.y)) { ok = false; break; }
            }
            // 偏移之後主軸也要走得通（這才是選邊的真正判準）
            if (ok) {
                const fx = nx + mDx * step, fy = ny + mDy * step;
                const fc = [
                    [fx + pad, fy + pad], [fx + cs - pad, fy + pad],
                    [fx + pad, fy + cs - pad], [fx + cs - pad, fy + cs - pad],
                ];
                for (const [cx, cy] of fc) {
                    const g = this.gridSystem.getGridCoord(cx, cy);
                    if (this.mapManager.isSolid(g.x, g.y)) { ok = false; break; }
                }
            }
            if (ok) return true;
        }
        void mx; void my;
        return false;
    }

    /**
     * 當「移動目標」可達方向被鄰格牆角卡住時，先橫向挪一點。
     *
     * 與 targetPath 無關：只要目標格可通行、而當下的像素位置讓主軸走不過去，
     * 就先挑一邊偏移。下一幀四角離開牆角，主軸自然就通。
     *
     * 實測依據（第 1 關 40 秒逐幀）：
     *   g=(1,3) off=(12,31) physD=false，目標是往下到 (1,4)
     *   (1,4) 是空地但 (2,4) 是硬磚，角色不夠靠左時右下角會撞上牆角。
     *   需要 off.x <= 26 左右才走得通，而它停在 12 就停住不動了。
     */
    tryNudgeForProgress() {
        const g = this.moveGoal;
        if (!g) return false;
        if (g.x === this.gridX && g.y === this.gridY) return false;

        const dx = Math.sign(g.x - this.gridX);
        const dy = Math.sign(g.y - this.gridY);
        if (dx === 0 && dy === 0) return false;

        // ===== 第六十六輪（決定性）：先看「路徑的下一格」走得通不走得通 =====
        //
        // 決定性實測（_tmp_osc.mjs 第 2 關 seed 999 逐幀，f9~f12 無限振盪）：
        //   f9 grid=(1,2) px=(172,135) moveGoal=(3,3) tp0=1,2
        //      canPhysicallyMove(1,1)=false   <- moveGoal 是斜向，被牆角擋住
        //      canPhysicallyMove(0,1)=true    <- 但路徑下一格 (1,3) 直直往下走得通
        //   tryNudgeForProgress() 以 moveGoal 的斜向 (1,1) 判定「走不動」
        //   → pickNudgeSign 挑正交軸 → 設成 up=true
        //   → 下一幀角色被拉回 px y=129（cell(1)），又算成 grid=(1,1)
        //   → 再往 (1,2) 走 → 又進 (1,2) 又被拉回 …… 淨位移恆為零
        //   → CARVE_MOVE 7168 幀、UNSTUCK 7110 幀，100 秒一格都沒前進，
        //     放彈 0~1 顆，第 1 關永遠卡死（實測 6 局裡 3 局直接 TIMEOUT）。
        //
        // 根因：moveGoal 是「最終目標格」，通常是斜對角，但真正該走的是
        // 路徑的下一格 targetPath[0]。兩者方向不同時，用 moveGoal 判斷
        // 「走不動」會誤觸發偏移，而偏移方向與真實路徑相反，
        // 於是每幀把角色拉離路徑、再被拉回，形成標準的零淨位移振盪。
        //
        // 正確判準：**以路徑的下一格為準。** 它物理上走得通時，
        // 這不是「卡牆角」，只是「還沒走到下一格」，
        // 該做的是沿路徑前進（交給 followPath 主軸邏輯），不是偏移。
        // 只有連路徑下一格都走不通時，才需要偏移去離開牆角。
        //
        // 這不放寬任何安全標準：偏移的場合（真的卡在牆角）仍然會觸發，
        // 只是不再用「斜對角的最終目標」冒充「當下走不動」。
        if (this.targetPath && this.targetPath.length > 0) {
            const step = this.targetPath[0];
            // 去掉「等於自己所在格」的前導節點（與 followPath 同一處理）
            let idx = 0;
            while (idx < this.targetPath.length &&
                   this.targetPath[idx].x === this.gridX &&
                   this.targetPath[idx].y === this.gridY) {
                idx++;
            }
            const realNext = this.targetPath[idx];
            if (realNext) {
                const sdx = Math.sign(realNext.x - this.gridX);
                const sdy = Math.sign(realNext.y - this.gridY);
                // 路徑下一格是正交單步且物理走得通 → 交給 followPath，不要偏移
                if ((sdx === 0) !== (sdy === 0) && this.canPhysicallyMove(sdx, sdy)) {
                    return false;
                }
            }
        }

        // 主軸本來就走得通 → 不需要偏移，讓正常的路徑跟隨處理
        if (this.canPhysicallyMove(dx, dy)) return false;
        // 目標格不可通行 → 這是真的牆，偏移沒用
        if (!this.isWalkableCell(this.gridX + dx, this.gridY + dy)) return false;

        // ===== 第十九輪（決定性修正）：正在逃命時，絕對不准偏移 ====
        //
        // 決定性實測（bb-autopsy.mjs，第 1 關，seed 4242）：
        //   f312 FLEE (1,2) DR goal=1,3 carve=1,2->1,3 nudge=Y pR=0 oX=31.6 oY=86.4
        //   f314 FLEE (1,1) L  goal=1,3 carve=1,2->1,3 nudge=Y pR=1 oX=37.4 oY=4.9
        //   f316 FLEE (1,2) DR goal=1,3 carve=1,2->1,3 nudge=Y pR=0 oX=29.2 oY=84.0
        //
        // oY 在 86 和 4.9 之間跳，gridY 在 (1,2)/(1,1) 之間翻，
        // 整場 FLEE 佔 54.6%、可達 1 格佔 48.4%，最後被自己的火燒死在 (1,2)。
        //
        // 原因：followPath() 的第一行就是 tryNudgeForProgress()，
        // 它完全不看「現在是不是在逃命」就設定方向。
        // 偏移的目標是「當前格中心」，而 Bot 站在格邊界上時
        // gridY 會在相鄰兩格之間跳，「當前格中心」跟著跳 ——
        // 於是偏移方向每幀翻面，抵消掉真正的逃生方向，Bot 在火場邊緣原地抽屜。
        //
        // 生命安全是硬約束，偏移只是效率優化。兩者衝突時必須先保命。
        if (this.escapeCommitted || this.isInsideLiveBlast()) return false;

        // ===== 第四十四輪（決定性）：已接近格心時，別橫移，直接沿主軸走 =====
        //
        // 決定性實測（bb-throughput.mjs 第 1 關 180 秒，第四十三輪之後）：
        //   10s g=(1,3) plan=stand(1,5) tp=3 tp0=1,3 off=(3,28)  physD=false
        //   20s g=(2,3) plan=stand(1,5) tp=2 tp0=1,4 off=(86,30) physD=false
        //   30s g=(1,3) plan=stand(1,5) tp=2 tp0=1,4 off=(2,34)  physD=true
        //   50s g=(2,3) plan=stand(1,5) tp=2 tp0=1,4 off=(85,33) physD=true
        //
        // 90 秒裡它在 (1,3) 與 (2,3) 之間橫向往返，stand(1,5) 從未到達。
        // off.x 在 2~4 與 83~87 之間跳 = 一整格（cs=87.3），
        // 代表角色反覆跨過 x 的格線；而目標 (1,4) 就在 (1,3) 正下方一格。
        //
        // 根因：pickNudgeSign 判「往左右挪之後往下走得通」，
        // 兩邊都回 true 時挑第一個（往左）。但往左挪只是移到格內左半部，
        // **不會讓它往下走** —— 往下走需要 x 對齊在格心附近，
        // 而橫移恰恰把 x 推離格心。
        //
        // 更糟的是：橫移走滿半格就跨到隔壁格，gridX 翻頁、
        // 偏移目標跟著換、方向再翻一次，於是永久循環。
        //
        // 修正：當下已經很接近格心（離心 < 0.25 格）時，
        // 問題不是「卡牆角」而是「還差一點才走得通」，
        // 此時**不該橫移**，該做的是沿主軸方向走一步 ——
        // 那一步會自然把角色帶到格心，順利進入下一格。
        const cs3 = this.gridSystem.getCellSize();
        const cX3 = this.gridSystem.offsetX + this.gridX * cs3 + cs3 / 2;
        const cY3 = this.gridSystem.offsetY + this.gridY * cs3 + cs3 / 2;
        if (Math.abs(cX3 - this.x) < cs3 * 0.25 &&
            Math.abs(cY3 - this.y) < cs3 * 0.25) {
            this.aiInput.up = this.aiInput.down = false;
            this.aiInput.left = this.aiInput.right = false;
            if (dx > 0) this.aiInput.right = true;
            else if (dx < 0) this.aiInput.left = true;
            else if (dy > 0) this.aiInput.down = true;
            else this.aiInput.up = true;
            this.state = 'CORE_ALIGN';
            return true;
        }

        // ===== 第二十六輪（決定性）：偏移方向必須「與主軸正交」且「承諾」=====
        //
        // 實測（bb-throughput.mjs 第 1 關 120 秒取樣）：
        //   g=(1,3) plan=stand(1,5) tp=3 tp0=1,3 off=(4,30) physD=false
        //
        // 想往下走，物理上往下走不通，需要**水平**偏移（左右）才能走通。
        // 但舊邏輯的偏移目標是「當前格心」，而 Bot 已經 off.x≈84（貼著右邊界），
        // 「朝格心」= 往左；往左會讓右下角離開鄰格牆角更遠，
        // 主軸反而更走不通 —— 每幀在「朝心」與「更卡」之間來回。
        //
        // 也就是說：偏移與主軸必須互相配合，不能互相對抗。
        // 正確語意就是 canMoveAfterShift 原本在做的事
        // （「偏移之後主軸會通」），但必須加上承諾，否則每幀翻面。
        if (this.nudgingOffCenter && this.nudgeRefCell) {
            this._nudgeFrames = (this._nudgeFrames || 0) + 1;
            // ===== 第四十五輪（決定性）：偏移必須有時間上限 =====
            //
            // 決定性實測（bb-autopsy.mjs canMoveAfterShift 前 20 筆，第 1 關）：
            //   f9  shift(0,-1) main(1,1) g=1,2 pR=0 => true
            //   f12 shift(0,-1) main(1,1) g=1,2 pR=0 => true
            //   ... 連續 20 幀，每幀位置都是 g=1,2、判斷都是 true
            //
            // 每幀都在「往上下移」的判斷裡回 true，
            // 於是 applyNudgeDirection 每幀都重設同一個方向、永不退出：
            // 角色在格內反覆上下，全場 CARVE_MOVE 65.7%、放彈 1 顆/180 秒。
            //
            // 根因：**canMoveAfterShift 回 true 只代表「這樣挪之後主軸走得通」**，
            // 它沒有、也不可能有「挪了多久該停」的判斷。
            // 承諾機制需要自己帶時間上限，否則會無限期延續。
            //
            // 這裡用幀數上限：偏移只是為了「離開牆角」，
            // 一幀 5.8px、偏移軸最多 0.34cs ≈ 29.7px，5 幀之內必須到位。
            // 超時就放棄偏移、交還決策權，讓上層重新規劃。
            if (this._nudgeFrames > 8) {
                this._nudgeFrames = 0;
                this.nudgingOffCenter = false;
                this.nudgeRefCell = null;
                this.nudgeSign = null;
                // 正在逃命時不要清掉撤退路徑 —— 那是我唯一的生路
                const fleeing = this.escapeCommitted || this.isInsideLiveBlast();
                if (!fleeing) {
                    this.carvePlan = null;
                    this.moveGoal = null;
                }
                return false;
            }
            return this.applyNudgeDirection();
        }
        this._nudgeFrames = 0;

        this.nudgingOffCenter = true;
        this.consecutiveStuck = 0;
        this.nudgeRefCell = { x: this.gridX, y: this.gridY };
        // 主軸水平 → 需要垂直偏移；主軸垂直 → 需要水平偏移
        this.nudgeAxis = dx === 0 ? 'x' : 'y';
        if (!this.pickNudgeSign(dx, dy)) {
            // 兩個偏移方向都不通 → 這條路真的走不通，放棄偏移
            this.nudgingOffCenter = false;
            this.nudgeRefCell = null;
            return false;
        }
        this.state = 'CORE_ALIGN';
        return true;
    }

    /**
     * 沿著「與主軸正交的軸」選一個偏移方向，
     * 判準是「偏移之後主軸走得通」（沿用既有的 canMoveAfterShift）。
     *
     * 與舊的 alignToClearCorner 的差別（第二十六輪的關鍵）：
     *   舊：目標 = 當前格心，且不要求與主軸正交
     *       → 貼著格邊時「朝格心」會把主軸推得更不通，於是每幀抖動
     *   新：目標 = 讓主軸通的那個偏移量，方向與主軸正交
     *       → 偏移與主軸互相配合，不會互相對抗
     */
    pickNudgeSign(primaryDx, primaryDy) {
        // ===== 第二十八輪（決定性）：偏移軸的判斷必須用「真正能改善主軸」的那一軸 ====
        //
        // 決定性實測（bb-autopsy.mjs 逐幀，第 1 關 seed 999，最後 40 幀完全凍結）：
        //   f2360..f2398 (1,2) key=U oX=31.3 oY=83.7 nd=Y pU=1 pD=1 pL=1 pR=0 tp=3
        //   f2399       (1,2) key=D oX=31.3 oY=77.8 nd=. pU=1 pD=1 pL=1 pR=0 tp=3
        //
        // oY=83.7 ≈ cs-3.6：角色停在格子最底端（下一格就是底線）。
        // pU=1（往上物理可行）、pD=1（往下也可行），但整段 40 幀位置完全沒變。
        //
        // 也就是說「想往下走、實際上往下不動、往上也不動」——
        // 偏移方向被 giveUp() 立刻清掉（因為 |offY| >= limit），
        // 下一幀重新挑又挑到同樣的方向、再被清掉，形成凍結。
        //
        // 這裡的問題是：偏移的「停止條件」（接近格心）和「起始條件」
        // 使用了同一個量。當角色已經在格底（offY≈+cs）時，
        // 「往上去靠近格心」只需要 3.6px 就會超過 limit，
        // 於是偏移剛啟動就宣告完成。
        //
        // 正確做法：偏移的目標是「讓主軸走得通的位置」，
        // 完成條件必須用**主軸是否已通**來判斷，而不是「是否靠近格心」。
        // 格心只是手段，主軸通了才是目的。
        this.nudgeGoalDx = primaryDx;
        this.nudgeGoalDy = primaryDy;

        // 兩個軸都試：正交軸優先（同軸偏移對卡牆角沒幫助）
        const axes = primaryDx === 0 ? ['x', 'y'] : ['y', 'x'];
        for (const axis of axes) {
            for (const s of [-1, 1]) {
                const sDx = axis === 'x' ? s : 0;
                const sDy = axis === 'y' ? s : 0;
                // ===== 第六十七輪（決定性）：偏移絕對不能「倒退」=====
                //
                // 決定性實測（stage 2 seed 999，出生口袋）：
                //   (1,2) px=(172,135) off=(31,84)，主軸=(1,1)（目標在東南）。
                //   這裡按 [-1,1] 順序先試中「往上」(0,-1)，
                //   canMoveAfterShift 回 true → 角色從 y=135 退回 129，
                //   grid 翻回 (1,1) → 參考格失效 giveUp → 下一幀主軸又往下 →
                //   (1,1)→(1,2)→(1,1) 三拍振盪；把偏移關掉後振盪立刻消失。
                //
                // 原因：探測模型（canMoveAfterShift）只看「偏移後主軸通不通」，
                // 它不知道「跨過格線」會讓 nudgeRefCell 失效。
                // 而往上一步（5.8px）就跨線（線在 y≈130，當下 y=135），
                // 所以探測說可行、執行一幀就自我作廢，永遠走不出去。
                //
                // 修正：與目標方向點積為負的候選（倒退）直接跳過，
                // 只保留「側移」（點積 0）與「順行」（點積 >0）。
                // 偏移的本意是側移讓位，從來不是倒退；倒退只會觸發翻頁失效。
                // 若全部候選都被拒，就回 false 交還主軸分解（直下/直右），
                // 那是安全的 fallback（實測直下每幀都有進展）。
                if (sDx * primaryDx + sDy * primaryDy < 0) continue;
                if (!this.canMoveAfterShift(sDx, sDy, primaryDx, primaryDy)) continue;
                this.aiInput.up = this.aiInput.down = false;
                this.aiInput.left = this.aiInput.right = false;
                if (sDx > 0) this.aiInput.right = true;
                else if (sDx < 0) this.aiInput.left = true;
                else if (sDy > 0) this.aiInput.down = true;
                else this.aiInput.up = true;
                this.nudgeAxis = axis;
                this.nudgeSign = s;
                return true;
            }
        }
        return false;
    }

    /** 偏移承諾已經選定方向 → 沿用同一個方向，不要每幀重挑 */
    applyNudgeDirection() {
        const s = this.nudgeSign;
        if (s === undefined || s === null) return false;
        const cs = this.gridSystem.getCellSize();
        const ref = this.nudgeRefCell;
        const rX = this.gridSystem.offsetX + ref.x * cs + cs / 2;
        const rY = this.gridSystem.offsetY + ref.y * cs + cs / 2;
        const offX = rX - this.x, offY = rY - this.y;

        const giveUp = () => {
            this.nudgingOffCenter = false;
            this.nudgeRefCell = null;
            this.nudgeSign = null;
            return false;
        };

        // 已經離開參考格（gridX/gridY 在格線附近翻頁）→ 放棄這個偏移目標
        if (this.gridX !== ref.x || this.gridY !== ref.y) return giveUp();

        // ===== 第二十八輪（決定性）：完成條件是「主軸已通」，不是「接近格心」=====
        //
        // 實測（第 1 關 seed 999 最後 40 幀完全凍結）：
        //   (1,2) key=U oX=31.3 oY=83.7 pU=1 pD=1 pL=1 pR=0
        //
        // oY=83.7 代表角色已在格子最底端。若用「接近格心」當完成條件，
        // 往上一動就超過 limit、立刻被判定完成 → 偏移永遠走不完一格。
        //
        // 目的既然是「讓主軸走得通」，完成條件就必須直接檢查主軸。
        // 一旦主軸通了，就交還決策權（偏移的目的是達成，不是長期佔用）。
        if (this.canPhysicallyMove(this.nudgeGoalDx, this.nudgeGoalDy)) {
            return giveUp();
        }

        // ===== 第二十七輪（決定性）：偏移絕對不能跨過格線 =====
        //
        // 實測（bb-throughput.mjs 第 1 關 120 秒取樣，第 26 輪之後）：
        //   10s g=(1,3) off=(0,35)   50s g=(2,3) off=(86,31)
        //   60s g=(1,3) off=(4,36)   80s g=(2,3) off=(85,31)
        //
        // oX 在 0~5 與 85~86 之間跳，gridX 在 (1,3) 與 (2,3) 之間翻，
        // 整整 120 秒只在這兩格之間來回，開放區永遠卡在 8 格。
        //
        // 原因：偏移軸的「目標」是格心，但 Bot 一開始幾乎在格心（off.x≈0），
        // 於是 pickNudgeSign 挑了「往右」；往右走幾幀就越過格線到了 (2,3)，
        // 接著 applyNudgeDirection 偵測到 gridX 改變 → giveUp → 重新挑，
        // 這次挑「往左」→ 又回到 (1,3)。每一輪都白走。
        //
        // 修正：偏移的行程必須限制在**當前格內**。
        // 遊戲本來就允許在格子內自由走動（不需要靠跨格來前進），
        // 偏移只是為了讓四角離開鄰格牆角，格內就足夠了。
        // 這裡用「距離參考格邊界的距離」當硬上限，越界就停止並交還主軸。
        const limit = cs * 0.34;   // 0.34 格：遠小於半格，保證不跨格
        // offX = 參考格心 - x，所以「往右移」時 offX 遞減、offX 會變負。
        // 往左移時 offX 遞增、會變正。兩種情況都不能超過 limit 的絕對值。
        const over = this.nudgeAxis === 'x' ? Math.abs(offX) : Math.abs(offY);
        if (over >= limit) return giveUp();

        // ===== 第三十四輪（決定性）：偏移方向本身走不動時，必須立刻放棄 =====
        //
        // 決定性實測（bb-autopsy.mjs 逐幀方向序列，第 1 關 seed 999）：
        //   f680..f718 (1,2) key=U oX=31.3 oY=83.7 nd=Y pU=1 pD=1 pL=1 pR=0 tp=3
        //
        // 整整 39 幀（0.65 秒）位置一個像素都沒變，方向恆為 U。
        // (1,2) 的正上方是 (1,1)，再上面 (1,0) 是邊界硬磚 ——
        // 角色 oY=83.7 已經貼在格底，往上走到 (1,1) 需要的空間是有的，
        // 但「往下」才是 path 的方向，往上等於往回走。
        //
        // 關鍵：applyNudgeDirection 沿用承諾方向，但**從不驗證那個方向還走不走得動**。
        // 承諾在選定那幀可行，之後位置改變了、走不動了，它仍然每幀送出同一個按鍵 ——
        // 於是 0.65 秒完全凍結，而且 needsCentering 因為 nudgingOffCenter 而放行，
        // 連「往格心拉」這個後備機制都被關掉了。
        //
        // 修正：偏移方向走不動就放棄承諾（並清除旗標，讓 needsCentering 恢復作用）。
        const wantDx = this.nudgeAxis === 'x' ? s : 0;
        const wantDy = this.nudgeAxis === 'y' ? s : 0;
        if (!this.canPhysicallyMove(wantDx, wantDy)) return giveUp();

        this.aiInput.up = this.aiInput.down = false;
        this.aiInput.left = this.aiInput.right = false;
        if (wantDx > 0) this.aiInput.right = true;
        else if (wantDx < 0) this.aiInput.left = true;
        else if (wantDy > 0) this.aiInput.down = true;
        else this.aiInput.up = true;
        this.state = 'CORE_ALIGN';
        return true;
    }

    /**
     * 目標格可通行、但「當下像素位置」讓移動框卡到鄰格牆角時，
     * 先往能讓四角離開鄰格牆的那一側橫向挪動。
     *
     * 決定性實測（bb-throughput.mjs，第 1 關，每 10 秒取樣 10s~50s 完全一致）：
     *   g=(1,3) plan=stand(1,5)->gate(1,6) tp0=1,3 off=(0,31) physD=false
     *
     * 逐點算清楚：
     *   (1,4) 是空地（往下走是合法的），但 (2,4) 是硬磚。
     *   Bot 的 x 精確置中（off.x = 0），往下移動一步之後，
     *   碰撞框的「右下角」正好跨過 x 的中線，落進 (2,4) -> 判定走不過去。
     *
     * 舊版 followPath() 在主軸被擋時有兩種反應：
     *   1. applyCrossAxis 檢查「斜向」走得通才補交叉軸 —— 斜向被同一個角擋住，所以什麼都不設
     *   2. 於是判定「這條路走不通」-> targetPath = [] -> 重新規劃
     * 結果它站在 (1,3) 不動 50 秒（CARVE_MOVE 94.2%），
     * 因為「走一格」這件事本身需要先橫向挪動半格才能成立，
     * 而舊邏輯把「需要兩步」當成「不可能」。
     *
     * 正確做法：主軸被擋但目標格確實可通行時，
     * 先挑一個「單獨走得通」的橫向方向挪過去，下一幀四角離開牆角，
     * 主軸自然就通了。這只是在格子內合法地走動，沒有穿牆或瞬移。
     */
    alignToClearCorner(primaryDx, primaryDy) {
        // 目標格本身必須可通行，否則這是真的牆，不該試著繞
        if (!this.isWalkableCell(this.gridX + primaryDx, this.gridY + primaryDy)) return false;

        // ===== 第十四輪（決定性）：宣告「正在故意偏離格心」=====
        //
        // 實測（bb-throughput.mjs，第 1 關，加入 alignToClearCorner 之後）：
        //   CORE_ALIGN 佔 46.6%，但 10s~50s 的 off 一直是 (0,31) 完全不變。
        //
        // 原因：alignToClearCorner 每幀設好「往左挪」，緊接著就被兩個機制取消：
        //   1. needsCentering() 看到偏離格心就判定要站正
        //   2. update() 的 consecutiveStuck >= 4 每幀觸發
        //      breakOutOfStall() / holdCentering()，把角色推回格心
        // 而「回到格心」正好會讓右下角重新撞上那面硬磚，
        // 於是每幀重新往左、每幀又被拉回來 ——
        // 淨位移精確為零，Bot 站在原地 50 秒一步都沒走出去。
        //
        // 這裡必須宣告「這一次的偏離是有意圖的」，
        // 讓站正與卡住救援知道不該插手。
        // 這不是無條件放行：它的前提是「目標格可通行、
        // 我正在為走過去做準備」，而 holdCentering 做的恰恰是
        // 那件會讓我走不過去的事。
        this.nudgingOffCenter = true;
        this.consecutiveStuck = 0;      // 這不是「卡住」，是刻意在挪動

        // ===== 第十八輪（決定性修正）：偏移的目標是「當前格中心」，不是「主軸通一步」=====
        //
        // 決定性實測（bb-autopsy.mjs，第 1 關，seed 999，40 秒）：
        //   整場 99.6% 的幀 nudgingOffCenter=true、A-B-A 振盪、只走過 2 個格、放彈 0 顆
        //   最後兩幀逐幀證據（cs = 87.3px）：
        //     f2398 CARVE_MOVE (1,2) D goal=3,3 pR=0  oX=31.3 oY=83.7
        //     f2399 CORE_ALIGN  (1,1) U goal=3,3 pR=0  oX=31.3 oY=2.2
        //
        // oY = 83.7 幾乎等於一整個格子大小：Bot 的 gridY 被算成 2，
        // 但它的像素其實還停在格 1 的中間（格邊界在 130.95px，它卡在 134.55px）。
        //
        // 舊判準「canMoveAfterShift(s)：偏移 N 幀後主軸走一步走得通」是錯的，
        // 因為它把「往左挪」判為可行（往上離開 (2,2) 的牆角，右下角暫時不撞），
        // 於是每幀都往「離格心更遠」的方向推；
        // 下一幀重算時條件又變，方向翻回來 —— 於是以一幀步長（5.8px）
        // 在格邊界上無限來回，gridY 在 1/2 之間跳動，一格都沒有前進。
        //
        // 正確判準：**朝當前格的中心移動。**
        // 格子中心的碰撞框四角落在 ±0.3cs（內縮 0.2cs 後）之內，
        // 必定全部位於當前格內，永遠不會伸進鄰格 —— 這是物理上必然收斂的目標。
        // 它同時滿足兩件事：離開鄰格牆角（解除卡住）、回到格心（讓 needsCentering 滿意）。
        //
        // 這不是在放寬安全標準，也沒有改動任何遊戲規則：
        // 仍然只靠遊戲本身的碰撞判定走路，沒有穿牆、瞬移或額外能力。
        const cs = this.gridSystem.getCellSize();
        // ===== 第二十五輪（決定性）：偏移目標格必須「承諾」，不可跟著 gridX/gridY 抖動 =====
        //
        // 決定性實測（bb-autopsy.mjs 逐幀方向序列，第 1 關 seed 999）：
        //   f588 (5,4) oY= 1.2  key=DL
        //   f590 (5,5) oY=84.4  key=DL      <- gridY 翻了一格，偏移目標瞬間改變
        //   f592 (5,4) oY= 8.8  key=U       <- 又翻回去，方向也跟著翻
        //   f594 (5,4) oY=20.4  key=U
        //
        // 關鍵：oY 在 1.2 與 84.4 之間跳，差 83.2px ≈ 一整格（cs=87.3）。
        //
        // 為什麼會這樣：Player.update 用「碰撞框中心點」算格座標
        //     gridY = floor((y + cs/2 - offsetY) / cs)
        // 當角色站在格線附近時，中心點跨過格線，gridY 就翻一格。
        // 於是「當前格中心」這個目標跟著跳，
        // alignToClearCorner 每幀重新算目標 → 方向每幀翻面 → 原地振盪。
        //
        // 這裡的 offY 從 1.2 變成 84.4，物理上角色幾乎沒動（只差幾 px），
        // 但「目標格」整個換掉了。遲滯門檻對這種情況完全無效，
        // 因為跳動的幅度是一整格，不是門檻那麼小。
        //
        // 正確做法：偏移目標格一旦選定就記錄下來（nudgeRefCell），
        // 直到真的完成才清除。這與本檔案既有的 carvePlan / escapeCommitted
        // 是同一個設計原理：跨越多幀的動作必須有承諾，
        // 否則每幀重算的結果就是抖振。
        if (this.nudgeRefCell === null || this.nudgeRefCell === undefined) {
            this.nudgeRefCell = { x: this.gridX, y: this.gridY };
        }
        const ref = this.nudgeRefCell;
        const rX = this.gridSystem.offsetX + ref.x * cs + cs / 2;
        const rY = this.gridSystem.offsetY + ref.y * cs + cs / 2;
        const offX = rX - this.x;     // >0 表示往右走才會靠近格心
        const offY = rY - this.y;

        // 已經很接近格心 → 偏移完成，交還主軸（否則會永遠停在這裡）
        //
        // ===== 第二十四輪（決定性）：門檻必須有遲滯帶，不能是單一數值 =====
        //
        // 決定性實測（bb-throughput.mjs，第 1 關，逐幀 900~929 完全一致）：
        //   f900 x=259.0 off=31.9 in[L0 R1] st=CORE_ALIGN
        //   f901 x=253.2 off=37.7 in[L1 R0] st=CORE_ALIGN
        //   f902 x=259.0 off=31.9 in[L0 R1] st=CORE_ALIGN
        //   ... 整整 30 幀逐位元組重複
        //
        // x 每幀在 259.0 與 253.2 之間來回，差 5.8px 正好是一幀的步長；
        // off 在 31.9 與 37.7 之間來回，門檻是 cs*0.06 = 5.24px。
        //
        // 這是一個標準的遲滯振盪：
        //   偏移把 off 從 37.7 拉回 31.9 → 判定「還沒到位，繼續偏移」
        //   但移動是離散的，一幀只走 5.8px，於是又跨過門檻回到 37.7
        //   → 判定方向翻面 → 無限循環。
        //
        // 正確做法是遲滯（hysteresis）：進入偏移與退出偏移用不同門檻。
        // 偏移一旦開始就必須走過「退出門檻」（更靠近格心）才停，
        // 中間的帶狀區間一律維持原狀態，不做判定。
        // 這是控制理論上的標準做法，也和本檔案既有的 escapeCommitted
        // 遲滯承諾同一個思路。
        const EXIT_TOL = cs * 0.05;    // 退出：更嚴格，確保真的到位
        const ENTER_TOL = cs * 0.14;   // 進入：較寬，避免被單幀步長抖進來

        if (this.nudgingOffCenter) {
            // 已在偏移中：只有走夠近了才交還主軸
            if (Math.abs(offX) <= EXIT_TOL && Math.abs(offY) <= EXIT_TOL) {
                this.nudgingOffCenter = false;
                this.nudgeRefCell = null;
                return false;
            }
            // 已經離開參考格（gridY/gridX 在格線附近翻頁）→ 放棄這個偏移目標。
            //
            // 注意門檻是 0（不是 1）：格座標只要「不等於參考格」就代表
            // 角色實際上已經跨過格線。此時若還拿著舊參考格算 off，
            // off 會突然變成接近 ±cs 的值，方向整個翻面。
            //
            // 實測（bb-throughput.mjs 第 1 關取樣）：
            //   20s g=(1,3) off=(1,30)   30s g=(2,3) off=(84,34)
            //   50s g=(1,3) off=(1,34)   70s g=(2,3) off=(84,33)
            // oX 在 1 與 84 之間翻 = 一整格，正是參考格跟著抖動的結果。
            if (this.gridX !== ref.x || this.gridY !== ref.y) {
                this.nudgingOffCenter = false;
                this.nudgeRefCell = null;
                return false;
            }
        } else if (Math.abs(offX) <= ENTER_TOL && Math.abs(offY) <= ENTER_TOL) {
            this.nudgeRefCell = null;
            // 不在偏移中，而且離心不夠遠 → 不需要偏移
            return false;
        }

        // 一次只修正一個軸：偏差大的那個。
        // 對角移動會讓兩個角同時逼近兩面牆，是卡牆角的主要來源，必須避免。
        let sDx = 0, sDy = 0;
        if (Math.abs(offX) >= Math.abs(offY)) sDx = offX > 0 ? 1 : -1;
        else sDy = offY > 0 ? 1 : -1;

        // 清掉相反方向，否則 Player.update 的 dx 會精確抵消成 0。
        this.aiInput.up = this.aiInput.down = false;
        this.aiInput.left = this.aiInput.right = false;
        if (sDx > 0) this.aiInput.right = true;
        else if (sDx < 0) this.aiInput.left = true;
        else if (sDy > 0) this.aiInput.down = true;
        else this.aiInput.up = true;

        this.state = 'CORE_ALIGN';
        return true;
    }

    alignToClearCornerLegacy(primaryDx, primaryDy) {

        // 沿著「垂直於主軸」的方向，挑「偏移之後主軸會通」的那一邊。
        // 判準不是「偏移本身通不通」——那會造成左右來回振盪。
        if (primaryDx === 0) {
            // 主軸是垂直（上下）→ 需要水平位移
            for (const s of [-1, 1]) {
                if (this.canMoveAfterShift(s, 0, primaryDx, primaryDy)) {
                    // 立刻清掉相反方向：ensureSomeAction() 可能已經設了另一邊，
                    // 若兩者同時為真，Player.update 的 dx 會精確抵消成 0。
                    this.aiInput.left = false; this.aiInput.right = false;
                    if (s > 0) this.aiInput.right = true; else this.aiInput.left = true;
                    this.state = 'CORE_ALIGN';
                    return true;
                }
            }
        } else {
            // 主軸是水平（左右）→ 需要垂直位移
            for (const s of [-1, 1]) {
                if (this.canMoveAfterShift(0, s, primaryDx, primaryDy)) {
                    this.aiInput.up = false; this.aiInput.down = false;
                    if (s > 0) this.aiInput.down = true; else this.aiInput.up = true;
                    this.state = 'CORE_ALIGN';
                    return true;
                }
            }
        }
        // 一個橫向方向都不通 → 宣告失效，恢復正常站正行為
        this.nudgingOffCenter = false;
        return false;
    }

    followPath() {
        // ===== 第十五輪（決定性）：偏移不依賴路徑 =====
        //
        // 實測（bb-throughput.mjs，第 1 關，40 秒）：
        //   off 從 (0,31) 變成 (12,31)  <- 終於真的往格心左邊挪了 12px
        //   但同時 tp=0：目標路徑被清空了。
        //
        // 舊版把偏移邏輯放在 followPath 的「主軸被擋」分支裡，
        // 一旦那個分支走到「這條路走不通 -> targetPath = []」，
        // 下一幀 followPath 就會在最開頭 `if (targetPath.length === 0) return` 結束，
        // 偏移邏輯永遠不會再被呼叫 —— 它就停在挪了 12px 的地方。
        //
        // 所以偏移必須獨立於路徑存在：只要「移動目標」還沒到達、
        // 而且當下被角落卡住，就先橫向挪。
        if (this.tryNudgeForProgress()) return;

        if (!this.targetPath || this.targetPath.length === 0) return;

        // ===== 第十一輪（決定性修正）：路徑必須先去掉「自己所在的格」=====
        //
        // 決定性實測（bb-stage1.mjs 第 1 關，逐幀移動鏈路記錄）：
        //   4.0s g=(1,3) off=(27,58) tp=1,4(len2)
        //   4.5s g=(1,3) off=(4,29)  tp=1,3(len3)   <- 第一格變成「自己」
        //   之後 px=(199,276) 完全凍結超過 1 萬幀，
        //   而 canGo=true（往左明明走得動）、state=CARVE_MOVE、targetPath 長度 3。
        //
        // 死循環的形成過程：
        //   1. aStar 從「當前格」開始擴鄰，回傳的路徑第一格可能就是自己
        //      （gridX 是用「中心點」算的，角色在格內偏移時，
        //       aStar 的起點格與 followPath 的 self 判定會不一致）。
        //   2. followPath 看到 next == 自己 -> shift()，但下一格又是自己。
        //   3. primaryDx = primaryDy = 0，於是朝「自己格子的中心」設方向。
        //   4. 角色已經在那個格子裡 -> 位移精確為 0 -> 永遠重複。
        //
        // 這個 bug 會讓任何「已經站到攻擊／開路站位」的 Bot 完全停止移動，
        // 而且完全沒有報錯：targetPath 非空、state 正確、canPhysicallyMove 為 true，
        // 從外部量測看起來一切正常，實際上一步也走不出去。
        //
        // 修正：進入路徑跟隨前，先把所有等於自己所在格的前導節點丟掉。
        // 這不改動任何遊戲規則，只是讓「要去的格子」真的是「別的格子」。
        while (this.targetPath.length > 0) {
            const h = this.targetPath[0];
            if (h.x === this.gridX && h.y === this.gridY) this.targetPath.shift();
            else break;
        }
        if (this.targetPath.length === 0) return;

        const target = this.targetPath[0];

        if (this.gridX === target.x && this.gridY === target.y) {
            this.targetPath.shift();
            if (this.targetPath.length === 0) return;
        }

        const next = this.targetPath[0];
        if (!next) return;

        // 再保險一次：擋掉「下一格仍然是自己」的路徑，避免同樣的凍結。
        if (next.x === this.gridX && next.y === this.gridY) {
            this.targetPath.shift();
            if (this.targetPath.length === 0) return;
        }
        const realNext = this.targetPath[0];
        if (!realNext) return;

        // 修正：必須用 gridSystem.getPixelCoord() 取目標像素，不可直接 next.x * cellSize。
        // canvas 16:9 而地圖 13x11，GridSystem 會把地圖置中，offsetX/offsetY 通常不為 0
        // （1280x960 時 offsetX≈72.7）。漏掉 offset 會讓水平/垂直對齊門檻整個偏移近一格，
        // AI 因此永遠對不齊目標、原地來回走不動。
        const cs = this.gridSystem.getCellSize();
        const targetPos = this.gridSystem.getPixelCoord(next.x, next.y);
        // 目標格「中心點」的像素座標
        const targetPixelX = targetPos.x + cs / 2;
        const targetPixelY = targetPos.y + cs / 2;
        const threshold = cs * 0.2;

        // ===== 第六十七輪（決定性）：交叉軸偏差必須用「相對座標」=====
        //
        // 決定性實測（第 2 關 seed 999 逐幀，f9~f12 無限振盪）：
        //   f9 grid=(1,2) px=(172,135) → 下一格 (1,3)，主軸=往下
        //      TN（偏移）正確返回 false
        //      但 followPath 主軸分支呼叫
        //        applyCrossAxis(0, 1, targetPixelX - threshold, ...)
        //      傳入的「偏差」是**絕對像素** targetPixelX ≈ 203、
        //      而 threshold = cs*0.2 ≈ 17。
        //      函式內 positive = (203-17) > 0 恆成立 → 誤判需要水平修正
        //      → 補上 right 或 left → 與主軸 down 組成 [DR]/[DL]
        //      → 本幀斜向 (0+1,1) 被牆角擋住 → 物理攔截觸發 →
        //        tryAlignToCellCenter 朝格心上拉 (up=true)
        //      → 下一幀 grid 翻回 (1,1) → 再往下 → 淨位移恆為零。
        //
        // 根因：偏差必須是「我離目標還差多少」（相對量），
        // 不能是「目標在地圖的哪裡」（絕對量）。這裡改傳
        //   excessLow  = 目標像素 - 門檻 - 我當下位置
        //   excessHigh = 我當下位置 - (目標像素 - 門檻)
        // 對齊時兩者都 <= 0 → 函式直接 return，主軸單獨前進。
        //
        // 這不改動任何遊戲規則：只是把傳錯的參數改成正確的相對偏差，
        // 按鍵組合從此只在「真的偏離」時才補交叉軸。
        const myCX = this.x + cs / 2, myCY = this.y + cs / 2;
        const devX = targetPixelX - myCX;
        const devY = targetPixelY - myCY;

        // ===== 擋路軟磚：放彈炸開，而不是持續撞牆 =====
        //
        // 實測（決定性）：Bot 在 (1,3)，右方 (2,3) 是軟磚。
        // freeDirs 實測為 DLU，canPhysicallyMove(1,0) = false。
        // 但舊版 followPath() 無條件 this.aiInput.right = true，
        // 於是每幀都往右撞軟磚，一格都前進不了：
        //   SNIPE_MOVE 佔 996 次決策、放彈 0 顆、120 秒零擊殺。
        //
        // 正確做法：主軸走不動且擋路的是軟磚時，直接放彈把牆炸開。
        // 這是遊戲本身允許的正常玩法（每個玩家都能這樣炸牆），
        // 沒有改動任何規則：炸彈傷害、範圍、引信時間都維持原樣。
        const primaryDx = Math.sign(next.x - this.gridX);
        const primaryDy = Math.sign(next.y - this.gridY);

        // ===== 第六十五輪（決定性）：斜向移動不能用 canPhysicallyMove(dx,dy) 判斷 =====
        //
        // 決定性實測（bb-autopsy.mjs 第 1 關 seed 4242，200 秒，followPath 撞牆統計）：
        //   2,1 want(-1,1) to=1,2 blockType=0    287 幀
        //   6,1 want(-1,1) to=1,2 blockType=2    180 幀
        //   1,1 want(0,1)  to=1,2 blockType=0    158 幀
        //   3,1 want(1,0)  to=4,1 blockType=0     72 幀
        //
        // blockType=0 代表**空地**，但 canPhysicallyMove 回傳 false。
        // 原因：canPhysicallyMove(dx,dy) 是「四角同時判定」的模型，
        // 而 Player.update 是**分軸碰撞**（Player.js:318-323）：
        //     if (dx !== 0 && !checkCollision(nextX, this.y)) this.x = nextX;
        //     if (dy !== 0 && !checkCollision(this.x, nextY)) this.y = nextY;
        //
        // 這正是本檔案第 41 輪註解記載的同一個模型不一致，這次它發生在
        // 「兩個軸都要動」的斜向情況：四角模型要求斜著走過拐角時
        // 四個角都不能碰到牆，於是判定走不動；但分軸模型其實走得動。
        //
        // 結果就是最嚴重的症狀：
        //   stand 是 (5,1)、我在 (6,1)、只有一步，卻卡了 90 幀（3 秒），
        //   每幀 aStar 重算、每幀撞同一個「牆」。
        //
        // 修正：斜向時分別檢查 X 軸與 Y 軸 —— 任何一軸走得動就代表有進展。
        // 這是與 Player.update 的分軸碰撞**對齊**，不是放寬規則。
        const dxA = primaryDx, dyA = primaryDy;
        const okX = dxA === 0 ? true : this.canPhysicallyMove(dxA, 0);
        const okY = dyA === 0 ? true : this.canPhysicallyMove(0, dyA);
        if ((primaryDx !== 0 || primaryDy !== 0) && !okX && !okY) {

            // ===== 第十三輪（決定性）：先分辨「卡角落」還是「真牆」=====
            //
            // 實測（第 1 關 10s~50s 取樣完全一致）：
            //   g=(1,3) plan=stand(1,5) off=(0,31) physD=false
            //   (1,4) 是空地但 (2,4) 是硬磚，角色精確置中所以右下角撞上牆角。
            //
            // 舊邏輯把這種情況當成「這條路走不通」-> targetPath = []，
            // 於是它站在原地 50 秒（CARVE_MOVE 94.2%）。
            // 但實際上只需要先橫向挪半格，四角離開牆角後主軸就通了 ——
            // 「走一格」在這裡需要兩步，舊邏輯卻把它當成不可能。
            //
            // 必須在放棄路徑「之前」先試這一步。
            if (this.alignToClearCorner(primaryDx, primaryDy)) {
                // 保留 targetPath，下一幀就能沿著它繼續前進
                return;
            }

            const wallX = this.gridX + primaryDx;
            const wallY = this.gridY + primaryDy;
            const wallType = this.mapManager.getBlockType(wallX, wallY);

            if (wallType === 2) {
                // ===== 第六十四輪（架構重構）：不在 followPath 裡開路 =====
                //
                // 決定性實測（bb-autopsy.mjs 第 1 關 seed 4242，200 秒）：
                //   BREACH_FOR_ATTACK  150 幀（21.1%）
                //   CARVE_MOVE+GATE     96 幀（13.5%）
                //   FLEE               261 幀、CORE_ALIGN 204 幀
                //
                // 這裡是「兩套開路邏輯」真正的來源（我前兩輪猜的
                // breakOutOfStall 只是其中之一，而且它的分支實測從未觸發）。
                //
                // 問題：followPath 是**每幀**都會走到的路徑，
                // 它在這裡站在當前格放彈炸掉擋路的軟磚、然後 targetPath = []。
                // 結果是：
                //   1. 它繞過了 carveTowardKillSpot 的全部保護
                //      （計畫承諾、no-progress、區域門檻、幾何死路）
                //   2. 它每幀都清空路徑 → carvePlan 永遠走不到 stand
                //   3. 它用 hasPierce，其他地方用 hasSuperBomb()
                //   4. 最嚴重：它在 update() 的中段改 aiInput，
                //      而 think() 早已決定好整個計畫 —— 兩者互相覆蓋
                //
                // 正確做法：followPath 只負責「沿著既定計畫走」，
                // 不該自己決定「要不要放彈」。要開路就讓
                // carveTowardKillSpot 在 think() 裡決定，
                // 那是唯一的開路決策點，且已經具備所有安全檢查。
                //
                // 這裡改成：把「需要炸開擋路牆」記錄下來並中止路徑，
                // 讓下一幀 think() 走 carveTowardKillSpot（它會重新規劃、
                // 找 stand、做死路檢查），而不是在這裡硬放一顆。
                this.pendingBreach = {
                    wall: { x: wallX, y: wallY },
                    until: this.time + 0.5,
                };
                this.targetPath = [];
                this.state = 'BREACH_REQUEST';
                return;
            }
            // 硬磚或無法安全放置 → 這條路走不通，直接棄用路徑讓 think() 重新規劃
            this.targetPath = [];
            this.blockedDir = primaryDx + ',' + primaryDy;
            this.blockedDirCount = (this.blockedDirCount || 0) + 1;
            return;
        }

        if (this.gridX < next.x) {
            this.aiInput.right = true;
            // 主軸是「右」(primaryDx = 1)，交叉軸必須是垂直 → 傳 primaryDx = 1
            this.applyCrossAxis(1, 0, devY - threshold, -(devY + threshold));
        } else if (this.gridX > next.x) {
            this.aiInput.left = true;
            // 主軸是「左」(primaryDx = -1)，交叉軸必須是垂直 → 傳 primaryDx = -1
            this.applyCrossAxis(-1, 0, devY - threshold, -(devY + threshold));
        } else if (this.gridY < next.y) {
            this.aiInput.down = true;
            // 主軸是「下」(primaryDy = 1)，交叉軸必須是水平 → 傳 primaryDx = 0
            this.applyCrossAxis(0, 1, devX - threshold, -(devX + threshold));
        } else if (this.gridY > next.y) {
            this.aiInput.up = true;
            // 主軸是「上」(primaryDy = -1)，交叉軸必須是水平 → 傳 primaryDx = 0
            this.applyCrossAxis(0, -1, devX - threshold, -(devX + threshold));
        }
    }

    /**
     * 在主軸移動的同時，設定「交叉軸對齊」方向，且保證左右／上下互斥。
     *
     * 這是決定 AI 會不會卡死的關鍵。
     *
     * 問題 1（原始 bug）：舊版 followPath() 只要交叉軸差異超過門檻就額外補上方向，
     * 送出「右 + 下」同時按。但斜下方正好是硬磚，canPhysicallyMove(1,1) 回傳 false，
     * update() 每幀都判定走不動 → 轉去 tryAlignToCellCenter() 對齊中心，
     * 對齊完下一幀又補上方向、再次撞牆，形成無限迴圈：
     *   BREACH_FOR_ATTACK 佔 1025 次決策、放彈 0 顆、120 秒一格都沒前進。
     *
     * 問題 2（修完 1 之後出現）：若把兩個交叉軸判斷各自獨立寫成
     * `down = ok(...)` 與 `up = ok(...)`，兩者同時為 true 時會送出
     * 「左 + 右 + 上」這種互相抵消的按鍵組合 —— 實測輸入變成 [RLU]，
     * 角色原地不動，SNIPE_MOVE 佔 996 次決策仍然一顆炸彈都放不出來。
     *
     * 正確做法：交叉軸用 if / else if 互斥選擇，
     * 方向確定後再檢查「連同主軸一起按是否物理走得通」，
     * 走不通就純粹走主軸（主軸實測可走通），等主軸對齊後自然收斂。
     *
     * 這只改變 AI 送出的按鍵組合，不改動任何遊戲規則：
     * 移動依然走 Player 原本的碰撞判定，沒有穿牆、沒有瞬移。
     *
     * @param {number} primaryDx 主軸 X（±1 或 0）
     * @param {number} primaryDy 主軸 Y（±1 或 0）
     * @param {number} excessLow  仍偏低時的偏差（>0 代表需要往下／往右）
     * @param {number} excessHigh 仍偏高時的偏差（>0 代表需要往上／往左）
     */
    applyCrossAxis(primaryDx, primaryDy, excessLow, excessHigh) {
        // ===== 交叉軸的方向必須與主軸垂直 =====
        //
        // 實測（決定性）：Bot 在 (3,5) 腳下有炸彈（倒數 0.23s），
        // 輸入卻是 [UD] —— 上與下同時按下，位移互相抵消、完全不動，
        // 眼睜睜看著引信歸零後被自己的火焰掃死。
        //
        // 原因：縱向移動的兩個分支原本寫成 applyCrossAxis(-1, 0, ...)，
        // 意圖是「主軸是縱向」，但參數擺在 primaryDx 的位置。
        // 函式內部看到 primaryDx !== 0 就判定為「主軸是水平」，
        // 於是把交叉軸設成垂直 → 往下走時又補上「上」→ [UD] 抵消。
        //
        // 正確規則（與主軸垂直）：
        //   主軸水平（primaryDx !== 0）→ 交叉軸為垂直（crossDy）
        //   主軸垂直（primaryDx === 0）→ 交叉軸為水平（crossDx）
        let crossDx = 0, crossDy = 0;
        const positive = excessLow > 0;
        if (!positive && excessHigh <= 0) return;    // 交叉軸已經對齊

        if (primaryDx !== 0) {
            // 主軸水平 → 交叉軸垂直
            crossDy = positive ? 1 : -1;
            crossDx = 0;
        } else {
            // 主軸垂直 → 交叉軸水平
            crossDx = positive ? 1 : -1;
            crossDy = 0;
        }
        // ===== 不變量保險：交叉軸絕對不能與主軸同軸 =====
        //
        // 實測（決定性，擊殺永遠是 0 的頭號根因）：
        // followPath() 在「水平移動」時原本傳 applyCrossAxis(0, -1, ...)，
        // 把主軸參數擺錯位置。函式看到 primaryDx === 0 就判定主軸是垂直，
        // 轉而補上「水平」交叉軸，於是右 + 左同時被設成 true。
        //
        // Player.update() 的寫法是：
        //     if (left)  dx -= 1;
        //     if (right) dx += 1;
        // → dx = -1 + 1 = 0，角色「完全不會動」，而且 update() 裡
        //   if (dx !== 0 || dy !== 0) 的防護也看不出異常，
        //   AI 於是站在自己剛放下的炸彈上，眼睜睜看引信歸零後被自己的火燒死。
        // （實測 3 局共 717 幀裡有 433 幀的輸入是 [LR]，Bot 連續 500 幀原地不動。）
        //
        // 這裡強制清掉與主軸同軸的分量，讓「交叉軸必與主軸垂直」
        // 成為函式本身保證的性質，而不是只靠呼叫端記得傳對。
        if (primaryDx !== 0) crossDx = 0;
        else crossDy = 0;

        if (crossDx === 0 && crossDy === 0) return;
        if (!this.canPhysicallyMove(primaryDx + crossDx, primaryDy + crossDy)) return;
        if (crossDx > 0) this.aiInput.right = true;
        else if (crossDx < 0) this.aiInput.left = true;
        if (crossDy > 0) this.aiInput.down = true;
        else if (crossDy < 0) this.aiInput.up = true;
    }

    // ==================== 軟磚尋路 ====================

    findPathToSoftBlock() {
        const queue = [{ x: this.gridX, y: this.gridY, path: [] }];
        const visited = new Set([`${this.gridX},${this.gridY}`]);
        
        while (queue.length > 0) {
            const curr = queue.shift();
            
            // 檢查是否在軟磚塊旁邊
            for (const d of [{dx:0,dy:-1},{dx:0,dy:1},{dx:-1,dy:0},{dx:1,dy:0}]) {
                const nx = curr.x + d.dx;
                const ny = curr.y + d.dy;
                if (this.mapManager.getBlockType(nx, ny) === 2) {
                    return curr;
                }
            }
            
            // BFS 繼續
            for (const d of [{dx:0,dy:-1},{dx:0,dy:1},{dx:-1,dy:0},{dx:1,dy:0}]) {
                const nx = curr.x + d.dx;
                const ny = curr.y + d.dy;
                const key = `${nx},${ny}`;
                
                if (visited.has(key)) continue;
                
                const info = this.dangerMap.getDangerInfo(nx, ny);
                if (!this.mapManager.isSolid(nx, ny) && !info.isFlameActive && info.dangerLevel === 0 && !this.bombManager.hasBombAt(nx, ny)) {
                    visited.add(key);
                    queue.push({ x: nx, y: ny, path: [...curr.path, {x: nx, y: ny}] });
                }
            }
        }
        return null;
    }

    // ==================== 死路與陷阱 ====================

    findDeadEnds() {
        const deadEnds = [];
        const checked = new Set();
        const dirs = [{dx:0,dy:-1},{dx:0,dy:1},{dx:-1,dy:0},{dx:1,dy:0}];
        
        for (let y = 0; y < this.gridSystem.rows; y++) {
            for (let x = 0; x < this.gridSystem.cols; x++) {
                const key = `${x},${y}`;
                if (checked.has(key)) continue;
                if (this.mapManager.isSolid(x, y)) continue;
                
                let exits = 0;
                let exitDir = null;
                for (const d of dirs) {
                    const nx = x + d.dx;
                    const ny = y + d.dy;
                    if (!this.mapManager.isSolid(nx, ny)) {
                        exits++;
                        exitDir = d;
                    }
                }
                
                if (exits === 1) {
                    // 找到死路入口
                    const region = [];
                    const queue = [{x, y}];
                    const regionVisited = new Set();
                    regionVisited.add(key);
                    checked.add(key);
                    
                    while (queue.length > 0) {
                        const curr = queue.shift();
                        region.push(curr);
                        
                        for (const d of dirs) {
                            const nx = curr.x + d.dx;
                            const ny = curr.y + d.dy;
                            const nkey = `${nx},${ny}`;
                            
                            if (!regionVisited.has(nkey) && !this.mapManager.isSolid(nx, ny)) {
                                // 計算這個格的出口數
                                let nExits = 0;
                                for (const dd of dirs) {
                                    const nnx = nx + dd.dx;
                                    const nny = ny + dd.dy;
                                    if (!this.mapManager.isSolid(nnx, nny)) {
                                        nExits++;
                                    }
                                }
                                
                                if (nExits <= 1) {
                                    regionVisited.add(nkey);
                                    checked.add(nkey);
                                    queue.push({x: nx, y: ny});
                                }
                            }
                        }
                    }
                    
                    deadEnds.push({
                        region: region,
                        exit: { x: x + exitDir.dx, y: y + exitDir.dy },
                        entrance: { x, y }
                    });
                }
            }
        }
        return deadEnds;
    }

    // ==================== 追擊遠處敵人 ====================

    tryChase() {
        const targets = this.getEnemies();
        if (targets.length === 0) return false;
        
        let nearestEnemy = null;
        let minDist = Infinity;
        for (const t of targets) {
            const dist = Math.abs(t.gridX - this.gridX) + Math.abs(t.gridY - this.gridY);
            if (dist < minDist) {
                minDist = dist;
                nearestEnemy = t;
            }
        }
        
        if (!nearestEnemy || minDist <= 4) return false;
        if (minDist > 15) return false;
        
        const candidates = [];
        for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
                if (Math.abs(dx) + Math.abs(dy) < 1 || Math.abs(dx) + Math.abs(dy) > 3) continue;
                const cx = nearestEnemy.gridX + dx;
                const cy = nearestEnemy.gridY + dy;
                
                if (this.mapManager.isSolid(cx, cy)) continue;
                if (this.bombManager.hasBombAt(cx, cy)) continue;
                
                const bombTime = this.getMinBombExplosionTimeAt(cx, cy);
                if (bombTime !== Infinity && bombTime < 2.0) continue;
                
                const dInfo = this.dangerMap.getDangerInfo(cx, cy);
                if (dInfo.isFlameActive || dInfo.dangerLevel > 0) continue;
                
                const wallBonus = this.isWallProtected(cx, cy) ? 10 : 0;
                const distToMe = Math.abs(cx - this.gridX) + Math.abs(cy - this.gridY);
                candidates.push({ x: cx, y: cy, score: wallBonus - distToMe * 2 });
            }
        }
        
        candidates.sort((a, b) => b.score - a.score);
        
        if (candidates.length > 0) {
            const best = candidates[0];
            const path = this.aStar(this.gridX, this.gridY, best.x, best.y, false);
            if (path && path.length > 0) {
                this.targetPath = path;
                this.state = 'CHASE';
                return true;
            }
        }
        
        return false;
    }

    // ==================== 收集道具 ====================

    tryGather() {
        if (!this.itemManager || this.itemManager.items.length === 0) return false;
        
        // 比較近的道具有效
        let nearestItem = null;
        let minItemDist = Infinity;
        for (const item of this.itemManager.items) {
            const dist = Math.abs(this.gridX - item.gridX) + Math.abs(this.gridY - item.gridY);
            if (dist < minItemDist) {
                minItemDist = dist;
                nearestItem = item;
            }
        }
        
        if (!nearestItem || minItemDist > 10) return false;
        
        // 檢查道具位置是否安全（使用全面的安全檢查）
        if (!this.isCellSafe(nearestItem.gridX, nearestItem.gridY)) return false;
        
        const path = this.aStar(this.gridX, this.gridY, nearestItem.gridX, nearestItem.gridY, false);
        if (path && path.length > 0) {
            this.targetPath = path;
            this.state = 'GATHER';
            return true;
        }
        
        return false;
    }
}