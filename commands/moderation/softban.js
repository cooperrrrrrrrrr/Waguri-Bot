async function handleSoftbanCommand(message, args, prefix, {
    permission,
    hasModerationPermission,
    resolveTargetMember,
    moderationBlockReason,
    replyEmbed,
    dmPunishment,
    banMember,
    unbanMember,
    addCase,
    logModAction,
    sendEmbed,
    errorColor,
    logError = console.error,
}) {
    if (!hasModerationPermission(message.member, permission)) {
        return replyEmbed(message, 'Only staff can softban members.', { title: '🔒 Staff only', color: errorColor });
    }
    const target = await resolveTargetMember(message, args[0]);
    const blocked = target && moderationBlockReason(message, target);
    if (blocked) return replyEmbed(message, blocked, { color: errorColor });
    if (!target) return replyEmbed(message, `Usage: \`${prefix}softban @user [reason]\`\n-# Or reply to their message and leave out the @user.`, { color: errorColor });
    if (!target.bannable) return replyEmbed(message, "I can't softban that user (role hierarchy or missing permissions).", { color: errorColor });

    const reason = args.slice(1).join(' ') || 'No reason provided';
    const dm = await dmPunishment(target.user, message.guild, 'softban', { reason });
    try {
        await banMember(target.user.id, { reason, deleteMessageSeconds: 60 * 60 * 24 });
    } catch (err) {
        logError(err);
        await dm?.delete().catch(() => {});
        return replyEmbed(message, 'Failed to softban that user.', { color: errorColor });
    }
    try {
        await unbanMember(target.user.id, 'Softban cleanup');
    } catch (err) {
        logError(err);
        return replyEmbed(message, `Banned **${target.displayName}** but couldn't unban them afterwards. Unban them manually.`, { color: errorColor });
    }
    addCase(message.guild, { type: 'softban', target: target.user, moderator: message.author, reason });
    logModAction({ guildId: message.guild?.id, moderator: message.author, target: target.user, action: 'softban', reason });
    sendEmbed(message.channel, `Softbanned **${target.displayName}** - ${reason}`, { title: '🧼 Softban' });
}

module.exports = { handleSoftbanCommand };
