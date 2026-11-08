export class ParticleSystem {
    constructor(canvasWidth, canvasHeight) {
        this.width = canvasWidth;
        this.height = canvasHeight;
        this.particles = [];
        
        // 初始產生一些火花粒子
        for (let i = 0; i < 50; i++) {
            this.particles.push(this.createParticle());
        }
    }

    createParticle() {
        return {
            x: Math.random() * this.width,
            y: this.height + Math.random() * 100,
            vx: (Math.random() - 0.5) * 20, // 水平飄動
            vy: -Math.random() * 50 - 20, // 向上飄
            size: Math.random() * 3 + 1,
            life: Math.random(),
            color: `rgba(255, ${Math.floor(Math.random() * 150 + 50)}, 0, `
        };
    }

    resize(width, height) {
        this.width = width;
        this.height = height;
    }

    update(deltaTime) {
        for (const p of this.particles) {
            p.x += p.vx * deltaTime;
            p.y += p.vy * deltaTime;
            
            // 微微飄動
            p.vx += (Math.random() - 0.5) * 10 * deltaTime;
            
            // 粒子生命衰減
            p.life -= deltaTime * 0.2;
            
            if (p.y < -10 || p.life <= 0) {
                // 重置粒子回到下方
                Object.assign(p, this.createParticle());
                p.y = this.height + Math.random() * 20;
                p.life = 1.0;
            }
        }
    }

    render(ctx) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const p of this.particles) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = p.color + p.life + ')';
            ctx.fill();
        }
        ctx.restore();
    }
}
