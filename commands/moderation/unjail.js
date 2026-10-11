async function handleUnjailCommand(message, args, prefix, {
    permission,
    hasModerationPermission,
    resolveTargetMember,
    moderationBlockReason,
    replyEmbed,
    getJailRole,
    clearTimedActions,
    logModAction,
    addCase,
    dmPunishment,
    sendEmbed,
    errorColor,
    logError = console.error,
}) {
    if (!hasModerationPermission(message.member, permission)) {
        return replyEmbed(message, 'Only staff can unjail members.', { title: '🔒 Staff only', color: errorColor });
    }
    const target = await resolveTargetMember(message, args[0]);
    const blocked = target && moderationBlockReason(message, target);
    if (blocked) return replyEmbed(message, blocked, { color: errorColor });
    if (!target) return replyEmbed(message, `Usage: \`${prefix}unjail @user\`\n-# Or reply to their message and leave out the @user.`, { color: errorColor });
    const role = getJailRole(message.guild);
    if (!role || !target.roles.cache.has(role.id)) return replyEmbed(message, `**${target.displayName}** isn't jailed.`, { color: errorColor });
    if (!role.editable) return replyEmbed(message, "I can't remove the jail role - drag my role above it in Server Settings → Roles.", { color: errorColor });

    try {
        await target.roles.remove(role, `Unjailed by ${message.author.tag}`);
        clearTimedActions(message.guild.id, target.id, 'jail');
        logModAction({ guildId: message.guild?.id, moderator: message.author, target: target.user, action: 'unjail', reason: 'Manual unjail' });
        addCase(message.guild, { type: 'unjail', target: target.user, moderator: message.author, reason: 'Released from jail by staff' });
        await dmPunishment(target.user, message.guild, 'unjail', { reason: 'Released by staff' });
        sendEmbed(message.channel, `Unjailed **${target.displayName}**.`, { title: '🔓 Unjail' });
    } catch (err) {
        logError(err);
        replyEmbed(message, 'Failed to unjail that user.', { color: errorColor });
    }
}

module.exports = { handleUnjailCommand };
