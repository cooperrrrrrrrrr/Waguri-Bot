const assert = require('node:assert/strict');
const test = require('node:test');
const { handleJailCommand } = require('../commands/moderation/jail');

const durationMs = 120_000;

function setup(overrides = {}) {
    const calls = [];
    const role = { id: 'jail-role', editable: true };
    const target = {
        id: 'target',
        user: { id: 'target' },
        displayName: 'Target',
        roles: {
            cache: new Set(),
            add: async (addedRole, reason) => calls.push(['add', addedRole, reason]),
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
        getVerificationState: () => ({ channelId: 'verify-channel' }),
        isUnverified: () => false,
        getJailRole: () => role,
        parseDuration: (input) => input === '2m' ? durationMs : 0,
        scheduleTimedAction: (action) => calls.push(['schedule', action]),
        addCase: (...args) => calls.push(['case', ...args]),
        logModAction: (...args) => calls.push(['log', ...args]),
        dmPunishment: async (...args) => calls.push(['dm', ...args]),
        formatDurationMs: (duration) => `${duration / 1000}s`,
        sendEmbed: (...args) => { calls.push(['send', ...args]); return 'sent'; },
        errorColor: 123,
        logError: (err) => calls.push(['error', err.message]),
        ...overrides,
    };
    return { calls, dependencies, message, role, target };
}

test('denies unauthorized members before target lookup', async () => {
    const { calls, dependencies, message } = setup({ hasModerationPermission: () => false });

    assert.equal(await handleJailCommand(message, ['123'], '.', dependencies), 'replied');
    assert.match(calls[0][1], /Only staff can jail members/);
    assert.equal(calls.some(([name]) => name === 'resolve'), false);
});

test('handles missing and protected targets plus verification and jail-role guards', async () => {
    const missing = setup({ resolveTargetMember: async () => null });
    await handleJailCommand(missing.message, [], '.', missing.dependencies);
    assert.match(missing.calls[0][1], /Usage: `\.jail @user/);

    const blocked = setup({ moderationBlockReason: () => 'Protected target.' });
    await handleJailCommand(blocked.message, ['123'], '.', blocked.dependencies);
    assert.equal(blocked.calls[1][1], 'Protected target.');

    const unverified = setup({ isUnverified: () => true });
    await handleJailCommand(unverified.message, ['123'], '.', unverified.dependencies);
    assert.match(unverified.calls[1][1], /hasn't verified yet/);
    assert.equal(unverified.calls.some(([name]) => name === 'add'), false);

    const noRole = setup({ getJailRole: () => null });
    await handleJailCommand(noRole.message, ['123'], '.', noRole.dependencies);
    assert.match(noRole.calls[1][1], /jail role no longer exists/);

    const uneditable = setup();
    uneditable.role.editable = false;
    await handleJailCommand(uneditable.message, ['123'], '.', uneditable.dependencies);
    assert.match(uneditable.calls[1][1], /drag my role above it/);

    const alreadyJailed = setup();
    alreadyJailed.target.roles.cache.add('jail-role');
    await handleJailCommand(alreadyJailed.message, ['123'], '.', alreadyJailed.dependencies);
    assert.match(alreadyJailed.calls[1][1], /already jailed/);
});

test('adds a jail role and schedules a timed release when a duration is supplied', async () => {
    const { calls, dependencies, message, role, target } = setup();
    const before = Date.now();

    await handleJailCommand(message, ['123', '2m', 'repeat', 'spam'], '.', dependencies);

    const after = Date.now();
    assert.deepEqual(calls.map(([name]) => name), ['resolve', 'add', 'schedule', 'case', 'log', 'dm', 'send']);
    assert.deepEqual(calls[1].slice(1), [role, 'Jailed by Mod#1234: repeat spam']);
    assert.equal(calls[2][1].guildId, 'guild');
    assert.equal(calls[2][1].type, 'jail');
    assert.equal(calls[2][1].userId, target.id);
    assert.equal(calls[2][1].roleId, role.id);
    assert.ok(calls[2][1].until >= before + durationMs);
    assert.ok(calls[2][1].until <= after + durationMs);
    assert.equal(calls[3][2].reason, 'repeat spam');
    assert.equal(calls[3][2].until, calls[2][1].until);
    assert.match(calls[6][2], /for \*\*120s\*\* - repeat spam/);
});

test('does not schedule permanent jails and reports role-add failures without case records', async () => {
    const permanent = setup();
    await handleJailCommand(permanent.message, ['123', 'spam'], '.', permanent.dependencies);
    assert.deepEqual(permanent.calls.map(([name]) => name), ['resolve', 'add', 'case', 'log', 'dm', 'send']);
    assert.equal(permanent.calls[2][2].until, null);
    assert.match(permanent.calls[5][2], /Jailed \*\*Target\*\* - spam/);

    const failed = setup();
    failed.target.roles.add = async () => { throw new Error('Discord failure'); };
    await handleJailCommand(failed.message, ['123'], '.', failed.dependencies);
    assert.deepEqual(failed.calls.map(([name]) => name), ['resolve', 'error', 'reply']);
    assert.equal(failed.calls[1][1], 'Discord failure');
    assert.match(failed.calls[2][1], /Failed to jail/);
});
