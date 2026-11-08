import { Explosion } from './Explosion.js';

export class ExplosionManager {
    constructor(gridSystem, mapManager, itemManager) {
        this.gridSystem = gridSystem;
        this.mapManager = mapManager;
        this.itemManager = itemManager;
        this.explosions = [];
        this.bombManager = null; // 需要由 main 注入
        this.audioManager = null;
    }

    setAudioManager(am) {
        this.audioManager = am;
    }

    setBombManager(bombManager) {
        this.bombManager = bombManager;
    }

    createExplosion(gridX, gridY, range, isPierce = false, shape = 'CROSS') {
        if (this.audioManager) this.audioManager.playExplosion();
        
        const type = shape === 'ICE' ? 'ICE' : 'FIRE';
        // 產生中心點爆炸
        this.explosions.push(new Explosion(gridX, gridY, 0.5, type));

        let directions = [
            { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }
        ];
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
            // 雷射是四方向並貫穿
            directions = [
                { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }
            ];
            isPierce = true;
            range = 20; // Laser range is very long
        }

        for (const dir of directions) {
            for (let i = 1; i <= range; i++) {
                // 如果是 ROUND，讓角落的延伸短一點以形成圓形
                if (shape === 'ROUND' && Math.abs(dir.dx) === 1 && Math.abs(dir.dy) === 1) {
                    if (i > range / 2) break;
                }

                const x = gridX + dir.dx * i;
                const y = gridY + dir.dy * i;
                const delay = i * 0.05;

                const blockType = this.mapManager.getBlockType(x, y);

                // 遇到硬磚塊 (1) 直接停止蔓延
                if (blockType === 1) {
                    break;
                }

                // 如果是軟磚塊 (2)
                if (blockType === 2) {
                    // 加入爆炸特效
                    this.explosions.push(new Explosion(x, y, Math.max(0.5, delay), type));
                    
                    // 通知 MapManager 摧毀此軟磚塊
                    this.mapManager.destroyBlock(x, y);
                    
                    // 機率產生道具
                    if (this.itemManager) {
                        this.itemManager.spawnItem(x, y);
                    }
                    
                    if (!isPierce) {
                        break; // 如果沒有貫穿能力，就停止蔓延
                    }
                } else {
                    // 空地 (0)，繼續蔓延
                    this.explosions.push(new Explosion(x, y, Math.max(0.5, delay), type));
                }

                // 摧毀該網格上的道具
                if (this.itemManager) {
                    this.itemManager.checkExplosionHit(x, y);
                }

                // 檢查是否引發連鎖爆炸
                if (this.bombManager && this.bombManager.checkChainExplosion(x, y)) {
                    // 連鎖爆炸不一定會阻擋蔓延
                }
            }
        }
    }
    
    triggerNuke() {
        if (this.audioManager) this.audioManager.playExplosion();
        for (let y = 0; y < this.gridSystem.rows; y++) {
            for (let x = 0; x < this.gridSystem.cols; x++) {
                const blockType = this.mapManager.getBlockType(x, y);
                if (blockType !== 1) {
                    this.explosions.push(new Explosion(x, y, Math.random() * 0.5 + 0.5, 'FIRE'));
                    if (blockType === 2) {
                        this.mapManager.destroyBlock(x, y);
                    }
                }
            }
        }
    }

    createDirectionalExplosion(gridX, gridY, dx, dy, range) {
        if (this.audioManager) this.audioManager.playExplosion();
        
        for (let i = 1; i <= range; i++) {
            const x = gridX + dx * i;
            const y = gridY + dy * i;
            const delay = i * 0.05;

            const blockType = this.mapManager.getBlockType(x, y);

            if (blockType === 1) {
                break;
            }

            this.explosions.push(new Explosion(x, y, Math.max(0.5, delay), 'FIRE'));

            if (blockType === 2) {
                this.mapManager.destroyBlock(x, y);
                if (this.itemManager) {
                    this.itemManager.spawnItem(x, y);
                }
            }

            if (this.itemManager) {
                this.itemManager.checkExplosionHit(x, y);
            }
            if (this.bombManager && this.bombManager.checkChainExplosion(x, y)) {
                // Let laser pierce through bombs
            }
        }
    }

    // 檢查玩家是否碰到任何火焰
    checkPlayerHit(player) {
        if (player.hasShield && player.shieldTimer > 0) return false;
        if (player.hasFirePass && player.firePassTimer > 0) return false;

        for (const exp of this.explosions) {
            if (!exp.isDone) {
                if (player.gridX === exp.gridX && player.gridY === exp.gridY) {
                    return true;
                }
            }
        }
        return false;
    }

    // 檢查怪物是否碰到火焰
    checkMonsterHit(monsterManager) {
        if (!monsterManager) return;
        for (const exp of this.explosions) {
            if (!exp.isDone) {
                for (const m of monsterManager.monsters) {
                    if (!m.isDead && m.gridX === exp.gridX && m.gridY === exp.gridY) {
                        if (exp.type === 'ICE') {
                            m.isFrozen = true;
                            m.freezeTimer = 5.0; // 冰凍 5 秒
                        } else {
                            m.die();
                            if (typeof window !== 'undefined' && window.incrementScore) {
                                window.incrementScore(1);
                            }
                        }
                    }
                }
            }
        }
    }

    update(deltaTime) {
        // 更新並移除已經結束的火焰
        for (let i = this.explosions.length - 1; i >= 0; i--) {
            this.explosions[i].update(deltaTime);
            if (this.explosions[i].isDone) {
                this.explosions.splice(i, 1);
            }
        }
    }

    render(ctx) {
        for (const exp of this.explosions) {
            exp.render(ctx, this.gridSystem);
        }
    }
}
