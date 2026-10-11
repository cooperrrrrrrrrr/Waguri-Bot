const assert = require('node:assert/strict');
const test = require('node:test');
const { restoreAntiNukeState } = require('../commands/moderation/anti-nuke-state');
const { replayMissedAuditEntries } = require('../commands/moderation/audit-replay');

function mapStores() {
    return Object.fromEntries([
        'deletedThings', 'deletedBy', 'removedMemberRoles', 'webhooksCreatedBy',
        'removedRoleOverwrites', 'nukeActivity', 'recentlyNeutralized', 'bansBy',
        'timeoutsBy', 'processedAuditIds', 'rebuiltChannels', 'rebuiltParents',
        'rebuiltRoles', 'rebuiltRoleOverwrites', 'lastNukeActivityAt', 'raidModeUntil',
    ].map((name) => [name, new Map()]));
}

test('restores persisted anti-nuke maps and converts nested webhook and overwrite collections', () => {
    const stores = mapStores();
    let pruned = 0;
    restoreAntiNukeState({
        deletedThings: [['deleted', { kind: 'channel' }]],
        deletedBy: [['deleted', 'attacker']],
        removedMemberRoles: [['guild:attacker', [{ memberId: 'member', roleIds: ['role'], at: 99 }]]],
        webhooksCreatedBy: [['guild:attacker', ['hook-a', 'hook-b']]],
        removedRoleOverwrites: [['role', [['channel', { allow: '1', deny: '0' }]]]],
        nukeActivity: [['guild:attacker:4', [99, 100]]],
        recentlyNeutralized: [['guild:attacker', 98]],
        bansBy: [['guild:attacker', [{ userId: 'banned', at: 99 }]]],
        timeoutsBy: [['guild:attacker', [{ memberId: 'timed-out', at: 99 }]]],
        processedAuditIds: [['seen-audit-id', 100]],
        rebuiltChannels: [['old-channel', 'new-channel']],
        rebuiltParents: [['new-channel', 'category']],
        rebuiltRoles: [['old-role', 'new-role']],
        rebuiltRoleOverwrites: [['old-role', [{ channelId: 'channel' }]]],
        lastNukeActivityAt: [['guild', 100]],
        raidModeUntil: [['guild', 500]],
    }, { ...stores, prune: () => { pruned++; } });

    assert.deepEqual(stores.deletedThings.get('deleted'), { kind: 'channel' });
    assert.equal(stores.deletedBy.get('deleted'), 'attacker');
    assert.deepEqual(stores.removedMemberRoles.get('guild:attacker')[0].roleIds, ['role']);
    assert.deepEqual([...stores.webhooksCreatedBy.get('guild:attacker')], ['hook-a', 'hook-b']);
    assert.deepEqual([...stores.removedRoleOverwrites.get('role')], [['channel', { allow: '1', deny: '0' }]]);
    assert.deepEqual(stores.nukeActivity.get('guild:attacker:4'), [99, 100]);
    assert.equal(stores.processedAuditIds.get('seen-audit-id'), 100);
    assert.equal(stores.raidModeUntil.get('guild'), 500);
    assert.equal(pruned, 1);
});

test('restored processed audit IDs prevent duplicate replay after restart', async () => {
    const stores = mapStores();
    restoreAntiNukeState({
        processedAuditIds: [['replayed-before-restart', 950]],
    }, { ...stores, prune: () => {} });
    const replayed = [];
    const guild = {
        name: 'guild',
        fetchAuditLogs: async () => ({
            entries: new Map([
                ['duplicate', { id: 'replayed-before-restart', createdTimestamp: 990 }],
                ['new', { id: 'new-event', createdTimestamp: 995 }],
            ]),
        }),
    };

    await replayMissedAuditEntries(900, {
        guilds: [guild],
        processedAuditIds: stores.processedAuditIds,
        handleAuditEntry: async (entry) => replayed.push(entry.id),
        now: () => 1000,
        logger: { log() {}, error() {} },
    });
    assert.deepEqual(replayed, ['new-event']);
});
