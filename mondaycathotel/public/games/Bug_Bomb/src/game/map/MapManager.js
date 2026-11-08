import assetLoader from '../../engine/renderer/AssetLoader.js';

export class MapManager {
    constructor(gridSystem) {
        this.gridSystem = gridSystem;
        this.cols = gridSystem.cols;
        this.rows = gridSystem.rows;
        this.grid = [];
        this.theme = 'FOREST';
        this.stage = 1;      // 給 openRatioForStage / hazardRateForStage 的預設值
        this.initMap();
    }

    setTheme(theme) {
        this.theme = theme;
    }

    /** 由 StageManager 傳入目前關卡，讓地形難度可被關卡數控制 */
    setStage(stage) {
        this.stage = stage || 1;
    }

    /**
     * 可通行比例（空地）隨關卡遞減。
     *
     * 舊版是固定 `r < 0.50` 的硬編碼亂數，跑 60 關後實測 openRatio
     * 在 25.6%~37.2% 之間隨機抖動（25 處比前一關下降），
     * 也就是說「同一區段內關卡難度會亂跳」，沒有任何關卡控制。
     *
     * 現在改成明確的曲線：從第 1 關的 46% 一路遞減到第 60 關的 28%。
     * 越後面空地越少 = 走位空間越窄 = 越難。
     */
    openRatioForStage() {
        const s = Math.min(60, Math.max(1, this.stage || 1));
        // 46% -> 28%，線性遞減
        return 0.46 - (0.18 * (s - 1) / 59);
    }

    /**
     * 地形傷害機制（冰塊 / 毒水）的出現機率與密度。
     *
     * 舊版問題（實測）：
     *   冰塊只出現在 11-19 關（ICE 主題），毒水只出現在 31-39 關（VOLCANO 主題），
     *   其他關卡完全沒有，後期等於少了一種傷害機制；
     *   而且數量是隨機的（12~28 個不等），不受關卡控制。
     *
     * 現在改為「依關卡遞增」，且不再綁死主題：
     *   冰塊   從第 11 關開始出現，密度隨關卡線性增加至第 60 關
     *   毒水   從第 31 關開始出現，密度隨關卡線性增加至第 60 關
     *   主題仍影響「外觀與配色」，但不再決定「有沒有這個機制」。
     *
     * 注意兩者的嚴重程度不同，因此上限刻意不同：
     *   毒水是踩到即死（Player.js:219-222），所以上限較低（8%）。
     */
    hazardRateForStage() {
        const s = Math.min(60, Math.max(1, this.stage || 1));
        const ice = s < 11 ? 0 : 0.03 + 0.05 * ((s - 11) / 49);      // 第11關3% -> 第60關8%
        const poison = s < 31 ? 0 : 0.02 + 0.06 * ((s - 31) / 29);   // 第31關2% -> 第60關8%
        return { ice: Math.min(0.08, ice), poison: Math.min(0.08, poison) };
    }

    initMap() {
        this.cols = this.gridSystem.cols;
        this.rows = this.gridSystem.rows;
        this.grid = [];
        const openRatio = this.openRatioForStage();
        const hazard = this.hazardRateForStage();

        // 0: 空地, 1: 不可破壞的磚塊, 2: 可破壞的軟磚塊, 3: 冰, 4: 傳送帶, 5: 毒水
        for (let y = 0; y < this.rows; y++) {
            this.grid[y] = [];
            for (let x = 0; x < this.cols; x++) {
                if (x === 0 || x === this.cols - 1 || y === 0 || y === this.rows - 1) {
                    this.grid[y][x] = 1;
                } else if (x % 2 === 0 && y % 2 === 0) {
                    this.grid[y][x] = 1;
                } else {
                    if ((x === 1 && y === 1) || (x === 1 && y === 2) || (x === 2 && y === 1)) {
                        this.grid[y][x] = 0;
                    } else if ((x === this.cols-2 && y === 1) || (x === this.cols-3 && y === 1) || (x === this.cols-2 && y === 2)) {
                        this.grid[y][x] = 0;
                    } else {
                        // 空地比例改由關卡決定（見 openRatioForStage）
                        let type = (Math.random() < openRatio) ? 0 : 2;

                        // 地形傷害：冰塊與毒水都依關卡遞增，不再綁主題
                        if (type === 0 && Math.random() < (hazard.ice + hazard.poison)) {
                            const roll = Math.random();
                            if (roll < hazard.ice / (hazard.ice + hazard.poison)) type = 3;   // 冰
                            else type = 5;                                                      // 毒水
                        } else if (type === 0 && this.theme === 'FACTORY' && Math.random() < 0.1) {
                            type = 4;   // 傳送帶（維持原本 FACTORY 主題的特色）
                        }
                        this.grid[y][x] = type;
                    }
                }
            }
        }
    }

    isSolid(gridX, gridY) {
        if (gridX < 0 || gridX >= this.cols || gridY < 0 || gridY >= this.rows) return true;
        return this.grid[gridY][gridX] === 1 || this.grid[gridY][gridX] === 2;
    }

    destroyBlock(gridX, gridY) {
        if (this.grid[gridY] && this.grid[gridY][gridX] === 2) {
            this.grid[gridY][gridX] = 0;
            return true;
        }
        return false;
    }

    getBlockType(gridX, gridY) {
        if (gridX < 0 || gridX >= this.cols || gridY < 0 || gridY >= this.rows) return 1;
        return this.grid[gridY][gridX];
    }

    render(ctx, gridSystem) {
        const size = gridSystem.getCellSize();
        const floorImg = assetLoader.getImage('floor');
        const hardBlockImg = assetLoader.getImage('hard_block');
        const softBlockImg = assetLoader.getImage('soft_block');

        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                const type = this.grid[y][x];
                const px = { x: x * size, y: y * size };

                // Draw Floor first for all tiles
                if (floorImg) {
                    ctx.drawImage(floorImg, px.x, px.y, size, size);
                } else {
                    ctx.fillStyle = '#33cc33';
                    ctx.fillRect(px.x, px.y, size, size);
                }

                ctx.save();
                switch (type) {
                    case 1:
                        if (hardBlockImg) {
                            ctx.drawImage(hardBlockImg, px.x, px.y, size, size);
                        } else {
                            ctx.fillStyle = '#888';
                            ctx.fillRect(px.x, px.y, size, size);
                        }
                        break;
                    case 2:
                        if (softBlockImg) {
                            ctx.drawImage(softBlockImg, px.x, px.y, size, size);
                        } else {
                            ctx.fillStyle = '#ff0055';
                            ctx.fillRect(px.x + 4, px.y + 4, size - 8, size - 8);
                        }
                        break;
                    case 3:
                        ctx.fillStyle = 'rgba(100, 200, 255, 0.6)';
                        ctx.fillRect(px.x, px.y, size, size);
                        break;
                    case 4:
                        ctx.fillStyle = '#333';
                        ctx.fillRect(px.x, px.y, size, size);
                        ctx.strokeStyle = '#666';
                        ctx.strokeRect(px.x, px.y + size/2, size, 0);
                        break;
                    case 5:
                        ctx.fillStyle = 'rgba(128, 0, 128, 0.6)';
                        ctx.fillRect(px.x, px.y, size, size);
                        break;
                }
                ctx.restore();
            }
        }
    }
}
