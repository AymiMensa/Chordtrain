import { GameEngine } from './engine/GameEngine.js';
import { CanvasRenderer } from './engine/renderer/CanvasRenderer.js';
import { InputManager } from './engine/input/InputManager.js';
import { GridSystem } from './engine/physics/GridSystem.js';
import { MapManager } from './game/map/MapManager.js';
import { Player } from './game/player/Player.js';
import { BombManager } from './game/bomb/BombManager.js';
import { ExplosionManager } from './game/explosion/ExplosionManager.js';
import { ItemManager } from './game/item/ItemManager.js';
import { MonsterManager } from './game/monster/MonsterManager.js';
import { DangerMap } from './game/ai/DangerMap.js';
import { Bot } from './game/ai/Bot.js';
import { DragonBoss } from './game/monster/DragonBoss.js';
import { ThreeJSBackground } from './engine/renderer/ThreeJSBackground.js';
import { ParticleSystem } from './engine/renderer/ParticleSystem.js';
import { AudioManager } from './engine/audio/AudioManager.js';
import { StageManager } from './game/map/StageManager.js';
import assetLoader from './engine/renderer/AssetLoader.js';
import { sharedSelfPlayTrainer } from './game/ai/AIController.js';

// 預載圖片素材 (路徑相對於 HTML 文件位置)
const imageSources = {
    player_up: './assets/player.png',
    player_down: './assets/player.png',
    player_left: './assets/player.png',
    player_right: './assets/player.png',
    hard_block: './assets/hard_block.png',
    soft_block: './assets/soft_block.png',
    floor: './assets/floor.png',
    bomb: './assets/bomb.png',
    explosion: './assets/explosion.png',
    monster_up: './assets/monster.png',
    monster_down: './assets/monster.png',
    monster_left: './assets/monster.png',
    monster_right: './assets/monster.png'
};

assetLoader.loadImages(imageSources).then(() => {
    console.log('Assets loaded.');
}).catch(e => {
    console.error('Asset loading failed, continuing without preloaded images:', e);
});

// 初始化系統
const canvas = document.getElementById('game-canvas');
const renderer = new CanvasRenderer(canvas);
const inputManager = new InputManager();
inputManager.init();

// 以 13x11 為基礎的地圖尺寸
const gridSystem = new GridSystem(13, 11);
const mapManager = new MapManager(gridSystem);
window.mapManager = mapManager;
const audioManager = new AudioManager();

// 遊戲全域狀態
let gameState = 'MENU'; // MENU, PLAYING, GAMEOVER, VICTORY
let gameMode = 'P1_BOT_COOP'; // Default
window.gameMode = gameMode;
let player, player2, itemManager, explosionManager, bombManager, monsterManager, dangerMap, bot, bot2, dragonBoss, stageManager;
const particleSystem = new ParticleSystem(canvas.width, canvas.height);
const threeJSBg = new ThreeJSBackground('bg-canvas');

window.gameScore = { kills: 0 };
window.incrementScore = function(val) {
    window.gameScore.kills += val;
}
window.logItem = function(playerName, itemName) {
    const log = document.getElementById('item-log');
    if (log) {
        log.innerText = `${playerName} 吃到了 ${itemName}!`;
        clearTimeout(window.logTimeout);
        window.logTimeout = setTimeout(() => { log.innerText = ''; }, 3000);
    }
}
window.updateHUD = function() {
    const p1Status = document.getElementById('p1-status');
    const p2Status = document.getElementById('p2-status');
    
    if (!p1Status || !p2Status) return;

    if (player || (bot && (gameMode === 'BOT_BOT_COOP' || gameMode === 'BOT_BOT_VS'))) {
        let p1 = player || bot;
        p1Status.innerText = `音 生命: ${p1.hp}/${p1.maxHp} | 擊殺: ${window.gameScore.kills}`;
    } else {
        p1Status.innerText = ``;
    }
    
    if (player2 || bot2 || (bot && gameMode !== 'BOT_BOT_COOP' && gameMode !== 'BOT_BOT_VS')) {
        let p2 = player2 || bot2 || bot;
        p2Status.innerText = `玥 生命: ${p2.hp}/${p2.maxHp} | 擊殺: ${window.gameScore.kills}`;
    } else {
        p2Status.innerText = ``;
    }
};

function initGame() {
    audioManager.playBGM(); // 播放背景音樂
    
    // 隱藏遊戲結束畫面 (防止進入下一關時卡在畫面上)
    const gameOverScreen = document.getElementById('game-over');
    if (gameOverScreen) gameOverScreen.classList.add('hidden');

    // 基礎系統初始化
    itemManager = new ItemManager(gridSystem);
    itemManager.setAudioManager(audioManager);
    explosionManager = new ExplosionManager(gridSystem, mapManager, itemManager);
    explosionManager.setAudioManager(audioManager);
    bombManager = new BombManager(gridSystem, mapManager, explosionManager);
    bombManager.setAudioManager(audioManager);
    monsterManager = new MonsterManager(gridSystem, mapManager, bombManager);
    window.monsterManager = monsterManager; // 暴露給 ItemManager 使用 Freeze
    explosionManager.setBombManager(bombManager);
    dangerMap = new DangerMap(gridSystem, mapManager, bombManager, explosionManager, monsterManager);
    
    stageManager = new StageManager(gridSystem, mapManager, monsterManager);
    stageManager.setDangerMap(dangerMap);
    window.stageManager = stageManager; // 暴露給 AIController 做關卡勝率追蹤

    // 順序修正：cellSize 必須在 setupStage() 之前算好。
    // setupStage() 內會呼叫 monsterManager.spawnMonsters() 生成怪物，
    // 怪物建構時用 getPixelCoord() 取像素位置；若此時 cellSize 仍是 0，
    // 所有怪物的 x/y 都會是 (0,0)，之後每幀用 cellSize 推動像素，
    // 怪物就從地圖左上角一路往外衝、離開邊界後再無阻擋，
    // 座標一路暴增導致永遠殺不到，「殺光所有怪物」的過關條件永不成立。
    // （renderer.resize() 會依 gridSystem 的實際比例設定畫布，所以此處安全。）
    renderer.resize(gridSystem);
    gridSystem.updateCellSize(renderer.getWidth(), renderer.getHeight());

    stageManager.setupStage(); // 此處會改變 gridSystem cols, rows 與生成地圖
    dangerMap.initGrid(); // Re-initialize danger map grid to match new dimensions
    // setupStage() 已改變 cols/rows → 依「新的地圖比例」重新設定畫布，
    // 這樣畫布形狀永遠貼合地圖，格子保持正方形、地圖置中、不留空白也不溢出。
    renderer.resize(gridSystem);
    gridSystem.updateCellSize(renderer.getWidth(), renderer.getHeight());
recalcEntityPositions();
    // 根據模式生成實體
    // 根據模式生成實體
    if (gameMode === 'P1_P2_COOP' || gameMode === 'P1_BOT_COOP' || gameMode === 'BOT_BOT_COOP' || gameMode === 'P1_SINGLE' || gameMode === 'BOT_SINGLE') {
        if (stageManager.getStageTheme() === 'BOSS') {
            dragonBoss = new DragonBoss(Math.floor(gridSystem.cols / 2), Math.floor(gridSystem.rows / 2), gridSystem, mapManager, explosionManager, stageManager.currentStage);
        } else {
            dragonBoss = null;
        }
    } else if (gameMode === 'P1_P2_VS' || gameMode === 'P1_BOT_VS' || gameMode === 'BOT_BOT_VS') {
        // VS 模式也加一點怪物增加趣味
        monsterManager.spawnMonsters(3);
        dragonBoss = null;
    }

    // 暴露龍王給 AI 決策層：HunterPolicy 透過 monsterManager.boss 攻擊 BOSS，
    // 否則電腦 AI 只會清小怪、永不攻擊龍王 -> BOSS 關永遠無法通關。
    monsterManager.boss = dragonBoss;
    window.dragonBoss = dragonBoss;
    
    // 生成 P1 (如果在有 P1 的模式)
    if (gameMode.startsWith('P1_')) {
        player = new Player(1, 1, gridSystem, inputManager, mapManager, 0);
        player.setBombManager(bombManager);
        player.hp = 3;
        player.maxHp = 3;
    } else {
        player = null; // 純電腦模式
    }

    // 生成 P2 或 Bot
    if (gameMode === 'P1_P2_COOP' || gameMode === 'P1_P2_VS') {
        player2 = new Player(gridSystem.cols - 2, 1, gridSystem, inputManager, mapManager, 1);
        player2.setBombManager(bombManager);
        player2.hp = 3;
        player2.maxHp = 3;
        bot = null;
    } else if (gameMode === 'P1_BOT_COOP' || gameMode === 'P1_BOT_VS') {
        player2 = null;
        bot = new Bot(gridSystem.cols - 2, 1, gridSystem, mapManager, dangerMap, bombManager, itemManager);
        bot.setBombManager(bombManager);
        bot.hp = 3;
        bot.maxHp = 3;
    } else if (gameMode === 'BOT_BOT_COOP' || gameMode === 'BOT_BOT_VS') {
        player2 = null;
        bot = new Bot(1, 1, gridSystem, mapManager, dangerMap, bombManager, itemManager);
        bot.setBombManager(bombManager);
        bot.hp = 3;
        bot.maxHp = 3;
        bot2 = new Bot(gridSystem.cols - 2, 1, gridSystem, mapManager, dangerMap, bombManager, itemManager);
        bot2.setBombManager(bombManager);
        bot2.hp = 3;
        bot2.maxHp = 3;
    } else if (gameMode === 'BOT_SINGLE') {
        player2 = null;
        bot2 = null;
        bot = new Bot(1, 1, gridSystem, mapManager, dangerMap, bombManager, itemManager);
        bot.setBombManager(bombManager);
        bot.hp = 3;
        bot.maxHp = 3;
    } else if (gameMode === 'P1_SINGLE') {
        player2 = null;
        bot = null;
        bot2 = null;
    }

    gameState = 'PLAYING';

    // 校正所有實體的像素座標（玩家、Bot、怪物、Boss）
    recalcEntityPositions();

    window.player = player;
    window.player2 = player2;
    window.bot = bot;
    window.bot2 = bot2;
}

/**
 * 依目前的 cellSize / offset，把所有實體的像素座標重新對齊到其所在格。
 *
 * 修正重點：原本這段只處理 player / player2 / bot，
 * 漏掉 player2 之外的 bot2、所有怪物（monsterManager.monsters）與 Boss。
 * 結果換關或視窗尺寸改變後，怪物與 bot2 的像素座標仍是舊 cellSize 算出來的，
 * 與新地圖完全對不上一格，會出現在畫面外或牆裡。
 *
 * 呼叫時機：initGame() 產生實體之後、視窗 resize 之後。
 * 純座標重算，不改變任何遊戲規則或物件狀態。
 */
function recalcEntityPositions() {
    const snap = (e) => {
        if (!e) return;
        if (typeof e.gridX !== 'number' || typeof e.gridY !== 'number') return;
        const p = gridSystem.getPixelCoord(e.gridX, e.gridY);
        e.x = p.x; e.y = p.y;
    };
    snap(player);
    snap(player2);
    snap(bot);
    snap(bot2);
    snap(dragonBoss);
    if (monsterManager && monsterManager.monsters) {
        for (const m of monsterManager.monsters) snap(m);
    }
}

// 建立引擎並註冊更新與渲染模組
const gameEngine = new GameEngine();

gameEngine.setUpdate((deltaTime) => {
    inputManager.update(); // 處理 Gamepad 與 Input 狀態更新

    window.updateHUD();
    particleSystem.update(deltaTime);
    if (threeJSBg) threeJSBg.update(deltaTime);

    if (gameState === 'MENU') return;

    // 檢查是否有玩家發動 Time Stop
    let timeStoppedBy = null;
    for (const p of [player, player2, bot, bot2]) {
        if (p && p.timeStopTimer > 0) {
            timeStoppedBy = p;
            p.timeStopTimer -= deltaTime;
            break;
        }
    }

    if (timeStoppedBy) {
        // 只有發動者能移動
        timeStoppedBy.update(deltaTime);
        itemManager.checkPlayerCollection(timeStoppedBy);
        // 其他系統暫停 (炸彈、怪物、其他玩家)
    } else {
        if (player) player.update(deltaTime);
        if (player2) player2.update(deltaTime);
        itemManager.update(deltaTime);
        bombManager.update(deltaTime);
        explosionManager.update(deltaTime);
        
        // 處理 Freeze (怪物結冰)
        if (monsterManager.freezeTimer > 0) {
            monsterManager.freezeTimer -= deltaTime;
            // Freeze 期間不 update 怪物
        } else {
            monsterManager.update(deltaTime);
        }
        
        dangerMap.update();
        if (bot) bot.update(deltaTime);
        if (bot2) bot2.update(deltaTime);
        if (dragonBoss) dragonBoss.update(deltaTime);

        if (player) itemManager.checkPlayerCollection(player);
        if (player2) itemManager.checkPlayerCollection(player2);
        if (bot) itemManager.checkPlayerCollection(bot);
        if (bot2) itemManager.checkPlayerCollection(bot2);
    }
    
    if (player) monsterManager.checkPlayerCollision(player);
    if (player2) monsterManager.checkPlayerCollision(player2);
    if (bot) monsterManager.checkPlayerCollision(bot);
    if (bot2) monsterManager.checkPlayerCollision(bot2);
    
    explosionManager.checkMonsterHit(monsterManager);

    // 玩家或 Bot 碰到爆風
    if (player && !player.isDead && explosionManager.checkPlayerHit(player)) {
        player.die();
    }
    if (player2 && !player2.isDead && explosionManager.checkPlayerHit(player2)) {
        player2.die();
    }
    if (bot && !bot.isDead && explosionManager.checkPlayerHit(bot)) {
        bot.die();
    }
    if (bot2 && !bot2.isDead && explosionManager.checkPlayerHit(bot2)) {
        bot2.die();
    }
    if (dragonBoss && !dragonBoss.isDead && explosionManager.checkPlayerHit(dragonBoss)) {
        dragonBoss.die();
    }

    // Boss 碰撞玩家/Bot
    if (dragonBoss && !dragonBoss.isDead) {
        const cellSize = gridSystem.getCellSize();
        if (player && !player.isDead && Math.abs(dragonBoss.x - player.x) < cellSize && Math.abs(dragonBoss.y - player.y) < cellSize) player.die();
        if (player2 && !player2.isDead && Math.abs(dragonBoss.x - player2.x) < cellSize && Math.abs(dragonBoss.y - player2.y) < cellSize) player2.die();
        if (bot && !bot.isDead && Math.abs(dragonBoss.x - bot.x) < cellSize && Math.abs(dragonBoss.y - bot.y) < cellSize) bot.die();
        if (bot2 && !bot2.isDead && Math.abs(dragonBoss.x - bot2.x) < cellSize && Math.abs(dragonBoss.y - bot2.y) < cellSize) bot2.die();
    }

    // 勝負判定邏輯
    let p1Dead = player ? player.isDead : true;
    let p2Dead = player2 ? player2.isDead : true;
    let botDead = bot ? bot.isDead : true;
    let bot2Dead = bot2 ? bot2.isDead : true;
    let allMonstersDead = monsterManager.monsters.length === 0 && (!dragonBoss || dragonBoss.isDead);

    if (gameState === 'PLAYING') {
        if (gameMode.includes('COOP') || gameMode.includes('SINGLE')) {
            // 闖關/合作模式：玩家/我方全滅 = 輸，怪物全滅 = 贏
            let myTeamAlive = false;
            if (player && !player.isDead) myTeamAlive = true;
            if (player2 && !player2.isDead) myTeamAlive = true;
            if (bot && !bot.isDead) myTeamAlive = true;
            if (bot2 && !bot2.isDead) myTeamAlive = true;

            if (!myTeamAlive) {
                gameState = 'GAMEOVER';
                if (bot && bot.aiController) bot.aiController.endStage(false);
                if (bot2 && bot2.aiController) bot2.aiController.endStage(false);
                if (window.sharedSelfPlayTrainer) window.sharedSelfPlayTrainer.onStageResult(false);
                setTimeout(showGameOver, 1500);
            } else if (allMonstersDead) {
                gameState = 'VICTORY';
                if (bot && bot.aiController) bot.aiController.endStage(true);
                if (bot2 && bot2.aiController) bot2.aiController.endStage(true);
                if (window.sharedSelfPlayTrainer) window.sharedSelfPlayTrainer.onStageResult(true);
                if (stageManager.advanceStage()) {
                    setTimeout(() => { showVictory(`第 ${stageManager.currentStage-1} 關突破！進入下一關！`); }, 1000);
                    setTimeout(() => { initGame(); }, 3000);
                } else {
                    setTimeout(() => { showVictory("恭喜全破！！"); }, 1000);
                }
            }
        } else {
            // 競賽模式：活下來的隊伍贏
            let t1Alive = (!p1Dead || (gameMode === 'BOT_BOT_VS' && !botDead));
            let t2Alive = (!p2Dead && gameMode === 'P1_P2_VS') || (!botDead && gameMode === 'P1_BOT_VS') || (!bot2Dead && gameMode === 'BOT_BOT_VS');
            
            if (!t1Alive && !t2Alive) {
                gameState = 'GAMEOVER';
                setTimeout(() => { showVictory("平手！"); }, 1500);
            } else if (!t1Alive && t2Alive) {
                gameState = 'GAMEOVER'; // T2 贏
                setTimeout(() => { showVictory("隊伍二 獲勝！"); }, 1500);
            } else if (t1Alive && !t2Alive) {
                gameState = 'VICTORY'; // T1 贏
                setTimeout(() => { showVictory("隊伍一 獲勝！"); }, 1000);
            }
        }
    }
});

gameEngine.setRender(() => {
    if (threeJSBg) threeJSBg.render(); // Render 3D Background

    renderer.beginFrame();
    renderer.clear();
    // particleSystem.render(renderer.getCtx()); // 暫時關閉 2D 粒子，改用 3D
    
    if (gameState === 'MENU') return;
    
    renderer.renderGrid(gridSystem);
    mapManager.render(renderer.getCtx(), gridSystem);
    itemManager.render(renderer.getCtx());
    bombManager.render(renderer.getCtx());
    explosionManager.render(renderer.getCtx());
    monsterManager.render(renderer.getCtx());
    if (bot) bot.render(renderer.getCtx());
    if (bot2) bot2.render(renderer.getCtx());
    if (dragonBoss) dragonBoss.render(renderer.getCtx());
    if (player2) player2.render(renderer.getCtx());
    if (player) player.render(renderer.getCtx());
});

// UI 控制
const mainMenu = document.getElementById('main-menu');
const gameOverScreen = document.getElementById('game-over');
const gameOverTitle = document.getElementById('game-over-title');

// UI 事件監聽 - ES module 會在 DOM 解析後執行，直接綁定
document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        gameMode = btn.dataset.mode;
        window.gameMode = gameMode;
        document.getElementById('main-menu').classList.add('hidden');
        initGame();
    });
});

// UI 自定義按鍵設定
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const keyBinds = document.querySelectorAll('.key-bind');
let listeningBtn = null;

// Store original bindings for cancel functionality
let originalBindings = null;

// 從 localStorage 初始化按鍵文字
const savedKeys = localStorage.getItem('bomber_controls');
if (savedKeys) {
    try {
        const kb = JSON.parse(savedKeys);
        keyBinds.forEach(btn => {
            const p = btn.dataset.player;
            const a = btn.dataset.action;
            if (kb[p] && kb[p][a]) {
                btn.textContent = kb[p][a];
            }
        });
    } catch(e) {}
}

keyBinds.forEach(btn => {
    btn.addEventListener('click', () => {
        if (listeningBtn) listeningBtn.classList.remove('listening');
        listeningBtn = btn;
        btn.classList.add('listening');
        btn.textContent = '...';
    });
});

settingsBtn.addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
    // Store current bindings when opening settings
    originalBindings = JSON.parse(JSON.stringify(inputManager.keyBindings));
});

const cancelSettingsBtn = document.getElementById('cancel-settings-btn');
cancelSettingsBtn.addEventListener('click', () => {
    // Restore original bindings
    if (originalBindings) {
        inputManager.keyBindings = originalBindings;
        keyBinds.forEach(btn => {
            const p = btn.dataset.player;
            const a = btn.dataset.action;
            if (originalBindings[p] && originalBindings[p][a]) {
                btn.textContent = originalBindings[p][a];
            }
        });
    }
    document.getElementById('settings-modal').classList.add('hidden');
});

saveSettingsBtn.addEventListener('click', () => {
    const newBindings = { 0: {}, 1: {} };
    keyBinds.forEach(btn => {
        newBindings[btn.dataset.player][btn.dataset.action] = btn.textContent;
    });
    localStorage.setItem('bomber_controls', JSON.stringify(newBindings));
    inputManager.keyBindings = newBindings;
    document.getElementById('settings-modal').classList.add('hidden');
});

// 圖鑑系統
document.getElementById('gallery-btn').addEventListener('click', () => {
    document.getElementById('gallery-modal').classList.remove('hidden');
    const list = document.getElementById('gallery-list');
    list.innerHTML = '';
    const monsters = [
        { name: 'Slime', icon: '💧', desc: '最常見的弱小怪物' },
        { name: 'Spider', icon: '🕷️', desc: '移動速度較快，隨機轉彎' },
        { name: 'Bat', icon: '🦇', desc: '飛行速度極快' },
        { name: 'Ghost', icon: '👻', desc: '無視牆壁穿透' },
        { name: 'Dragon', icon: '🐉', desc: '噴射十字火焰的首領' },
        { name: 'Mecha', icon: '🤖', desc: '發射定向高溫雷射的首領' },
        { name: 'Titan', icon: '🧊', desc: '能冰凍大範圍的極寒首領' },
        { name: 'Overlord', icon: '👁️', desc: '終極首領，發動核爆' }
    ];
    monsters.forEach(m => {
        const item = document.createElement('div');
        item.style.cssText = 'background: rgba(255,255,255,0.1); padding: 10px; border-radius: 10px; text-align: center; width: 100px; border: 1px solid #00ff80;';
        item.innerHTML = `<div style="font-size: 3rem;">${m.icon}</div><div style="font-weight: bold; color: #fff; margin: 5px 0;">${m.name}</div><div style="font-size: 0.8rem; color: #aaa;">${m.desc}</div>`;
        list.appendChild(item);
    });
});

document.getElementById('close-gallery-btn').addEventListener('click', () => {
    document.getElementById('gallery-modal').classList.add('hidden');
});

// 成就系統
document.getElementById('achievements-btn').addEventListener('click', () => {
    document.getElementById('achievements-modal').classList.remove('hidden');
    const list = document.getElementById('achievements-list');
    list.innerHTML = '';

    // 讀取最高關卡進度
    const maxStage = localStorage.getItem('bomber_stage') || 1;

    const achievements = [
        { title: '初次爆破', desc: '成功通關第 1 關', done: maxStage >= 2 },
        { title: '森林勇者', desc: '成功通關第 10 關 (擊敗森林首領)', done: maxStage >= 11 },
        { title: '極寒考驗', desc: '成功通關第 20 關 (擊敗冰原首領)', done: maxStage >= 21 },
        { title: '炸彈大師', desc: '成功通關第 30 關 (擊敗工廠首領)', done: maxStage >= 31 },
        { title: '終極挑戰', desc: '成功通關第 60 關 (擊敗終極首領)', done: maxStage > 60 }
    ];
    achievements.forEach(a => {
        const item = document.createElement('div');
        const color = a.done ? '#ff00ff' : '#555';
        const bg = a.done ? 'rgba(255,0,255,0.2)' : 'rgba(255,255,255,0.05)';
        item.style.cssText = `background: ${bg}; padding: 15px; border-radius: 10px; border: 1px solid ${color}; display: flex; justify-content: space-between; align-items: center;`;
        item.innerHTML = `<div><div style="font-weight: bold; color: ${a.done ? '#fff' : '#888'}; font-size: 1.2rem;">${a.title}</div><div style="font-size: 0.9rem; color: #aaa;">${a.desc}</div></div><div style="font-size: 2rem;">${a.done ? '🏆' : '🔒'}</div>`;
        list.appendChild(item);
    });
});

document.getElementById('close-achievements-btn').addEventListener('click', () => {
    document.getElementById('achievements-modal').classList.add('hidden');
});

// 地圖編輯器系統
document.getElementById('map-editor-btn').addEventListener('click', () => {
    document.getElementById('map-editor-modal').classList.remove('hidden');
    const grid = document.getElementById('editor-grid');
    grid.innerHTML = '';

    // 計算自適應網格大小
    const maxGridWidth = Math.min(window.innerWidth * 0.9, 600);
    const maxGridHeight = window.innerHeight * 0.45;
    const cellSizeByWidth = Math.floor((maxGridWidth - 20) / 13); // 13 cols + padding
    const cellSizeByHeight = Math.floor((maxGridHeight - 20) / 11); // 11 rows + padding
    const cellSize = Math.max(18, Math.min(cellSizeByWidth, cellSizeByHeight, 40));
    
    grid.style.gridTemplateColumns = `repeat(13, ${cellSize}px)`;
    grid.style.gridTemplateRows = `repeat(11, ${cellSize}px)`;

    // 初始化或讀取自訂地圖
    let customMap = [];
    const savedMap = localStorage.getItem('bomber_custom_map');
    if (savedMap) {
        try { customMap = JSON.parse(savedMap); } catch(e) {}
    }

    if (customMap.length === 0) {
        for (let y = 0; y < 11; y++) {
            customMap[y] = [];
            for (let x = 0; x < 13; x++) {
                if (x === 0 || x === 12 || y === 0 || y === 10) customMap[y][x] = 1;
                else if (x % 2 === 0 && y % 2 === 0) customMap[y][x] = 1;
                else customMap[y][x] = 0;
            }
        }
    }

    const colors = { 0: '#33cc33', 1: '#888', 2: '#ff0055' };
    window.currentCustomMap = customMap;

    for (let y = 0; y < 11; y++) {
        for (let x = 0; x < 13; x++) {
            const cell = document.createElement('div');
            cell.style.cssText = `background: ${colors[customMap[y][x]]}; border: 1px solid #000; cursor: pointer; width: ${cellSize}px; height: ${cellSize}px;`;
            cell.dataset.x = x;
            cell.dataset.y = y;
            cell.addEventListener('click', () => {
                let t = window.currentCustomMap[y][x];
                t = (t + 1) % 3;
                window.currentCustomMap[y][x] = t;
                cell.style.background = colors[t];
            });
            grid.appendChild(cell);
        }
    }
});

document.getElementById('save-map-btn').addEventListener('click', () => {
    if (window.currentCustomMap) {
        localStorage.setItem('bomber_custom_map', JSON.stringify(window.currentCustomMap));
        alert('地圖已儲存！');
    }
});

document.getElementById('close-editor-btn').addEventListener('click', () => {
    document.getElementById('map-editor-modal').classList.add('hidden');
});

document.getElementById('restart-btn').addEventListener('click', () => {
    gameOverScreen.classList.add('hidden');
    gameState = 'MENU';
    document.getElementById('main-menu').classList.remove('hidden');
});

function showGameOver() {
    gameOverTitle.innerText = "遊戲結束";
    gameOverTitle.style.background = "linear-gradient(180deg, #ff0055 0%, #aa0022 100%)";
    gameOverTitle.style.webkitBackgroundClip = "text";
    gameOverScreen.classList.remove('hidden');
}

function showVictory(text = "勝利！") {
    gameOverTitle.innerText = text;
    gameOverTitle.style.background = "linear-gradient(180deg, #00ffaa 0%, #008855 100%)";
    gameOverTitle.style.webkitBackgroundClip = "text";
    gameOverScreen.classList.remove('hidden');
}

// 監聽視窗調整（手機直式／橫式、平板、電腦皆走同一條路徑）
window.addEventListener('resize', () => {
    handleResize();
});

// 裝置方向改變時也重新計算（iOS/Android 會同時觸發 orientationchange）
window.addEventListener('orientationchange', () => {
    // 等瀏覽器完成旋轉再算，否則量到的仍是舊的 viewport
    setTimeout(handleResize, 120);
});

/**
 * 依當下地圖尺寸與視窗大小，重新設定畫布與所有實體座標。
 *
 * 統一處理 resize／orientationchange／換關三種情境，確保：
 *  - 畫布形狀永遠貼合地圖比例（不留空白、不溢出螢幕）
 *  - 格子維持正方形、地圖置中對齊
 *  - 玩家／Bot／怪物／Boss 的像素座標全部重新對齊到新 cellSize
 *    （原本只重算 player 與第一隻怪物，會讓其餘實體與地圖錯位）
 */
function handleResize() {
    renderer.resize(gridSystem);
    if (threeJSBg) threeJSBg.resize(window.innerWidth, window.innerHeight);
    gridSystem.updateCellSize(renderer.getWidth(), renderer.getHeight());
    particleSystem.resize(renderer.getWidth(), renderer.getHeight());
    recalcEntityPositions();
}

// 啟動引擎
handleResize();   // 以 gridSystem 比例設定初始畫布
gameEngine.start();

console.log('Bomber Arena Ultimate - Engine Started');
