export class DragonBoss {
    /**
     * ===== 龍王依關卡排序，不再純隨機 =====
     *
     * 舊版是 types[Math.floor(Math.random() * types.length)]，
     * 註解寫「based on level」但程式根本沒用到 level，
     * 導致 6 個 BOSS 關的龍王 HP 每次都可能是 15~100 的任一值，
     * 同一關重玩難度會亂跳。
     *
     * 現在固定成「關卡越後面、龍王越強」，6 個 BOSS 關剛好用掉 6 種。
     */
    static STAGE_BOSS = {
        10: 'SHADOW_ASSASSIN',   // HP 15  speed 4.0  -> 約 0.5 顆炸彈
        20: 'GHOST_KING',       // HP 25  speed 2.5  -> 約 0.8 顆炸彈
        30: 'ICE_TITAN',        // HP 40  speed 1.5  -> 約 1.3 顆炸彈
        40: 'CRYSTAL_GOLEM',    // HP 60  speed 1.0  -> 約 2.0 顆炸彈
        50: 'DARK_TITAN',       // HP 80  speed 2.5  -> 約 2.7 顆炸彈
        60: 'FINAL_OVERLORD',   // HP 100 speed 3.0  -> 約 3.3 顆炸彈
    };
    constructor(gridX, gridY, gridSystem, mapManager, explosionManager, stage = null) {
        this.gridX = gridX;
        this.gridY = gridY;
        this.gridSystem = gridSystem;
        this.mapManager = mapManager;
        this.explosionManager = explosionManager;
        
        const pos = this.gridSystem.getPixelCoord(this.gridX, this.gridY);
        this.x = pos.x;
        this.y = pos.y;
        
        const types = [
            'DRAGON', 'MECHA_SPIDER', 'ICE_TITAN', 'SHADOW_ASSASSIN',
            'VOLCANO_WORM', 'CRYSTAL_GOLEM', 'GHOST_KING', 'BOMB_MASTER',
            'SLIME_QUEEN', 'FINAL_OVERLORD', 'DARK_TITAN'
        ];
        // 依關卡固定龍王；stage 未提供時才退回舊的隨機行為（向後相容）。
        this.type = (stage && DragonBoss.STAGE_BOSS[stage])
            ? DragonBoss.STAGE_BOSS[stage]
            : types[Math.floor(Math.random() * types.length)];
        
        const stats = {
            'DRAGON': { speed: 2, hp: 30, color: '#aa0000', symbol: '🐉' },
            'MECHA_SPIDER': { speed: 3, hp: 20, color: '#444', symbol: '🤖' },
            'ICE_TITAN': { speed: 1.5, hp: 40, color: '#0ff', symbol: '🧊' },
            'SHADOW_ASSASSIN': { speed: 4, hp: 15, color: '#111', symbol: '🗡️' },
            'VOLCANO_WORM': { speed: 1, hp: 50, color: '#f50', symbol: '🐛' },
            'CRYSTAL_GOLEM': { speed: 1, hp: 60, color: '#f0f', symbol: '💎' },
            'GHOST_KING': { speed: 2.5, hp: 25, color: '#fff', symbol: '👑' },
            'BOMB_MASTER': { speed: 2.5, hp: 25, color: '#222', symbol: '💣' },
            'SLIME_QUEEN': { speed: 1.5, hp: 45, color: '#0f0', symbol: '👑' },
            'FINAL_OVERLORD': { speed: 3, hp: 100, color: '#f00', symbol: '👁️' },
            // 新增：填補 HP 曲線 60 -> 100 之間缺少的 80 檔位
            'DARK_TITAN': { speed: 2.5, hp: 80, color: '#4a0', symbol: '🗿' }
        };
        
        this.speed = stats[this.type].speed;
        this.hp = stats[this.type].hp;
        this.maxHp = this.hp;
        
        this.isDead = false;
        this.fireTimer = 0;
        this.specialTimer = 0;
        this.direction = { dx: -1, dy: 0 };
        this.time = 0;
        this.phase = 1;
    }

    update(deltaTime) {
        if (this.isDead) return;
        this.time += deltaTime;

        // 隨機移動
        if (Math.random() < 0.02) {
            const dirs = [{dx:1,dy:0}, {dx:-1,dy:0}, {dx:0,dy:1}, {dx:0,dy:-1}];
            this.direction = dirs[Math.floor(Math.random() * dirs.length)];
        }

        const cellSize = this.gridSystem.getCellSize();
        const nextX = this.x + this.direction.dx * this.speed * cellSize * deltaTime;
        const nextY = this.y + this.direction.dy * this.speed * cellSize * deltaTime;

        // 簡單邊界檢查 (Boss 佔用 2x2 或 1x1，這裡先算 1x1 稍微大一點)
        const checkMap = this.mapManager.isSolid(
            Math.floor((nextX + cellSize/2) / cellSize),
            Math.floor((nextY + cellSize/2) / cellSize)
        );

        if (!checkMap) {
            this.x = nextX;
            this.y = nextY;
            this.gridX = Math.floor((this.x + cellSize/2) / cellSize);
            this.gridY = Math.floor((this.y + cellSize/2) / cellSize);
        } else {
            // 撞牆反轉
            this.direction.dx *= -1;
            this.direction.dy *= -1;
        }

        // Multi-phase behavior checks
        if (this.hp < this.maxHp * 0.5 && this.phase === 1) {
            this.phase = 2;
            this.speed *= 1.5; // Phase 2 makes them faster
            console.log(`${this.type} enters PHASE 2!`);
        }
        if (this.hp < this.maxHp * 0.2 && this.phase === 2) {
            this.phase = 3;
            this.speed *= 1.5; // Phase 3 makes them super fast
            console.log(`${this.type} enters PHASE 3!`);
        }

        // 技能攻擊
        this.fireTimer += deltaTime;
        const attackCooldown = this.phase === 1 ? 3.0 : (this.phase === 2 ? 2.0 : 1.0);
        
        if (this.fireTimer > attackCooldown) {
            this.fireTimer = 0;
            if (this.explosionManager) {
                switch (this.type) {
                    case 'DRAGON':
                        this.explosionManager.createExplosion(this.gridX, this.gridY, 5 + this.phase, true, 'CROSS');
                        break;
                    case 'ICE_TITAN':
                        this.explosionManager.createExplosion(this.gridX, this.gridY, 3 * this.phase, false, 'ICE');
                        break;
                    case 'BOMB_MASTER':
                        this.explosionManager.createExplosion(this.gridX + 1, this.gridY, 3, false, 'X');
                        this.explosionManager.createExplosion(this.gridX - 1, this.gridY, 3, false, 'X');
                        break;
                    case 'FINAL_OVERLORD':
                        this.explosionManager.createExplosion(this.gridX, this.gridY, 10, true, 'ROUND');
                        if (this.phase >= 2 && window.monsterManager) window.monsterManager.spawnMonsters(1);
                        break;
                    case 'SLIME_QUEEN':
                        this.explosionManager.createExplosion(this.gridX, this.gridY, 4, false, 'ROUND');
                        if (window.monsterManager) window.monsterManager.spawnMonsters(2);
                        break;
                    case 'MECHA_SPIDER':
                        this.explosionManager.createDirectionalExplosion(this.gridX, this.gridY, this.direction.dx, this.direction.dy, 5 + this.phase);
                        break;
                    case 'SHADOW_ASSASSIN':
                        // Teleport near player
                        if (window.player && !window.player.isDead) {
                            this.gridX = window.player.gridX + 1;
                            this.gridY = window.player.gridY;
                            this.x = this.gridX * this.gridSystem.getCellSize();
                            this.y = this.gridY * this.gridSystem.getCellSize();
                            this.explosionManager.createExplosion(this.gridX, this.gridY, 2, false, 'CROSS');
                        }
                        break;
                    case 'VOLCANO_WORM':
                        if (window.player && !window.player.isDead) {
                            this.explosionManager.createExplosion(window.player.gridX, window.player.gridY, 2, false, 'ROUND');
                        }
                        break;
                    case 'CRYSTAL_GOLEM':
                        this.explosionManager.createExplosion(this.gridX, this.gridY, 4 + this.phase, true, 'SQUARE');
                        break;
                    case 'GHOST_KING':
                        this.explosionManager.createExplosion(this.gridX, this.gridY, 5 + this.phase, true, 'X');
                        break;
                    default:
                        this.explosionManager.createExplosion(this.gridX, this.gridY, 3, false, 'CROSS');
                        break;
                }
            }
        }
    }

    die() {
        if (!this.isDead) {
            this.hp--;
            console.log(`Boss HP: ${this.hp}`);
            if (this.hp <= 0) {
                this.isDead = true;
                console.log('Boss defeated!');
                if (this.explosionManager) {
                    this.explosionManager.createExplosion(this.gridX, this.gridY, 6, true, 'ROUND');
                }
                if (window.audioManager) {
                    window.audioManager.playExplosion();
                }
            }
        }
    }

    render(ctx) {
        if (this.isDead) return;
        const cellSize = this.gridSystem.getCellSize();
        
        ctx.save();
        ctx.translate(this.x + cellSize/2, this.y + cellSize/2);
        
        // 浮動動畫
        const bob = Math.sin(this.time * 5) * 5;
        ctx.translate(0, bob);

        // 繪製 Boss (Generic rendering with specific colors)
        ctx.shadowColor = this.phase >= 2 ? '#ff0000' : '#000';
        ctx.shadowBlur = this.phase === 3 ? 50 : 20;
        
        // 畫一個大圓形身體
        ctx.fillStyle = this.phase === 3 ? '#fff' : '#444';
        ctx.beginPath();
        ctx.arc(0, 0, cellSize, 0, Math.PI * 2);
        ctx.fill();
        
        // 眼睛
        ctx.fillStyle = this.phase >= 2 ? '#f00' : '#ff0';
        ctx.beginPath();
        ctx.arc(-10, -10, 5, 0, Math.PI * 2);
        ctx.arc(10, -10, 5, 0, Math.PI * 2);
        ctx.fill();
        
        // Symbol
        ctx.fillStyle = '#fff';
        ctx.font = `${cellSize}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        let symbol = '🐉';
        switch (this.type) {
            case 'MECHA_SPIDER': symbol = '🤖'; break;
            case 'ICE_TITAN': symbol = '🧊'; break;
            case 'SHADOW_ASSASSIN': symbol = '🗡️'; break;
            case 'VOLCANO_WORM': symbol = '🐛'; break;
            case 'CRYSTAL_GOLEM': symbol = '💎'; break;
            case 'GHOST_KING': symbol = '👑'; break;
            case 'BOMB_MASTER': symbol = '💣'; break;
            case 'SLIME_QUEEN': symbol = '👑'; break;
            case 'FINAL_OVERLORD': symbol = '👁️'; break;
        }
        ctx.fillText(symbol, 0, 10);

        // HP 條
        ctx.fillStyle = '#f00';
        ctx.fillRect(-cellSize, -cellSize - 15, (cellSize * 2) * (this.hp / this.maxHp), 8);
        
        ctx.restore();
    }
}
