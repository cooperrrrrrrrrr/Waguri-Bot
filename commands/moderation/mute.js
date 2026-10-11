async function handleMuteCommand(message, args, prefix, {
    permission,
    hasModerationPermission,
    resolveTargetMember,
    moderationBlockReason,
    replyEmbed,
    parseDuration,
    maxTimeoutMs,
    permanentMuteTimeoutMs,
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
        return replyEmbed(message, 'Only staff can mute members.', { title: '🔒 Staff only', color: errorColor });
    }
    const target = await resolveTargetMember(message, args[0]);
    const blocked = target && moderationBlockReason(message, target);
    if (blocked) return replyEmbed(message, blocked, { color: errorColor });
    if (!target) return replyEmbed(message, `Usage: \`${prefix}mute @user [time] [reason]\` - e.g. \`${prefix}mute @user 10m spam\`, \`2h\` or \`1d\`. Leave out the time to mute until someone unmutes them.\n-# Or reply to their message and leave out the @user.`, { color: errorColor });

    const durationMs = parseDuration(args[1]);
    const forever = !durationMs;
    if (durationMs > maxTimeoutMs) return replyEmbed(message, 'Discord only allows timed mutes of up to 28 days. Leave out the time to mute them until someone unmutes them.', { color: errorColor });
    if (!target.moderatable) return replyEmbed(message, "I can't mute that user (role hierarchy or missing permissions).", { color: errorColor });

    const reason = args.slice(forever ? 1 : 2).join(' ') || 'No reason provided';
    try {
        await target.timeout(forever ? permanentMuteTimeoutMs : durationMs, reason);
        setPermaMute(message.guild.id, target.id, forever);
        addCase(message.guild, {
            type: 'mute',
            target: target.user,
            moderator: message.author,
            reason: forever ? `${reason} (until unmuted)` : reason,
            until: forever ? null : Date.now() + durationMs,
        });
        logModAction({ guildId: message.guild?.id, moderator: message.author, target: target.user, action: 'mute', reason });
        await dmPunishment(target.user, message.guild, 'mute', forever
            ? { reason, note: 'This mute lasts until staff unmute you.' }
            : { reason, until: Date.now() + durationMs });
        sendEmbed(message.channel, `Muted **${target.displayName}** ${forever ? '**until someone unmutes them**' : `for ${formatDurationMs(durationMs)}`} - ${reason}`, { title: '🔇 Mute' });
    } catch (err) {
        logError(err);
        replyEmbed(message, 'Failed to mute that user.', { color: errorColor });
    }
}

module.exports = { handleMuteCommand };
