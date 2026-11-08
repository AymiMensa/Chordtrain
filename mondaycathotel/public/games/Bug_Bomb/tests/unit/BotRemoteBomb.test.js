import { afterEach, describe, expect, it, vi } from 'vitest';
import { Bot } from '../../src/game/ai/Bot.js';

afterEach(() => {
    vi.unstubAllGlobals();
});

function makeBot({ hasRemoteBomb = true, bombTimer = 1, blastCells = new Set() } = {}) {
    const bot = Object.create(Bot.prototype);
    const bomb = {
        player: bot,
        gridX: 2,
        gridY: 2,
        range: 3,
        fireRange: 3,
        isPierce: false,
        shape: 'CROSS',
        timer: bombTimer,
        isExploded: false,
    };

    Object.assign(bot, {
        aiInput: { action: false },
        hasRemoteBomb,
        isDead: false,
        gridX: 1,
        gridY: 1,
        remoteBombActionCooldown: 0,
        bombManager: { bombs: [bomb] },
        getExplosionCells: vi.fn(() => blastCells),
        getEnemies: () => [],
        _teammates: () => [],
    });

    return { bot, bomb };
}

describe('Bot remote-bomb action', () => {
    it('triggers an owned remote bomb when an enemy is in its blast', () => {
        const { bot } = makeBot({ blastCells: new Set(['3,2']) });
        bot.getEnemies = () => [{ gridX: 3, gridY: 2 }];

        bot.updateRemoteBombAction(1 / 60);

        expect(bot.aiInput.action).toBe(true);
    });

    it('detonates a safe remote bomb after its normal fuse has elapsed', () => {
        const { bot } = makeBot({ bombTimer: 0, blastCells: new Set() });

        bot.updateRemoteBombAction(1 / 60);

        expect(bot.aiInput.action).toBe(true);
    });

    it('does not detonate while the bot itself is in the blast', () => {
        const { bot } = makeBot({ blastCells: new Set(['1,1']) });

        bot.updateRemoteBombAction(1 / 60);
        expect(bot.aiInput.action).toBe(false);
    });

    it('does not detonate when a co-op teammate is in the blast', () => {
        const { bot } = makeBot({ blastCells: new Set(['4,2']) });
        vi.stubGlobal('window', { gameMode: 'BOT_BOT_COOP' });
        bot._teammates = () => [{ gridX: 4, gridY: 2, isDead: false }];

        bot.updateRemoteBombAction(1 / 60);
        expect(bot.aiInput.action).toBe(false);
    });

    it('pulses the action input instead of holding it across cooldown frames', () => {
        const { bot } = makeBot({
            bombTimer: 0,
            blastCells: new Set(),
        });

        bot.updateRemoteBombAction(1 / 60);
        expect(bot.aiInput.action).toBe(true);

        bot.updateRemoteBombAction(1 / 60);
        expect(bot.aiInput.action).toBe(false);
    });
});
