const assert = require('node:assert/strict');
const test = require('node:test');
const { parsePrefixCommand } = require('../commands/prefix');
const { getModerationRoute } = require('../commands/moderation/dispatch');
const { handleTempbanCommand } = require('../commands/moderation/tempban');
const { handleTimeoutCommand } = require('../commands/moderation/timeout');

function setup() {
    const calls = [];
    const target = {
        id: '12345678901234567',
        user: { id: '12345678901234567', tag: 'Target#1234' },
        displayName: 'Target',
        bannable: true,
        moderatable: true,
    };
    const message = {
        member: { id: 'moderator' },
        author: { id: 'moderator', tag: 'Mod#1234' },
        guild: { id: 'guild', members: { ban: async (...args) => calls.push(['ban', ...args]) } },
        channel: { id: 'channel' },
    };
    const baseDependencies = {
        hasModerationPermission: () => true,
        resolveTargetMember: async (_message, userId) => {
            calls.push(['resolve', userId]);
            return target;
        },
        moderationBlockReason: () => null,
        replyEmbed: (_message, content) => calls.push(['reply', content]),
        parseDuration: (value) => ({ '3d': 3 * 86_400_000, '2h': 7_200_000 })[value] ?? 0,
        dmPunishment: async (...args) => calls.push(['dm', ...args]),
        clearTimedActions: (...args) => calls.push(['clear', ...args]),
        scheduleTimedAction: (...args) => calls.push(['schedule', ...args]),
        addCase: (...args) => calls.push(['case', ...args]),
        logModAction: (...args) => calls.push(['log', ...args]),
        formatDurationMs: (duration) => `${duration / 1000}s`,
        sendEmbed: (...args) => calls.push(['send', ...args]),
        targetTimeout: async (...args) => calls.push(['timeout', ...args]),
        setPermaMute: (...args) => calls.push(['perma', ...args]),
        permission: 'moderate',
        maxTimeoutMinutes: 28 * 24 * 60,
        errorColor: 1,
        logError: (error) => calls.push(['error', error.message]),
    };
    return { calls, target, message, baseDependencies };
}

test('parsed tempban command routes to the production handler and preserves reason/action order', async () => {
    const { calls, target, message, baseDependencies } = setup();
    const parsed = parsePrefixCommand('.tempban 12345678901234567 3d repeated spam', '.');
    const route = getModerationRoute(parsed.commandName, {
        tempban: () => handleTempbanCommand(message, parsed.args, '.', {
            ...baseDependencies,
            permission: 'ban',
            banMember: (userId, options) => message.guild.members.ban(userId, options),
        }),
    });

    assert.equal(typeof route, 'function');
    await route();
    assert.deepEqual(calls.map(([name]) => name), ['resolve', 'dm', 'ban', 'clear', 'schedule', 'case', 'log', 'send']);
    assert.equal(calls[0][1], '12345678901234567');
    assert.equal(calls[2][1], target.id);
    assert.match(calls[2][2].reason, /repeated spam/);
    assert.equal(calls[4][1].type, 'ban');
});

test('parsed timeout command selects the timeout handler without invoking other moderation routes', async () => {
    const { calls, target, message, baseDependencies } = setup();
    const parsed = parsePrefixCommand('.timeout 12345678901234567 2h flood', '.');
    const route = getModerationRoute(parsed.commandName, {
        tempban: () => assert.fail('tempban route should not run'),
        timeout: () => handleTimeoutCommand(message, parsed.args, '.', baseDependencies),
    });

    await route();
    assert.deepEqual(calls.map(([name]) => name), ['resolve', 'timeout', 'perma', 'case', 'log', 'dm', 'send']);
    assert.deepEqual(calls[1].slice(1), [target, 7_200_000, 'flood']);
});

test('unknown command names do not select a moderation route', () => {
    assert.equal(getModerationRoute('purge', { tempban: () => {} }), null);
    assert.equal(getModerationRoute('constructor', { tempban: () => {} }), null);
    assert.equal(getModerationRoute('__proto__', { tempban: () => {} }), null);
});
