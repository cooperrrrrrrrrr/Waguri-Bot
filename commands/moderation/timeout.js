async function handleTimeoutCommand(message, args, prefix, {
    permission,
    hasModerationPermission,
    resolveTargetMember,
    moderationBlockReason,
    parseDuration,
    maxTimeoutMinutes,
    replyEmbed,
    targetTimeout,
    setPermaMute,
    addCase,
    logModAction,
    dmPunishment,
    formatDurationMs,
    sendEmbed,
    errorColor,
    logError = console.error,
}) {
    if (!hasModerationPermission(message.member, permission)) {
        return replyEmbed(message, 'Only staff can timeout members.', { title: '🔒 Staff only', color: errorColor });
    }

    const target = await resolveTargetMember(message, args[0]);
    const blocked = target && moderationBlockReason(message, target);
    if (blocked) return replyEmbed(message, blocked, { color: errorColor });
    const durationMs = parseDuration(args[1]);
    if (!target || !durationMs) {
        return replyEmbed(message, `Usage: \`${prefix}timeout @user <time> [reason]\` - e.g. \`${prefix}timeout @user 10m\`, \`2h\` or \`1d\` (a plain number means minutes)\n-# Or reply to their message and leave out the @user.`, { color: errorColor });
    }
    if (durationMs > maxTimeoutMinutes * 60 * 1000) {
        return replyEmbed(message, `Discord only allows timeouts of up to 28 days (**${maxTimeoutMinutes}** minutes).`, { color: errorColor });
    }
    if (!target.moderatable) {
        return replyEmbed(message, "I can't timeout that user (role hierarchy or missing permissions).", { color: errorColor });
    }

    const reason = args.slice(2).join(' ') || 'No reason provided';
    try {
        await targetTimeout(target, durationMs, reason);
        setPermaMute(message.guild.id, target.id, false);
        addCase(message.guild, { type: 'timeout', target: target.user, moderator: message.author, reason, until: Date.now() + durationMs });
        logModAction({ guildId: message.guild?.id, moderator: message.author, target: target.user, action: 'timeout', reason });
        await dmPunishment(target.user, message.guild, 'mute', { reason, until: Date.now() + durationMs });
        return sendEmbed(message.channel, `Timed out **${target.displayName}** for ${formatDurationMs(durationMs)} - ${reason}`, { title: '🔇 Timeout' });
    } catch (err) {
        logError(err);
        return replyEmbed(message, 'Failed to timeout that user.', { color: errorColor });
    }
}

module.exports = { handleTimeoutCommand };
