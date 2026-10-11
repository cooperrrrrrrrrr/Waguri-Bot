const assert = require('node:assert/strict');
const test = require('node:test');
const { handleTimeoutCommand } = require('../commands/moderation/timeout');

const durationMs = 2 * 60 * 60 * 1000;

function setup(overrides = {}) {
    const calls = [];
    const target = {
        id: '12345678901234567',
        user: { id: '12345678901234567', tag: 'Target#1234' },
        displayName: 'Target',
        moderatable: true,
    };
    const message = {
        member: { id: 'moderator' },
        author: { id: 'moderator', tag: 'Mod#1234' },
        guild: { id: 'guild' },
        channel: { id: 'channel' },
    };
    const dependencies = {
        permission: 'moderate-members',
        hasModerationPermission: () => true,
        resolveTargetMember: async (_message, arg) => { calls.push(['resolve', arg]); return target; },
        moderationBlockReason: () => null,
        parseDuration: (input) => input === '2h' ? durationMs : 0,
        maxTimeoutMinutes: 28 * 24 * 60,
        replyEmbed: (_message, text, options) => { calls.push(['reply', text, options]); return 'replied'; },
        targetTimeout: async (...args) => calls.push(['timeout', ...args]),
        setPermaMute: (...args) => calls.push(['perma', ...args]),
        addCase: (...args) => calls.push(['case', ...args]),
        logModAction: (...args) => calls.push(['log', ...args]),
        dmPunishment: async (...args) => calls.push(['dm', ...args]),
        formatDurationMs: (duration) => `${duration / 3600000}h`,
        sendEmbed: (...args) => { calls.push(['send', ...args]); return 'sent'; },
        errorColor: 123,
        logError: (err) => calls.push(['error', err.message]),
        ...overrides,
    };
    return { calls, dependencies, message, target };
}

test('denies unauthorized moderators before target lookup', async () => {
    const { calls, dependencies, message } = setup({ hasModerationPermission: () => false });
    assert.equal(await handleTimeoutCommand(message, [], '.', dependencies), 'replied');
    assert.match(calls[0][1], /Only staff can timeout/);
    assert.equal(calls.some(([name]) => name === 'resolve'), false);
});

test('requires a target and duration, enforces the Discord maximum, and checks hierarchy', async () => {
    const missing = setup({ resolveTargetMember: async () => null });
    await handleTimeoutCommand(missing.message, [], '.', missing.dependencies);
    assert.match(missing.calls[0][1], /Usage: `\.timeout/);

    const overLimit = setup({ parseDuration: () => 28 * 24 * 60 * 60 * 1000 + 1 });
    await handleTimeoutCommand(overLimit.message, ['123', 'long'], '.', overLimit.dependencies);
    assert.match(overLimit.calls[1][1], /up to 28 days/);

    const protectedTarget = setup({ moderationBlockReason: () => 'Protected target.' });
    await handleTimeoutCommand(protectedTarget.message, ['123', '2h'], '.', protectedTarget.dependencies);
    assert.equal(protectedTarget.calls[1][1], 'Protected target.');

    const notModeratable = setup();
    notModeratable.target.moderatable = false;
    await handleTimeoutCommand(notModeratable.message, ['123', '2h'], '.', notModeratable.dependencies);
    assert.match(notModeratable.calls[1][1], /role hierarchy or missing permissions/);
});

test('accepts the exact 28-day maximum timeout', async () => {
    const maximum = 28 * 24 * 60 * 60 * 1000;
    const { calls, dependencies, message, target } = setup({
        parseDuration: () => maximum,
    });

    assert.equal(await handleTimeoutCommand(message, ['123', '28d'], '.', dependencies), 'sent');
    assert.deepEqual(calls[1].slice(1), [target, maximum, 'No reason provided']);
    assert.equal(calls.some(([name]) => name === 'case'), true);
});

test('applies timeout before clearing permanent-mute state and recording the action', async () => {
    const { calls, dependencies, message, target } = setup();
    assert.equal(await handleTimeoutCommand(message, ['123', '2h', 'spam'], '.', dependencies), 'sent');

    assert.deepEqual(calls.map(([name]) => name), ['resolve', 'timeout', 'perma', 'case', 'log', 'dm', 'send']);
    assert.deepEqual(calls[1].slice(1), [target, durationMs, 'spam']);
    assert.deepEqual(calls[2].slice(1), ['guild', target.id, false]);
    assert.equal(calls[3][2].type, 'timeout');
    assert.equal(calls[3][2].reason, 'spam');
    assert.ok(Math.abs(calls[3][2].until - calls[5][4].until) < 100);
    assert.match(calls[6][2], /Timed out \*\*Target\*\* for 2h - spam/);
});

test('does not clear mute state or record an action when Discord rejects timeout', async () => {
    const { calls, dependencies, message } = setup({
        targetTimeout: async () => { throw new Error('Discord failure'); },
    });
    assert.equal(await handleTimeoutCommand(message, ['123', '2h'], '.', dependencies), 'replied');
    assert.deepEqual(calls.map(([name]) => name), ['resolve', 'error', 'reply']);
    assert.equal(calls[1][1], 'Discord failure');
    assert.match(calls[2][1], /Failed to timeout/);
});

test('preserves current behavior when timeout succeeds but the notification fails', async () => {
    const { calls, dependencies, message } = setup({
        dmPunishment: async () => { throw new Error('DMs closed'); },
    });
    assert.equal(await handleTimeoutCommand(message, ['123', '2h'], '.', dependencies), 'replied');
    assert.deepEqual(calls.map(([name]) => name), ['resolve', 'timeout', 'perma', 'case', 'log', 'error', 'reply']);
    assert.match(calls[6][1], /Failed to timeout/);
});
