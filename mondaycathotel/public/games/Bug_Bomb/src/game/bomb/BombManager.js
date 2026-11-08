import { Bomb } from './Bomb.js';

export class BombManager {
    constructor(gridSystem, mapManager, explosionManager) {
        this.gridSystem = gridSystem;
        this.mapManager = mapManager;
        this.explosionManager = explosionManager;
        this.bombs = [];
        this.audioManager = null;
    }

    setAudioManager(am) {
        this.audioManager = am;
    }

    placeBomb(gridX, gridY, player, isPierce = false, shape = 'CROSS') {
        // 檢查該位置是否已經有炸彈
        if (this.hasBombAt(gridX, gridY)) return false;

        // 檢查該位置是否是牆壁 (理論上不應該發生，以防萬一)
        if (this.mapManager.isSolid(gridX, gridY)) return false;

        const newBomb = new Bomb(gridX, gridY, player.fireRange, this.gridSystem, player, isPierce, shape);
        
        newBomb.onExplode = (bomb) => {
            this.triggerExplosion(bomb);
        };
        
        this.bombs.push(newBomb);
        
        if (this.audioManager) this.audioManager.playPlaceBomb();
        
        return true;
    }

    hasBombAt(gridX, gridY) {
        return this.bombs.some(bomb => bomb.gridX === gridX && bomb.gridY === gridY);
    }

    getBombAt(gridX, gridY) {
        return this.bombs.find(bomb => bomb.gridX === gridX && bomb.gridY === gridY);
    }

    triggerExplosion(bomb) {
        // 從清單中移除
        const index = this.bombs.indexOf(bomb);
        if (index !== -1) {
            this.bombs.splice(index, 1);
        }

        // 通知玩家歸還炸彈數量
        bomb.player.restoreBomb();

        // 呼叫 explosionManager 產生火焰
        this.explosionManager.createExplosion(bomb.gridX, bomb.gridY, bomb.fireRange, bomb.isPierce, bomb.shape);
        
        // 處理連鎖爆炸：如果爆炸範圍內有其他炸彈，立刻觸發它
        // 由於爆炸蔓延會在 explosionManager 處理，這裡把連鎖引爆邏輯交由 explosionManager 去掃描 bombs
    }

    // 讓 ExplosionManager 調用，用來判斷某個座標是否有炸彈，如果有就立刻引爆（連鎖爆炸）
    checkChainExplosion(gridX, gridY) {
        const bomb = this.bombs.find(b => b.gridX === gridX && b.gridY === gridY);
        if (bomb && !bomb.isExploded) {
            bomb.isChainExploded = true;
            bomb.explode();
            return true;
        }
        return false;
    }

    kickBomb(gridX, gridY, dx, dy) {
        const bomb = this.bombs.find(b => b.gridX === gridX && b.gridY === gridY);
        if (bomb && !bomb.isSliding) {
            bomb.slide(dx, dy);
            return true;
        }
        return false;
    }

    update(deltaTime) {
        // ===== 防禦性修正：連鎖爆炸會在迴圈進行中改動 this.bombs =====
        //
        // 一顆炸彈 update() 引爆時，會觸發 ExplosionManager 的連鎖爆炸，
        // 連帶讓「爆炸範圍內的其他炸彈」立刻 explode() → triggerExplosion()
        // → splice() 把自己從 this.bombs 移除。也就是說，陣列會在這個迴圈
        // 「正在跑」的時候被縮短。
        //
        // 舊版用「倒序索引迴圈」想避免這個問題，但只有「移除當前或更後面的元素」
        // 才安全；連鎖爆炸會移除「更前面」的元素，於是 this.bombs[i] 在後續
        // 迭代可能變成 undefined → 讀 undefined.update 直接崩潰。
        // fireRange 越大、炸彈越密時連鎖越頻繁，這個潛在崩潰就越容易觸發。
        //
        // 正解：對「當下的炸彈清單」做一份快照再迭代，並在呼叫前確認該炸彈
        // 還在場上且尚未引爆（可能已被連鎖爆炸提前移除）。
        const snapshot = this.bombs.slice();
        for (const bomb of snapshot) {
            if (!bomb || bomb.isExploded) continue;
            if (this.bombs.indexOf(bomb) === -1) continue; // 已被連鎖爆炸移除
            bomb.update(deltaTime, this.mapManager, this);
        }
    }

    render(ctx) {
        for (const bomb of this.bombs) {
            bomb.render(ctx, this.gridSystem);
        }
    }
}
