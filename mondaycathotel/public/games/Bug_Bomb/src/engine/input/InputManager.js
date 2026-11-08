export class InputManager {
    constructor() {
        this.keys = {};
        this.touchState = {
            up: false, down: false, left: false, right: false, bomb: false, action: false
        };
        
        // 預設按鍵
        this.keyBindings = {
            0: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', bomb: 'KeyJ', action: 'KeyK' },
            1: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', bomb: 'Numpad1', action: 'Numpad2' }
        };
        
        // 載入自訂按鍵
        const saved = localStorage.getItem('bomber_controls');
        if (saved) {
            try {
                this.keyBindings = JSON.parse(saved);
            } catch (e) { console.error('Failed to parse saved controls'); }
        }

        // 紀錄各玩家的輸入狀態
        this.players = [
            { up: false, down: false, left: false, right: false, bomb: false, action: false, actionJustPressed: false }, // Player 1
            { up: false, down: false, left: false, right: false, bomb: false, action: false, actionJustPressed: false }  // Player 2
        ];

        // 手把支援
        this.gamepads = [];
    }

    init() {
        // 鍵盤事件
        window.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
            this.keys[e.key] = true; // 雙重保險
            // Prevent ESC key default behavior to avoid browser interference
            if (e.key === 'Escape' || e.code === 'Escape') {
                e.preventDefault();
            }
            // 攔截空白鍵，避免觸發聚焦按鈕的 click（導致遊戲意外重新開始）
            if (e.code === 'Space' || e.key === ' ') {
                e.preventDefault();
            }
        });

        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
            this.keys[e.key] = false;
        });

        // Gamepad API
        window.addEventListener("gamepadconnected", (e) => {
            console.log("Gamepad connected at index %d: %s. %d buttons, %d axes.",
                e.gamepad.index, e.gamepad.id,
                e.gamepad.buttons.length, e.gamepad.axes.length);
        });

        // 觸控虛擬搖桿 DOM 事件綁定 (若存在)
        this.bindTouchControls();
    }

    bindTouchControls() {
        const dpadUp = document.getElementById('btn-up');
        const dpadDown = document.getElementById('btn-down');
        const dpadLeft = document.getElementById('btn-left');
        const dpadRight = document.getElementById('btn-right');
        const btnBomb = document.getElementById('btn-bomb');
        const btnAction = document.getElementById('btn-action');

        const bindTouch = (elem, action) => {
            if (!elem) return;
            elem.addEventListener('touchstart', (e) => { e.preventDefault(); this.touchState[action] = true; });
            elem.addEventListener('touchend', (e) => { e.preventDefault(); this.touchState[action] = false; });
            elem.addEventListener('mousedown', (e) => { this.touchState[action] = true; });
            elem.addEventListener('mouseup', (e) => { this.touchState[action] = false; });
            elem.addEventListener('mouseleave', (e) => { this.touchState[action] = false; });
        };

        bindTouch(dpadUp, 'up');
        bindTouch(dpadDown, 'down');
        bindTouch(dpadLeft, 'left');
        bindTouch(dpadRight, 'right');
        bindTouch(btnBomb, 'bomb');
        bindTouch(btnAction, 'action');
    }

    update() {
        // 更新 Gamepad 狀態
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];

        // 統整 Player 1 狀態 (Keyboard + Touch + Gamepad 0)
        let gp0 = gamepads[0];
        let p1 = this.players[0];
        let kb0 = this.keyBindings[0];
        p1.up = this.keys[kb0.up] || this.touchState.up || (gp0 && (gp0.buttons[12]?.pressed || gp0.axes[1] < -0.5));
        p1.down = this.keys[kb0.down] || this.touchState.down || (gp0 && (gp0.buttons[13]?.pressed || gp0.axes[1] > 0.5));
        p1.left = this.keys[kb0.left] || this.touchState.left || (gp0 && (gp0.buttons[14]?.pressed || gp0.axes[0] < -0.5));
        p1.right = this.keys[kb0.right] || this.touchState.right || (gp0 && (gp0.buttons[15]?.pressed || gp0.axes[0] > 0.5));
        p1.bomb = this.keys[kb0.bomb] || this.touchState.bomb || (gp0 && (gp0.buttons[0]?.pressed || gp0.buttons[2]?.pressed));
        
        const newP1Action = this.keys[kb0.action] || this.touchState.action || (gp0 && (gp0.buttons[1]?.pressed || gp0.buttons[3]?.pressed));
        p1.actionJustPressed = newP1Action && !p1.action;
        p1.action = newP1Action;

        // 統整 Player 2 狀態 (Keyboard + Gamepad 1)
        let gp1 = gamepads[1];
        let p2 = this.players[1];
        let kb1 = this.keyBindings[1];
        p2.up = this.keys[kb1.up] || (gp1 && (gp1.buttons[12]?.pressed || gp1.axes[1] < -0.5));
        p2.down = this.keys[kb1.down] || (gp1 && (gp1.buttons[13]?.pressed || gp1.axes[1] > 0.5));
        p2.left = this.keys[kb1.left] || (gp1 && (gp1.buttons[14]?.pressed || gp1.axes[0] < -0.5));
        p2.right = this.keys[kb1.right] || (gp1 && (gp1.buttons[15]?.pressed || gp1.axes[0] > 0.5));
        p2.bomb = this.keys[kb1.bomb] || (gp1 && (gp1.buttons[0]?.pressed || gp1.buttons[2]?.pressed));

        const newP2Action = this.keys[kb1.action] || (gp1 && (gp1.buttons[1]?.pressed || gp1.buttons[3]?.pressed));
        p2.actionJustPressed = newP2Action && !p2.action;
        p2.action = newP2Action;
    }

    isActionPressed(playerIndex, action) {
        if (playerIndex < 0 || playerIndex > 1) return false;
        return this.players[playerIndex][action];
    }
}
