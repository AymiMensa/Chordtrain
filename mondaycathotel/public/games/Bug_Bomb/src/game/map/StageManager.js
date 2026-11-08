export class StageManager {
    constructor(gridSystem, mapManager, monsterManager) {
        this.gridSystem = gridSystem;
        this.mapManager = mapManager;
        this.monsterManager = monsterManager;
        
        // 嘗試讀取存檔
        const savedStage = localStorage.getItem('bomber_stage');
        this.currentStage = savedStage ? parseInt(savedStage) : 1;
        this.maxStage = 60;
    }

    advanceStage() {
        if (this.currentStage < this.maxStage) {
            this.currentStage++;
            localStorage.setItem('bomber_stage', this.currentStage.toString());
            return true; // 進入下一關
        }
        return false; // 全破
    }

    getStageTheme() {
        if (this.currentStage % 10 === 0) return 'BOSS';
        const section = Math.floor((this.currentStage - 1) / 10);
        switch (section) {
            case 0: return 'FOREST'; // 1-9
            case 1: return 'ICE'; // 11-19
            case 2: return 'FACTORY'; // 21-29
            case 3: return 'VOLCANO'; // 31-39
            case 4: return 'SPACE'; // 41-49
            default: return 'CASTLE'; // 51-59
        }
    }

    setupStage() {
        const theme = this.getStageTheme();
        const isBoss = theme === 'BOSS';

        // 隨著關卡變大，增加地圖大小
        //
        // BOSS 關原本是額外 +10x10（舊版），實測造成嚴重難度回退：
        //   stage 10: 195 -> 675 格（3.46x），但怪物數只從 7 增到 8，
        //   怪物密度由 0.140 掉到 0.034（只剩 24%），可通行比例還從 25.6% 升到 34.7%。
        //   等於「打龍王的那關」比前一關簡單 4 倍。
        // 現在 BOSS 關改為 +2x2，與一般關卡的成長一致，難度改由怪物量與龍王本身提供。
        // 順帶解決手機問題：第 60 關由 47x45 降為 31x31，格子不會小到難以操作。
        let cols = 13 + Math.floor(this.currentStage / 5) * 2;
        let rows = 11 + Math.floor(this.currentStage / 5) * 2;

        if (isBoss) {
            cols += 2;
            rows += 2;
        }

        // 更新網格大小
        if (this.gridSystem.setSize) {
            this.gridSystem.setSize(cols, rows);
        }

        // 告訴 MapManager 用什麼主題生成，並傳入關卡數讓地形難度受控
        this.mapManager.setTheme(theme);
        this.mapManager.setStage(this.currentStage);
        this.mapManager.initMap();

        // 生成怪物難度
        //
        // BOSS 關原本想用 x1.5 來抵銷舊版「地圖 +10 格」造成的密度下降，
        // 但地圖已改為只 +2 格後，密度本來就不降了（實測 BOSS 關密度
        // 1.01x~1.47x，高於前一關），此時再乘 1.5 反而製造鋸齒：
        // 第 10 關 8x1.5=12 隻，下一關第 11 關又回 8 隻 -> 怪物數難度回退。
        // 所以這裡維持原本的公式，讓怪物數全程單調不減。
        const monsterCount = 3 + Math.floor(this.currentStage / 2);

        // 傳入 currentStage，讓 MonsterManager 依難度分帶挑怪物種類
        this.monsterManager.spawnMonsters(monsterCount, this.currentStage);
    }

    setDangerMap(dangerMap) {
        this.dangerMap = dangerMap;
    }
}
