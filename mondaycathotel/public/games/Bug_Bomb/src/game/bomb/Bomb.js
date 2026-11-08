import assetLoader from '../../engine/renderer/AssetLoader.js';

export class Bomb {
    constructor(gridX, gridY, range, gridSystem, owner, isPierce = false, shape = 'CROSS') {
        this.gridX = gridX;
        this.gridY = gridY;
        this.range = range;
        this.gridSystem = gridSystem;
        this.player = owner;
        this.isPierce = isPierce;
        this.shape = shape;
        this.isMine = owner.hasMine || false;
        
        // 炸彈倒數 3 秒 (如果是地雷則不會隨時間爆炸)
        this.timer = 3.0;
        this.isExploded = false;
        // 火力範圍
        this.fireRange = this.range; 
        
        this.isSliding = false;
        this.pixelX = gridX * gridSystem.getCellSize();
        this.pixelY = gridY * gridSystem.getCellSize();
        this.pulse = 0;
        this.pulseDir = 1;
    }

    update(deltaTime, mapManager, bombManager) {
        if (this.isExploded) return;

        if (this.isSliding) {
            const speed = 15 * this.gridSystem.getCellSize() * deltaTime;
            this.pixelX += this.slideDx * speed;
            this.pixelY += this.slideDy * speed;

            // Update logical grid position continuously
            this.gridX = Math.round(this.pixelX / this.gridSystem.getCellSize());
            this.gridY = Math.round(this.pixelY / this.gridSystem.getCellSize());

            // Check collision ahead
            const nextGridX = Math.floor((this.pixelX + this.slideDx * speed * 1.5 + this.gridSystem.getCellSize()/2) / this.gridSystem.getCellSize());
            const nextGridY = Math.floor((this.pixelY + this.slideDy * speed * 1.5 + this.gridSystem.getCellSize()/2) / this.gridSystem.getCellSize());

            if (mapManager && mapManager.isSolid(nextGridX, nextGridY)) {
                this.stopSlide();
            } else if (bombManager && bombManager.hasBombAt(nextGridX, nextGridY) && (nextGridX !== this.gridX || nextGridY !== this.gridY)) {
                this.stopSlide();
            }
        } else if (this.shape === 'HOMING' && !this.isSliding && window.monsterManager) {
            // Find nearest monster
            let nearest = null;
            let minDist = Infinity;
            for (const m of window.monsterManager.monsters) {
                if (m.isDead) continue;
                const dist = Math.hypot(m.gridX - this.gridX, m.gridY - this.gridY);
                if (dist < minDist) {
                    minDist = dist;
                    nearest = m;
                }
            }
            if (nearest && minDist < 5) { // Within 5 grids
                let dx = 0, dy = 0;
                if (Math.abs(nearest.gridX - this.gridX) > Math.abs(nearest.gridY - this.gridY)) {
                    dx = Math.sign(nearest.gridX - this.gridX);
                } else {
                    dy = Math.sign(nearest.gridY - this.gridY);
                }
                
                // Only slide if the next block is not solid
                if (mapManager && !mapManager.isSolid(this.gridX + dx, this.gridY + dy)) {
                    this.slide(dx, dy);
                }
            }
        }

        // 短引線與長引線 (地雷不會隨時間減少)
        if (!this.isMine) {
            if (this.player.shortFuse) this.timer -= deltaTime * 1.5;
            else if (this.player.longFuse) this.timer -= deltaTime * 0.5;
            else this.timer -= deltaTime;
        }

        // Pulse effect
        this.pulse += deltaTime * 2 * this.pulseDir;
        if (this.pulse > 1) { this.pulse = 1; this.pulseDir = -1; }
        if (this.pulse < 0) { this.pulse = 0; this.pulseDir = 1; }

        // Explode
        // Remote bomb requires manual trigger, unless it's triggered by chain reaction
        if (this.timer <= 0 && (!this.player.hasRemoteBomb || this.isChainExploded) && !this.isMine) {
            this.explode();
        }
    }

    stopSlide() {
        if (!this.isSliding) return;
        this.isSliding = false;
        this.slideDx = 0;
        this.slideDy = 0;
        this.pixelX = this.gridX * this.gridSystem.getCellSize();
        this.pixelY = this.gridY * this.gridSystem.getCellSize();
    }

    slide(dx, dy) {
        this.isSliding = true;
        this.slideDx = dx;
        this.slideDy = dy;
    }

    explode() {
        this.isExploded = true;
        this.stopSlide();
        if (this.onExplode) {
            this.onExplode(this);
        }
    }

    render(ctx) {
        if (this.isExploded) return;

        const size = this.gridSystem.getCellSize();
        const radius = size * 0.4;
        const centerX = this.pixelX + size / 2;
        const centerY = this.pixelY + size / 2;
        const padding = size * 0.15;

        // 計算倒數進度，用於脈衝效果
        const progress = 1 - (this.timer / 3.0); 
        // 隨著時間加快閃爍頻率
        const pulse = Math.sin(this.timer * (5 + progress * 20)) * 0.5 + 0.5;

        // 畫炸彈陰影
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.beginPath();
        ctx.ellipse(centerX, centerY + radius * 0.8, radius, radius * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();

        if (this.isMine) {
            // 地雷的外觀
            ctx.fillStyle = '#444';
            ctx.beginPath();
            ctx.ellipse(centerX, centerY + radius * 0.5, radius * 1.2, radius * 0.6, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ff0000';
            ctx.beginPath();
            ctx.arc(centerX, centerY + radius * 0.3, radius * 0.3, 0, Math.PI * 2);
            ctx.fill();
            return; // 結束繪製
        }

        const bombImg = assetLoader.getImage('bomb');
        if (bombImg && !this.shape.includes('ICE') && !this.shape.includes('HOMING')) {
            // pulsing scale effect
            const scale = 1.0 + pulse * 0.1;
            const drawRadius = radius * scale * 1.5; // Make the sprite a bit larger
            ctx.drawImage(bombImg, centerX - drawRadius, centerY - drawRadius, drawRadius * 2, drawRadius * 2);
        } else {
            // 畫炸彈主體 (漸層球體)
            const bombGrad = ctx.createRadialGradient(
                centerX - radius * 0.3, centerY - radius * 0.3, radius * 0.1,
                centerX, centerY, radius
            );
            bombGrad.addColorStop(0, '#666');
            bombGrad.addColorStop(0.5, '#222');
            bombGrad.addColorStop(1, '#000');

            ctx.fillStyle = bombGrad;
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
            ctx.fill();

            // 高科技脈衝發光核心
            ctx.shadowColor = '#ff0055';
            ctx.shadowBlur = 10 + pulse * 15;
            ctx.fillStyle = `rgba(255, ${Math.floor(255 * (1 - progress))}, 0, ${0.7 + pulse * 0.3})`;
            
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius * (0.3 + pulse * 0.1), 0, Math.PI * 2);
            ctx.fill();

            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
        }
    }
}
