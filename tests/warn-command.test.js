const assert = require('node:assert/strict');
const test = require('node:test');
const { handleWarnCommand } = require('../commands/moderation/warn');

function setup(overrides = {}) {
    const calls = [];
    const message = {
        member: { id: 'moderator' },
        author: { id: 'moderator' },
        guild: { id: 'guild' },
        channel: { id: 'channel' },
    };
    const target = { id: 'target', user: { id: 'target' }, displayName: 'Target' };
    const dependencies = {
        permission: 'moderate-members',
        hasModerationPermission: () => true,
        resolveTargetMember: async (_message, arg) => { calls.push(['resolve', arg]); return target; },
        moderationBlockReason: () => null,
        replyEmbed: (_message, text, options) => { calls.push(['reply', text, options]); return 'replied'; },
        addCase: (...args) => calls.push(['case', ...args]),
        logModAction: (...args) => calls.push(['log', ...args]),
        dmPunishment: async (...args) => calls.push(['dm', ...args]),
        guildCases: () => [{ type: 'warn', active: true, targetId: 'target' }],
        sendEmbed: (...args) => { calls.push(['send', ...args]); return 'sent'; },
        errorColor: 123,
        ...overrides,
    };
    return { calls, dependencies, message, target };
}

test('rejects unauthorized moderators before resolving a target', async () => {
    const { calls, dependencies, message } = setup({ hasModerationPermission: () => false });

    assert.equal(await handleWarnCommand(message, ['123'], '.', dependencies), 'replied');
    assert.equal(calls[0][0], 'reply');
    assert.match(calls[0][1], /Only staff can warn members/);
    assert.equal(calls.some(([name]) => name === 'resolve'), false);
    assert.equal(calls.some(([name]) => name === 'case' || name === 'log' || name === 'dm'), false);
});

test('shows usage when the target cannot be resolved and blocks protected targets', async () => {
    const missing = setup({ resolveTargetMember: async () => null });
    assert.equal(await handleWarnCommand(missing.message, [], '.', missing.dependencies), 'replied');
    assert.match(missing.calls[0][1], /Usage: `\.warn @user/);
    assert.equal(missing.calls.some(([name]) => name === 'case'), false);

    const blocked = setup({ moderationBlockReason: () => 'Protected target.' });
    assert.equal(await handleWarnCommand(blocked.message, ['123'], '.', blocked.dependencies), 'replied');
    assert.equal(blocked.calls[1][0], 'reply');
    assert.equal(blocked.calls[1][1], 'Protected target.');
    assert.equal(blocked.calls.some(([name]) => name === 'case'), false);
});

test('records, logs, and notifies a successfully warned member', async () => {
    const { calls, dependencies, message, target } = setup();

    assert.equal(await handleWarnCommand(message, ['123', 'Repeated', 'spam'], '.', dependencies), 'sent');
    assert.deepEqual(calls.map(([name]) => name), ['resolve', 'case', 'log', 'dm', 'send']);
    assert.deepEqual(calls[1][2], {
        type: 'warn',
        target: target.user,
        moderator: message.author,
        reason: 'Repeated spam',
    });
    assert.deepEqual(calls[3].slice(1), [target.user, message.guild, 'warn', { reason: 'Repeated spam' }]);
    assert.match(calls[4][2], /Target.*Repeated spam/);
    assert.match(calls[4][2], /1.*active warning/);
});
