async function handleTempbanCommand(message, args, prefix, {
    permission,
    hasModerationPermission,
    resolveTargetMember,
    moderationBlockReason,
    replyEmbed,
    parseDuration,
    dmPunishment,
    banMember,
    clearTimedActions,
    scheduleTimedAction,
    addCase,
    logModAction,
    formatDurationMs,
    sendEmbed,
    errorColor,
    logError = console.error,
}) {
    if (!hasModerationPermission(message.member, permission)) {
        return replyEmbed(message, 'Only staff can ban members.', { title: '🔒 Staff only', color: errorColor });
    }
    const target = await resolveTargetMember(message, args[0]);
    const blocked = target && moderationBlockReason(message, target);
    if (blocked) return replyEmbed(message, blocked, { color: errorColor });
    const durationMs = parseDuration(args[1]);
    if (!target || !durationMs) return replyEmbed(message, `Usage: \`${prefix}tempban @user <time> [reason]\` - e.g. \`${prefix}tempban @user 3d raiding\`\n-# Or reply to their message and leave out the @user.`, { color: errorColor });
    if (!target.bannable) return replyEmbed(message, "I can't ban that user (role hierarchy or missing permissions).", { color: errorColor });

    const reason = args.slice(2).join(' ') || 'No reason provided';
    const until = Date.now() + durationMs;
    try {
        await dmPunishment(target.user, message.guild, 'ban', {
            reason,
            automatic: false,
            note: `You can rejoin <t:${Math.floor(until / 1000)}:R>.`,
        }).catch(() => {});
        await banMember(target.id, { reason: `Temp-ban by ${message.author.tag} (${formatDurationMs(durationMs)}): ${reason}` });
        clearTimedActions(message.guild.id, target.id, 'ban');
        scheduleTimedAction({ guildId: message.guild.id, type: 'ban', userId: target.id, until });
        addCase(message.guild, { type: 'tempban', target: target.user, moderator: message.author, reason, until });
        logModAction({ guildId: message.guild?.id, moderator: message.author, target: target.user, action: 'tempban', reason });
        return sendEmbed(message.channel, `Banned **${target.user.tag}** for **${formatDurationMs(durationMs)}** - ${reason}\n-# Auto-unban <t:${Math.floor(until / 1000)}:R>`, { title: '🔨 Temp-ban' });
    } catch (err) {
        logError(err);
        return replyEmbed(message, 'Failed to ban that user.', { color: errorColor });
    }
}

module.exports = { handleTempbanCommand };
