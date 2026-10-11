const assert = require('node:assert/strict');
const test = require('node:test');
const { handleTempbanCommand } = require('../commands/moderation/tempban');

const durationMs = 3 * 24 * 60 * 60 * 1000;

function setup(overrides = {}) {
    const calls = [];
    const target = {
        id: '12345678901234567',
        user: { id: '12345678901234567', tag: 'Target#1234' },
        bannable: true,
    };
    const message = {
        member: { id: 'moderator' },
        author: { id: 'moderator', tag: 'Mod#1234' },
        guild: { id: 'guild' },
        channel: { id: 'channel' },
    };
    const dependencies = {
        permission: 'ban-members',
        hasModerationPermission: () => true,
        resolveTargetMember: async (_message, arg) => { calls.push(['resolve', arg]); return target; },
        moderationBlockReason: () => null,
        replyEmbed: (_message, text, options) => { calls.push(['reply', text, options]); return 'replied'; },
        parseDuration: (input) => input === '3d' ? durationMs : 0,
        dmPunishment: async (...args) => { calls.push(['dm', ...args]); },
        banMember: async (...args) => calls.push(['ban', ...args]),
        clearTimedActions: (...args) => calls.push(['clear', ...args]),
        scheduleTimedAction: (action) => calls.push(['schedule', action]),
        addCase: (...args) => calls.push(['case', ...args]),
        logModAction: (...args) => calls.push(['log', ...args]),
        formatDurationMs: (duration) => `${duration / 86400000}d`,
        sendEmbed: (...args) => { calls.push(['send', ...args]); return 'sent'; },
        errorColor: 123,
        logError: (err) => calls.push(['error', err.message]),
        ...overrides,
    };
    return { calls, dependencies, message, target };
}

test('denies unauthorized members before target lookup', async () => {
    const { calls, dependencies, message } = setup({ hasModerationPermission: () => false });

    assert.equal(await handleTempbanCommand(message, ['123'], '.', dependencies), 'replied');
    assert.match(calls[0][1], /Only staff can ban members/);
    assert.equal(calls.some(([name]) => name === 'resolve'), false);
});

test('requires a resolvable target and valid duration and checks ban permissions', async () => {
    const missing = setup({ resolveTargetMember: async () => null });
    await handleTempbanCommand(missing.message, [], '.', missing.dependencies);
    assert.match(missing.calls[0][1], /Usage: `\.tempban/);

    const noDuration = setup({ parseDuration: () => 0 });
    await handleTempbanCommand(noDuration.message, ['123', 'invalid'], '.', noDuration.dependencies);
    assert.match(noDuration.calls[1][1], /Usage: `\.tempban/);

    const protectedTarget = setup({ moderationBlockReason: () => 'Protected target.' });
    await handleTempbanCommand(protectedTarget.message, ['123', '3d'], '.', protectedTarget.dependencies);
    assert.equal(protectedTarget.calls[1][1], 'Protected target.');

    const notBannable = setup();
    notBannable.target.bannable = false;
    await handleTempbanCommand(notBannable.message, ['123', '3d'], '.', notBannable.dependencies);
    assert.match(notBannable.calls[1][1], /role hierarchy or missing permissions/);
});

test('notifies, bans, replaces old timers, then records the new timed ban', async () => {
    const { calls, dependencies, message, target } = setup();
    const before = Date.now();

    assert.equal(await handleTempbanCommand(message, ['123', '3d', 'raiding'], '.', dependencies), 'sent');

    const after = Date.now();
    assert.deepEqual(calls.map(([name]) => name), ['resolve', 'dm', 'ban', 'clear', 'schedule', 'case', 'log', 'send']);
    assert.deepEqual(calls[1].slice(1, 4), [
        target.user,
        message.guild,
        'ban',
    ]);
    assert.equal(calls[1][4].reason, 'raiding');
    assert.ok(calls[1][4].note.includes('<t:'));
    assert.deepEqual(calls[2].slice(1), [target.id, { reason: 'Temp-ban by Mod#1234 (3d): raiding' }]);
    assert.deepEqual(calls[3].slice(1), ['guild', target.id, 'ban']);
    assert.equal(calls[4][1].type, 'ban');
    assert.equal(calls[4][1].until, calls[5][2].until);
    assert.ok(calls[4][1].until >= before + durationMs);
    assert.ok(calls[4][1].until <= after + durationMs);
});

test('continues if notification fails but does not schedule or record a failed ban', async () => {
    const notificationFailure = setup({ dmPunishment: async () => { throw new Error('DMs closed'); } });
    await handleTempbanCommand(notificationFailure.message, ['123', '3d'], '.', notificationFailure.dependencies);
    assert.equal(notificationFailure.calls.some(([name]) => name === 'schedule'), true);

    const banFailure = setup({ banMember: async () => { throw new Error('Discord failure'); } });
    await handleTempbanCommand(banFailure.message, ['123', '3d'], '.', banFailure.dependencies);
    assert.deepEqual(banFailure.calls.map(([name]) => name), ['resolve', 'dm', 'error', 'reply']);
    assert.equal(banFailure.calls[2][1], 'Discord failure');
    assert.match(banFailure.calls[3][1], /Failed to ban/);
});
