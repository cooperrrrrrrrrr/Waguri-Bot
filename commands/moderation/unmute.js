async function handleUnmuteCommand(message, args, prefix, {
    permission,
    hasModerationPermission,
    resolveTargetMember,
    moderationBlockReason,
    replyEmbed,
    setPermaMute,
    logModAction,
    addCase,
    dmPunishment,
    sendEmbed,
    errorColor,
    logError = console.error,
}) {
    if (!hasModerationPermission(message.member, permission)) {
        return replyEmbed(message, 'Only staff can unmute members.', { title: '🔒 Staff only', color: errorColor });
    }
    const target = await resolveTargetMember(message, args[0]);
    const blocked = target && moderationBlockReason(message, target);
    if (blocked) return replyEmbed(message, blocked, { color: errorColor });
    if (!target) return replyEmbed(message, `Usage: \`${prefix}unmute @user\`\n-# Or reply to their message and leave out the @user.`, { color: errorColor });
    if (!target.moderatable) return replyEmbed(message, "I can't unmute that user (role hierarchy or missing permissions).", { color: errorColor });
    if (!target.isCommunicationDisabled()) {
        setPermaMute(message.guild.id, target.id, false);
        return replyEmbed(message, `**${target.displayName}** isn't muted.`, { color: errorColor });
    }
    try {
        await target.timeout(null);
        setPermaMute(message.guild.id, target.id, false);
        logModAction({ guildId: message.guild?.id, moderator: message.author, target: target.user, action: 'unmute', reason: 'Manual unmute' });
        addCase(message.guild, { type: 'unmute', target: target.user, moderator: message.author, reason: 'Mute lifted by staff' });
        await dmPunishment(target.user, message.guild, 'unmute', { reason: 'Lifted by staff' });
        sendEmbed(message.channel, `Unmuted **${target.displayName}**.`, { title: '🔊 Unmute' });
    } catch (err) {
        logError(err);
        replyEmbed(message, 'Failed to unmute that user.', { color: errorColor });
    }
}

module.exports = { handleUnmuteCommand };
