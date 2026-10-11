const AUDIT_FIX_INDENT = String.fromCharCode(0x3000);

async function runSecurityAudit(guild, {
    permissionFlags,
    verificationLevel,
    explicitContentFilter,
    mfaLevel,
    defaultMessageNotifications,
    clientUserId,
    botName,
    securitySettings,
    getSecurityAlertChannel,
    getPrefix,
    listBackups,
    automodCsamRule,
    createEmbed,
}) {
    const lines = [];
    let passed = 0;
    let total = 0;
    const check = (ok, good, bad, fix) => {
        total++;
        if (ok) passed++;
        lines.push(ok ? `✅ ${good}` : `❌ ${bad}${fix ? `\n${AUDIT_FIX_INDENT}↳ *${fix}*` : ''}`);
    };

    const everyone = guild.roles.everyone.permissions;
    const risky = ['Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'BanMembers', 'KickMembers', 'ManageWebhooks', 'MentionEveryone', 'ManageMessages']
        .filter((permission) => everyone.has(permissionFlags[permission]));
    check(!risky.length, '@everyone has no dangerous permissions', `@everyone can: ${risky.join(', ')}`, 'Server Settings → Roles → @everyone: turn these off');

    await guild.members.fetch().catch(() => {});
    const admins = guild.members.cache.filter((member) => !member.user.bot && member.permissions.has(permissionFlags.Administrator));
    check(admins.size <= 5, `${admins.size} people have Administrator`, `${admins.size} people have Administrator`, 'Fewer admins = fewer accounts that can be hacked into wiping the server');
    const adminBots = guild.members.cache.filter((member) => member.user.bot && member.id !== clientUserId && member.permissions.has(permissionFlags.Administrator));
    check(!adminBots.size, 'No other bots have Administrator', `${adminBots.size} other bot(s) have Administrator: ${adminBots.map((member) => member.user.username).join(', ')}`, 'Give bots only the permissions they need');

    const me = guild.members.me;
    const topRole = guild.roles.highest;
    check(me.roles.highest.id === topRole.id || me.roles.highest.position >= topRole.position - 1, `${botName}'s role is at the top`, `${botName}'s role isn't near the top`, `Drag ${botName}'s role to the top so anti-nuke can act on anyone`);
    check(me.permissions.has(permissionFlags.Administrator) || me.permissions.has(permissionFlags.ManageRoles), `${botName} can manage roles`, `${botName} can't manage roles`, `Give ${botName} Manage Roles (or Administrator)`);

    check(guild.verificationLevel >= verificationLevel.Medium, 'Verification level is Medium or higher', 'Verification level is low', 'Server Settings → Safety Setup → Verification Level: Medium or higher');
    check(guild.explicitContentFilter === explicitContentFilter.AllMembers, 'Explicit media filter is on for everyone', 'Explicit media filter is not on for all members', 'Safety Setup → Explicit image filter: all members');
    check(guild.mfaLevel === mfaLevel.Elevated, '2FA is required for moderation', '2FA is not required for moderation', 'Safety Setup → Require 2FA for moderator actions');
    check(guild.defaultMessageNotifications === defaultMessageNotifications.OnlyMentions, 'Default notifications: only @mentions', 'Default notifications: all messages', 'Server Settings → Overview → Default Notification Settings: only @mentions');

    const webhooks = await guild.fetchWebhooks().catch(() => null);
    if (webhooks) check(webhooks.size <= 10, `${webhooks.size} webhook(s)`, `${webhooks.size} webhooks exist`, 'Delete webhooks you don\'t use (Channel Settings → Integrations)');

    const settings = securitySettings.get(guild.id) ?? {};
    check(Boolean(getSecurityAlertChannel(guild)), 'Security alert channel is set', 'No security alert channel', `\`${getPrefix(guild.id)}security alerts #channel\``);
    const rules = await guild.autoModerationRules.fetch().catch(() => null);
    check(Boolean(rules?.some((rule) => rule.name === automodCsamRule && rule.enabled)), 'AutoMod blocker is set up', 'AutoMod blocker is not set up', `\`${getPrefix(guild.id)}security automod\``);
    check(Boolean(settings.verify?.enabled), 'Verification gate is on', 'Verification gate is off', `\`${getPrefix(guild.id)}verify setup #channel\``);
    check(listBackups(guild.id).length > 0, `${listBackups(guild.id).length} server backup(s) saved`, 'No server backups yet', '`.backup create`');

    const score = Math.round((passed / total) * 100);
    const grade = score >= 90 ? '🟢 Excellent' : score >= 70 ? '🟡 Good' : score >= 50 ? '🟠 Needs work' : '🔴 At risk';
    return createEmbed()
        .setColor(score >= 90 ? 0x57f287 : score >= 70 ? 0xfee75c : 0xed4245)
        .setTitle(`🛡️ Security audit - ${score}/100 ${grade}`)
        .setDescription(`${passed} of ${total} checks passed.\n\n${lines.join('\n')}`.slice(0, 4096))
        .setTimestamp(new Date());
}

module.exports = { runSecurityAudit };
