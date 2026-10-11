async function handleSecuritySettingsCommand(message, args, prefix, subcommand, {
    botName,
    securitySettings,
    saveSecuritySettings,
    updateGuildSecurity,
    isOwnerOf,
    resolveTargetMember,
    limitPresets,
    replyEmbed,
    sendEmbed,
    makeEmbed,
    logModAction,
    errorColor,
}) {
    if (subcommand === 'alerts') {
        const channel = message.mentions.channels.first();
        if (!channel?.isTextBased()) {
            return {
                handled: true,
                result: replyEmbed(message, `Usage: \`${prefix}security alerts #channel\` - where ${botName} posts security alerts (make it staff-only).`, { color: errorColor }),
            };
        }
        securitySettings.set(message.guild.id, { ...securitySettings.get(message.guild.id), alertChannelId: channel.id });
        saveSecuritySettings();
        return {
            handled: true,
            result: sendEmbed(message.channel, `Security alerts will go to ${channel}.\nNext, run \`${prefix}security automod\` so Discord blocks the worst messages before anyone sees them.`, { title: '🛡️ Alert channel set' }),
        };
    }

    if (['trust', 'untrust', 'trusted'].includes(subcommand)) {
        const trusted = securitySettings.get(message.guild.id)?.trusted ?? [];
        if (subcommand === 'trusted') {
            const list = trusted.map((id) => `• <@${id}>`).join('\n') || 'Nobody yet (the server owner and co-owner are always trusted).';
            return {
                handled: true,
                result: message.channel.send({ embeds: [makeEmbed(list, { title: '🤝 Trusted for big actions' })], allowedMentions: { parse: [] } }),
            };
        }
        if (!isOwnerOf(message.guild, message.author.id)) {
            return {
                handled: true,
                result: replyEmbed(message, 'Only the **server owner or co-owner** can change who is trusted - so a hacked admin account can never trust itself.', { title: '🔒 Owner only', color: errorColor }),
            };
        }
        const target = await resolveTargetMember(message, args[1]);
        if (!target) {
            return {
                handled: true,
                result: replyEmbed(message, `Usage: \`${prefix}security ${subcommand} @user\``, { color: errorColor }),
            };
        }
        const next = subcommand === 'trust' ? [...new Set([...trusted, target.id])] : trusted.filter((id) => id !== target.id);
        updateGuildSecurity(message.guild.id, { trusted: next });
        return {
            handled: true,
            result: sendEmbed(
                message.channel,
                subcommand === 'trust'
                    ? `${target} is now **trusted**: auto-undo leaves their changes alone, and anti-nuke only stops them if they go far past the limits.`
                    : `${target} is **no longer trusted**.`,
                { title: '🤝 Trusted list updated' },
            ),
        };
    }

    if (subcommand === 'minage') {
        if ((args[1] || '').toLowerCase() === 'off') {
            updateGuildSecurity(message.guild.id, { minAge: null });
            return {
                handled: true,
                result: sendEmbed(message.channel, 'The account-age gate is **off**.', { title: '🎂 Account-age gate' }),
            };
        }
        const days = parseInt(args[1], 10);
        const action = (args[2] || 'timeout').toLowerCase();
        if (!Number.isInteger(days) || days < 1 || days > 365 || !['kick', 'timeout'].includes(action)) {
            return {
                handled: true,
                result: replyEmbed(message, `Usage: \`${prefix}security minage <days> [kick|timeout]\` (1-365 days) or \`${prefix}security minage off\``, { color: errorColor }),
            };
        }
        updateGuildSecurity(message.guild.id, { minAge: { days, action } });
        return {
            handled: true,
            result: sendEmbed(
                message.channel,
                `Accounts younger than **${days} day(s)** will be **${action === 'kick' ? 'kicked (with a DM explaining why)' : 'timed out until they\'re old enough (up to 28 days)'}** when they join.`,
                { title: '🎂 Account-age gate ON' },
            ),
        };
    }

    if (subcommand === 'limits' || subcommand === 'punish') {
        const settings = securitySettings.get(message.guild.id) ?? {};
        const choices = subcommand === 'limits' ? Object.keys(limitPresets) : ['strip', 'kick', 'ban'];
        const current = subcommand === 'limits' ? settings.limits ?? 'normal' : settings.punish ?? 'strip';
        const explain = {
            strict: 'half the normal limits (e.g. 2 channel deletes in a minute)',
            normal: 'the default limits (e.g. 3 channel deletes in a minute)',
            relaxed: 'double the normal limits (e.g. 6 channel deletes in a minute)',
            strip: 'remove their powerful roles and time them out for 1 hour',
            kick: 'kick them from the server',
            ban: 'ban them from the server',
        };
        const choice = (args[1] || '').toLowerCase();
        if (!choice) {
            return {
                handled: true,
                result: sendEmbed(
                    message.channel,
                    `Currently **${current}**: ${explain[current]}.\n\nOptions: ${choices.map((item) => `\`${item}\` - ${explain[item]}`).join('\n')}\n\nChange it (owner only): \`${prefix}security ${subcommand} <${choices.join('|')}>\``,
                    { title: subcommand === 'limits' ? '🛡️ Anti-nuke limits' : '🛡️ Anti-nuke punishment' },
                ),
            };
        }
        if (!isOwnerOf(message.guild, message.author.id)) {
            return {
                handled: true,
                result: replyEmbed(message, 'Only the **server owner or co-owner** can change this - so a hacked admin account can never weaken anti-nuke.', { title: '🔒 Owner only', color: errorColor }),
            };
        }
        if (!choices.includes(choice)) {
            return {
                handled: true,
                result: replyEmbed(message, `Usage: \`${prefix}security ${subcommand} <${choices.join('|')}>\``, { color: errorColor }),
            };
        }
        updateGuildSecurity(message.guild.id, { [subcommand]: choice });
        logModAction({
            guildId: message.guild.id,
            moderator: message.author,
            target: { id: message.guild.id, tag: message.guild.name },
            action: `security:${subcommand}`,
            reason: choice,
        });
        return {
            handled: true,
            result: sendEmbed(
                message.channel,
                `Anti-nuke ${subcommand === 'limits' ? 'limits are' : 'punishment is'} now **${choice}**: ${explain[choice]}.`,
                { title: '🛡️ Anti-nuke updated' },
            ),
        };
    }

    return { handled: false };
}

module.exports = { handleSecuritySettingsCommand };
