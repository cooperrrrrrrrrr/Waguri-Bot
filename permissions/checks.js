function createPermissionChecks({ permissionFlags, isOwnerOf, getConfiguredRoleId }) {
    function memberHasRole(member, roleId) {
        return Boolean(member?.roles?.cache?.has(roleId));
    }

    function hasRoleOrHigher(member, roleId) {
        if (memberHasRole(member, roleId)) return true;
        const role = roleId ? member?.guild?.roles?.cache?.get(roleId) : null;
        return Boolean(role && member?.roles?.highest && member.roles.highest.comparePositionTo(role) >= 0);
    }

    function hasModeratorAccess(member) {
        return Boolean(
            member && (
                isOwnerOf(member.guild, member.id) ||
                hasRoleOrHigher(member, getConfiguredRoleId(member, 'mod')) ||
                member.permissions?.has(permissionFlags.ModerateMembers) ||
                member.permissions?.has(permissionFlags.KickMembers) ||
                member.permissions?.has(permissionFlags.BanMembers) ||
                member.permissions?.has(permissionFlags.ManageMessages)
            )
        );
    }

    function hasModerationPermission(member, permission) {
        return Boolean(
            member && (
                isOwnerOf(member.guild, member.id) ||
                hasRoleOrHigher(member, getConfiguredRoleId(member, 'mod')) ||
                member.permissions?.has(permissionFlags.Administrator) ||
                member.permissions?.has(permission)
            )
        );
    }

    function hasAdminAccess(member) {
        if (!member) return false;
        const roleId = getConfiguredRoleId(member, 'admin');
        if (hasRoleOrHigher(member, roleId) || isOwnerOf(member.guild, member.id)) return true;
        return !member.guild?.roles?.cache?.has(roleId) && Boolean(member.permissions?.has(permissionFlags.Administrator));
    }

    function moderationBlockReason(message, target) {
        if (target.id === message.author.id) return "You can't use that on yourself.";
        if (target.id === message.client.user.id) return "I can't do that to myself.";
        if (isOwnerOf(message.guild, target.id)) return "That can't be used on the server owner or co-owner.";
        const isOwner = isOwnerOf(message.guild, message.author.id);
        if (!isOwner && target.roles.highest.comparePositionTo(message.member.roles.highest) >= 0) {
            return 'You can only use that on members whose highest role is below yours.';
        }
        return null;
    }

    return { memberHasRole, hasRoleOrHigher, hasModeratorAccess, hasModerationPermission, hasAdminAccess, moderationBlockReason };
}

module.exports = { createPermissionChecks };
