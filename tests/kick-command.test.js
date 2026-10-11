const assert = require('node:assert/strict');
const test = require('node:test');
const { handleKickCommand } = require('../commands/moderation/kick');

function setup(overrides = {}) {
    const calls = [];
    const target = {
        id: 'target',
        user: { id: 'target' },
        displayName: 'Target',
        kickable: true,
        kick: async (reason) => calls.push(['kick', reason]),
    };
    const dm = { delete: async () => calls.push(['delete-dm']) };
    const message = {
        member: { id: 'moderator' },
        author: { id: 'moderator' },
        guild: { id: 'guild' },
        channel: { id: 'channel' },
    };
    const dependencies = {
        permission: 'kick-members',
        hasModerationPermission: () => true,
        resolveTargetMember: async (_message, arg) => { calls.push(['resolve', arg]); return target; },
        moderationBlockReason: () => null,
        replyEmbed: (_message, text, options) => { calls.push(['reply', text, options]); return 'replied'; },
        dmPunishment: async (...args) => { calls.push(['dm', ...args]); return dm; },
        addCase: (...args) => calls.push(['case', ...args]),
        logModAction: (...args) => calls.push(['log', ...args]),
        sendEmbed: (...args) => { calls.push(['send', ...args]); return 'sent'; },
        errorColor: 123,
        logError: (err) => calls.push(['error', err.message]),
        ...overrides,
    };
    return { calls, dependencies, dm, message, target };
}

test('denies unauthorized moderators before target lookup', async () => {
    const { calls, dependencies, message } = setup({ hasModerationPermission: () => false });

    assert.equal(await handleKickCommand(message, ['123'], '.', dependencies), 'replied');
    assert.match(calls[0][1], /Only staff can kick members/);
    assert.equal(calls.some(([name]) => name === 'resolve'), false);
});

test('handles missing, protected, and non-kickable targets without creating records', async () => {
    const missing = setup({ resolveTargetMember: async () => null });
    await handleKickCommand(missing.message, [], '.', missing.dependencies);
    assert.match(missing.calls[0][1], /Usage: `\.kick @user/);

    const protectedTarget = setup({ moderationBlockReason: () => 'Protected target.' });
    await handleKickCommand(protectedTarget.message, ['123'], '.', protectedTarget.dependencies);
    assert.equal(protectedTarget.calls[1][1], 'Protected target.');
    assert.equal(protectedTarget.calls.some(([name]) => name === 'dm'), false);

    const unkickable = setup();
    unkickable.target.kickable = false;
    await handleKickCommand(unkickable.message, ['123'], '.', unkickable.dependencies);
    assert.match(unkickable.calls[1][1], /role hierarchy or missing permissions/);
    assert.equal(unkickable.calls.some(([name]) => name === 'dm'), false);
});

test('DMs before kicking and records successful actions', async () => {
    const { calls, dependencies, message, target } = setup();

    await handleKickCommand(message, ['123', 'repeated', 'spam'], '.', dependencies);

    assert.deepEqual(calls.map(([name]) => name), ['resolve', 'dm', 'kick', 'case', 'log', 'send']);
    assert.deepEqual(calls[1].slice(1), [target.user, message.guild, 'kick', { reason: 'repeated spam' }]);
    assert.equal(calls[2][1], 'repeated spam');
    assert.deepEqual(calls[3][2], {
        type: 'kick',
        target: target.user,
        moderator: message.author,
        reason: 'repeated spam',
    });
});

test('removes the pre-kick DM and reports errors when the kick fails', async () => {
    const { calls, dependencies, message, target } = setup();
    target.kick = async () => { throw new Error('Discord failure'); };

    await handleKickCommand(message, ['123'], '.', dependencies);

    assert.deepEqual(calls.map(([name]) => name), ['resolve', 'dm', 'error', 'delete-dm', 'reply']);
    assert.equal(calls[2][1], 'Discord failure');
    assert.match(calls[4][1], /Failed to kick/);
});
