const assert = require('node:assert/strict');
const test = require('node:test');
const { handleMuteCommand } = require('../commands/moderation/mute');

const durationMs = 60_000;

function setup(overrides = {}) {
    const calls = [];
    const message = {
        member: { id: 'moderator' },
        author: { id: 'moderator' },
        guild: { id: 'guild' },
        channel: { id: 'channel' },
    };
    const target = {
        id: 'target',
        user: { id: 'target' },
        displayName: 'Target',
        moderatable: true,
        timeout: async (duration, reason) => calls.push(['timeout', duration, reason]),
    };
    const dependencies = {
        permission: 'moderate-members',
        hasModerationPermission: () => true,
        resolveTargetMember: async (_message, arg) => { calls.push(['resolve', arg]); return target; },
        moderationBlockReason: () => null,
        replyEmbed: (_message, text, options) => { calls.push(['reply', text, options]); return 'replied'; },
        parseDuration: (input) => input === '1m' ? durationMs : 0,
        maxTimeoutMs: 28 * 24 * 60 * 60 * 1000,
        permanentMuteTimeoutMs: 28 * 24 * 60 * 60 * 1000 - 60_000,
        setPermaMute: (...args) => calls.push(['perma', ...args]),
        addCase: (...args) => calls.push(['case', ...args]),
        logModAction: (...args) => calls.push(['log', ...args]),
        dmPunishment: async (...args) => calls.push(['dm', ...args]),
        formatDurationMs: (duration) => `${duration / 1000}s`,
        sendEmbed: (...args) => { calls.push(['send', ...args]); return 'sent'; },
        errorColor: 123,
        logError: (err) => calls.push(['error', err.message]),
        ...overrides,
    };
    return { calls, dependencies, message, target };
}

test('denies unauthorized members before target lookup', async () => {
    const { calls, dependencies, message } = setup({ hasModerationPermission: () => false });

    assert.equal(await handleMuteCommand(message, ['123'], '.', dependencies), 'replied');
    assert.match(calls[0][1], /Only staff can mute members/);
    assert.equal(calls.some(([name]) => name === 'resolve'), false);
});

test('requires a valid target and enforces maximum duration and bot role hierarchy', async () => {
    const missing = setup({ resolveTargetMember: async () => null });
    await handleMuteCommand(missing.message, [], '.', missing.dependencies);
    assert.match(missing.calls[0][1], /Usage: `\.mute @user/);

    const tooLong = setup({ parseDuration: () => 29 * 24 * 60 * 60 * 1000 });
    await handleMuteCommand(tooLong.message, ['123', '29d'], '.', tooLong.dependencies);
    assert.match(tooLong.calls[1][1], /up to 28 days/);
    assert.equal(tooLong.calls.some(([name]) => name === 'timeout'), false);

    const unmanageable = setup();
    unmanageable.target.moderatable = false;
    await handleMuteCommand(unmanageable.message, ['123'], '.', unmanageable.dependencies);
    assert.match(unmanageable.calls[1][1], /role hierarchy or missing permissions/);
});

test('records a permanent mute with its until-unmuted reason and user notice', async () => {
    const { calls, dependencies, message } = setup();

    await handleMuteCommand(message, ['123', 'repeated', 'spam'], '.', dependencies);

    assert.deepEqual(calls.map(([name]) => name), ['resolve', 'timeout', 'perma', 'case', 'log', 'dm', 'send']);
    assert.deepEqual(calls[1].slice(1), [dependencies.permanentMuteTimeoutMs, 'repeated spam']);
    assert.deepEqual(calls[2].slice(1), ['guild', 'target', true]);
    assert.equal(calls[3][2].reason, 'repeated spam (until unmuted)');
    assert.equal(calls[3][2].until, null);
    assert.deepEqual(calls[5].slice(1), [
        { id: 'target' }, message.guild, 'mute',
        { reason: 'repeated spam', note: 'This mute lasts until staff unmute you.' },
    ]);
    assert.match(calls[6][2], /until someone unmutes them/);
});

test('records a timed mute with a finite expiration', async () => {
    const { calls, dependencies, message } = setup();
    const before = Date.now();

    await handleMuteCommand(message, ['123', '1m', 'short', 'mute'], '.', dependencies);

    const after = Date.now();
    assert.deepEqual(calls[1].slice(1), [durationMs, 'short mute']);
    assert.deepEqual(calls[2].slice(1), ['guild', 'target', false]);
    assert.ok(calls[3][2].until >= before + durationMs);
    assert.ok(calls[3][2].until <= after + durationMs);
    assert.ok(calls[5][4].until >= before + durationMs);
    assert.ok(calls[5][4].until <= after + durationMs);
    assert.match(calls[6][2], /for 60s - short mute/);
});

test('does not persist mute state if Discord rejects the timeout', async () => {
    const { calls, dependencies, message, target } = setup();
    target.timeout = async () => { throw new Error('Discord failure'); };

    await handleMuteCommand(message, ['123'], '.', dependencies);

    assert.deepEqual(calls.map(([name]) => name), ['resolve', 'error', 'reply']);
    assert.equal(calls[1][1], 'Discord failure');
    assert.match(calls[2][1], /Failed to mute/);
});
