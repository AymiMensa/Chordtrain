import assetLoader from '../../engine/renderer/AssetLoader.js';

export class Monster {
    constructor(gridX, gridY, gridSystem, mapManager, type = 'slime') {
        this.gridX = gridX;
        this.gridY = gridY;
        this.gridSystem = gridSystem;
        this.mapManager = mapManager;
        this.type = type;

        const pos = this.gridSystem.getPixelCoord(gridX, gridY);
        this.x = pos.x;
        this.y = pos.y;
        
        // Define 15+ Monster Types
        const stats = {
            'SLIME': { speed: 2, ai: 'random', color: '#0f0', symbol: '💧' },
            'SPIDER': { speed: 2.5, ai: 'random', color: '#800', symbol: '🕷️' },
            'BAT': { speed: 3.5, ai: 'random', color: '#555', symbol: '🦇' },
            'GHOST': { speed: 1.5, ai: 'chase', color: '#ccc', symbol: '👻', wallPass: true },
            'ZOMBIE': { speed: 1, ai: 'chase', color: '#4a4', symbol: '🧟' },
            'SKELETON': { speed: 2, ai: 'random', color: '#eee', symbol: '💀' },
            'GOBLIN': { speed: 3, ai: 'flee', color: '#5a5', symbol: '👺' },
            'ORC': { speed: 1.8, ai: 'chase', color: '#363', symbol: '👹' },
            'TROLL': { speed: 1.2, ai: 'chase', color: '#774', symbol: '🧌' },
            'WIZARD': { speed: 2, ai: 'flee', color: '#00f', symbol: '🧙' },
            'DRAGON_WHELP': { speed: 3, ai: 'chase', color: '#f00', symbol: '🐉' },
            'DEMON': { speed: 3.5, ai: 'chase', color: '#a00', symbol: '👿' },
            'VAMPIRE': { speed: 3, ai: 'chase', color: '#808', symbol: '🧛' },
            'ASSASSIN': { speed: 4, ai: 'chase', color: '#222', symbol: '🥷' },
            'HUNTER': { speed: 2.5, ai: 'chase', color: '#852', symbol: '🏹' },
            'MIMIC': { speed: 0, ai: 'idle', color: '#a85', symbol: '🧰' },
            'GOLEM': { speed: 1, ai: 'random', color: '#888', symbol: '🪨', breakWall: true }
        };
        
        const typeStats = stats[this.type] || stats['SLIME'];
        this.speed = typeStats.speed;
        this.ai = typeStats.ai;
        this.color = typeStats.color;
        this.symbol = typeStats.symbol;
        this.wallPass = typeStats.wallPass || false;
        this.breakWall = typeStats.breakWall || false;

        this.isDead = false;
        this.deathTimer = 0;

        // AI 移動狀態
        this.direction = this.getRandomDirection();
        
        // 用於動畫
        this.time = Math.random() * 100;
        this.tiltAngle = 0;
    }

    getRandomDirection() {
        const dirs = [
            { dx: -1, dy: 0 },
            { dx: 1, dy: 0 },
            { dx: 0, dy: -1 },
            { dx: 0, dy: 1 }
        ];
        return dirs[Math.floor(Math.random() * dirs.length)];
    }

    die() {
        if (!this.isDead) {
            this.isDead = true;
            this.deathTimer = 0;
        }
    }

    update(deltaTime, bombManager, target) {
        if (this.isDead) {
            this.deathTimer += deltaTime;
            return;
        }
        
        if (this.ai === 'idle') return; // Mimic stays still

        const cellSize = this.gridSystem.getCellSize();
        const moveDist = this.speed * cellSize * deltaTime;

        // Basic AI decisions at grid intersections
        const tolerance = cellSize * 0.1;

        // ===== 修正：必須先扣除地圖置中偏移 offsetX / offsetY =====
        //
        // 實測（1280x960、13x11）：cellSize ≈ 87.27、offsetX ≈ 72.73、offsetY = 0。
        // offsetX 不是 cellSize 的整數倍（約 0.83 格），所以
        //     this.x % cellSize
        // 永遠等於 72.73（≈0.83 格），而 tolerance 只有 8.73。
        //
        // 結果 `gridXPos < tolerance` 幾乎永遠不成立 → 整個
        // 「到達路口」的判斷形同虛設，chase 型怪物不會在路口重新
        // 鎖定玩家、隨機轉向也幾乎不會發生，怪物只會一路直走到撞牆。
        // 實測 3 局：正確算法會在路口觸發 509+300+224 幀，
        // 而現有算法只有 78+26+89 幀，差了 6~10 倍。
        //
        // 正確的「格內偏移」必須先把 offset 扣掉：
        //     ((x - offsetX) % cellSize + cellSize) % cellSize
        // 這樣才對應 GridSystem.getPixelCoord() 採用的同一套座標系。
        // 這與 Player.js / Monster 自己的 gridX 換算方式保持一致。
        const _moX = this.gridSystem.offsetX || 0;
        const _moY = this.gridSystem.offsetY || 0;
        const gridXPos = ((this.x - _moX) % cellSize + cellSize) % cellSize;
        const gridYPos = ((this.y - _moY) % cellSize + cellSize) % cellSize;
        
        if (gridXPos < tolerance && gridYPos < tolerance) {
            if (this.ai === 'chase' && target) {
                // Determine direction to target
                const dx = target.x - this.x;
                const dy = target.y - this.y;
                if (Math.random() < 0.8) { // 80% chance to chase directly
                    if (Math.abs(dx) > Math.abs(dy)) {
                        this.direction = { dx: Math.sign(dx), dy: 0 };
                    } else {
                        this.direction = { dx: 0, dy: Math.sign(dy) };
                    }
                }
            } else if (this.ai === 'flee' && target) {
                const dx = target.x - this.x;
                const dy = target.y - this.y;
                if (Math.hypot(dx, dy) < cellSize * 5) {
                    if (Math.abs(dx) > Math.abs(dy)) {
                        this.direction = { dx: -Math.sign(dx), dy: 0 };
                    } else {
                        this.direction = { dx: 0, dy: -Math.sign(dy) };
                    }
                }
            }
        }

        // 簡單 AI: 直直走，碰到障礙物就轉彎，或是在網格中心點有機率隨機轉彎
        let nextX = this.x + this.direction.dx * moveDist;
        let nextY = this.y + this.direction.dy * moveDist;

        // 檢查碰撞 (與玩家類似的 AABB，但不允許穿透任何炸彈)
        const checkCollision = (px, py) => {
            const padding = cellSize * 0.1;
            const topLeft = this.gridSystem.getGridCoord(px + padding, py + padding);
            const topRight = this.gridSystem.getGridCoord(px + cellSize - padding, py + padding);
            const bottomLeft = this.gridSystem.getGridCoord(px + padding, py + cellSize - padding);
            const bottomRight = this.gridSystem.getGridCoord(px + cellSize - padding, py + cellSize - padding);

            const t1 = this.mapManager.getBlockType(topLeft.x, topLeft.y);
            const t2 = this.mapManager.getBlockType(topRight.x, topRight.y);
            const t3 = this.mapManager.getBlockType(bottomLeft.x, bottomLeft.y);
            const t4 = this.mapManager.getBlockType(bottomRight.x, bottomRight.y);

            let isMapSolid = false;
            if (this.wallPass) {
                // Can pass through soft blocks (2)
                isMapSolid = (t1 === 1 || t2 === 1 || t3 === 1 || t4 === 1);
            } else if (this.breakWall) {
                // Break soft blocks
                if (t1 === 2) this.mapManager.destroyBlock(topLeft.x, topLeft.y);
                if (t2 === 2) this.mapManager.destroyBlock(topRight.x, topRight.y);
                if (t3 === 2) this.mapManager.destroyBlock(bottomLeft.x, bottomLeft.y);
                if (t4 === 2) this.mapManager.destroyBlock(bottomRight.x, bottomRight.y);
                isMapSolid = (t1 === 1 || t2 === 1 || t3 === 1 || t4 === 1);
            } else {
                isMapSolid = (t1 === 1 || t1 === 2 || t2 === 1 || t2 === 2 || 
                              t3 === 1 || t3 === 2 || t4 === 1 || t4 === 2);
            }

            if (isMapSolid) return true;

            if (bombManager) {
                const isBombSolid = bombManager.hasBombAt(topLeft.x, topLeft.y) ||
                                    bombManager.hasBombAt(topRight.x, topRight.y) ||
                                    bombManager.hasBombAt(bottomLeft.x, bottomLeft.y) ||
                                    bombManager.hasBombAt(bottomRight.x, bottomRight.y);
                if (isBombSolid) return true;
            }

            return false;
        };

        if (checkCollision(nextX, nextY)) {
            // 撞牆了，貼齊網格並轉彎
            const pos = this.gridSystem.getPixelCoord(this.gridX, this.gridY);
            this.x = pos.x;
            this.y = pos.y;
            this.direction = this.getRandomDirection();
        } else {
            // 前進
            this.x = nextX;
            this.y = nextY;
            
            // 如果剛好接近網格中心點，有小機率轉彎 (增加不可預測性)
            const cx = this.x + cellSize/2;
            const cy = this.y + cellSize/2;
            const gridCenter = this.gridSystem.getPixelCoord(this.gridX, this.gridY);
            gridCenter.x += cellSize/2;
            gridCenter.y += cellSize/2;
            
            const distToCenter = Math.hypot(cx - gridCenter.x, cy - gridCenter.y);
            // 第七十四輪（怪物移動層）：再把「自發隨機轉向」機率降到 0.008 / SPIDER 0.02。
            //
            // 根因實測（bb-coverage.mjs）：殘局清不完的真因是「對準稀缺」——
            // Bot 好不容易算準一條直線上的攔截站位，怪卻在路口自發隨機掉頭，
            // 等 Bot 走到火線，怪早就移走了。這個自發轉向（撞牆/被炸彈擋才轉向是
            // 必要的、保留；沒撞牆也隨機掉頭則純粹是雜訊）正是「對不準」的放大器。
            //
            // A/B 實測（bb-modes.mjs，60 局/格，1~3 關）：
            //   試了三檔——OLD(0.02/0.05)、MID(0.012/0.03)、LOW(0.004/0.01)。
            //   LOW 讓雙人大漲(第1關 25→42.5%)但單人反而下降（獨行 Bot 靠怪「亂走晃進
            //   火線」撿機會，怪走太直反而對不上）。
            //   MID 是兩個模式的最佳折衷：單人 +5.0/+1.7（第1關 15→20%）、
            //   雙人 +1.7/0/+3.3，且**兩個模式的死亡率都下降**（怪更可預測，Bot 比較
            //   不會被逼到角落）。單人第3關 −3.3（約 2 局）在抽樣誤差內。
            //   故採 MID，而非更激進的 LOW。
            // 仍保留足量隨機（避免多隻怪永遠同步、或看起來像軌道玩具），
            // 也讓人類玩家覺得「怪比較不會鬼打牆」。不改速度、類型、碰撞。
            const turnProb = this.type === 'SPIDER' ? 0.02 : 0.008;
            
            if (distToCenter < moveDist * 2 && Math.random() < turnProb) {
                // 強制貼齊並轉向
                this.x = gridCenter.x - cellSize/2;
                this.y = gridCenter.y - cellSize/2;
                this.direction = this.getRandomDirection();
            }
        }

        // 更新網格座標
        //
        // ===== 修正：必須先扣除地圖置中偏移 offsetX / offsetY =====
        //
        // 實測（這是「擊殺恆為 0」的根本原因）：
        // 原本寫成
        //     this.gridX = Math.floor((this.x + cellSize/2) / cellSize);
        // 沒有扣除 gridSystem.offsetX / offsetY。
        //
        // Canvas 是 16:9、地圖是 13x11，GridSystem 會把地圖置中，
        // 1280x960 時 offsetX ≈ 72.7px（約 0.83 格）、cellSize ≈ 87.3px。
        // 因此怪物回報的格座標會系統性地比真實位置大約 1 格。
        //
        // 後果是致命的：ExplosionManager.checkMonsterHit() 的判定是
        //     if (m.gridX === exp.gridX && m.gridY === exp.gridY) m.die();
        // 炸彈在「真實格座標」爆炸、怪物卻回報「偏移後的格座標」，
        // 兩者永遠不相等 → **怪物永遠不會被炸死**。
        //
        // 這完全解釋了為什麼不管 AI 怎麼調整權重、預測或優先序，
        // 擊殺數永遠是 0：判斷根本不可能成立。
        //
        // （先前受控實驗之所以能殺死怪物，是因為實驗腳本手動覆寫了
        //   monster.gridX，剛好繞過了這個 bug。）
        //
        // 這與 Player.js 的換算方式保持一致（Player 已做同樣修正），
        // 沒有改動任何遊戲規則：怪物的速度、移動、碰撞半徑與 HP 皆未更動。
        const _ox = this.gridSystem.offsetX || 0;
        const _oy = this.gridSystem.offsetY || 0;
        this.gridX = Math.floor((this.x + cellSize/2 - _ox) / cellSize);
        this.gridY = Math.floor((this.y + cellSize/2 - _oy) / cellSize);
    }

    render(ctx) {
        const cellSize = this.gridSystem.getCellSize();
        const padding = cellSize * 0.15;
        const renderX = this.x + padding;
        const renderY = this.y + padding;
        const renderSize = cellSize - padding * 2;

        ctx.save();
        
        if (this.isDead) {
            const shrink = Math.max(0, 1 - this.deathTimer * 2);
            ctx.translate(renderX + renderSize / 2, renderY + renderSize / 2);
            ctx.rotate(this.deathTimer * Math.PI * 8);
            ctx.scale(shrink, shrink);
            
            ctx.shadowColor = '#cc00ff';
            ctx.shadowBlur = 20;
            ctx.fillStyle = '#cc00ff';
            ctx.fillRect(-renderSize/2, -renderSize/2, renderSize, renderSize);
            ctx.restore();
            return;
        }

        this.time += 0.1;
        const bobbing = Math.sin(this.time) * (cellSize * 0.05);
        this.tiltAngle = this.direction.dx * 0.1;

        ctx.translate(renderX + renderSize / 2, renderY + renderSize / 2 + bobbing);
        ctx.rotate(this.tiltAngle);

        let dirSuffix = 'down';
        if (Math.abs(this.direction.dx) > Math.abs(this.direction.dy)) {
            dirSuffix = this.direction.dx > 0 ? 'right' : 'left';
        } else if (this.direction.dy < 0) {
            dirSuffix = 'up';
        }
        const monsterImg = assetLoader.getImage('monster_' + dirSuffix);
        
        if (monsterImg) {
            ctx.drawImage(monsterImg, -renderSize/2, -renderSize/2, renderSize, renderSize);
        } else {
            let color1 = '#ff00aa';
            let color2 = '#5500aa';
            if (this.type === 'GHOST') { color1 = '#ffffff'; color2 = '#cccccc'; ctx.globalAlpha = 0.7; }
            else if (this.type === 'BAT') { color1 = '#4b0082'; color2 = '#000000'; }
            else if (this.type === 'SPIDER') { color1 = '#8b4513'; color2 = '#000000'; }
            
            ctx.shadowColor = color1;
            ctx.shadowBlur = 15;
            
            const grad = ctx.createLinearGradient(-renderSize/2, -renderSize/2, renderSize/2, renderSize/2);
            grad.addColorStop(0, color1);
            grad.addColorStop(1, color2);
            
            ctx.fillStyle = grad;
            
            if (this.type === 'BAT') {
                ctx.beginPath();
                ctx.moveTo(0, -renderSize/2);
                ctx.lineTo(renderSize/2, 0);
                ctx.lineTo(0, renderSize/2);
                ctx.lineTo(-renderSize/2, 0);
                ctx.closePath();
                ctx.fill();
            } else if (this.type === 'SPIDER') {
                ctx.beginPath();
                ctx.arc(0, 0, renderSize/2 * 0.8, 0, Math.PI * 2);
                ctx.fill();
                // Legs
                ctx.strokeStyle = color2;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(-renderSize/2, -renderSize/4); ctx.lineTo(renderSize/2, -renderSize/4);
                ctx.moveTo(-renderSize/2, 0); ctx.lineTo(renderSize/2, 0);
                ctx.moveTo(-renderSize/2, renderSize/4); ctx.lineTo(renderSize/2, renderSize/4);
                ctx.stroke();
            } else {
                // SLIME or GHOST
                ctx.beginPath();
                ctx.arc(0, 0, renderSize/2, 0, Math.PI, true);
                ctx.lineTo(renderSize/2, renderSize/2);
                ctx.lineTo(-renderSize/2, renderSize/2);
                ctx.closePath();
                ctx.fill();
            }

            // 眼睛
            ctx.shadowBlur = 0;
            ctx.fillStyle = this.type === 'GHOST' ? '#000000' : (this.type === 'SPIDER' ? '#ff0000' : '#ffff00');
            ctx.fillRect(-renderSize*0.3, -renderSize*0.2, renderSize*0.2, renderSize*0.2);
            ctx.fillRect(renderSize*0.1, -renderSize*0.2, renderSize*0.2, renderSize*0.2);
        }

        ctx.restore();
    }
}


