import { Monster } from './Monster.js';

export class MonsterManager {
    constructor(gridSystem, mapManager, bombManager) {
        this.gridSystem = gridSystem;
        this.mapManager = mapManager;
        this.bombManager = bombManager;
        this.monsters = [];
        this.freezeTimer = 0;
    }

    /**
     * ===== 關卡難度分帶 =====
     *
     * 這 17 種怪物是依「移動速度由慢到快」排序後，依序切成的 6 個難度帶
     * （2 / 2 / 2 / 3 / 4 / 4 = 17 種剛好用完）。
     *
     * 為什麼要這樣改（原本的問題）：
     *   舊版 spawnMonsters() 從全部 17 種裡「純隨機」抽，完全不看關卡數。
     *   結果第 1 關會生出 ASSASSIN（速度 4，與玩家同速），
     *   第 60 關反而可能生出 MIMIC（速度 0，完全不動）。
     *   難度因此不是曲線，而是雜訊 —— 同一關重玩難度會亂跳。
     *
     * 難度現在只由三個可預期的旋鈕決定：怪物數、地圖大小、每 10 關的龍王。
     *
     * 注意：GOBLIN 原本與 DRAGON_WHELP / VAMPIRE 同為速度 3，
     * 放在第 5 帶會讓第 5、6 帶在速度 3 處重疊。
     * 經確認後把 GOBLIN 移入第 6 帶，讓分界落在 3（含）以下，
     * 第 5 帶 = 3 種、第 6 帶 = 5 種，總數仍是 2+2+2+3+3+5 = 17。
     *
     * 第 1 帶另外做了「數量權重」：
     *   MIMIC 的 AI 是 idle（完全不動），當靶子太無聊，
     *   但直接移除又會少一種。改成 4 個槽位中只有 1 個是 MIMIC，
     *   也就是 MIMIC 約 25%、ZOMBIE 約 75%（原本是各 50%）。
     *   種類循環是 pool[spawned % pool.length]，重複的槽位即為權重。
     */
    static DIFFICULTY_BANDS = [
        // MIMIC 刻意只佔 1 個槽位（≈25%），其餘 3 個是 ZOMBIE
        { from: 1,  to: 10, types: ['ZOMBIE', 'ZOMBIE', 'ZOMBIE', 'MIMIC'] },
        { from: 11, to: 20, types: ['TROLL', 'GOLEM'] },
        { from: 21, to: 30, types: ['GHOST', 'ORC'] },
        { from: 31, to: 40, types: ['SLIME', 'SKELETON', 'WIZARD'] },
        { from: 41, to: 50, types: ['SPIDER', 'HUNTER', 'DRAGON_WHELP'] },
        { from: 51, to: 60, types: ['GOBLIN', 'VAMPIRE', 'BAT', 'DEMON', 'ASSASSIN'] },
    ];

    /** 取得某關卡該用的怪物種類池（超出 60 關時沿用最後一帶） */
    static typesForStage(stage) {
        if (!stage || !Number.isFinite(stage)) return null;
        for (const b of MonsterManager.DIFFICULTY_BANDS) {
            if (stage >= b.from && stage <= b.to) return b.types;
        }
        return MonsterManager.DIFFICULTY_BANDS[MonsterManager.DIFFICULTY_BANDS.length - 1].types;
    }

    // 在地圖邊緣或隨機空白區域生成怪物
    /**
     * @param {number} count 想生成的數量
     * @param {number} [stage] 目前關卡。傳入時會依難度分帶限制種類；
     *                     不傳則維持原本「17 種全隨機」的舊行為（向後相容）。
     */
    spawnMonsters(count, stage = null) {
        const allTypes = [
            'SLIME', 'SPIDER', 'BAT', 'GHOST', 'ZOMBIE', 'SKELETON', 'GOBLIN',
            'ORC', 'TROLL', 'WIZARD', 'DRAGON_WHELP', 'DEMON', 'VAMPIRE',
            'ASSASSIN', 'HUNTER', 'MIMIC', 'GOLEM'
        ];
        const pool = MonsterManager.typesForStage(stage) || allTypes;

        let spawned = 0;
        // 舊版的 attempts 上限只有 100，在大地圖上常常找不到空位，
        // 導致實際生成數量少於預設（例如第 52 關公式要 29 隻卻只生出 26 隻），
        // 讓「怪物數」這個難度旋鈕失準。改成依需求量放大嘗試次數。
        const maxAttempts = Math.max(100, count * 60);
        let attempts = 0;
        while (spawned < count && attempts < maxAttempts) {
            const gx = Math.floor(Math.random() * this.gridSystem.cols);
            const gy = Math.floor(Math.random() * this.gridSystem.rows);

            // 避免生成在玩家附近 (1,1), (1,2), (2,1)
            if (gx < 3 && gy < 3) {
                attempts++;
                continue;
            }

            if (!this.mapManager.isSolid(gx, gy)) {
                // 種類依難度帶決定；帶內以 spawned 循序輪替，
                // 讓每一關的怪物組成可預測，而不是純隨機。
                const type = pool[spawned % pool.length];
                this.monsters.push(new Monster(gx, gy, this.gridSystem, this.mapManager, type));
                spawned++;
            }
            attempts++;
        }
    }

    // 檢查怪物是否抓到玩家
    checkPlayerCollision(player) {
        if (player.isDead) return;
        const pRadius = this.gridSystem.getCellSize() * 0.4;
        const pCx = player.x + this.gridSystem.getCellSize() / 2;
        const pCy = player.y + this.gridSystem.getCellSize() / 2;

        for (const m of this.monsters) {
            if (m.isDead) continue;
            const mRadius = this.gridSystem.getCellSize() * 0.4;
            const mCx = m.x + this.gridSystem.getCellSize() / 2;
            const mCy = m.y + this.gridSystem.getCellSize() / 2;

            const dist = Math.hypot(pCx - mCx, pCy - mCy);
            if (dist < pRadius + mRadius) {
                // 玩家被抓到了！
                player.die();
                break;
            }
        }
    }

    update(deltaTime) {
        if (this.freezeTimer > 0) {
            this.freezeTimer -= deltaTime;
            // 如果冰凍中，只更新動畫/死亡倒數，不更新位置 (或不呼叫 m.update，但需要死亡動畫)
            for (let i = this.monsters.length - 1; i >= 0; i--) {
                const m = this.monsters[i];
                if (m.isDead) m.deathTimer += deltaTime;
                
                if (m.isDead && m.deathTimer > 0.5) {
                    this.monsters.splice(i, 1);
                }
            }
            return;
        }

        // Get nearest player or bot
        const players = [];
        if (typeof window !== 'undefined') {
            const addTarget = (p) => {
                if (p && !p.isDead) {
                    players.push(p);
                    // 如果玩家有分身，將分身視為一個低血量的誘餌加入目標池
                    if (p.cloneTimer > 0) {
                        players.push({
                            x: p.cloneX,
                            y: p.cloneY,
                            gridX: Math.floor(p.cloneX / this.gridSystem.getCellSize()),
                            gridY: Math.floor(p.cloneY / this.gridSystem.getCellSize()),
                            isDead: false,
                            isClone: true
                        });
                    }
                }
            };
            addTarget(window.player);
            addTarget(window.player2);
            addTarget(window.bot);
            addTarget(window.bot2);
        }

        for (let i = this.monsters.length - 1; i >= 0; i--) {
            const m = this.monsters[i];
            
            // Find nearest target
            let target = null;
            let minDist = Infinity;
            for (const p of players) {
                const dist = Math.hypot(p.x - m.x, p.y - m.y);
                if (dist < minDist) {
                    minDist = dist;
                    target = p;
                }
            }
            
            // Check if monster stepped on a mine
            if (this.bombManager && this.bombManager.hasBombAt(m.gridX, m.gridY)) {
                const b = this.bombManager.getBombAt(m.gridX, m.gridY);
                if (b && b.isMine) {
                    b.explode();
                }
            }

            m.update(deltaTime, this.bombManager, target);
            
            if (m.isDead && m.deathTimer > 0.5) { // 死亡動畫結束後移除
                this.monsters.splice(i, 1);
            }
        }
    }

    render(ctx) {
        for (const m of this.monsters) {
            m.render(ctx);
        }
    }
}
