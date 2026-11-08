export class ThreeJSBackground {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;
        
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x050510, 0.015);
        this.camera = new THREE.PerspectiveCamera(75, this.width / this.height, 0.1, 1000);
        this.camera.position.z = 30;
        
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
        this.renderer.setSize(this.width, this.height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // 效能優化
        
        // Emulate Bloom with Additive Blending Particles
        this.particles = this.createParticles();
        this.scene.add(this.particles);
        
        this.embers = this.createEmbers();
        this.scene.add(this.embers);
        
        // 加入動態光影
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
        this.scene.add(ambientLight);
        
        this.pointLight = new THREE.PointLight(0x00f2fe, 3, 100);
        this.pointLight.position.set(0, 0, 10);
        this.scene.add(this.pointLight);

        this.fireLight = new THREE.PointLight(0xff5500, 2, 80);
        this.fireLight.position.set(-10, -10, 10);
        this.scene.add(this.fireLight);
    }
    
    createParticles() {
        const particleCount = 300;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = [];
        const sizes = new Float32Array(particleCount);
        
        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 100;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 100 - 20; 
            positions[i * 3 + 2] = (Math.random() - 0.5) * 50;
            
            velocities.push({
                y: Math.random() * 0.05 + 0.02, 
                x: (Math.random() - 0.5) * 0.02
            });
            sizes[i] = Math.random() * 2 + 1;
        }
        
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        this.velocities = velocities;
        
        const material = new THREE.PointsMaterial({
            color: 0x00d8ff,
            size: 0.8,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        
        return new THREE.Points(geometry, material);
    }

    createEmbers() {
        const count = 150;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        this.emberVelocities = [];
        
        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 100;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 100 - 20; 
            positions[i * 3 + 2] = (Math.random() - 0.5) * 50 + 10;
            
            this.emberVelocities.push({
                y: Math.random() * 0.15 + 0.05, 
                x: (Math.random() - 0.5) * 0.08
            });
        }
        
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        
        const material = new THREE.PointsMaterial({
            color: 0xff4400,
            size: 0.4,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        
        return new THREE.Points(geometry, material);
    }
    
    resize(width, height) {
        if (!this.renderer) return;
        this.width = width;
        this.height = height;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }
    
    update(deltaTime) {
        if (!this.particles || !this.embers) return;
        
        const positions = this.particles.geometry.attributes.position.array;
        for (let i = 0; i < this.velocities.length; i++) {
            positions[i * 3] += this.velocities[i].x;
            positions[i * 3 + 1] += this.velocities[i].y;
            if (positions[i * 3 + 1] > 50) {
                positions[i * 3 + 1] = -50;
                positions[i * 3] = (Math.random() - 0.5) * 100;
            }
        }
        this.particles.geometry.attributes.position.needsUpdate = true;
        // this.particles.rotation.y += 0.05 * deltaTime; // 移除背景自轉，避免讓玩家產生整個畫面往左移的錯覺

        const ePositions = this.embers.geometry.attributes.position.array;
        for (let i = 0; i < this.emberVelocities.length; i++) {
            ePositions[i * 3] += this.emberVelocities[i].x + Math.sin(Date.now()*0.002 + i)*0.05;
            ePositions[i * 3 + 1] += this.emberVelocities[i].y;
            if (ePositions[i * 3 + 1] > 50) {
                ePositions[i * 3 + 1] = -50;
                ePositions[i * 3] = (Math.random() - 0.5) * 100;
            }
        }
        this.embers.geometry.attributes.position.needsUpdate = true;
        
        const time = Date.now() * 0.001;
        this.pointLight.position.x = Math.sin(time) * 20;
        this.pointLight.position.y = Math.cos(time * 0.8) * 20;
        this.pointLight.intensity = 2 + Math.sin(time * 3) * 0.5;

        this.fireLight.position.x = Math.cos(time * 1.2) * 15;
        this.fireLight.position.y = Math.sin(time * 0.5) * 15;
        this.fireLight.intensity = 1.5 + Math.random() * 0.5;
    }
    
    render() {
        if (this.renderer) {
            this.renderer.render(this.scene, this.camera);
        }
    }
}
