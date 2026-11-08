export class GameEngine {
    constructor() {
        this.lastTime = 0;
        this.updateFn = null;
        this.renderFn = null;
        this.isRunning = false;
        
        // 將 loop 綁定到 instance
        this.loop = this.loop.bind(this);
    }

    setUpdate(fn) {
        this.updateFn = fn;
    }

    setRender(fn) {
        this.renderFn = fn;
    }

    start() {
        if (!this.isRunning) {
            this.isRunning = true;
            this.lastTime = performance.now();
            requestAnimationFrame(this.loop);
        }
    }

    stop() {
        this.isRunning = false;
    }

    loop(currentTime) {
        if (!this.isRunning) return;

        // 計算 deltaTime (單位：秒)
        let deltaTime = (currentTime - this.lastTime) / 1000;
        // 限制最大 deltaTime 避免切換分頁時出現大跳躍
        if (deltaTime > 0.1) deltaTime = 0.1;
        this.lastTime = currentTime;

        if (this.updateFn) this.updateFn(deltaTime);
        if (this.renderFn) this.renderFn();

        requestAnimationFrame(this.loop);
    }
}
