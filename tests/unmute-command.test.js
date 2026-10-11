const assert = require('node:assert/strict');
const test = require('node:test');
const { handleUnmuteCommand } = require('../commands/moderation/unmute');

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
        isCommunicationDisabled: () => true,
        timeout: async (duration) => calls.push(['timeout', duration]),
    };
    const dependencies = {
        permission: 'moderate-members',
        hasModerationPermission: () => true,
        resolveTargetMember: async (_message, arg) => { calls.push(['resolve', arg]); return target; },
        moderationBlockReason: () => null,
        replyEmbed: (_message, text, options) => { calls.push(['reply', text, options]); return 'replied'; },
        setPermaMute: (...args) => calls.push(['perma', ...args]),
        logModAction: (...args) => calls.push(['log', ...args]),
        addCase: (...args) => calls.push(['case', ...args]),
        dmPunishment: async (...args) => calls.push(['dm', ...args]),
        sendEmbed: (...args) => { calls.push(['send', ...args]); return 'sent'; },
        errorColor: 123,
        logError: (err) => calls.push(['error', err.message]),
        ...overrides,
    };
    return { calls, dependencies, message, target };
}

test('denies unauthorized members before resolving the target', async () => {
    const { calls, dependencies, message } = setup({ hasModerationPermission: () => false });

    assert.equal(await handleUnmuteCommand(message, ['123'], '.', dependencies), 'replied');
    assert.match(calls[0][1], /Only staff can unmute members/);
    assert.equal(calls.some(([name]) => name === 'resolve'), false);
});

test('handles missing, protected, non-moderatable, and already-unmuted targets', async () => {
    const missing = setup({ resolveTargetMember: async () => null });
    await handleUnmuteCommand(missing.message, [], '.', missing.dependencies);
    assert.match(missing.calls[0][1], /Usage: `\.unmute @user/);

    const blocked = setup({ moderationBlockReason: () => 'Protected target.' });
    await handleUnmuteCommand(blocked.message, ['123'], '.', blocked.dependencies);
    assert.equal(blocked.calls[1][1], 'Protected target.');

    const unmanageable = setup();
    unmanageable.target.moderatable = false;
    await handleUnmuteCommand(unmanageable.message, ['123'], '.', unmanageable.dependencies);
    assert.match(unmanageable.calls[1][1], /role hierarchy or missing permissions/);

    const alreadyUnmuted = setup();
    alreadyUnmuted.target.isCommunicationDisabled = () => false;
    await handleUnmuteCommand(alreadyUnmuted.message, ['123'], '.', alreadyUnmuted.dependencies);
    assert.deepEqual(alreadyUnmuted.calls.map(([name]) => name), ['resolve', 'perma', 'reply']);
    assert.deepEqual(alreadyUnmuted.calls[1].slice(1), ['guild', 'target', false]);
});

test('clears the timeout and records, logs, and notifies a successful unmute', async () => {
    const { calls, dependencies, message, target } = setup();

    assert.equal(await handleUnmuteCommand(message, ['123'], '.', dependencies), undefined);
    assert.deepEqual(calls.map(([name]) => name), ['resolve', 'timeout', 'perma', 'log', 'case', 'dm', 'send']);
    assert.equal(calls[1][1], null);
    assert.deepEqual(calls[3][1], {
        guildId: 'guild',
        moderator: message.author,
        target: target.user,
        action: 'unmute',
        reason: 'Manual unmute',
    });
    assert.deepEqual(calls[4][2], {
        type: 'unmute',
        target: target.user,
        moderator: message.author,
        reason: 'Mute lifted by staff',
    });
});

test('reports Discord failures without clearing persisted mute state', async () => {
    const { calls, dependencies, message, target } = setup();
    target.timeout = async () => { throw new Error('Discord failure'); };

    await handleUnmuteCommand(message, ['123'], '.', dependencies);

    assert.deepEqual(calls.map(([name]) => name), ['resolve', 'error', 'reply']);
    assert.equal(calls[1][1], 'Discord failure');
    assert.match(calls[2][1], /Failed to unmute/);
});
