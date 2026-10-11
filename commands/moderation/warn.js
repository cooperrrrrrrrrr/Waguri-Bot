async function handleWarnCommand(message, args, prefix, {
    permission,
    hasModerationPermission,
    resolveTargetMember,
    moderationBlockReason,
    replyEmbed,
    addCase,
    logModAction,
    dmPunishment,
    guildCases,
    sendEmbed,
    errorColor,
}) {
    if (!hasModerationPermission(message.member, permission)) {
        return replyEmbed(message, 'Only staff can warn members.', { title: '🔒 Staff only', color: errorColor });
    }
    const target = await resolveTargetMember(message, args[0]);
    const blocked = target && moderationBlockReason(message, target);
    if (blocked) return replyEmbed(message, blocked, { color: errorColor });
    if (!target) return replyEmbed(message, `Usage: \`${prefix}warn @user [reason]\`\n-# Or reply to their message and leave out the @user.`, { color: errorColor });

    const reason = args.slice(1).join(' ') || 'No reason provided';
    addCase(message.guild, { type: 'warn', target: target.user, moderator: message.author, reason });
    logModAction({ guildId: message.guild?.id, moderator: message.author, target: target.user, action: 'warn', reason });
    await dmPunishment(target.user, message.guild, 'warn', { reason });
    const count = guildCases(message.guild.id).filter((entry) => entry.type === 'warn' && entry.active && entry.targetId === target.id).length;
    return sendEmbed(message.channel, `Warned **${target.displayName}** - ${reason}\n-# They now have **${count}** active warning${count === 1 ? '' : 's'}.`, { title: '⚠️ Warn' });
}

module.exports = { handleWarnCommand };
