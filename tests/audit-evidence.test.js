const assert = require('node:assert/strict');
const test = require('node:test');
const { recordAuditEvidence } = require('../commands/moderation/audit-evidence');

const events = {
    ChannelDelete: 1,
    RoleDelete: 2,
    WebhookCreate: 3,
    MemberRoleUpdate: 4,
    MemberBanAdd: 5,
    MemberUpdate: 6,
};

function setup() {
    const deletedBy = new Map();
    const deletedThings = new Map();
    const snapshots = [];
    const webhooksCreatedBy = new Map();
    const removedMemberRoles = new Map();
    const bansBy = new Map();
    const timeoutsBy = new Map();
    const dependencies = {
        auditLogEvent: events,
        deletedBy,
        deletedThings,
        rememberDeletedFromSnapshot: (...args) => snapshots.push(args),
        webhooksCreatedBy,
        removedMemberRoles,
        bansBy,
        timeoutsBy,
        rememberByExecutor: (map, key, evidence) => {
            const values = map.get(key) ?? [];
            values.push(evidence);
            map.set(key, values);
        },
        now: () => 5000,
    };
    return {
        deletedBy, deletedThings, snapshots, webhooksCreatedBy,
        removedMemberRoles, bansBy, timeoutsBy, dependencies,
    };
}

const guild = { id: 'guild' };
const executorKey = 'guild:executor';
const record = (entry, isOwner = false, dependencies = setup().dependencies) =>
    recordAuditEvidence({ executorId: 'executor', ...entry }, guild, executorKey, isOwner, dependencies);

test('tracks deleted channels and roles and snapshots only when no snapshot exists', () => {
    const state = setup();
    record({ action: events.ChannelDelete, targetId: 'channel' }, false, state.dependencies);
    state.deletedThings.set('role', { name: 'saved role' });
    record({ action: events.RoleDelete, targetId: 'role' }, false, state.dependencies);
    assert.equal(state.deletedBy.get('channel'), 'executor');
    assert.equal(state.deletedBy.get('role'), 'executor');
    assert.deepEqual(state.snapshots, [[guild, 'channel', 'channel']]);
});

test('records webhook IDs separately per executor', () => {
    const state = setup();
    record({ action: events.WebhookCreate, targetId: 'hook-1' }, false, state.dependencies);
    record({ action: events.WebhookCreate, targetId: 'hook-2' }, false, state.dependencies);
    record({ action: events.WebhookCreate, targetId: null }, false, state.dependencies);
    assert.deepEqual([...state.webhooksCreatedBy.get(executorKey)], ['hook-1', 'hook-2']);
});

test('records role removals, bans, and timeouts for non-owners only', () => {
    const state = setup();
    record({
        action: events.MemberRoleUpdate,
        targetId: 'member',
        changes: [{ key: '$remove', new: [{ id: 'role-a' }, { id: 'role-b' }] }],
    }, false, state.dependencies);
    record({ action: events.MemberBanAdd, targetId: 'banned-user' }, false, state.dependencies);
    const gaveTimeout = record({
        action: events.MemberUpdate,
        targetId: 'timed-out-member',
        changes: [{ key: 'communication_disabled_until', old: null, new: 'later' }],
    }, false, state.dependencies);
    assert.equal(gaveTimeout, true);
    assert.deepEqual(state.removedMemberRoles.get(executorKey), [
        { memberId: 'member', roleIds: ['role-a', 'role-b'], at: 5000 },
    ]);
    assert.deepEqual(state.bansBy.get(executorKey), [{ userId: 'banned-user', at: 5000 }]);
    assert.deepEqual(state.timeoutsBy.get(executorKey), [{ memberId: 'timed-out-member', at: 5000 }]);

    record({
        action: events.MemberRoleUpdate,
        targetId: 'member',
        changes: [{ key: '$remove', new: [{ id: 'role-c' }] }],
    }, true, state.dependencies);
    record({ action: events.MemberBanAdd, targetId: 'owner-banned-user' }, true, state.dependencies);
    const ownerTimeout = record({
        action: events.MemberUpdate,
        targetId: 'owner-timed-out-member',
        changes: [{ key: 'communication_disabled_until', old: null, new: 'later' }],
    }, true, state.dependencies);
    assert.equal(ownerTimeout, true);
    assert.equal(state.removedMemberRoles.get(executorKey).length, 1);
    assert.equal(state.bansBy.get(executorKey).length, 1);
    assert.equal(state.timeoutsBy.get(executorKey).length, 1);
});

test('does not classify a cleared timeout as a new timeout', () => {
    const state = setup();
    const gaveTimeout = record({
        action: events.MemberUpdate,
        targetId: 'member',
        changes: [{ key: 'communication_disabled_until', old: 'previous', new: null }],
    }, false, state.dependencies);
    assert.equal(gaveTimeout, false);
    assert.equal(state.timeoutsBy.size, 0);
});
