const assert = require('node:assert/strict');
const test = require('node:test');
const { undoAttack } = require('../commands/moderation/undo-attack');

const CATEGORY = 4;
const guild = { id: 'guild' };

function setup(overrides = {}) {
    const deletedThings = new Map();
    const deletedBy = new Map();
    const liveSnapshots = new Map();
    const rebuiltChannels = new Map();
    const rebuiltParents = new Map();
    const rebuiltRoles = new Map();
    const removedRoleOverwrites = new Map();
    const rebuiltRoleOverwrites = new Map();
    const removedMemberRoles = new Map();
    const bansBy = new Map();
    const timeoutsBy = new Map();
    const roleIds = new Set();
    const channelMap = new Map();
    const calls = [];
    const channel = {
        id: 'new-channel',
        permissionOverwrites: { cache: new Map() },
    };
    guild.roles = { cache: { has: (id) => roleIds.has(id) } };
    guild.channels = { cache: { has: (id) => channelMap.has(id), get: (id) => channelMap.get(id) } };
    guild.members = {
        fetch: async (id) => {
            calls.push(['fetch', id]);
            return {
                roles: { add: async (ids) => calls.push(['add-roles', ids]) },
                isCommunicationDisabled: () => true,
                timeout: async (duration) => calls.push(['timeout', id, duration]),
            };
        },
        unban: async (id) => calls.push(['unban', id]),
    };
    const dependencies = {
        deletedThings,
        deletedBy,
        liveSnapshots,
        channelType: { GuildCategory: CATEGORY },
        restoreBackup: async (_guild, snapshot) => {
            calls.push(['restore', snapshot]);
            return { roles: 0, channels: 0, memberRoles: 0, failed: [], ...overrides.restoreResult };
        },
        rebuiltChannels,
        rebuiltParents,
        reattachRebuiltChannels: async () => calls.push('reattach'),
        rebuiltRoles,
        removedRoleOverwrites,
        rebuiltRoleOverwrites,
        putPermission: async (...args) => calls.push(['permission', ...args]),
        botName: 'Ruby',
        removedMemberRoles,
        bansBy,
        timeoutsBy,
        forgetBan: (...args) => calls.push(['forget-ban', ...args]),
        markAntiNukeDirty: () => calls.push('dirty'),
    };
    return {
        deletedThings, deletedBy, liveSnapshots, rebuiltChannels, rebuiltParents, rebuiltRoles,
        removedRoleOverwrites, rebuiltRoleOverwrites, removedMemberRoles, bansBy, timeoutsBy,
        roleIds, channelMap, channel, calls, dependencies,
    };
}

test("restores only this executor's snapshots for this guild and clears processed snapshots", async () => {
    const state = setup();
    const category = { id: 'category', type: CATEGORY, position: 8 };
    const text = { id: 'text', type: 0, position: 1, parentId: 'category' };
    const role = { id: 'role', permissions: 0n };
    state.deletedThings.set('text', { guildId: 'guild', kind: 'channel', data: text });
    state.deletedThings.set('category', { guildId: 'guild', kind: 'channel', data: category });
    state.deletedThings.set('role', { guildId: 'guild', kind: 'role', data: role });
    state.deletedThings.set('other-executor', { guildId: 'guild', kind: 'channel', data: { id: 'other' } });
    state.deletedThings.set('other-guild', { guildId: 'elsewhere', kind: 'channel', data: { id: 'elsewhere' } });
    for (const id of state.deletedThings.keys()) state.deletedBy.set(id, 'attacker');
    state.deletedBy.set('other-executor', 'someone-else');
    state.liveSnapshots.set('guild', { memberRoles: { member: ['role'] } });

    await undoAttack(guild, 'attacker', state.dependencies);
    const snapshot = state.calls.find((entry) => Array.isArray(entry) && entry[0] === 'restore')[1];
    assert.deepEqual(snapshot.roles, [role]);
    assert.deepEqual(snapshot.channels.map((entry) => entry.id), ['category', 'text']);
    assert.deepEqual(snapshot.memberRoles, { member: ['role'] });
    assert.equal(state.deletedThings.has('text'), false);
    assert.equal(state.deletedBy.has('text'), false);
    assert.equal(state.deletedThings.has('other-executor'), true);
    assert.equal(state.deletedThings.has('other-guild'), true);
    assert.deepEqual(state.calls.slice(-2), ['reattach', 'dirty']);
});

test('reconnects rebuilt channels and restores role permissions and attack evidence', async () => {
    const state = setup({
        restoreResult: {
            channelMap: [['old-channel', 'new-channel']],
            roleMap: [['old-role', 'new-role']],
        },
    });
    const savedRole = {
        id: 'old-role',
        overwrites: [{ channelId: 'old-channel', allow: '1', deny: '0' }],
    };
    state.deletedThings.set('old-channel', {
        guildId: 'guild',
        kind: 'channel',
        data: { id: 'old-channel', type: 0, position: 1, parentId: 'old-category' },
    });
    state.deletedThings.set('old-role', { guildId: 'guild', kind: 'role', data: savedRole });
    state.deletedBy.set('old-channel', 'attacker');
    state.deletedBy.set('old-role', 'attacker');
    state.removedRoleOverwrites.set('old-role', new Map([
        ['existing', { channelId: 'existing-channel', allow: '2', deny: '0' }],
    ]));
    state.roleIds.add('new-role');
    state.channelMap.set('new-channel', state.channel);
    state.channelMap.set('existing-channel', {
        id: 'existing-channel',
        permissionOverwrites: { cache: new Map([['new-role', {}]]) },
    });
    state.roleIds.add('role-a');
    state.removedMemberRoles.set('guild:attacker', [{ memberId: 'stripped-member', roleIds: ['role-a', 'missing-role'] }]);
    state.bansBy.set('guild:attacker', [{ userId: 'banned-user' }]);
    state.timeoutsBy.set('guild:attacker', [{ memberId: 'timed-out-member' }]);

    const result = await undoAttack(guild, 'attacker', state.dependencies);
    assert.deepEqual([...state.rebuiltChannels], [['old-channel', 'new-channel']]);
    assert.deepEqual([...state.rebuiltParents], [['new-channel', 'old-category']]);
    assert.deepEqual([...state.rebuiltRoles], [['old-role', 'new-role']]);
    assert.equal(state.removedRoleOverwrites.has('old-role'), false);
    assert.equal(state.rebuiltRoleOverwrites.get('old-role').length, 2);
    assert.equal(state.calls.filter((entry) => Array.isArray(entry) && entry[0] === 'permission').length, 1);
    assert.ok(state.calls.some((entry) => Array.isArray(entry) && entry[0] === 'add-roles'
        && entry[1].length === 1 && entry[1][0] === 'role-a'));
    assert.ok(state.calls.some((entry) => Array.isArray(entry) && entry[0] === 'unban' && entry[1] === 'banned-user'));
    assert.ok(state.calls.some((entry) => Array.isArray(entry) && entry[0] === 'forget-ban'
        && entry[1] === 'guild' && entry[2] === 'banned-user'));
    assert.ok(state.calls.some((entry) => Array.isArray(entry) && entry[0] === 'timeout'
        && entry[1] === 'timed-out-member' && entry[2] === null));
    assert.equal(result.permissions, 1);
    assert.equal(result.memberRoles, 1);
    assert.equal(result.unbanned, 1);
    assert.equal(result.untimedOut, 1);
    assert.equal(state.removedMemberRoles.has('guild:attacker'), false);
    assert.equal(state.bansBy.has('guild:attacker'), false);
    assert.equal(state.timeoutsBy.has('guild:attacker'), false);
});

test('skips unavailable channels and removed roles and clears evidence after failed recovery attempts', async () => {
    const state = setup();
    state.rebuiltRoleOverwrites.set('old-role', [{ channelId: 'missing-channel', allow: '1', deny: '0' }]);
    state.rebuiltRoles.set('old-role', 'missing-role');
    state.removedMemberRoles.set('guild:attacker', [{ memberId: 'member', roleIds: ['missing-role'] }]);
    state.bansBy.set('guild:attacker', [{ userId: 'banned' }]);
    state.timeoutsBy.set('guild:attacker', [{ memberId: 'timed-out' }]);
    guild.members.unban = async () => { throw new Error('already unbanned'); };
    guild.members.fetch = async () => null;

    const result = await undoAttack(guild, 'attacker', state.dependencies);
    assert.equal(state.calls.some((entry) => Array.isArray(entry) && entry[0] === 'permission'), false);
    assert.equal(result.unbanned, undefined);
    assert.equal(result.untimedOut, undefined);
    assert.equal(state.calls.some((entry) => Array.isArray(entry) && entry[0] === 'forget-ban'), false);
    assert.equal(state.removedMemberRoles.has('guild:attacker'), false);
    assert.equal(state.bansBy.has('guild:attacker'), false);
    assert.equal(state.timeoutsBy.has('guild:attacker'), false);
    assert.equal(state.calls.at(-1), 'dirty');
});
