async function handleJailCommand(message, args, prefix, {
    permission,
    hasModerationPermission,
    resolveTargetMember,
    moderationBlockReason,
    replyEmbed,
    getVerificationState,
    isUnverified,
    getJailRole,
    parseDuration,
    scheduleTimedAction,
    addCase,
    logModAction,
    dmPunishment,
    formatDurationMs,
    sendEmbed,
    errorColor,
    logError = console.error,
}) {
    if (!hasModerationPermission(message.member, permission)) {
        return replyEmbed(message, 'Only staff can jail members.', { title: '🔒 Staff only', color: errorColor });
    }
    const target = await resolveTargetMember(message, args[0]);
    const blocked = target && moderationBlockReason(message, target);
    if (blocked) return replyEmbed(message, blocked, { color: errorColor });
    if (!target) return replyEmbed(message, `Usage: \`${prefix}jail @user [time] [reason]\` - e.g. \`${prefix}jail @user 2h spamming\`\n-# Or reply to their message and leave out the @user.`, { color: errorColor });

    const verify = getVerificationState(message.guild);
    if (isUnverified(target, verify)) {
        return replyEmbed(message, `**${target.displayName}** hasn't verified yet, so they can only see <#${verify.channelId}> anyway - no need to jail them. Kick or ban them instead if they need to go.`, { color: errorColor });
    }
    const role = getJailRole(message.guild);
    if (!role) return replyEmbed(message, 'The jail role no longer exists.', { color: errorColor });
    if (!role.editable) return replyEmbed(message, "I can't assign the jail role - drag my role above it in Server Settings → Roles.", { color: errorColor });
    if (target.roles.cache.has(role.id)) return replyEmbed(message, `**${target.displayName}** is already jailed.`, { color: errorColor });

    const durationMs = parseDuration(args[1]);
    const reason = args.slice(durationMs ? 2 : 1).join(' ') || 'No reason provided';
    try {
        await target.roles.add(role, `Jailed by ${message.author.tag}: ${reason}`);
        const until = durationMs ? Date.now() + durationMs : null;
        if (until) scheduleTimedAction({ guildId: message.guild.id, type: 'jail', userId: target.id, roleId: role.id, until });
        addCase(message.guild, { type: 'jail', target: target.user, moderator: message.author, reason, until });
        logModAction({ guildId: message.guild?.id, moderator: message.author, target: target.user, action: 'jail', reason });
        await dmPunishment(target.user, message.guild, 'jail', { reason, until });
        sendEmbed(message.channel, `Jailed **${target.displayName}**${durationMs ? ` for **${formatDurationMs(durationMs)}**` : ''} - ${reason}`, { title: '🚔 Jail' });
    } catch (err) {
        logError(err);
        replyEmbed(message, 'Failed to jail that user.', { color: errorColor });
    }
}

module.exports = { handleJailCommand };
