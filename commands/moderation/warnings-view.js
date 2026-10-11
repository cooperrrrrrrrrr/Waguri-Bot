async function handleWarningsViewCommand(commandName, message, args, prefix, {
    permission,
    hasModerationPermission,
    resolveTargetMember,
    guildCases,
    createEmbed,
    themeColor,
    avatarOf,
    replyEmbed,
    errorColor,
}) {
    const own = commandName.startsWith('my');
    if (!own && !hasModerationPermission(message.member, permission)) {
        return replyEmbed(
            message,
            `Only staff can view other people's warnings. See your own with \`${prefix}mywarns\`.`,
            { title: '🔒 Staff only', color: errorColor },
        );
    }

    const target = own ? message.member : (await resolveTargetMember(message, args[0]) || message.member);
    const all = guildCases(message.guild.id).filter((entry) => entry.type === 'warn' && entry.targetId === target.id);
    const active = all.filter((entry) => entry.active).sort((a, b) => a.at - b.at);
    const shown = active.slice(0, 20);
    const lines = shown.map((entry, index) => `**${index + 1}.** <t:${Math.floor(entry.at / 1000)}:d> · by ${entry.modTag}\n> ${String(entry.reason).replace(/\n/g, '\n> ')}`);
    if (active.length > shown.length) lines.push(`-# ...and ${active.length - shown.length} more.`);

    const embed = createEmbed()
        .setColor(themeColor)
        .setTitle(`⚠️ ${own ? 'Your warnings' : `Warnings for ${target.displayName}`}`)
        .setThumbnail(avatarOf(target, message.guild, { extension: 'png', size: 128 }))
        .addFields(
            { name: 'Active', value: `\`${active.length}\``, inline: true },
            { name: 'Removed', value: `\`${all.length - active.length}\``, inline: true },
            { name: 'Total', value: `\`${all.length}\``, inline: true },
        )
        .setDescription(lines.length ? lines.join('\n\n') : 'No active warnings.');
    if (!own) embed.setFooter({ text: `${prefix}removewarn @user <number> · ${prefix}clearwarns @user` });
    return message.channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
}

module.exports = { handleWarningsViewCommand };
