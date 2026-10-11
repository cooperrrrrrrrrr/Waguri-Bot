const assert = require('node:assert/strict');
const test = require('node:test');
const { handleBanCommand } = require('../commands/moderation/ban');

function setup(overrides = {}) {
    const calls = [];
    const user = { id: '12345678901234567', tag: 'Target#1234' };
    const target = {
        id: user.id,
        user,
        displayName: 'Target',
        bannable: true,
    };
    const message = {
        member: { id: 'moderator' },
        author: { id: 'moderator', tag: 'Mod#1234' },
        guild: {
            id: 'guild',
            members: {
                ban: async (...args) => calls.push(['ban', ...args]),
            },
        },
        channel: { id: 'channel' },
    };
    const dm = { delete: async () => calls.push(['delete-dm']) };
    const dependencies = {
        permission: 'ban-members',
        hasModerationPermission: () => true,
        resolveTargetMember: async (_message, arg) => { calls.push(['resolve', arg]); return target; },
        moderationBlockReason: () => null,
        isOwnerOf: () => false,
        fetchUser: async (userId) => { calls.push(['fetch', userId]); return user; },
        replyEmbed: (_message, text, options) => { calls.push(['reply', text, options]); return 'replied'; },
        dmPunishment: async (...args) => { calls.push(['dm', ...args]); return dm; },
        clearTimedActions: (...args) => calls.push(['clear', ...args]),
        addCase: (...args) => calls.push(['case', ...args]),
        logModAction: (...args) => calls.push(['log', ...args]),
        sendEmbed: (...args) => { calls.push(['send', ...args]); return 'sent'; },
        errorColor: 123,
        logError: (err) => calls.push(['error', err.message]),
        ...overrides,
    };
    return { calls, dependencies, dm, message, target, user };
}

test('denies unauthorized members before resolving users', async () => {
    const { calls, dependencies, message } = setup({ hasModerationPermission: () => false });

    assert.equal(await handleBanCommand(message, ['123'], '.', dependencies), 'replied');
    assert.match(calls[0][1], /Only staff can ban members/);
    assert.equal(calls.some(([name]) => name === 'resolve' || name === 'fetch'), false);
});

test('handles missing targets and protects self, owners, and non-bannable members', async () => {
    const missing = setup({
        resolveTargetMember: async () => null,
        fetchUser: async () => null,
    });
    await handleBanCommand(missing.message, ['12345678901234567'], '.', missing.dependencies);
    assert.match(missing.calls[0][1], /Usage: `\.ban/);

    const self = setup();
    self.dependencies.resolveTargetMember = async () => null;
    self.dependencies.fetchUser = async () => ({ id: 'moderator', tag: 'Mod#1234' });
    await handleBanCommand(self.message, ['12345678901234567'], '.', self.dependencies);
    assert.match(self.calls[0][1], /yourself/);

    const owner = setup();
    owner.dependencies.resolveTargetMember = async () => null;
    owner.dependencies.fetchUser = async () => owner.user;
    owner.dependencies.isOwnerOf = () => true;
    await handleBanCommand(owner.message, ['12345678901234567'], '.', owner.dependencies);
    assert.match(owner.calls[0][1], /server owner or co-owner/);

    const notBannable = setup();
    notBannable.target.bannable = false;
    await handleBanCommand(notBannable.message, [notBannable.user.id], '.', notBannable.dependencies);
    assert.match(notBannable.calls[1][1], /role hierarchy or missing permissions/);
    assert.equal(notBannable.calls.some(([name]) => name === 'dm'), false);
});

test('bans a present member after notification and replaces any scheduled temp-ban', async () => {
    const { calls, dependencies, message, target, user } = setup();

    assert.equal(await handleBanCommand(message, [user.id, 'serious', 'spam'], '.', dependencies), 'sent');
    assert.deepEqual(calls.map(([name]) => name), ['resolve', 'dm', 'ban', 'clear', 'case', 'log', 'send']);
    assert.deepEqual(calls[1].slice(1), [user, message.guild, 'ban', { reason: 'serious spam' }]);
    assert.deepEqual(calls[2].slice(1), [user.id, { reason: 'Banned by Mod#1234: serious spam' }]);
    assert.deepEqual(calls[3].slice(1), ['guild', user.id, 'ban']);
    assert.deepEqual(calls[4][2], { type: 'ban', target: user, moderator: message.author, reason: 'serious spam' });
    assert.match(calls[6][2], /Target.*serious spam/);
    assert.equal(target.id, user.id);
});

test('bans departed users by ID without trying to DM them', async () => {
    const { calls, dependencies, message, user } = setup({
        resolveTargetMember: async (_message, arg) => { calls.push(['resolve', arg]); return null; },
    });

    await handleBanCommand(message, [user.id], '.', dependencies);

    assert.deepEqual(calls.map(([name]) => name), ['resolve', 'fetch', 'ban', 'clear', 'case', 'log', 'send']);
    assert.equal(calls.some(([name]) => name === 'dm'), false);
});

test('rolls back the pre-ban DM and leaves timed actions untouched on ban failure', async () => {
    const { calls, dependencies, message } = setup();
    message.guild.members.ban = async () => { throw new Error('Discord failure'); };

    await handleBanCommand(message, ['12345678901234567'], '.', dependencies);

    assert.deepEqual(calls.map(([name]) => name), ['resolve', 'dm', 'error', 'delete-dm', 'reply']);
    assert.equal(calls[2][1], 'Discord failure');
    assert.match(calls[4][1], /Failed to ban/);
});
