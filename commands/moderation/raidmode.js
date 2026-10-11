async function handleRaidmodeCommand(message, args, prefix, {
    isStaffMember,
    replyEmbed,
    setRaidMode,
    logModAction,
    sendSecurityAlert,
    sendEmbed,
    raidModeUntil,
    isRaidMode,
    raidQuarantineAccountDays,
    raidJoins,
    errorColor,
}) {
    if (!isStaffMember(message.member)) {
        return replyEmbed(message, 'Only staff can change raid mode.', { title: '🔒 Staff only', color: errorColor });
    }

    const subcommand = (args[0] || 'status').toLowerCase();
    if (subcommand === 'on') {
        const minutes = Math.min(Math.max(parseInt(args[1], 10) || 30, 1), 24 * 60);
        setRaidMode(message.guild.id, minutes * 60 * 1000);
        logModAction({
            guildId: message.guild.id,
            moderator: message.author,
            target: { id: message.guild.id, tag: message.guild.name },
            action: 'raidmode:on',
            reason: `${minutes} minutes`,
        });
        await sendSecurityAlert(message.guild, {
            title: 'Raid mode turned ON',
            description: `${message.author} turned raid mode on for **${minutes} minutes**. Accounts younger than ${raidQuarantineAccountDays} days that join will be timed out for 1 hour.`,
            color: 0xffa500,
        });
        return sendEmbed(
            message.channel,
            `Raid mode is **on** for **${minutes} minutes**. New accounts (under ${raidQuarantineAccountDays} days old) that join are quarantined with a 1-hour timeout.\nTurn it off with \`${prefix}raidmode off\`.`,
            { title: '🚨 Raid mode ON' },
        );
    }

    if (subcommand === 'off') {
        setRaidMode(message.guild.id, 0);
        logModAction({
            guildId: message.guild.id,
            moderator: message.author,
            target: { id: message.guild.id, tag: message.guild.name },
            action: 'raidmode:off',
            reason: 'Manual',
        });
        return sendEmbed(message.channel, 'Raid mode is **off**. New members can join normally again.', { title: '✅ Raid mode OFF' });
    }

    const until = raidModeUntil.get(message.guild.id) ?? 0;
    return sendEmbed(
        message.channel,
        isRaidMode(message.guild.id)
            ? `Raid mode is **on** until <t:${Math.floor(until / 1000)}:t> (<t:${Math.floor(until / 1000)}:R>).`
            : `Raid mode is **off**. It turns on by itself if ${raidJoins}+ members join within a minute, or use \`${prefix}raidmode on [minutes]\`.`,
        { title: '🚨 Raid mode' },
    );
}

module.exports = { handleRaidmodeCommand };
