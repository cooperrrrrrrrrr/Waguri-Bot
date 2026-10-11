async function handleKickCommand(message, args, prefix, {
    permission,
    hasModerationPermission,
    resolveTargetMember,
    moderationBlockReason,
    replyEmbed,
    dmPunishment,
    addCase,
    logModAction,
    sendEmbed,
    errorColor,
    logError = console.error,
}) {
    if (!hasModerationPermission(message.member, permission)) {
        return replyEmbed(message, 'Only staff can kick members.', { title: '🔒 Staff only', color: errorColor });
    }
    const target = await resolveTargetMember(message, args[0]);
    const blocked = target && moderationBlockReason(message, target);
    if (blocked) return replyEmbed(message, blocked, { color: errorColor });
    if (!target) return replyEmbed(message, `Usage: \`${prefix}kick @user [reason]\`\n-# Or reply to their message and leave out the @user.`, { color: errorColor });
    if (!target.kickable) return replyEmbed(message, "I can't kick that user (role hierarchy or missing permissions).", { color: errorColor });

    const reason = args.slice(1).join(' ') || 'No reason provided';
    const dm = await dmPunishment(target.user, message.guild, 'kick', { reason });
    try {
        await target.kick(reason);
        addCase(message.guild, { type: 'kick', target: target.user, moderator: message.author, reason });
        logModAction({ guildId: message.guild?.id, moderator: message.author, target: target.user, action: 'kick', reason });
        sendEmbed(message.channel, `Kicked **${target.displayName}** - ${reason}`, { title: '👢 Kicked' });
    } catch (err) {
        logError(err);
        await dm?.delete().catch(() => {});
        return replyEmbed(message, 'Failed to kick that user.', { color: errorColor });
    }
}

module.exports = { handleKickCommand };
