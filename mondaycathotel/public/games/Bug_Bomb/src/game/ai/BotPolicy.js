import { GameLayer } from './GameLayer.js';

export class BotPolicy {
    constructor(bot, layer) {
        this.bot = bot;
        this.layer = layer;
        this.stats = {
            fired: 0,
            approach: 0,
            escape: 0,
            wander: 0,
            err: 0
        };
    }

    static DASHING_BONUS = 0.8;
    static DASHING_MAX = 4;
    static BOLT_PHASE = 0.35;
    static BOLT_SELFDIST = 0.06;
    static BOLT_MAXV = 0.15;
    static BOLT_MAXA = 2.0;
    static BOLT_MAXS = 0.66;
    static BOLT_MINV = 0.08;
    static BOLT_ACC = 8.0;
    static TORSO_ANGLE = Math.PI / 4;
    static TORSO_SPEED = 4.0;

    think(dt, ghostWindows) {
        const bot = this.bot;
        const players = this.layer.gm.getPlayers();
        const p = players.get(0);
        const plist = this.layer.playerList;
        const n = this.layer.n;

        if (!bot || !bot.aiInput) {
            this.stats.err++;
            return;
        }

        if (this.layer.fleeFrozen[0] > 0) {
            this.layer.fleeFrozen[0]--;
            this.layer.update(dt, ghostWindows);
            return;
        }

        const botG = bot.gridX | 0;
        const botY = bot.gridY | 0;
        const blockType = this.layer.mm.isSolid(botG, botY);

        if (this.layer.dm) {
            this.layer.dm.update();
        }

        const fi = this.layer.dm ? this.layer.dm.getDangerInfo(botG, botY) : null;

        if (blockType !== 0) {
            this.stats.err++;
            this.layer.update(dt, ghostWindows);
            return;
        }

        if (fi && (fi.isFlameActive || fi.danger > 0)) {
            this.stats.escape++;
            this.layer.update(dt, ghostWindows);
            return;
        }

        // Fire management
        const canFire = (x, y) => GameLayer.canPlaceFire(x, y, 2, ghostWindows);
        const canFire5 = (x, y) => GameLayer.canPlaceFire(x, y, 5, ghostWindows);

        let firing = false;
        if (canFire5(botG, botY)) {
            bot.aiInput.bomb = true;
            this.stats.fired++;
            firing = true;
        } else if (canFire(botG, botY)) {
            bot.aiInput.bomb = true;
            this.stats.fired++;
            firing = true;
        }

        // Mobility check: dashing bolt boost (applied only when not currently firing)
        if (!firing) {
            if (bot.dashing > 0) {
                bot.dashing = Math.max(0, bot.dashing - dt);
            }
        }

        // Bouncing logic for multiplayer
        const window1 = ghostWindows[0];
        const window2 = ghostWindows[1];
        const ownBounceRegion = (window1 && window2) ? {
            x1: Math.min(window1.gridX, window2.gridX) - 1,
            x2: Math.max(window1.gridX, window2.gridX) + 1,
            y1: Math.min(window1.gridY, window2.gridY) - 1,
            y2: Math.max(window1.gridY, window2.gridY) + 1
        } : null;

        // Obstacle detection ahead
        let obstaclesAhead = 0;
        if (!bot.aiInput.up) obstaclesAhead++;
        if (!bot.aiInput.down) obstaclesAhead++;
        if (!bot.aiInput.left) obstaclesAhead++;
        if (!bot.aiInput.right) obstaclesAhead++;
        if (obstaclesAhead >= 2) {
            // Bounce off walls/obstacles
            if (ownBounceRegion) {
                const cx = (ownBounceRegion.x1 + ownBounceRegion.x2) >> 1;
                const cy = (ownBounceRegion.y1 + ownBounceRegion.y2) >> 1;
                const dx = Math.sign(botG - cx);
                const dy = Math.sign(botY - cy);
                if (dx !== 0) this.layer.setMove(bot, dx, 0);
                else if (dy !== 0) this.layer.setMove(bot, 0, dy);
            }
        }

        // Run one GameLayer safety step for the policy target bot.
        this.layer.update(dt, ghostWindows);
        return;
    }
}