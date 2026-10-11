const assert = require('node:assert/strict');
const test = require('node:test');
const { recordNukeActivity } = require('../commands/moderation/anti-nuke');

const guild = { id: 'guild' };
const events = {
    ChannelOverwriteCreate: 1,
    ChannelOverwriteUpdate: 2,
    ChannelOverwriteDelete: 3,
    ChannelDelete: 4,
    MemberRoleUpdate: 5,
};
const limits = {
    [events.ChannelOverwriteCreate]: { limit: 3, label: 'changed channel permissions', group: 'overwrites' },
    [events.ChannelOverwriteUpdate]: { limit: 3, label: 'changed channel permissions', group: 'overwrites' },
    [events.ChannelOverwriteDelete]: { limit: 3, label: 'changed channel permissions', group: 'overwrites' },
    [events.ChannelDelete]: { limit: 2, label: 'deleted channels' },
};

function setup(overrides = {}) {
    const nukeActivity = new Map();
    const lastNukeActivityAt = new Map();
    const dependencies = {
        at: 60_000,
        executorId: 'executor',
        isOwner: false,
        trusted: false,
        nukeActivity,
        lastNukeActivityAt,
        nukeWindowMs: 60_000,
        nukeLimits: limits,
        nukeLimitFor: (_guild, limit) => limit,
        trustedHardCap: 3,
        memberRoleUpdate: events.MemberRoleUpdate,
        gaveTimeout: false,
        ...overrides,
    };
    return { dependencies, lastNukeActivityAt, nukeActivity };
}

test('counts overwrite create, update, and delete actions together', () => {
    const { dependencies, nukeActivity } = setup();
    const actions = [
        events.ChannelOverwriteCreate,
        events.ChannelOverwriteUpdate,
        events.ChannelOverwriteDelete,
    ];
    let result = null;
    for (const action of actions) {
        result = recordNukeActivity({ action }, guild, dependencies);
    }
    assert.deepEqual(result, {
        executorId: 'executor',
        count: 3,
        label: 'changed channel permissions',
    });
    assert.deepEqual(nukeActivity.get('guild:executor:overwrites'), [60_000, 60_000, 60_000]);
});

test('triggers at the configured threshold and not for unknown audit actions', () => {
    const { dependencies, lastNukeActivityAt, nukeActivity } = setup();
    assert.equal(recordNukeActivity({ action: events.ChannelDelete }, guild, dependencies), null);
    assert.equal(recordNukeActivity({ action: events.ChannelDelete }, guild, dependencies).count, 2);
    assert.equal(lastNukeActivityAt.has(guild.id), true);

    const unknown = setup();
    assert.equal(recordNukeActivity({ action: 999 }, guild, unknown.dependencies), null);
    assert.equal(unknown.nukeActivity.size, 0);
    assert.equal(unknown.lastNukeActivityAt.size, 0);
});

test('does not count destructive actions by the server owner', () => {
    const { dependencies, lastNukeActivityAt, nukeActivity } = setup({ isOwner: true });
    assert.equal(recordNukeActivity({ action: events.ChannelDelete }, guild, dependencies), null);
    assert.equal(nukeActivity.size, 0);
    assert.equal(lastNukeActivityAt.size, 0);
});

test('allows trusted members three times the configured limit then marks the trigger', () => {
    const { dependencies } = setup({
        trusted: true,
        nukeLimitFor: (_guild, limit) => Math.max(1, Math.round(limit * 0.5)),
    });
    const entry = { action: events.ChannelDelete };
    for (let index = 0; index < 2; index++) {
        assert.equal(recordNukeActivity(entry, guild, dependencies), null);
    }
    const result = recordNukeActivity(entry, guild, dependencies);
    assert.deepEqual(result, {
        executorId: 'executor',
        count: 3,
        label: 'deleted channels (far past the limit, even for a trusted person)',
    });
});

test('uses a rolling replay-safe window and excludes events exactly at its boundary', () => {
    const { dependencies } = setup({
        at: 180_000,
        nukeActivity: new Map([['guild:executor:4', [120_000, 120_001]]]),
    });
    const result = recordNukeActivity({ action: events.ChannelDelete }, guild, dependencies);
    assert.deepEqual(result, { executorId: 'executor', count: 2, label: 'deleted channels' });
    assert.deepEqual(dependencies.nukeActivity.get('guild:executor:4'), [120_001, 180_000]);
});

test('counts member role stripping and timeouts as separate shared action groups', () => {
    const stripped = setup();
    const roleEntry = { action: events.MemberRoleUpdate, changes: [{ key: '$remove', new: [{ id: 'role' }] }] };
    for (let index = 0; index < 9; index++) {
        assert.equal(recordNukeActivity(roleEntry, guild, stripped.dependencies), null);
    }
    assert.deepEqual(recordNukeActivity(roleEntry, guild, stripped.dependencies), {
        executorId: 'executor',
        count: 10,
        label: 'removed roles from members',
    });

    const timeouts = setup({ gaveTimeout: true });
    for (let index = 0; index < 7; index++) {
        assert.equal(recordNukeActivity({ action: 999 }, guild, timeouts.dependencies), null);
    }
    assert.deepEqual(recordNukeActivity({ action: 999 }, guild, timeouts.dependencies), {
        executorId: 'executor',
        count: 8,
        label: 'timed out members',
    });
    assert.equal(timeouts.nukeActivity.has('guild:executor:timeouts'), true);
});

test('member-role removals take precedence over timeout classification', () => {
    const { dependencies, nukeActivity } = setup({ gaveTimeout: true });
    const entry = { action: events.MemberRoleUpdate, changes: [{ key: '$remove', new: [{ id: 'role' }] }] };
    recordNukeActivity(entry, guild, dependencies);
    assert.equal(nukeActivity.has('guild:executor:memberroles'), true);
    assert.equal(nukeActivity.has('guild:executor:timeouts'), false);
});
