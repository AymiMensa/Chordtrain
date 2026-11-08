export class Item {
    constructor(gridX, gridY, type, gridSystem) {
        this.gridX = gridX;
        this.gridY = gridY;
        this.type = type; // 'BOMB', 'FIRE', 'SPEED'
        this.gridSystem = gridSystem;
        this.isCollected = false;
        
        const pos = this.gridSystem.getPixelCoord(this.gridX, this.gridY);
        this.pixelX = pos.x;
        this.pixelY = pos.y;
        
        // 浮動動畫使用
        this.time = Math.random() * 100;
    }

    update(deltaTime) {
        this.time += deltaTime * 5;
        if (this.offsetX || this.offsetY) {
            this.pixelX += this.offsetX;
            this.pixelY += this.offsetY;
            this.offsetX = 0;
            this.offsetY = 0;
            
            // Update logical grid position continuously
            this.gridX = Math.round(this.pixelX / this.gridSystem.getCellSize());
            this.gridY = Math.round(this.pixelY / this.gridSystem.getCellSize());
        }
    }

    render(ctx) {
        if (this.isCollected) return;

        const size = this.gridSystem.getCellSize();
        const padding = size * 0.25;
        const centerX = this.pixelX + size / 2;
        const centerY = this.pixelY + size / 2;

        const bobbing = Math.sin(this.time) * (size * 0.1);
        const drawY = centerY + bobbing;
        const radius = size * 0.3;

        ctx.save();
        
        // 畫道具光暈
        ctx.shadowBlur = 15;
        
        let color = '#fff';
        let symbol = '?';
        
        switch (this.type) {
            case 'BOMB':
                color = '#222'; // 黑色
                symbol = '💣';
                break;
            case 'FIRE':
                color = '#f00'; // 紅色
                symbol = '🔥';
                break;
            case 'SPEED':
                color = '#00f'; // 藍色
                symbol = '👟';
                break;
            case 'SHIELD':
                color = '#ff0'; // 黃色
                symbol = '🛡️';
                break;
            case 'PIERCE':
                color = '#f0f'; // 紫色
                symbol = '⚡';
                break;
            case 'GHOST':
                color = '#fff'; // 白色
                symbol = '👻';
                break;
            case 'POISON':
                color = '#0f0'; // 綠色
                symbol = '☠️';
                break;
            case 'KICK':
                color = '#8B4513'; // 棕色
                symbol = '🦵';
                break;
            case 'PUNCH':
                color = '#FFA500'; // 橘色
                symbol = '🥊';
                break;
            case 'REMOTE_BOMB':
                color = '#4B0082'; // 靛色
                symbol = '📱';
                break;
            case 'MINE':
                color = '#555';
                symbol = '⚙️';
                break;
            case 'DASH':
                color = '#00FFFF'; // 青色
                symbol = '💨';
                break;
            case 'PHOENIX':
                color = '#FFD700'; // 金色
                symbol = '🦅';
                break;
            case 'TIME_STOP':
                color = '#C0C0C0'; // 銀色
                symbol = '⏸️';
                break;
            case 'FREEZE':
                color = '#ADD8E6'; // 淺藍
                symbol = '❄️';
                break;
            case 'HEAL':
                color = '#FF69B4'; // 粉紅
                symbol = '❤️';
                break;
            case 'LIFE_UP':
                color = '#ffaa00';
                symbol = '1UP';
                break;
            case 'DOUBLE_BOMB': color = '#555'; symbol = '2x💣'; break;
            case 'TRIPLE_BOMB': color = '#333'; symbol = '3x💣'; break;
            case 'CROSS_FIRE': color = '#f55'; symbol = '✛'; break;
            case 'DIAGONAL_FIRE': color = '#f0a'; symbol = '❌'; break;
            case 'REFLECT': color = '#aff'; symbol = '🪞'; break;
            case 'MAGNET': color = '#c00'; symbol = '🧲'; break;
            case 'LASER': color = '#0ff'; symbol = '⚡'; break;
            case 'SLOW': color = '#777'; symbol = '🐢'; break;
            case 'CURSE': color = '#500'; symbol = '💀'; break;
            case 'LUCKY': color = '#ff0'; symbol = '🍀'; break;
            case 'RADAR': color = '#0f0'; symbol = '📡'; break;
            case 'ICE_BOMB': color = '#0ff'; symbol = '🧊'; break;
            case 'HOMING_BOMB': color = '#f50'; symbol = '🎯'; break;
            case 'WALL_PASS': color = '#fff'; symbol = '🧱'; break;
            case 'BOMB_PASS': color = '#444'; symbol = '🚶'; break;
            case 'FIRE_PASS': color = '#f55'; symbol = '🔥🛡'; break;
            case 'MINI': color = '#f0f'; symbol = '🐁'; break;
            case 'GIANT': color = '#f00'; symbol = '🦖'; break;
            case 'REVERSE': color = '#808'; symbol = '🔄'; break;
            case 'NO_BOMB': color = '#222'; symbol = '🚫💣'; break;
            case 'SHORT_FUSE': color = '#f00'; symbol = '⏱️-'; break;
            case 'LONG_FUSE': color = '#0f0'; symbol = '⏱️+'; break;
            case 'SLIPPERY': color = '#0ff'; symbol = '⛸️'; break;
            case 'BLIND': color = '#000'; symbol = '👁️‍🗨️'; break;
            case 'SPRING': color = '#0f0'; symbol = '🦘'; break;
            case 'TELEPORTER': color = '#80f'; symbol = '🌀'; break;
            case 'SUPER_SPEED': color = '#00f'; symbol = '🏎️'; break;
            case 'SUPER_FIRE': color = '#f00'; symbol = '🌋'; break;
            case 'SUPER_BOMB': color = '#222'; symbol = '💣+'; break;
            case 'INVINCIBLE': color = '#ff0'; symbol = '⭐'; break;
            case 'CLONE': color = '#ccc'; symbol = '👥'; break;
            case 'NUKE': color = '#f00'; symbol = '☢️'; break;
            case 'RANDOM': color = '#fff'; symbol = '❓'; break;
        }

        ctx.beginPath();
        ctx.arc(centerX, drawY, radius, 0, Math.PI * 2);
        ctx.shadowColor = color;
        ctx.fillStyle = color;
        ctx.fill();

        // 道具內部圖示 (簡化為文字或形狀)
        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = 0;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${radius}px sans-serif`;
        
        ctx.fillText(symbol, centerX, drawY);

        ctx.restore();
    }
}
