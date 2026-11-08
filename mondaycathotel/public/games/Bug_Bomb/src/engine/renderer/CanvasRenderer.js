export class CanvasRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.width = 0;
        this.height = 0;
        
        // Dynamic Quality Scaling
        this.qualityScale = 1.0;
        this.frameCount = 0;
        this.lastTime = performance.now();
        this.fps = 60;
        // 由 main.js 注入，供 resize() 依實際地圖比例計算畫布
        this.gridSystemRef = null;
    }

    /**
     * 依「實際地圖比例」而非固定 13:11 設定畫布尺寸。
     *
     * 修正（自適應螢幕）：原本硬寫 targetRatio = 13/11，但地圖會隨關卡長大
     * （Lv1 13x11、Lv30 35x33、Lv60 47x45），比例並不相同。畫布比例與地圖
     * 不一致時，GridSystem.updateCellSize() 取 min(cw/cols, ch/rows) 讓格子
     * 保持正方形，結果畫布有一邊多出大片空白、地圖用不到 100%。
     * 實測最差情況（iPad 橫式 Lv60）只用到 88% 的畫面。
     *
     * 改成讀 gridSystem 的實際 cols/rows 計算比例後，畫布永遠貼合地圖形狀，
     * 格子正方形、地圖置中、無空白浪費、也不會超出螢幕。
     *
     * @param {GridSystem} [gridSystem] 由呼叫端注入，避免此層反向相依
     */
    resize(gridSystem) {
        const container = this.canvas.parentElement;
        const containerWidth = Math.max(1, container.clientWidth);
        const containerHeight = Math.max(1, container.clientHeight);

        // 預設沿用 13:11；gridSystem 尚未建立（開機第一帧）時行為與原本一致。
        let targetRatio = 13 / 11;
        if (gridSystem && gridSystem.cols > 0 && gridSystem.rows > 0) {
            targetRatio = gridSystem.cols / gridSystem.rows;
        }

        const currentRatio = containerWidth / containerHeight;

        let finalWidth, finalHeight;

        if (currentRatio > targetRatio) {
            // 螢幕比較寬，以高度為主
            finalHeight = containerHeight;
            finalWidth = finalHeight * targetRatio;
        } else {
            // 螢幕比較高，以寬度為主
            finalWidth = containerWidth;
            finalHeight = finalWidth / targetRatio;
        }

        // 取整數，避免小數造成 sub-pixel 縫隙、視覺上看起來沒對齊
        finalWidth = Math.max(1, Math.round(finalWidth));
        finalHeight = Math.max(1, Math.round(finalHeight));

        this.width = finalWidth;
        this.height = finalHeight;

        // 設定實際渲染解析度與 CSS 大小
        this.canvas.width = Math.round(this.width * this.qualityScale);
        this.canvas.height = Math.round(this.height * this.qualityScale);
        this.canvas.style.width = this.width + 'px';
        this.canvas.style.height = this.height + 'px';
        // 每次 resize 都會重置整個 transform，先清乾淨再縮放；
        // 否則重複呼叫會讓 scale 疊乘，畫面愈縮愈小（換關後就消失）。
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.scale(this.qualityScale, this.qualityScale);
        // 強制啟用平滑縮放，避免像素化
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = 'high';
    }

    updateQuality() {
        this.frameCount++;
        const now = performance.now();
        if (now - this.lastTime >= 1000) {
            this.fps = (this.frameCount * 1000) / (now - this.lastTime);
            this.frameCount = 0;
            this.lastTime = now;
            
            // 如果 FPS 太低，降低畫質 (最低 0.75，避免嚴重像素化)
            if (this.fps < 45 && this.qualityScale > 0.75) {
                this.qualityScale = Math.max(0.75, this.qualityScale - 0.05);
                this.resize(this.gridSystemRef);
            } else if (this.fps >= 55 && this.qualityScale < 1.0) {
                this.qualityScale = Math.min(1.0, this.qualityScale + 0.05);
                this.resize(this.gridSystemRef);
            }
        }
    }

    beginFrame() {
        this.updateQuality();
    }

    clear() {
        // 深邃的星空暗色漸層背景
        const grad = this.ctx.createRadialGradient(
            this.width / 2, this.height / 2, 0,
            this.width / 2, this.height / 2, this.width
        );
        grad.addColorStop(0, '#1a1a2e');
        grad.addColorStop(1, '#0f0f1a');
        this.ctx.fillStyle = grad;
        this.ctx.fillRect(0, 0, this.width, this.height);
    }

    getCtx() {
        return this.ctx;
    }

    getWidth() {
        return this.width;
    }

    getHeight() {
        return this.height;
    }

    renderGrid(gridSystem) {
        // 微弱的高科技網格線
        this.ctx.strokeStyle = 'rgba(0, 238, 255, 0.05)';
        this.ctx.lineWidth = 1;
        const size = gridSystem.getCellSize();
        
        for (let y = 0; y <= gridSystem.rows; y++) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y * size);
            this.ctx.lineTo(this.width, y * size);
            this.ctx.stroke();
        }

        for (let x = 0; x <= gridSystem.cols; x++) {
            this.ctx.beginPath();
            this.ctx.moveTo(x * size, 0);
            this.ctx.lineTo(x * size, this.height);
            this.ctx.stroke();
        }
    }
}
