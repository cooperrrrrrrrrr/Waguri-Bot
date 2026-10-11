const { getTargetUserId } = require('../../permissions/targets');

async function handleUnbanCommand(message, args, prefix, {
    permission,
    hasModerationPermission,
    fetchBan,
    replyEmbed,
    clearTimedActions,
    addCase,
    logModAction,
    sendEmbed,
    errorColor,
    logError = console.error,
}) {
    if (!hasModerationPermission(message.member, permission)) {
        return replyEmbed(message, 'Only staff can unban members.', { title: '🔒 Staff only', color: errorColor });
    }
    const userId = getTargetUserId(args[0]);
    const ban = userId ? await fetchBan(userId).catch(() => null) : null;
    if (!userId) return replyEmbed(message, `Usage: \`${prefix}unban <user ID> [reason]\`\n-# Or reply to one of their old messages and leave out the ID.`, { color: errorColor });
    if (!ban) return replyEmbed(message, 'That user isn\'t banned.', { color: errorColor });

    const reason = args.slice(1).join(' ') || 'No reason provided';
    try {
        await message.guild.members.unban(userId, `Unbanned by ${message.author.tag}: ${reason}`);
    } catch (err) {
        logError(err);
        return replyEmbed(message, 'Failed to unban that user.', { color: errorColor });
    }
    clearTimedActions(message.guild.id, userId, 'ban');
    addCase(message.guild, { type: 'unban', target: ban.user, moderator: message.author, reason });
    logModAction({ guildId: message.guild.id, moderator: message.author, target: ban.user, action: 'unban', reason });
    return sendEmbed(message.channel, `Unbanned **${ban.user.tag}** - ${reason}`, { title: '🔓 Unban' });
}

module.exports = { handleUnbanCommand };
