import { Item } from './Item.js';

export class ItemManager {
    constructor(gridSystem) {
        this.gridSystem = gridSystem;
        this.items = [];
        this.audioManager = null;
    }

    setAudioManager(am) {
        this.audioManager = am;
    }

    // 依機率隨機掉落道具
    spawnItem(gridX, gridY) {
        // 40% 機率掉落道具
        if (Math.random() < 0.4) {
            const itemsPool = [
                'BOMB', 'FIRE', 'SPEED', 'SHIELD', 'PIERCE', 'GHOST', 'POISON', 'KICK', 'PUNCH', 
                'REMOTE_BOMB', 'MINE', 'DASH', 'PHOENIX', 'TIME_STOP', 'FREEZE', 'HEAL', 'LIFE_UP',
                'DOUBLE_BOMB', 'TRIPLE_BOMB', 'CROSS_FIRE', 'DIAGONAL_FIRE', 'REFLECT', 'MAGNET', 
                'LASER', 'SLOW', 'CURSE', 'LUCKY', 'RADAR', 'ICE_BOMB', 'HOMING_BOMB', 'WALL_PASS',
                'BOMB_PASS', 'FIRE_PASS', 'MINI', 'GIANT', 'REVERSE', 'NO_BOMB', 'SHORT_FUSE', 
                'LONG_FUSE', 'SLIPPERY', 'BLIND', 'SPRING', 'TELEPORTER', 'SUPER_SPEED', 'SUPER_FIRE',
                'SUPER_BOMB', 'INVINCIBLE', 'CLONE', 'NUKE', 'RANDOM'
            ];
            const rand = Math.random();
            let type = 'BOMB';
            
            // 基礎道具 60%
            if (rand < 0.20) type = 'FIRE';
            else if (rand < 0.40) type = 'SPEED';
            else if (rand < 0.60) type = 'BOMB';
            // 其他 40% 隨機從池中抽取
            else {
                type = itemsPool[Math.floor(Math.random() * itemsPool.length)];
            }
            
            this.items.push(new Item(gridX, gridY, type, this.gridSystem));
        }
    }

    // 檢查玩家是否吃到道具
    checkPlayerCollection(player) {
        if (player.isDead) return;

        const cellSize = this.gridSystem.getCellSize();
        const padding = cellSize * 0.2;
        
        const pX1 = player.x + padding;
        const pY1 = player.y + padding;
        const pX2 = player.x + cellSize - padding;
        const pY2 = player.y + cellSize - padding;

        for (let i = this.items.length - 1; i >= 0; i--) {
            const item = this.items[i];
            const itemPad = cellSize * 0.25;
            const iX1 = item.pixelX + itemPad;
            const iY1 = item.pixelY + itemPad;
            const iX2 = item.pixelX + cellSize - itemPad;
            const iY2 = item.pixelY + cellSize - itemPad;

            // AABB 重疊檢測
            if (pX1 < iX2 && pX2 > iX1 && pY1 < iY2 && pY2 > iY1) {
                if (this.audioManager) this.audioManager.playItemPickup();
                // 吃掉道具
                item.isCollected = true;
                this.applyItemEffect(player, item.type);
                this.items.splice(i, 1);
                
                let pName = "玩家";
                if (typeof window !== 'undefined') {
                    if (player === window.player) pName = "音";
                    else if (player === window.player2) pName = "玥";
                    else if (player === window.bot) pName = "電腦一";
                    else if (player === window.bot2) pName = "電腦二";
                    
                    if (window.logItem) window.logItem(pName, item.type);
                }
            }
        }
    }

    applyItemEffect(player, type) {
        switch (type) {
            case 'BOMB':
                player.maxBombs = Math.min(player.maxBombs + 1, 8);
                break;
            case 'FIRE':
                player.fireRange = Math.min(player.fireRange + 1, 10);
                break;
            case 'SPEED':
                player.speed = Math.min(player.speed + 1, 8);
                break;
            case 'SHIELD':
                player.hasShield = true;
                player.shieldTimer = 5.0; // 5 秒無敵
                break;
            case 'PIERCE':
                player.hasPierce = true;
                break;
            case 'GHOST':
                player.isGhost = true;
                player.ghostTimer = 10.0; // 10 秒穿牆
                break;
            case 'POISON':
                player.isPoisoned = true;
                player.poisonTimer = 8.0; // 8 秒混亂
                break;
            case 'KICK':
                player.hasKick = true;
                break;
            case 'PUNCH':
                player.hasPunch = true;
                break;
            case 'REMOTE_BOMB':
                player.hasRemoteBomb = true;
                break;
            case 'MINE':
                player.hasMine = true;
                break;
            case 'DASH':
                player.hasDash = true;
                break;
            case 'PHOENIX':
                player.hasPhoenix = true;
                break;
            case 'TIME_STOP':
                player.timeStopTimer = 5.0; // 5 秒時間暫停
                break;
            case 'FREEZE':
                // 冰凍全場怪物，在怪物系統或主邏輯處理
                if (window.monsterManager) window.monsterManager.freezeTimer = 5.0;
                break;
            case 'HEAL':
                player.hp = Math.min((player.hp || 1) + 1, player.maxHp || 3);
                break;
            case 'LIFE_UP':
                player.maxLives = (player.maxLives || 3) + 1;
                player.lives = (player.lives || 3) + 1;
                break;
            case 'DOUBLE_BOMB':
                player.maxBombs = Math.min(player.maxBombs + 2, 8);
                break;
            case 'TRIPLE_BOMB':
                player.maxBombs = Math.min(player.maxBombs + 3, 8);
                break;
            case 'CROSS_FIRE':
            case 'SUPER_FIRE':
                player.fireRange = 10;
                break;
            case 'SUPER_SPEED':
                player.speed = 8;
                break;
            case 'SUPER_BOMB':
                player.maxBombs = 8;
                break;
            case 'INVINCIBLE':
                player.hasShield = true;
                player.shieldTimer = 15.0; // 15秒無敵
                break;
            case 'SLOW':
                player.speed = Math.max(player.speed - 1, 1);
                break;
            case 'MINI':
                player.isMini = true;
                break;
            case 'GIANT':
                player.isGiant = true;
                break;
            case 'REVERSE':
                player.isReversed = true;
                player.reverseTimer = 5.0;
                break;
            case 'NO_BOMB':
                player.noBombTimer = 5.0;
                break;
            case 'SHORT_FUSE':
                player.shortFuse = true;
                break;
            case 'LONG_FUSE':
                player.longFuse = true;
                break;
            case 'SLIPPERY':
                player.isSlippery = true;
                player.slipperyTimer = 8.0;
                break;
            case 'BLIND':
                player.isBlind = true;
                player.blindTimer = 5.0;
                break;
            case 'ICE_BOMB':
                player.hasIceBomb = true;
                break;
            case 'HOMING_BOMB':
                player.hasHomingBomb = true;
                break;
            case 'LASER':
                player.hasLaser = true;
                break;
            case 'MAGNET':
                player.hasMagnet = true;
                break;
            case 'REFLECT':
                player.hasReflect = true;
                break;
            case 'DIAGONAL_FIRE':
                player.hasDiagonalFire = true;
                break;
            case 'WALL_PASS':
                player.hasWallPass = true;
                player.wallPassTimer = 10.0;
                break;
            case 'BOMB_PASS':
                player.hasBombPass = true;
                player.bombPassTimer = 10.0;
                break;
            case 'FIRE_PASS':
                player.hasFirePass = true;
                player.firePassTimer = 10.0;
                break;
            case 'TELEPORTER':
                // Instant teleport
                let tx, ty;
                do {
                    tx = Math.floor(Math.random() * this.gridSystem.cols);
                    ty = Math.floor(Math.random() * this.gridSystem.rows);
                } while (window.mapManager && window.mapManager.isSolid(tx, ty));
                player.gridX = tx;
                player.gridY = ty;
                const newPos = this.gridSystem.getPixelCoord(tx, ty);
                player.x = newPos.x;
                player.y = newPos.y;
                break;
            case 'SPRING':
                player.hasSpring = true;
                break;
            case 'CLONE':
                // Create decoy (can be handled in main game loop)
                player.createClone = true;
                break;
            case 'NUKE':
                // Handled in ExplosionManager/main.js
                if (window.explosionManager) window.explosionManager.triggerNuke();
                break;
            case 'RANDOM':
                // Trigger random good or bad effect
                if (Math.random() > 0.5) {
                    player.fireRange = 10;
                    player.maxBombs = 8;
                } else {
                    player.speed = 1;
                    player.noBombTimer = 5.0;
                }
                break;
            case 'LUCKY':
                player.lives++;
                player.fireRange = 10;
                break;
            case 'CURSE':
                player.hp = 1;
                player.speed = 1;
                break;
            case 'RADAR':
                player.hasRadar = true;
                break;
        }
        console.log(`Player collected ${type}!`);
    }

    // 火焰爆炸可能會摧毀道具
    checkExplosionHit(gridX, gridY) {
        for (let i = this.items.length - 1; i >= 0; i--) {
            if (this.items[i].gridX === gridX && this.items[i].gridY === gridY) {
                this.items.splice(i, 1); // 道具被炸毀
            }
        }
    }

    update(deltaTime) {
        // Collect players who have Magnet
        const playersWithMagnet = [];
        if (typeof window !== 'undefined') {
            if (window.player && !window.player.isDead && window.player.hasMagnet) playersWithMagnet.push(window.player);
            if (window.player2 && !window.player2.isDead && window.player2.hasMagnet) playersWithMagnet.push(window.player2);
            if (window.bot && !window.bot.isDead && window.bot.hasMagnet) playersWithMagnet.push(window.bot);
            if (window.bot2 && !window.bot2.isDead && window.bot2.hasMagnet) playersWithMagnet.push(window.bot2);
        }

        for (const item of this.items) {
            item.update(deltaTime);

            if (playersWithMagnet.length > 0) {
                let nearest = null;
                let minDist = Infinity;
                const itemPx = this.gridSystem.getPixelCoord(item.gridX, item.gridY);
                // Note: itemPx represents top-left of the grid cell
                const itemCx = itemPx.x + this.gridSystem.getCellSize() / 2;
                const itemCy = itemPx.y + this.gridSystem.getCellSize() / 2;

                for (const p of playersWithMagnet) {
                    const pCx = p.x + this.gridSystem.getCellSize() / 2;
                    const pCy = p.y + this.gridSystem.getCellSize() / 2;
                    const dist = Math.hypot(pCx - itemCx, pCy - itemCy);
                    if (dist < minDist) {
                        minDist = dist;
                        nearest = p;
                    }
                }

                // If within 3 grid cells radius, attract the item
                if (nearest && minDist < this.gridSystem.getCellSize() * 3) {
                    const pCx = nearest.x + this.gridSystem.getCellSize() / 2;
                    const pCy = nearest.y + this.gridSystem.getCellSize() / 2;
                    const speed = 4 * this.gridSystem.getCellSize() * deltaTime;
                    const angle = Math.atan2(pCy - itemCy, pCx - itemCx);
                    
                    if (item.offsetX === undefined) item.offsetX = 0;
                    if (item.offsetY === undefined) item.offsetY = 0;
                    
                    item.offsetX += Math.cos(angle) * speed;
                    item.offsetY += Math.sin(angle) * speed;
                }
            }
        }
    }

    render(ctx) {
        for (const item of this.items) {
            item.render(ctx);
        }
    }
}
