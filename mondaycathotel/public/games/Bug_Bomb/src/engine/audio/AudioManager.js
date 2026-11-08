export class AudioManager {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.5; // 預設音量 50%
        this.masterGain.connect(this.ctx.destination);
        
        this.isMuted = false;
        
        // 為了在瀏覽器政策下啟用音效，必須由使用者互動觸發
        this.enabled = false;
        
        const enableAudio = () => {
            if (!this.enabled) {
                this.ctx.resume();
                this.enabled = true;
            }
        };
        
        window.addEventListener('click', enableAudio, { once: true });
        window.addEventListener('keydown', enableAudio, { once: true });
        window.addEventListener('touchstart', enableAudio, { once: true });
    }

    setVolume(vol) {
        if (!this.isMuted) {
            this.masterGain.gain.value = vol;
        }
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        this.masterGain.gain.value = this.isMuted ? 0 : 0.5;
    }

    // 播放爆炸音效 (震撼深沉的爆炸)
    playExplosion() {
        if (!this.enabled) return;
        
        const t = this.ctx.currentTime;
        
        // 低頻震波
        const osc = this.ctx.createOscillator();
        const oscGain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(120, t);
        osc.frequency.exponentialRampToValueAtTime(0.01, t + 0.8);
        oscGain.gain.setValueAtTime(1, t);
        oscGain.gain.exponentialRampToValueAtTime(0.01, t + 0.8);
        osc.connect(oscGain);
        oscGain.connect(this.masterGain);
        
        // 白噪音衝擊波
        const bufferSize = this.ctx.sampleRate * 0.6; 
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        
        const noiseFilter = this.ctx.createBiquadFilter();
        noiseFilter.type = 'lowpass';
        noiseFilter.frequency.setValueAtTime(2000, t);
        noiseFilter.frequency.exponentialRampToValueAtTime(100, t + 0.6);
        
        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(1.5, t);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.6);
        
        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(this.masterGain);
        
        osc.start(t);
        noise.start(t);
        osc.stop(t + 0.8);
        noise.stop(t + 0.6);
    }

    // 播放吃道具音效 (科技感上升音階)
    playItemPickup() {
        if (!this.enabled) return;
        
        const t = this.ctx.currentTime;
        
        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc1.type = 'sine';
        osc2.type = 'square';
        
        // 快速琶音效果
        osc1.frequency.setValueAtTime(440, t);
        osc1.frequency.setValueAtTime(554, t + 0.05); // C#
        osc1.frequency.setValueAtTime(659, t + 0.1);  // E
        osc1.frequency.setValueAtTime(880, t + 0.15); // A
        
        osc2.frequency.setValueAtTime(440, t);
        osc2.frequency.setValueAtTime(554, t + 0.05);
        osc2.frequency.setValueAtTime(659, t + 0.1);
        osc2.frequency.setValueAtTime(880, t + 0.15);
        
        gain.gain.setValueAtTime(0.3, t);
        gain.gain.setValueAtTime(0.3, t + 0.15);
        gain.gain.linearRampToValueAtTime(0, t + 0.3);
        
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(this.masterGain);
        
        osc1.start(t);
        osc2.start(t);
        osc1.stop(t + 0.3);
        osc2.stop(t + 0.3);
    }

    // 放炸彈音效 (清脆鎖定音)
    playPlaceBomb() {
        if (!this.enabled) return;
        
        const t = this.ctx.currentTime;
        
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = 'square';
        osc.frequency.setValueAtTime(600, t);
        osc.frequency.exponentialRampToValueAtTime(300, t + 0.05);
        
        gain.gain.setValueAtTime(0.4, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
        
        osc.connect(gain);
        gain.connect(this.masterGain);
        
        osc.start(t);
        osc.stop(t + 0.1);
    }

    // --- BGM Playback ---
    playBGM(type = 'stage') {
        if (!this.enabled) return;
        this.stopBGM();
        
        if (!this.bgmAudio) {
            this.bgmAudio = new Audio('./assets/bgm.mp3');
            this.bgmAudio.loop = true;
            this.bgmNode = this.ctx.createMediaElementSource(this.bgmAudio);
            
            this.bgmGain = this.ctx.createGain();
            this.bgmGain.gain.value = 0.4;
            
            this.bgmNode.connect(this.bgmGain);
            this.bgmGain.connect(this.masterGain);
        }
        
        this.bgmAudio.play().catch(e => console.log('BGM Play Error:', e));
    }
    
    stopBGM() {
        if (this.bgmAudio) {
            this.bgmAudio.pause();
            this.bgmAudio.currentTime = 0;
        }
    }
}
