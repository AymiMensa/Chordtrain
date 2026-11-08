export class GridSystem {
    constructor(cols, rows) {
        this.cols = cols;
        this.rows = rows;
        this.cellSize = 0;
        this.offsetX = 0;
        this.offsetY = 0;
    }

    setSize(cols, rows) {
        this.cols = cols;
        this.rows = rows;
    }

    updateCellSize(canvasWidth, canvasHeight) {
        // 以寬高比例較小者為基準計算 cellSize
        const sizeX = canvasWidth / this.cols;
        const sizeY = canvasHeight / this.rows;
        this.cellSize = Math.min(sizeX, sizeY);

        // 置中偏移量（如果有的話，不過 CanvasRenderer 已經控制了比例，這裡 offsetX/Y 應該是 0）
        this.offsetX = (canvasWidth - this.cellSize * this.cols) / 2;
        this.offsetY = (canvasHeight - this.cellSize * this.rows) / 2;
    }

    getCellSize() {
        return this.cellSize;
    }

    getPixelCoord(gridX, gridY) {
        return {
            x: this.offsetX + gridX * this.cellSize,
            y: this.offsetY + gridY * this.cellSize
        };
    }

    getGridCoord(pixelX, pixelY) {
        return {
            x: Math.floor((pixelX - this.offsetX) / this.cellSize),
            y: Math.floor((pixelY - this.offsetY) / this.cellSize)
        };
    }
}
