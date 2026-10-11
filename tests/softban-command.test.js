const assert = require('node:assert/strict');
const test = require('node:test');
const { handleSoftbanCommand } = require('../commands/moderation/softban');

function setup(overrides = {}) {
    const calls = [];
    const target = {
        id: '12345678901234567',
        user: { id: '12345678901234567', tag: 'Target#1234' },
        displayName: 'Target',
        bannable: true,
    };
    const message = {
        member: { id: 'moderator' },
        author: { id: 'moderator' },
        guild: { id: 'guild' },
        channel: { id: 'channel' },
    };
    const dm = { delete: async () => calls.push(['delete-dm']) };
    const dependencies = {
        permission: 'ban-members',
        hasModerationPermission: () => true,
        resolveTargetMember: async (_message, arg) => { calls.push(['resolve', arg]); return target; },
        moderationBlockReason: () => null,
        replyEmbed: (_message, text, options) => { calls.push(['reply', text, options]); return 'replied'; },
        dmPunishment: async (...args) => { calls.push(['dm', ...args]); return dm; },
        banMember: async (...args) => calls.push(['ban', ...args]),
        unbanMember: async (...args) => calls.push(['unban', ...args]),
        addCase: (...args) => calls.push(['case', ...args]),
        logModAction: (...args) => calls.push(['log', ...args]),
        sendEmbed: (...args) => { calls.push(['send', ...args]); return 'sent'; },
        errorColor: 123,
        logError: (err) => calls.push(['error', err.message]),
        ...overrides,
    };
    return { calls, dependencies, dm, message, target };
}

test('denies unauthorized members before target lookup', async () => {
    const { calls, dependencies, message } = setup({ hasModerationPermission: () => false });

    assert.equal(await handleSoftbanCommand(message, ['123'], '.', dependencies), 'replied');
    assert.match(calls[0][1], /Only staff can softban members/);
    assert.equal(calls.some(([name]) => name === 'resolve'), false);
});

test('handles missing, protected, and non-bannable targets before sending a DM', async () => {
    const missing = setup({ resolveTargetMember: async () => null });
    await handleSoftbanCommand(missing.message, [], '.', missing.dependencies);
    assert.match(missing.calls[0][1], /Usage: `\.softban @user/);

    const protectedTarget = setup({ moderationBlockReason: () => 'Protected target.' });
    await handleSoftbanCommand(protectedTarget.message, ['123'], '.', protectedTarget.dependencies);
    assert.equal(protectedTarget.calls[1][1], 'Protected target.');
    assert.equal(protectedTarget.calls.some(([name]) => name === 'dm'), false);

    const unbannable = setup();
    unbannable.target.bannable = false;
    await handleSoftbanCommand(unbannable.message, ['123'], '.', unbannable.dependencies);
    assert.match(unbannable.calls[1][1], /role hierarchy or missing permissions/);
    assert.equal(unbannable.calls.some(([name]) => name === 'dm'), false);
});

test('deletes a pre-ban DM if the first ban step fails', async () => {
    const { calls, dependencies, message } = setup({
        banMember: async () => { throw new Error('Ban failed'); },
    });

    await handleSoftbanCommand(message, ['123', 'reason'], '.', dependencies);

    assert.deepEqual(calls.map(([name]) => name), ['resolve', 'dm', 'error', 'delete-dm', 'reply']);
    assert.match(calls[4][1], /Failed to softban/);
});

test('reports when cleanup unban fails instead of claiming the softban completed', async () => {
    const { calls, dependencies, message } = setup({
        unbanMember: async () => { throw new Error('Cleanup failed'); },
    });

    await handleSoftbanCommand(message, ['123'], '.', dependencies);

    assert.deepEqual(calls.map(([name]) => name), ['resolve', 'dm', 'ban', 'error', 'reply']);
    assert.match(calls[4][1], /couldn't unban them afterwards/);
    assert.equal(calls.some(([name]) => name === 'case' || name === 'log'), false);
});

test('cleans up a successful softban and only then records the action', async () => {
    const { calls, dependencies, message, target } = setup();

    await handleSoftbanCommand(message, ['123', 'repeat', 'spam'], '.', dependencies);

    assert.deepEqual(calls.map(([name]) => name), ['resolve', 'dm', 'ban', 'unban', 'case', 'log', 'send']);
    assert.deepEqual(calls[2].slice(1), [target.id, { reason: 'repeat spam', deleteMessageSeconds: 86400 }]);
    assert.deepEqual(calls[3].slice(1), [target.id, 'Softban cleanup']);
    assert.deepEqual(calls[4][2], {
        type: 'softban',
        target: target.user,
        moderator: message.author,
        reason: 'repeat spam',
    });
});
