async function handleLockdownCommand(message, args, prefix, {
    permission,
    hasModerationPermission,
    securitySettings,
    replyEmbed,
    sendEmbed,
    makeEmbed,
    lockdownServer,
    logModAction,
    sendSecurityAlert,
    editChannelOverwrite,
    isSendMessagesDenied,
    errorColor,
}) {
    if (!hasModerationPermission(message.member, permission)) {
        return replyEmbed(message, 'Only staff can lock down channels.', { title: '🔒 Staff only', color: errorColor });
    }

    if ((args[0] || '').toLowerCase() === 'server') {
        if (securitySettings.get(message.guild.id)?.lockdown) {
            return replyEmbed(message, `The server is already locked down. Use \`${prefix}unlock server\` to lift it.`, { color: errorColor });
        }

        const status = await message.channel.send({ embeds: [makeEmbed('Locking every channel...', { title: '🔒 Server lockdown' })] });
        const count = await lockdownServer(message.guild, (text) => status.edit({
            embeds: [makeEmbed(text, { title: '🔒 Server lockdown' })],
        }).catch(() => {}));
        const reason = args.slice(1).join(' ') || 'No reason given';
        logModAction({
            guildId: message.guild.id,
            moderator: message.author,
            target: { id: message.guild.id, tag: message.guild.name },
            action: 'lockdown:server',
            reason,
        });
        await sendSecurityAlert(message.guild, {
            title: 'Server locked down',
            description: `${message.author} locked **${count}** channels. Reason: ${reason}`,
            color: 0xffa500,
        });
        return status.edit({
            embeds: [makeEmbed(`**${count}** channels are locked - only staff can talk.\nReason: ${reason}\n\nLift it with \`${prefix}unlock server\` (every channel goes back exactly how it was).`, { title: '🔒 Server lockdown' })],
        });
    }

    if (isSendMessagesDenied(message.channel.permissionOverwrites.cache.get(message.guild.id) ?? null)) {
        return sendEmbed(message.channel, 'This channel is already locked down.', { title: '🔒 Lockdown' });
    }

    await editChannelOverwrite(message.channel, message.guild.id, { SendMessages: false });
    logModAction({
        guildId: message.guild?.id,
        moderator: message.author,
        target: { id: message.channel.id, tag: message.channel.name },
        action: 'lockdown',
        reason: 'Channel lockdown',
    });
    return sendEmbed(message.channel, 'This channel has been locked down to non-moderators.', { title: '🔒 Lockdown' });
}

async function handleUnlockCommand(message, args, {
    permission,
    hasModerationPermission,
    replyEmbed,
    sendEmbed,
    unlockServer,
    logModAction,
    sendSecurityAlert,
    editChannelOverwrite,
    errorColor,
}) {
    if (!hasModerationPermission(message.member, permission)) {
        return replyEmbed(message, 'Only staff can unlock channels.', { title: '🔒 Staff only', color: errorColor });
    }

    if ((args[0] || '').toLowerCase() === 'server') {
        const restored = await unlockServer(message.guild);
        if (restored === null) {
            return replyEmbed(message, 'The server isn\'t locked down.', { color: errorColor });
        }
        logModAction({
            guildId: message.guild.id,
            moderator: message.author,
            target: { id: message.guild.id, tag: message.guild.name },
            action: 'unlock:server',
            reason: 'Server lockdown lifted',
        });
        await sendSecurityAlert(message.guild, {
            title: 'Server lockdown lifted',
            description: `${message.author} restored **${restored}** channels.`,
            color: 0x57f287,
        });
        return sendEmbed(message.channel, `Lockdown lifted - **${restored}** channels are back exactly how they were. 💙`, { title: '🔓 Server unlocked' });
    }

    await editChannelOverwrite(message.channel, message.guild.id, { SendMessages: null });
    logModAction({
        guildId: message.guild?.id,
        moderator: message.author,
        target: { id: message.channel.id, tag: message.channel.name },
        action: 'unlock',
        reason: 'Channel unlock',
    });
    return sendEmbed(message.channel, 'This channel has been unlocked.', { title: '🔓 Unlock' });
}

module.exports = { handleLockdownCommand, handleUnlockCommand };
