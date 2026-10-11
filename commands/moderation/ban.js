const { getTargetUserId } = require('../../permissions/targets');

async function handleBanCommand(message, args, prefix, {
    permission,
    hasModerationPermission,
    resolveTargetMember,
    moderationBlockReason,
    isOwnerOf,
    fetchUser,
    replyEmbed,
    dmPunishment,
    clearTimedActions,
    addCase,
    logModAction,
    sendEmbed,
    errorColor,
    logError = console.error,
}) {
    if (!hasModerationPermission(message.member, permission)) {
        return replyEmbed(message, 'Only staff can ban members.', { title: '🔒 Staff only', color: errorColor });
    }
    const target = await resolveTargetMember(message, args[0]);
    const userId = target?.id ?? getTargetUserId(args[0]);
    const user = target?.user ?? (userId ? await fetchUser(userId).catch(() => null) : null);
    if (!user) return replyEmbed(message, `Usage: \`${prefix}ban <@user or user ID> [reason]\`\n-# Or reply to their message and leave out the @user.`, { color: errorColor });

    const blocked = target
        ? moderationBlockReason(message, target)
        : user.id === message.author.id ? "You can't use that on yourself."
            : isOwnerOf(message.guild, user.id) ? "That can't be used on the server owner or co-owner." : null;
    if (blocked) return replyEmbed(message, blocked, { color: errorColor });
    if (target && !target.bannable) return replyEmbed(message, "I can't ban that user (role hierarchy or missing permissions).", { color: errorColor });

    const reason = args.slice(1).join(' ') || 'No reason provided';
    const dm = target ? await dmPunishment(user, message.guild, 'ban', { reason }) : null;
    try {
        await message.guild.members.ban(user.id, { reason: `Banned by ${message.author.tag}: ${reason}` });
    } catch (err) {
        logError(err);
        await dm?.delete().catch(() => {});
        return replyEmbed(message, 'Failed to ban that user.', { color: errorColor });
    }

    clearTimedActions(message.guild.id, user.id, 'ban');
    addCase(message.guild, { type: 'ban', target: user, moderator: message.author, reason });
    logModAction({ guildId: message.guild.id, moderator: message.author, target: user, action: 'ban', reason });
    return sendEmbed(message.channel, `Banned **${target?.displayName ?? user.tag}** - ${reason}`, { title: '🔨 Banned from the agency' });
}

module.exports = { handleBanCommand };
