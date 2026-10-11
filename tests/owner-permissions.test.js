const assert = require('node:assert/strict');
const test = require('node:test');
const { createOwnerCheck } = require('../permissions/owner');

function makeOwnerCheck({ guildOwnerId = 'owner', mainServerOwnerId = 'main-owner', coOwners = [], ownerRoleId = 'owner-role' } = {}) {
    const guild = {
        id: 'guild',
        ownerId: guildOwnerId,
        members: {
            cache: new Map([
                ['role-holder', { roles: { cache: new Set(['owner-role']) } }],
                ['regular-member', { roles: { cache: new Set(['member-role']) } }],
            ]),
        },
    };
    const isOwnerOf = createOwnerCheck({
        getOwnerRoleId: () => ownerRoleId,
        getCoOwnerIds: (guildId) => guildId === guild.id ? coOwners : [],
        serverOwnerId: mainServerOwnerId,
        coOwnerIds: ['co-owner'],
    });
    return { guild, isOwnerOf };
}

test('recognizes the server owner, configured co-owners, and the owner role', () => {
    const { guild, isOwnerOf } = makeOwnerCheck({ coOwners: ['setup-co-owner'] });

    assert.equal(isOwnerOf(guild, 'owner'), true);
    assert.equal(isOwnerOf(guild, 'setup-co-owner'), true);
    assert.equal(isOwnerOf(guild, 'role-holder'), true);
    assert.equal(isOwnerOf(guild, 'regular-member'), false);
});

test('environment co-owner only receives owner access in the configured main server', () => {
    const { guild, isOwnerOf } = makeOwnerCheck({ guildOwnerId: 'main-owner' });

    assert.equal(isOwnerOf(guild, 'co-owner'), true);
    assert.equal(isOwnerOf({ ...guild, ownerId: 'different-server-owner' }, 'co-owner'), false);
});

test('does not grant owner access without a guild or user ID', () => {
    const { guild, isOwnerOf } = makeOwnerCheck();

    assert.equal(isOwnerOf(null, 'owner'), false);
    assert.equal(isOwnerOf(guild, ''), false);
});
