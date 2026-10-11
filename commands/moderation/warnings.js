const TARGET_PATTERN = /^<@!?\d{17,20}>$|^\d{17,20}$/;
const WARNING_NUMBER_PATTERN = /^#?\d{1,4}$/;

async function handleRemoveWarningCommand(message, args, prefix, {
    permission,
    hasModerationPermission,
    resolveTargetMember,
    guildCases,
    saveCases,
    addCase,
    replyEmbed,
    sendEmbed,
    errorColor,
}) {
    if (!hasModerationPermission(message.member, permission)) {
        return replyEmbed(message, 'Only staff can remove warnings.', { title: '🔒 Staff only', color: errorColor });
    }

    const usage = `Usage: \`${prefix}removewarn @user <number>\`, e.g. \`${prefix}removewarn @user 2\` removes their 2nd warning. See the numbers with \`${prefix}warnings @user\`.`;
    const mention = args.find((arg) => TARGET_PATTERN.test(arg));
    const target = await resolveTargetMember(message, mention);
    const number = parseInt(args.find((arg) => WARNING_NUMBER_PATTERN.test(arg))?.replace('#', ''), 10);
    if (!target || !number) return replyEmbed(message, usage, { color: errorColor });

    const active = guildCases(message.guild.id)
        .filter((entry) => entry.type === 'warn' && entry.active && entry.targetId === target.id)
        .sort((a, b) => a.at - b.at);
    const entry = active[number - 1];
    if (!entry) {
        return replyEmbed(
            message,
            active.length
                ? `**${target.displayName}** only has **${active.length}** active warning${active.length === 1 ? '' : 's'}. ${usage}`
                : `**${target.displayName}** has no active warnings.`,
            { color: errorColor, title: '⚠️ Remove warning' },
        );
    }

    entry.active = false;
    saveCases();
    addCase(message.guild, {
        type: 'unwarn',
        target: target.user,
        moderator: message.author,
        reason: `Removed warning: ${entry.reason}`,
    });
    const remaining = active.length - 1;
    return sendEmbed(
        message.channel,
        `Removed warning **${number}** from **${target.displayName}**:\n> ${entry.reason}\n-# They now have **${remaining}** active warning${remaining === 1 ? '' : 's'}.`,
        { title: '⚠️ Warning removed' },
    );
}

async function handleClearWarningsCommand(message, args, prefix, {
    permission,
    hasModerationPermission,
    resolveTargetMember,
    guildCases,
    saveCases,
    addCase,
    replyEmbed,
    sendEmbed,
    errorColor,
}) {
    if (!hasModerationPermission(message.member, permission)) {
        return replyEmbed(message, 'Only staff can clear warnings.', { title: '🔒 Staff only', color: errorColor });
    }

    const target = await resolveTargetMember(message, args[0]);
    if (!target) return replyEmbed(message, `Usage: \`${prefix}clearwarns @user\``, { color: errorColor });
    const active = guildCases(message.guild.id)
        .filter((entry) => entry.type === 'warn' && entry.active && entry.targetId === target.id);
    if (!active.length) {
        return replyEmbed(message, `**${target.displayName}** has no active warnings.`, { title: '⚠️ Clear warnings' });
    }

    for (const entry of active) entry.active = false;
    saveCases();
    addCase(message.guild, {
        type: 'unwarn',
        target: target.user,
        moderator: message.author,
        reason: `Cleared all ${active.length} warning(s)`,
    });
    return sendEmbed(
        message.channel,
        `Cleared **${active.length}** warning${active.length === 1 ? '' : 's'} from **${target.displayName}**. Clean slate!`,
        { title: '⚠️ Clear warnings' },
    );
}

module.exports = { handleRemoveWarningCommand, handleClearWarningsCommand };
