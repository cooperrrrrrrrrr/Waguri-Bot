function createOwnerCheck({ getOwnerRoleId, getCoOwnerIds, serverOwnerId, coOwnerIds }) {
    return function isOwnerOf(guild, userId) {
        if (!guild || !userId) return false;
        const ownerRoleId = getOwnerRoleId(guild);
        return userId === guild.ownerId
            || getCoOwnerIds(guild.id).includes(userId)
            || Boolean(ownerRoleId && guild.members.cache.get(userId)?.roles.cache.has(ownerRoleId))
            || (guild.ownerId === serverOwnerId && coOwnerIds.includes(userId));
    };
}

module.exports = { createOwnerCheck };
