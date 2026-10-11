const assert = require('node:assert/strict');
const test = require('node:test');
const { handleUnjailCommand } = require('../commands/moderation/unjail');

function setup(overrides = {}) {
    const calls = [];
    const role = { id: 'jail-role', editable: true };
    const target = {
        id: 'target',
        user: { id: 'target' },
        displayName: 'Target',
        roles: {
            cache: new Set(['jail-role']),
            remove: async (removedRole, reason) => calls.push(['remove', removedRole, reason]),
        },
    };
    const message = {
        member: { id: 'moderator' },
        author: { id: 'moderator', tag: 'Mod#1234' },
        guild: { id: 'guild' },
        channel: { id: 'channel' },
    };
    const dependencies = {
        permission: 'manage-roles',
        hasModerationPermission: () => true,
        resolveTargetMember: async (_message, arg) => { calls.push(['resolve', arg]); return target; },
        moderationBlockReason: () => null,
        replyEmbed: (_message, text, options) => { calls.push(['reply', text, options]); return 'replied'; },
        getJailRole: () => role,
        clearTimedActions: (...args) => calls.push(['clear', ...args]),
        logModAction: (...args) => calls.push(['log', ...args]),
        addCase: (...args) => calls.push(['case', ...args]),
        dmPunishment: async (...args) => calls.push(['dm', ...args]),
        sendEmbed: (...args) => { calls.push(['send', ...args]); return 'sent'; },
        errorColor: 123,
        logError: (err) => calls.push(['error', err.message]),
        ...overrides,
    };
    return { calls, dependencies, message, role, target };
}

test('denies unauthorized members before looking up targets', async () => {
    const { calls, dependencies, message } = setup({ hasModerationPermission: () => false });

    assert.equal(await handleUnjailCommand(message, ['123'], '.', dependencies), 'replied');
    assert.match(calls[0][1], /Only staff can unjail members/);
    assert.equal(calls.some(([name]) => name === 'resolve'), false);
});

test('handles missing targets, missing jail roles, unjailed targets, and uneditable roles', async () => {
    const missingTarget = setup({ resolveTargetMember: async () => null });
    await handleUnjailCommand(missingTarget.message, [], '.', missingTarget.dependencies);
    assert.match(missingTarget.calls[0][1], /Usage: `\.unjail @user/);

    const missingRole = setup({ getJailRole: () => null });
    await handleUnjailCommand(missingRole.message, ['123'], '.', missingRole.dependencies);
    assert.match(missingRole.calls[1][1], /isn't jailed/);

    const notJailed = setup();
    notJailed.target.roles.cache.clear();
    await handleUnjailCommand(notJailed.message, ['123'], '.', notJailed.dependencies);
    assert.match(notJailed.calls[1][1], /isn't jailed/);

    const uneditable = setup();
    uneditable.role.editable = false;
    await handleUnjailCommand(uneditable.message, ['123'], '.', uneditable.dependencies);
    assert.match(uneditable.calls[1][1], /drag my role above it/);
});

test('removes the jail role and clears timed actions before recording and notifying', async () => {
    const { calls, dependencies, message, role, target } = setup();

    assert.equal(await handleUnjailCommand(message, ['123'], '.', dependencies), undefined);
    assert.deepEqual(calls.map(([name]) => name), ['resolve', 'remove', 'clear', 'log', 'case', 'dm', 'send']);
    assert.deepEqual(calls[1].slice(1), [role, 'Unjailed by Mod#1234']);
    assert.deepEqual(calls[2].slice(1), ['guild', 'target', 'jail']);
    assert.deepEqual(calls[3][1], {
        guildId: 'guild',
        moderator: message.author,
        target: target.user,
        action: 'unjail',
        reason: 'Manual unjail',
    });
    assert.deepEqual(calls[4][2], {
        type: 'unjail',
        target: target.user,
        moderator: message.author,
        reason: 'Released from jail by staff',
    });
});

test('leaves timed actions intact and reports a failed role removal', async () => {
    const { calls, dependencies, message, target } = setup();
    target.roles.remove = async () => { throw new Error('Discord failure'); };

    await handleUnjailCommand(message, ['123'], '.', dependencies);

    assert.deepEqual(calls.map(([name]) => name), ['resolve', 'error', 'reply']);
    assert.equal(calls[1][1], 'Discord failure');
    assert.match(calls[2][1], /Failed to unjail/);
});
