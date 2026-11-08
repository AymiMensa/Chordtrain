import assetLoader from '../../engine/renderer/AssetLoader.js';

export class Player {
    constructor(gridX, gridY, gridSystem, inputManager, mapManager, playerIndex = 0) {
        this.gridX = gridX;
        this.gridY = gridY;
        this.gridSystem = gridSystem;
        this.inputManager = inputManager;
        this.mapManager = mapManager;
        this.playerIndex = playerIndex;
        this.bombManager = null; // 將由 main 注入
        
        this.facing = { dx: 0, dy: 1 }; // Default facing down
        
        // 用於動畫
        this.tiltAngle = 0;
        this.time = 0;
        
        // 像素座標 (浮點數)
        const pos = this.gridSystem.getPixelCoord(this.gridX, this.gridY);
        this.x = pos.x;
        this.y = pos.y;
        
        this.speed = 4; // 每秒移動的網格數
        this.maxBombs = 1;
        this.currentBombs = 0;
        // 第七十二輪（規則層）：十字爆炸長度 2 -> 5。
        //
        // 根因（bb-coverage.mjs）：殘局清不完的真因是「對準稀缺」——
        // 很多時刻沒有任何一格與怪同線、能打到牠。fireRange 決定十字火線
        // 每條臂的長度，直接決定「有多少格算在火線上」。
        //
        // A/B 實測（bb-setparams.cjs 隔離變數，30 局/格 x {SINGLE,COOP} x 1~3 關，
        // 共 180 局/組；Bot.js / BombManager.js 保持本輪版本不變，只切換本行）：
        //
        //   fireRange=2（原始）  meanCLEAR 13.33%   SINGLE 7.77%   COOP 18.90%
        //   fireRange=4          meanCLEAR 16.10%   SINGLE 7.77%   COOP 24.43%
        //   fireRange=5（採用）  meanCLEAR 22.20%   SINGLE 12.20%  COOP 32.20%
        //
        // 單調遞增，5 是實測最好的一檔，且死亡率未上升（32.78% vs 原始 32.23%）：
        // 爆炸變長讓 Bot 能從更遠處出手，反而更安全（不像加炸彈數會逼它貼近）。
        //
        // 誠實範圍：以上只涵蓋第 1~3 關。第 2/3 關單人仍是 3.3%/0%，
        // 未證明對高關有效；不要引用成「全遊戲提升」。
        // 人類與 AI 共用此值（Bot extends Player），對兩者一致生效。
        this.fireRange = 5; // 十字爆炸長度

        // 進階道具狀態
        this.hasShield = false;
        this.shieldTimer = 0;
        this.isGhost = false;
        this.ghostTimer = 0;
        this.isPoisoned = false;
        this.poisonTimer = 0;
        this.hasPierce = false;
        this.hasKick = false;
        this.hasPunch = false;
        this.hasRemoteBomb = false;
        this.hasMine = false;
        this.hasDash = false;
        this.hasPhoenix = false;
        this.hasLaser = false;
        this.hasMagnet = false;
        this.hasHomingBomb = false;
        this.createClone = false;
        this.cloneTimer = 0;
        
        this.timeStopTimer = 0;
        this.isReversed = false;
        this.reverseTimer = 0;
        this.isSlippery = false;
        this.slipperyTimer = 0;
        this.hasBombPass = false;
        this.bombPassTimer = 0;
        this.hasWallPass = false;
        this.wallPassTimer = 0;
        this.isMini = false;
        this.isGiant = false;
        this.isBlind = false;
        this.blindTimer = 0;
        this.noBombTimer = 0;
        
        this.cloneX = 0;
        this.cloneY = 0;

        this.hp = 3;
        this.maxHp = 3;

        // 防重複按鍵狀態
        this.jKeyPressed = false;

        // 死亡狀態
        this.isDead = false;
        this.deathTimer = 0;

        // 保存最後移動方向與 deltaTime 用於 render 動畫
        this.lastDx = 0;
        this.lastDy = 0;
        this.lastDeltaTime = 0;
    }

    setBombManager(bombManager) {
        this.bombManager = bombManager;
    }

    restoreBomb() {
        if (this.currentBombs > 0) {
            this.currentBombs--;
        }
    }

    die() {
        if (this.hasShield || this.isDead) return; // 無敵狀態免死！

        if (this.hasPhoenix) {
            this.hasPhoenix = false;
            this.hasShield = true;
            this.shieldTimer = 3.0; // 復活後無敵3秒
            console.log(`Player ${this.playerIndex} revived by Phoenix!`);
            return;
        }

        if (this.hp > 1) {
            this.hp--;
            this.hasShield = true;
            this.shieldTimer = 2.0;
            return;
        }

        this.hp--;
        this.isDead = true;
        this.deathTimer = 0;
        console.log(`Player ${this.playerIndex} has died!`);
    }

    update(deltaTime) {
        if (this.isDead) {
            this.deathTimer += deltaTime;
            return; // 死亡後停止更新移動邏輯
        }

        // 更新狀態計時器
        if (this.hasShield) {
            this.shieldTimer -= deltaTime;
            if (this.shieldTimer <= 0) this.hasShield = false;
        }
        if (this.isGhost) {
            this.ghostTimer -= deltaTime;
            if (this.ghostTimer <= 0) this.isGhost = false;
        }
        if (this.isPoisoned) {
            this.poisonTimer -= deltaTime;
            if (this.poisonTimer <= 0) this.isPoisoned = false;
        }
        if (this.isReversed) {
            this.reverseTimer -= deltaTime;
            if (this.reverseTimer <= 0) this.isReversed = false;
        }
        if (this.isSlippery) {
            this.slipperyTimer -= deltaTime;
            if (this.slipperyTimer <= 0) this.isSlippery = false;
        }
        if (this.hasBombPass) {
            this.bombPassTimer -= deltaTime;
            if (this.bombPassTimer <= 0) this.hasBombPass = false;
        }
        if (this.hasWallPass) {
            this.wallPassTimer -= deltaTime;
            if (this.wallPassTimer <= 0) this.hasWallPass = false;
        }
        if (this.isBlind) {
            this.blindTimer -= deltaTime;
            if (this.blindTimer <= 0) this.isBlind = false;
        }
        if (this.noBombTimer > 0) {
            this.noBombTimer -= deltaTime;
        }
        
        if (this.createClone) {
            this.createClone = false;
            this.cloneTimer = 10.0;
            this.cloneX = this.x;
            this.cloneY = this.y;
        }
        if (this.cloneTimer > 0) {
            this.cloneTimer -= deltaTime;
        }

        const cellSize = this.gridSystem.getCellSize();
        let currentSpeed = this.speed;
        let speedMultiplier = 1.0;
        if (this.hasDash) currentSpeed *= 1.5; // Dash 道具增加 50% 速度
        
        const moveDist = this.speed * speedMultiplier * cellSize * deltaTime;
        let up = this.inputManager.isActionPressed(this.playerIndex, 'up');
        let down = this.inputManager.isActionPressed(this.playerIndex, 'down');
        let left = this.inputManager.isActionPressed(this.playerIndex, 'left');
        let right = this.inputManager.isActionPressed(this.playerIndex, 'right');

        // 混亂狀態或反轉狀態反轉按鍵
        if (this.isPoisoned || this.isReversed) {
            let tmpUp = up; let tmpDown = down; let tmpLeft = left; let tmpRight = right;
            up = tmpDown; down = tmpUp; left = tmpRight; right = tmpLeft;
        }

        // 地形效果 - 冰塊滑行：如果沒有輸入，維持上一次的移動方向
        const tile = this.mapManager.getBlockType(this.gridX, this.gridY);
        if ((tile === 3 || this.isSlippery) && !up && !down && !left && !right) {
            if (this.lastDy < 0) up = true;
            if (this.lastDy > 0) down = true;
            if (this.lastDx < 0) left = true;
            if (this.lastDx > 0) right = true;
        }

        let dx = 0;
        let dy = 0;
        if (up) dy -= 1;
        if (down) dy += 1;
        if (left) dx -= 1;
        if (right) dx += 1;

        if (dx !== 0 || dy !== 0) {
            // Update facing direction
            this.facing.dx = Math.sign(dx);
            this.facing.dy = Math.sign(dy);
            
            // Normalize
            const length = Math.hypot(dx, dy);
            dx = (dx / length) * moveDist;
            dy = (dy / length) * moveDist;
        }

        if (tile === 4) {
            // 傳送帶：強制向右移動
            dx += moveDist * 0.8;
        }

        if (tile === 5 && !this.hasShield) {
            // 毒池：如果沒有護盾直接死亡
            this.die();
        }

        if (dx !== 0 || dy !== 0) {
            this.lastDx = dx;
            this.lastDy = dy;
        }
        this.lastDeltaTime = deltaTime;

        // 簡單的碰撞檢查 (基於中心點與四個角)
        // 為了 MVP 階段，這裡實作最基礎的碰撞。未來需要更精確的 AABB 碰撞。
        const nextX = this.x + dx;
        const nextY = this.y + dy;

        // 玩家的碰撞框大小稍小於一個網格 (Mini 道具會使碰撞框更小)
        const padding = this.isMini ? cellSize * 0.4 : cellSize * 0.2;
        
        // 檢查預計前往的位置是否與牆壁或炸彈碰撞
        const checkCollision = (px, py) => {
            const topLeft = this.gridSystem.getGridCoord(px + padding, py + padding);
            const topRight = this.gridSystem.getGridCoord(px + cellSize - padding, py + padding);
            const bottomLeft = this.gridSystem.getGridCoord(px + padding, py + cellSize - padding);
            const bottomRight = this.gridSystem.getGridCoord(px + cellSize - padding, py + cellSize - padding);

            // 如果是 Giant 狀態，可以直接撞破軟磚塊 (2)
            if (this.isGiant) {
                this.mapManager.destroyBlock(topLeft.x, topLeft.y);
                this.mapManager.destroyBlock(topRight.x, topRight.y);
                this.mapManager.destroyBlock(bottomLeft.x, bottomLeft.y);
                this.mapManager.destroyBlock(bottomRight.x, bottomRight.y);
            }

            // 檢查地圖方塊
            const isMapSolid = this.mapManager.isSolid(topLeft.x, topLeft.y) || 
                               this.mapManager.isSolid(topRight.x, topRight.y) || 
                               this.mapManager.isSolid(bottomLeft.x, bottomLeft.y) || 
                               this.mapManager.isSolid(bottomRight.x, bottomRight.y);

            if (isMapSolid) {
                // Ghost 可以穿過軟磚塊 (但不能穿透邊界或硬磚塊)
                // Wall Pass 道具也可以穿透軟磚塊
                if (this.isGhost || this.hasWallPass) {
                    const t1 = this.mapManager.getBlockType(topLeft.x, topLeft.y);
                    const t2 = this.mapManager.getBlockType(topRight.x, topRight.y);
                    const t3 = this.mapManager.getBlockType(bottomLeft.x, bottomLeft.y);
                    const t4 = this.mapManager.getBlockType(bottomRight.x, bottomRight.y);
                    // 只要有碰到硬磚塊就擋住，否則放行
                    if (t1 === 1 || t2 === 1 || t3 === 1 || t4 === 1) return true;
                } else {
                    return true;
                }
            }

            // 檢查炸彈實體 (AABB精確碰撞)
            if (this.bombManager) {
                if (this.hasBombPass) return false; // Bomb Pass 道具可以直接穿透炸彈
                
                for (const bomb of this.bombManager.bombs) {
                    const bombPx = this.gridSystem.getPixelCoord(bomb.gridX, bomb.gridY);
                    
                    const bx1 = bombPx.x;
                    const by1 = bombPx.y;
                    const bx2 = bombPx.x + cellSize;
                    const by2 = bombPx.y + cellSize;

                    const pNewX1 = px + padding;
                    const pNewY1 = py + padding;
                    const pNewX2 = px + cellSize - padding;
                    const pNewY2 = py + cellSize - padding;

                    // 檢查新位置是否與炸彈重疊
                    if (pNewX1 < bx2 && pNewX2 > bx1 && pNewY1 < by2 && pNewY2 > by1) {
                        // 檢查舊位置是否已經與炸彈重疊 (若是，代表玩家正在走出炸彈，允許移動)
                        const pOldX1 = this.x + padding;
                        const pOldY1 = this.y + padding;
                        const pOldX2 = this.x + cellSize - padding;
                        const pOldY2 = this.y + cellSize - padding;

                        const overlappedBefore = (pOldX1 < bx2 && pOldX2 > bx1 && pOldY1 < by2 && pOldY2 > by1);
                        
                        if (!overlappedBefore) {
                            if (this.hasKick) {
                                let kickDx = 0, kickDy = 0;
                                if (Math.abs(dx) > Math.abs(dy)) kickDx = Math.sign(dx);
                                else kickDy = Math.sign(dy);
                                this.bombManager.kickBomb(bomb.gridX, bomb.gridY, kickDx, kickDy);
                            }
                            return true; // 撞到了一顆之前沒踩在上面的炸彈！
                        }
                    }
                }
            }

            return false;
        };

        // 分離 X 與 Y 軸進行滑動碰撞處理
        if (dx !== 0 && !checkCollision(nextX, this.y)) {
            this.x = nextX;
        }
        if (dy !== 0 && !checkCollision(this.x, nextY)) {
            this.y = nextY;
        }
        // 更新網格座標
        //
        // 修正（影響所有玩家，與 Monster.js 同一類問題）：
        // 原本直接用 this.x 換算格座標，但 this.x 是畫布像素且含置中偏移
        // offsetX/offsetY，換算時必須先扣掉偏移，否則算出來的格座標會整個
        // 平移 floor((offsetX + cellSize/2) / cellSize) 格。
        //
        // 實測 1280x960 配 13x11 時 offsetX 約 72.7（約 0.83 格），
        // 導致 gridX / gridY 恆比實際位置大 1 格。
        // 後果：角色視為站在 B 格、實際卻在 A 格，
        // 放炸彈會放在錯的格子、與怪物互動的判定也整格偏移。
        const _ox = this.gridSystem.offsetX || 0;
        const _oy = this.gridSystem.offsetY || 0;
        this.gridX = Math.floor((this.x + cellSize/2 - _ox) / cellSize);
        this.gridY = Math.floor((this.y + cellSize/2 - _oy) / cellSize);

        if (this.bombManager && this.bombManager.hasBombAt(this.gridX, this.gridY)) {
            const b = this.bombManager.getBombAt(this.gridX, this.gridY);
            if (b && b.isMine && b.player !== this) {
                b.explode();
            }
        }

        // 處理放置炸彈或發射雷射
        if (this.inputManager.isActionPressed(this.playerIndex, 'bomb')) {
            if (!this.wasBombPressed) {
                if (this.noBombTimer <= 0) {
                    if (this.hasLaser) {
                        // Shoot laser instantly in facing direction
                        if (window.explosionManager) {
                            window.explosionManager.createDirectionalExplosion(this.gridX, this.gridY, this.facing.dx, this.facing.dy, this.fireRange);
                        }
                    } else if (this.currentBombs < this.maxBombs) {
                        let shape = 'CROSS';
                        if (this.hasDiagonalFire) shape = 'X';
                        if (this.hasIceBomb) shape = 'ICE';
                        if (this.bombManager && this.bombManager.placeBomb(this.gridX, this.gridY, this, this.hasPierce, shape)) {
                            this.currentBombs++;
                        }
                    }
                }
                this.wasBombPressed = true;
            }
        } else {
            this.wasBombPressed = false;
        }

        // Action 按鍵 (例如 Remote Bomb, Spring)
        if (this.inputManager.isActionPressed(this.playerIndex, 'action')) {
            if (!this.wasActionPressed) {
                if (this.hasRemoteBomb && this.bombManager) {
                    const myBombs = this.bombManager.bombs.filter(b => b.player === this && !b.isExploded);
                    if (myBombs.length > 0) {
                        myBombs[0].explode();
                    }
                } else if (this.hasSpring) {
                    // Spring jump
                    const jumpDist = 2; // jump over 2 blocks
                    const newGx = this.gridX + this.facing.dx * jumpDist;
                    const newGy = this.gridY + this.facing.dy * jumpDist;
                    
                    // 確保目標在邊界內且沒有硬磚塊
                    if (newGx >= 1 && newGx < this.gridSystem.cols - 1 && newGy >= 1 && newGy < this.gridSystem.rows - 1) {
                        if (this.mapManager.getBlockType(newGx, newGy) !== 1) {
                            this.gridX = newGx;
                            this.gridY = newGy;
                            const pos = this.gridSystem.getPixelCoord(newGx, newGy);
                            this.x = pos.x;
                            this.y = pos.y;
                            this.hasSpring = false; // consume spring after 1 use
                        }
                    }
                }
                this.wasActionPressed = true;
            }
        } else {
            this.wasActionPressed = false;
        }
    }

    render(ctx) {
        const cellSize = this.gridSystem.getCellSize();
        
        const padding = cellSize * 0.15;
        const renderX = this.x + padding;
        const renderY = this.y + padding;
        const renderSize = cellSize - padding * 2;

        ctx.save();
        
        // 死亡動畫：旋轉並逐漸變紅消失
        if (this.isDead) {
            const shrink = Math.max(0, 1 - this.deathTimer);
            ctx.translate(renderX + renderSize / 2, renderY + renderSize / 2);
            ctx.rotate(this.deathTimer * Math.PI * 4); // 快速旋轉
            ctx.scale(shrink, shrink);
            
            ctx.shadowColor = '#ff0000';
            ctx.shadowBlur = 20;
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(-renderSize/2, -renderSize/2, renderSize, renderSize);
            
            // 畫一個 X 的眼睛
            ctx.fillStyle = '#000';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(-10, -10); ctx.lineTo(0, 0);
            ctx.moveTo(-10, 0); ctx.lineTo(0, -10);
            ctx.moveTo(10, -10); ctx.lineTo(0, 0);
            ctx.moveTo(10, 0); ctx.lineTo(0, -10);
            ctx.stroke();

            ctx.restore();
            return;
        }

        // 角色身體微動畫：傾斜與浮動
        this.time += this.lastDeltaTime * 10;
        const targetTilt = this.lastDx !== 0 ? (this.lastDx > 0 ? 0.15 : -0.15) : 0;
        this.tiltAngle += (targetTilt - this.tiltAngle) * this.lastDeltaTime * 10;
        const bobbing = Math.sin(this.time) * (cellSize * 0.05);

        ctx.save();
        ctx.translate(renderX + renderSize / 2, renderY + renderSize / 2 + bobbing);
        ctx.rotate(this.tiltAngle);

        // 發光光環
        ctx.shadowColor = '#00ffcc';
        ctx.shadowBlur = 15;
        
        // 根據面向決定圖片
        let dirSuffix = 'down';
        if (Math.abs(this.facing.dx) > Math.abs(this.facing.dy)) {
            dirSuffix = this.facing.dx > 0 ? 'right' : 'left';
        } else if (this.facing.dy < 0) {
            dirSuffix = 'up';
        }
        const playerImg = assetLoader.getImage('player_' + dirSuffix);
        
        if (playerImg) {
            ctx.drawImage(playerImg, -renderSize/2, -renderSize/2, renderSize, renderSize);
        } else {
            // Fallback: 角色本體漸層
            const playerGrad = ctx.createLinearGradient(-renderSize/2, -renderSize/2, renderSize/2, renderSize/2);
            playerGrad.addColorStop(0, '#00ffcc');
            playerGrad.addColorStop(1, '#0088aa');
            
            ctx.fillStyle = playerGrad;
            ctx.fillRect(-renderSize/2, -renderSize/2, renderSize, renderSize);

            // 畫高科技護目鏡
            ctx.shadowColor = 'transparent';
            ctx.fillStyle = '#0f172a';
            ctx.fillRect(-renderSize*0.3, -renderSize*0.2, renderSize*0.6, renderSize*0.3);
            
            ctx.fillStyle = '#ffffff';
            ctx.globalAlpha = 0.6;
            ctx.fillRect(-renderSize*0.2, -renderSize*0.1, renderSize*0.4, renderSize*0.05);
            ctx.globalAlpha = 1.0;
        }

        // 狀態特效疊加
        if (this.isPoisoned) {
            ctx.fillStyle = 'rgba(150, 0, 255, 0.5)';
            ctx.beginPath();
            ctx.arc(0, 0, renderSize * 0.8, 0, Math.PI * 2);
            ctx.fill();
        }

        if (this.hasShield) {
            ctx.strokeStyle = '#ffff00';
            ctx.lineWidth = 3;
            ctx.setLineDash([5, 5]);
            ctx.lineDashOffset = -this.time * 2;
            ctx.beginPath();
            ctx.arc(0, 0, renderSize * 0.9, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        
        if (this.isGhost) {
            ctx.globalAlpha = 0.5;
        }

        ctx.restore();

        // Render clone
        if (this.cloneTimer > 0) {
            ctx.save();
            const cx = this.cloneX + padding;
            const cy = this.cloneY + padding;
            ctx.translate(cx + renderSize / 2, cy + renderSize / 2 + bobbing);
            ctx.globalAlpha = 0.5; // Hologram effect
            ctx.shadowColor = '#fff';
            ctx.shadowBlur = 10;
            if (playerImg) {
                ctx.drawImage(playerImg, -renderSize/2, -renderSize/2, renderSize, renderSize);
            } else {
                ctx.fillStyle = '#fff';
                ctx.fillRect(-renderSize/2, -renderSize/2, renderSize, renderSize);
            }
            ctx.restore();
        }
    }
}







