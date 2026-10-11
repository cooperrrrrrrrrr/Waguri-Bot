async function handleSecurityStatusCommand(message, prefix, {
    permissionFlags,
    getSecurityAlertChannel,
    securitySettings,
    createEmbed,
    themeColor,
    botName,
    phishingDomainCount,
    automodCsamRule,
    mentionSpamTrigger,
    spamTrigger,
}) {
    const me = message.guild.members.me;
    const requiredPermissions = [
        ['Manage Messages', permissionFlags.ManageMessages, 'delete spam'],
        ['Moderate Members', permissionFlags.ModerateMembers, 'time out spammers'],
        ['Ban Members', permissionFlags.BanMembers, 'ban CSAM advertisers'],
        ['Manage Server', permissionFlags.ManageGuild, 'set up AutoMod'],
    ];
    const permissionLines = requiredPermissions.map(([name, flag, reason]) => `${me?.permissions.has(flag) ? '✅' : '❌'} ${name} - to ${reason}`);
    const alertChannel = getSecurityAlertChannel(message.guild);
    let automodLines = ['Could not read AutoMod rules (needs Manage Server).'];

    if (me?.permissions.has(permissionFlags.ManageGuild)) {
        const rules = await message.guild.autoModerationRules.fetch().catch(() => null);
        const status = (label, matches) => {
            const rule = rules?.find((entry) => matches(entry) && entry.enabled);
            return `${rule ? '✅' : '❌'} ${label}${rule && !rule.name.startsWith(`${botName} •`) ? ` (your rule "${rule.name}")` : ''}`;
        };
        automodLines = [
            status('CSAM-advertising blocker', (rule) => rule.name === automodCsamRule),
            status('Mention-spam limit', (rule) => rule.triggerType === mentionSpamTrigger),
            status('Suspected-spam filter', (rule) => rule.triggerType === spamTrigger),
        ];
    }

    const settings = securitySettings.get(message.guild.id);
    const embed = createEmbed()
        .setColor(themeColor)
        .setTitle(`🛡️ ${botName} Security`)
        .setDescription([
            'Always on: CSAM-advertising blocker, scam-link blocker, cross-channel spam and flood protection, raid alerts.',
            'Slur filter (everyone, staff included; bypasses like n1gg@, n.i.g.g.a and look-alike letters are caught): the n-word is deleted with a warning DM, the hard-R version also gets a 5-minute timeout, and rape language a 2-minute timeout. Every hit is alerted.',
            'No one (except staff) can post server invites, Telegram links, file-sharing links or executable files.',
            "New members (first 24h, or accounts under 7 days) also can't post shortened links, IP-address links or archives (.zip, .rar...).",
            'Disguised links (text showing one site, linking to another) are removed for everyone.',
            `Anti-nuke (limits: **${settings?.limits ?? 'normal'}**, punishment: **${settings?.punish ?? 'strip'}**): anyone mass-deleting channels/roles, mass-banning, mass-timing-out, mass-removing roles or mass-creating webhooks is stopped, and ${botName} rebuilds what they deleted, gives members their roles back, unbans who they banned, lifts their timeouts and deletes their webhooks. Taking permissions away from ${botName} stops them instantly.`,
            'Auto-undo: powerful permissions or roles given out by someone untrusted are taken back, lowered safety settings are put back, and bots they add are kicked.',
            'Webhooks and bots that flood or keep pinging @everyone are shut down.',
            `Downtime alerts: staff are warned if ${botName} goes offline. Anti-nuke remembers everything across restarts and checks the audit log for anything missed.`,
            'Raid mode switches on automatically during raids and quarantines brand-new accounts.',
            `Known scam sites are blocked using a list of ${phishingDomainCount.toLocaleString('en-US')} phishing domains (updated twice a day).`,
            'Server backups are saved daily; ban evaders and impersonators are flagged to staff.',
            'Staff are never affected.',
        ].join('\n'))
        .addFields(
            { name: 'Alert channel', value: alertChannel ? `${alertChannel}` : `❌ Not set - \`${prefix}security alerts #channel\`` },
            { name: `${botName}'s permissions`, value: permissionLines.join('\n') },
            { name: 'Discord AutoMod rules', value: `${automodLines.join('\n')}\nSet up / refresh: \`${prefix}security automod\`` },
            {
                name: 'Also recommended (Server Settings → Safety Setup)',
                value: [
                    '• Turn on **Raid protection** and the **DM spam filter**',
                    '• Verification level **Medium** or higher, explicit media filter for **all members**',
                    '• **Require 2FA** for moderator actions',
                ].join('\n'),
            },
        );
    return message.channel.send({ embeds: [embed] });
}

module.exports = { handleSecurityStatusCommand };
