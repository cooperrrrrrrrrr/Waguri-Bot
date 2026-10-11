const assert = require('node:assert/strict');
const test = require('node:test');
const { createPermissionChecks } = require('../permissions/checks');

const flags = {
    Administrator: 'administrator',
    ModerateMembers: 'moderate-members',
    KickMembers: 'kick-members',
    BanMembers: 'ban-members',
    ManageMessages: 'manage-messages',
};
const configuredRoles = { admin: 'admin-role', mod: 'mod-role' };
const ownerIds = new Set(['owner']);
const checks = createPermissionChecks({
    permissionFlags: flags,
    isOwnerOf: (_guild, userId) => ownerIds.has(userId),
    getConfiguredRoleId: (_member, type) => configuredRoles[type],
});

function makeMember({ id = 'member', roles = [], rolePositions = {}, permissions = [], guildRoleIds = ['admin-role', 'mod-role'] } = {}) {
    const guildRoles = new Map();
    for (const roleId of new Set([...guildRoleIds, ...Object.keys(rolePositions)])) {
        guildRoles.set(roleId, { comparePositionTo: (other) => (rolePositions[roleId] ?? 1) - (rolePositions[other.id] ?? 1) });
        guildRoles.get(roleId).id = roleId;
    }
    const highest = Math.max(0, ...roles.map((role) => rolePositions[role] ?? 1));
    return {
        id,
        guild: { roles: { cache: guildRoles } },
        roles: {
            cache: new Set(roles),
            highest: { comparePositionTo: (role) => highest - (rolePositions[role.id] ?? 1) },
        },
        permissions: { has: (permission) => permissions.includes(permission) },
    };
}

test('recognizes direct role membership and roles above a configured role', () => {
    const direct = makeMember({ roles: ['mod-role'] });
    const higher = makeMember({ roles: ['admin-role'], rolePositions: { 'mod-role': 1, 'admin-role': 2 } });
    const lower = makeMember({ roles: ['member-role'], rolePositions: { 'mod-role': 2, 'member-role': 1 } });

    assert.equal(checks.memberHasRole(direct, 'mod-role'), true);
    assert.equal(checks.hasRoleOrHigher(direct, 'mod-role'), true);
    assert.equal(checks.hasRoleOrHigher(higher, 'mod-role'), true);
    assert.equal(checks.hasRoleOrHigher(lower, 'mod-role'), false);
});

test('grants moderator access only through owner, moderator role, or moderation permissions', () => {
    assert.equal(checks.hasModeratorAccess(makeMember({ id: 'owner' })), true);
    assert.equal(checks.hasModeratorAccess(makeMember({ roles: ['mod-role'] })), true);
    assert.equal(checks.hasModeratorAccess(makeMember({ permissions: [flags.BanMembers] })), true);
    assert.equal(checks.hasModeratorAccess(makeMember()), false);
});

test('allows moderation action permissions through staff role, admin, owner, or requested permission', () => {
    assert.equal(checks.hasModerationPermission(makeMember({ roles: ['mod-role'] }), 'manage-channels'), true);
    assert.equal(checks.hasModerationPermission(makeMember({ permissions: [flags.Administrator] }), 'manage-channels'), true);
    assert.equal(checks.hasModerationPermission(makeMember({ id: 'owner' }), 'manage-channels'), true);
    assert.equal(checks.hasModerationPermission(makeMember({ permissions: ['manage-channels'] }), 'manage-channels'), true);
    assert.equal(checks.hasModerationPermission(makeMember(), 'manage-channels'), false);
});

test('keeps administrator permission restricted when a configured admin role exists', () => {
    const memberWithConfiguredRole = makeMember({ permissions: [flags.Administrator] });
    const memberWithoutConfiguredRole = makeMember({ permissions: [flags.Administrator], guildRoleIds: ['mod-role'] });

    assert.equal(checks.hasAdminAccess(memberWithConfiguredRole), false);
    assert.equal(checks.hasAdminAccess(makeMember({ roles: ['admin-role'] })), true);
    assert.equal(checks.hasAdminAccess(makeMember({ id: 'owner' })), true);
    assert.equal(checks.hasAdminAccess(memberWithoutConfiguredRole), true);
    assert.equal(checks.hasAdminAccess(null), false);
});

test('blocks moderation against self, the bot, protected owners, and equal or higher roles', () => {
    const message = {
        author: { id: 'moderator' },
        client: { user: { id: 'bot' } },
        guild: {},
        member: { roles: { highest: { position: 2, comparePositionTo: (role) => 2 - role.position } } },
    };
    const target = (id, position) => ({
        id,
        roles: { highest: { position, comparePositionTo: (role) => position - role.position } },
    });

    assert.equal(checks.moderationBlockReason(message, target('moderator', 1)), "You can't use that on yourself.");
    assert.equal(checks.moderationBlockReason(message, target('bot', 1)), "I can't do that to myself.");
    assert.equal(checks.moderationBlockReason(message, target('owner', 1)), "That can't be used on the server owner or co-owner.");
    assert.match(checks.moderationBlockReason(message, target('peer', 2)), /below yours/);
    assert.match(checks.moderationBlockReason(message, target('higher', 3)), /below yours/);
    assert.equal(checks.moderationBlockReason(message, target('lower', 1)), null);
});

test('allows owners to act on equal or higher-ranked non-owner members', () => {
    const message = {
        author: { id: 'owner' },
        client: { user: { id: 'bot' } },
        guild: {},
        member: { roles: { highest: { comparePositionTo: () => -1 } } },
    };
    const target = { id: 'higher', roles: { highest: { comparePositionTo: () => 1 } } };

    assert.equal(checks.moderationBlockReason(message, target), null);
});
