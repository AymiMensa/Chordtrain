import assetLoader from '../../engine/renderer/AssetLoader.js';

export class Explosion {
    constructor(gridX, gridY, duration, type = 'FIRE') {
        this.gridX = gridX;
        this.gridY = gridY;
        this.type = type; // 'FIRE', 'ICE', etc.
        this.duration = duration || 0.5; // 確保有預設時間
        this.timer = this.duration;
        this.isDone = false;
    }

    update(deltaTime) {
        if (this.isDone) return;
        this.timer -= deltaTime;
        if (this.timer <= 0) {
            this.isDone = true;
        }
    }

    render(ctx, gridSystem) {
        if (this.isDone) return;

        const size = gridSystem.getCellSize();
        const pos = gridSystem.getPixelCoord(this.gridX, this.gridY);
        const centerX = pos.x + size / 2;
        const centerY = pos.y + size / 2;
        
        const progress = this.timer / this.duration; // 1 -> 0
        const currentSize = size * (0.8 + progress * 0.2); // 爆炸瞬間最大，逐漸縮小

        ctx.save();
        
        const explosionImg = assetLoader.getImage('explosion');
        if (explosionImg && this.type === 'FIRE') {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = progress;
            const drawSize = currentSize * 1.5;
            ctx.drawImage(explosionImg, centerX - drawSize/2, centerY - drawSize/2, drawSize, drawSize);
        } else {
            // 使用 lighter 讓顏色疊加，產生高溫光暈效果 (Bloom)
            ctx.globalCompositeOperation = 'lighter';
            
            // 畫外圍光暈
            let colorOuter = this.type === 'ICE' ? '0, 200, 255' : '255, 69, 0';
            let colorInner = this.type === 'ICE' ? '200, 255, 255' : '255, 255, 200';
            let shadowColor = this.type === 'ICE' ? '#00c8ff' : '#ff2a00';

            ctx.shadowColor = shadowColor;
            ctx.shadowBlur = 20 * progress;
            ctx.fillStyle = `rgba(${colorOuter}, ${progress * 0.8})`;
            ctx.fillRect(centerX - currentSize/2, centerY - currentSize/2, currentSize, currentSize);

            // 畫核心高溫雷射
            ctx.fillStyle = `rgba(${colorInner}, ${progress})`;
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 10;
            const coreSize = currentSize * 0.5;
            ctx.fillRect(centerX - coreSize/2, centerY - coreSize/2, coreSize, coreSize);
        }

        ctx.restore();
    }
}
