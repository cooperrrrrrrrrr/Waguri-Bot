async function handleVerificationGateCommand(message, args, prefix, {
    hasAdminAccess,
    denyAdminCommand,
    replyEmbed,
    sendEmbed,
    makeEmbed,
    setupVerification,
    disableVerification,
    verifySettings,
    logModAction,
    errorColor,
}) {
    if (!hasAdminAccess(message.member)) return denyAdminCommand(message, `${prefix}verify`);

    const subcommand = (args[0] || 'status').toLowerCase();
    if (subcommand === 'setup') {
        const channel = message.mentions.channels.first();
        if (!channel?.isTextBased()) {
            return replyEmbed(message, `Usage: \`${prefix}verify setup #verify-channel\` (make a new channel for it first)`, { color: errorColor });
        }

        const status = await message.channel.send({ embeds: [makeEmbed('Setting up the verification gate...', { title: '✅ Verification' })] });
        const result = await setupVerification(
            message.guild,
            channel,
            (text) => status.edit({ embeds: [makeEmbed(text, { title: '✅ Verification' })] }).catch(() => {}),
        );
        logModAction({
            guildId: message.guild.id,
            moderator: message.author,
            target: { id: message.guild.id, tag: message.guild.name },
            action: 'verify:setup',
            reason: `#${channel.name}`,
        });
        return status.edit({
            embeds: [makeEmbed(`The verification gate is **on**! 🎉\n\n• New members get ${result.role} and can only see ${channel} until they verify\n• ${result.channels} channels are hidden from unverified members\n• Existing members aren't affected\n\nTurn it off with \`${prefix}verify off\`.`, { title: '✅ Verification gate ON' })],
        });
    }

    if (subcommand === 'off') {
        const released = await disableVerification(message.guild);
        return sendEmbed(message.channel, `The verification gate is **off**. ${released} waiting member(s) were let in.`, { title: '✅ Verification gate OFF' });
    }

    const verification = verifySettings(message.guild.id);
    return sendEmbed(
        message.channel,
        verification
            ? `The verification gate is **on** in <#${verification.channelId}> (role <@&${verification.roleId}>).`
            : `The verification gate is **off**. Turn it on with \`${prefix}verify setup #channel\`.`,
        { title: '✅ Verification gate' },
    );
}

module.exports = { handleVerificationGateCommand };
