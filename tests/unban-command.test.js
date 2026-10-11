const assert = require('node:assert/strict');
const test = require('node:test');
const { handleUnbanCommand } = require('../commands/moderation/unban');

const userId = '12345678901234567';

function setup(overrides = {}) {
    const calls = [];
    const ban = { user: { id: userId, tag: 'Target#1234' } };
    const message = {
        member: { id: 'moderator' },
        author: { id: 'moderator', tag: 'Mod#1234' },
        guild: {
            id: 'guild',
            members: {
                unban: async (...args) => calls.push(['unban', ...args]),
            },
        },
        channel: { id: 'channel' },
    };
    const dependencies = {
        permission: 'ban-members',
        hasModerationPermission: () => true,
        fetchBan: async (id) => { calls.push(['fetch', id]); return ban; },
        replyEmbed: (_message, text, options) => { calls.push(['reply', text, options]); return 'replied'; },
        clearTimedActions: (...args) => calls.push(['clear', ...args]),
        addCase: (...args) => calls.push(['case', ...args]),
        logModAction: (...args) => calls.push(['log', ...args]),
        sendEmbed: (...args) => { calls.push(['send', ...args]); return 'sent'; },
        errorColor: 123,
        logError: (err) => calls.push(['error', err.message]),
        ...overrides,
    };
    return { ban, calls, dependencies, message };
}

test('denies unauthorized members before checking a ban', async () => {
    const { calls, dependencies, message } = setup({ hasModerationPermission: () => false });

    assert.equal(await handleUnbanCommand(message, [userId], '.', dependencies), 'replied');
    assert.match(calls[0][1], /Only staff can unban members/);
    assert.equal(calls.some(([name]) => name === 'fetch'), false);
});

test('requires a valid user ID and an existing ban', async () => {
    const invalid = setup();
    await handleUnbanCommand(invalid.message, ['<@&12345678901234567>'], '.', invalid.dependencies);
    assert.match(invalid.calls[0][1], /Usage: `\.unban/);
    assert.equal(invalid.calls.some(([name]) => name === 'fetch'), false);

    const notBanned = setup({ fetchBan: async () => null });
    await handleUnbanCommand(notBanned.message, [userId], '.', notBanned.dependencies);
    assert.match(notBanned.calls[0][1], /isn't banned/);
});

test('unbans the target and clears any scheduled automatic unban', async () => {
    const { ban, calls, dependencies, message } = setup();

    assert.equal(await handleUnbanCommand(message, [`<@${userId}>`, 'appeal', 'accepted'], '.', dependencies), 'sent');
    assert.deepEqual(calls.map(([name]) => name), ['fetch', 'unban', 'clear', 'case', 'log', 'send']);
    assert.deepEqual(calls[0].slice(1), [userId]);
    assert.deepEqual(calls[1].slice(1), [userId, 'Unbanned by Mod#1234: appeal accepted']);
    assert.deepEqual(calls[2].slice(1), ['guild', userId, 'ban']);
    assert.deepEqual(calls[3][2], { type: 'unban', target: ban.user, moderator: message.author, reason: 'appeal accepted' });
    assert.match(calls[5][2], /Target#1234.*appeal accepted/);
});

test('keeps timed actions and case records unchanged when Discord rejects unban', async () => {
    const { calls, dependencies, message } = setup();
    message.guild.members.unban = async () => { throw new Error('Discord failure'); };

    await handleUnbanCommand(message, [userId], '.', dependencies);

    assert.deepEqual(calls.map(([name]) => name), ['fetch', 'error', 'reply']);
    assert.equal(calls[1][1], 'Discord failure');
    assert.match(calls[2][1], /Failed to unban/);
});
