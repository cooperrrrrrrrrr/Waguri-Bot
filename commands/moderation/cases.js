async function handleCaseCommand(message, args, prefix, {
    permission,
    hasModerationPermission,
    guildCases,
    formatDurationMs,
    replyEmbed,
    sendEmbed,
    errorColor,
}) {
    if (!hasModerationPermission(message.member, permission)) {
        return replyEmbed(message, 'Only staff can view cases.', { title: '🔒 Staff only', color: errorColor });
    }

    const id = parseInt(args[0], 10);
    const entry = guildCases(message.guild.id).find((item) => item.id === id);
    if (!entry) return replyEmbed(message, `Usage: \`${prefix}case <number>\``, { color: errorColor });
    const duration = entry.until ? `\n**Duration:** ${formatDurationMs(entry.until - entry.at)}` : '';
    return sendEmbed(
        message.channel,
        `**Type:** ${entry.type}${entry.active ? '' : ' (removed)'}\n**User:** ${entry.targetTag} (\`${entry.targetId}\`)\n**Moderator:** ${entry.modTag}\n**When:** <t:${Math.floor(entry.at / 1000)}:F>${duration}\n**Reason:** ${entry.reason}`,
        { title: `🗂️ Case #${entry.id}` },
    );
}

async function handleCasesCommand(message, args, {
    permission,
    hasModerationPermission,
    resolveTargetMember,
    guildCases,
    replyEmbed,
    sendEmbed,
    errorColor,
}) {
    if (!hasModerationPermission(message.member, permission)) {
        return replyEmbed(message, 'Only staff can view cases.', { title: '🔒 Staff only', color: errorColor });
    }

    const target = await resolveTargetMember(message, args[0]);
    let list = guildCases(message.guild.id);
    if (target) list = list.filter((entry) => entry.targetId === target.id);
    list = list.slice(-15).reverse();
    const lines = list.map((entry) => `**#${entry.id}** \`${entry.type}\` - ${entry.targetTag} · <t:${Math.floor(entry.at / 1000)}:R>${entry.active ? '' : ' *(removed)*'}\n${entry.reason}`);
    return sendEmbed(
        message.channel,
        list.length ? lines.join('\n\n') : 'No cases yet.',
        { title: target ? `🗂️ Cases for ${target.displayName}` : '🗂️ Recent cases' },
    );
}

module.exports = { handleCaseCommand, handleCasesCommand };
