async function handleAuditWatchdog(entry, guild, trusted, executorId, {
    auditLogEvent,
    clientUserId,
    botName,
    membersFetch,
    hasDangerousPermission,
    lostDangerousPermission,
    neutralizeNuker,
    sendSecurityAlert,
    getPrefix,
    logger = console,
}) {
    const me = guild.members.me;
    if (!trusted && entry.action === auditLogEvent.RoleUpdate && entry.targetId !== guild.id && me?.roles.cache.has(entry.targetId)) {
        const change = entry.changes.find((item) => item.key === 'permissions');
        if (change && lostDangerousPermission(change.old, change.new)) {
            const role = guild.roles.cache.get(entry.targetId);
            if (role?.editable) {
                await role.setPermissions(BigInt(change.old ?? 0), `${botName} Security: someone took permissions away from ${botName}`).catch(() => {});
            }
            await neutralizeNuker(guild, executorId, `took permissions away from ${botName}`, 1);
            return true;
        }
    }
    if (!trusted && entry.action === auditLogEvent.MemberRoleUpdate && entry.targetId === clientUserId
        && entry.changes.some((item) => item.key === '$remove')) {
        const removed = (entry.changes.find((item) => item.key === '$remove')?.new ?? []).map((role) => role.id);
        const giveBack = removed.filter((id) => guild.roles.cache.get(id)?.editable);
        if (giveBack.length) {
            await me?.roles.add(giveBack, `${botName} Security: someone took roles away from ${botName}`).catch(() => {});
        }
        await neutralizeNuker(guild, executorId, `took roles away from ${botName}`, 1);
        return true;
    }

    if (entry.action === auditLogEvent.BotAdd) {
        let kicked = false;
        if (!trusted) {
            const bot = await membersFetch(entry.targetId).catch(() => null);
            kicked = Boolean(bot?.kickable) && await bot.kick(`${botName} Security: bot added by someone who is not trusted`).then(() => true).catch(() => false);
        }
        await sendSecurityAlert(guild, {
            title: kicked ? 'Unapproved bot removed' : 'A bot was added',
            description: kicked
                ? `<@${executorId}> added the bot <@${entry.targetId}>, but only the owner or trusted people can add bots, so I **kicked it**.\nIf it's wanted, the owner can add it (or \`${getPrefix(guild.id)}security trust\` the person first).`
                : `<@${executorId}> added the bot <@${entry.targetId}>. Make sure it's one you trust.`,
            color: kicked ? 0xffa500 : 0x5e60ce,
        });
        return false;
    }
    if (entry.action === auditLogEvent.WebhookCreate) {
        await sendSecurityAlert(guild, {
            title: 'Webhook created',
            description: `<@${executorId}> created a webhook${entry.target?.channelId ? ` in <#${entry.target.channelId}>` : ''}. Webhooks can post as anyone - make sure it's expected.`,
            color: 0x5e60ce,
        });
        return false;
    }
    if (entry.action === auditLogEvent.RoleUpdate) {
        const change = entry.changes.find((item) => item.key === 'permissions');
        if (change && hasDangerousPermission(change.new) && !hasDangerousPermission(change.old)) {
            const role = guild.roles.cache.get(entry.targetId);
            const reverted = !trusted && Boolean(role?.editable)
                && await role.setPermissions(BigInt(change.old ?? 0), `${botName} Security: powerful permissions added by someone who is not trusted`).then(() => true).catch(() => false);
            await sendSecurityAlert(guild, {
                title: reverted ? 'Powerful permissions undone' : 'Role given powerful permissions',
                description: `<@${executorId}> gave <@&${entry.targetId}> permissions like Administrator, Manage Server or Ban Members.` +
                    (reverted ? `\nThey aren't trusted, so I **put the role back how it was**. The owner can make the change (or \`${getPrefix(guild.id)}security trust\` them).` : ''),
                color: 0xffa500,
            });
        }
        return false;
    }
    if (entry.action === auditLogEvent.MemberRoleUpdate) {
        const added = entry.changes.find((item) => item.key === '$add')?.new ?? [];
        const powerful = added.filter((role) => hasDangerousPermission(guild.roles.cache.get(role.id)?.permissions.bitfield));
        if (powerful.length) {
            let reverted = false;
            if (!trusted) {
                const target = await membersFetch(entry.targetId).catch(() => null);
                const removable = powerful.filter((role) => guild.roles.cache.get(role.id)?.editable).map((role) => role.id);
                reverted = Boolean(target) && removable.length > 0
                    && await target.roles.remove(removable, `${botName} Security: powerful role given by someone who is not trusted`).then(() => true).catch(() => false);
            }
            await sendSecurityAlert(guild, {
                title: reverted ? 'Powerful role taken back' : 'Powerful role given to a member',
                description: `<@${executorId}> gave <@${entry.targetId}> ${powerful.map((role) => `<@&${role.id}>`).join(', ')}.` +
                    (reverted ? `\nThey aren't trusted, so I **removed it again**. The owner can give it (or \`${getPrefix(guild.id)}security trust\` them).` : ''),
                color: 0xffa500,
            });
        }
        return false;
    }
    if (entry.action === auditLogEvent.GuildUpdate) {
        const keys = entry.changes.map((item) => item.key);
        const vanity = entry.changes.find((item) => item.key === 'vanity_url_code');
        if (vanity && !trusted) {
            await neutralizeNuker(guild, executorId, `changed the server's vanity URL (from \`${vanity.old ?? 'none'}\` to \`${vanity.new ?? 'none'}\`)`, 1);
            return true;
        }
        const putBack = [];
        if (!trusted) {
            const reason = `${botName} Security: safety setting lowered by someone who is not trusted`;
            const level = entry.changes.find((item) => item.key === 'verification_level');
            if (level && level.new < level.old
                && await guild.setVerificationLevel(level.old, reason).then(() => true).catch(() => false)) {
                putBack.push('verification level');
            }
            const filter = entry.changes.find((item) => item.key === 'explicit_content_filter');
            if (filter && filter.new < filter.old
                && await guild.setExplicitContentFilter(filter.old, reason).then(() => true).catch(() => false)) {
                putBack.push('explicit media filter');
            }
        }
        const notable = keys.filter((key) => ['name', 'icon_hash', 'banner_hash', 'vanity_url_code', 'mfa_level', 'verification_level', 'explicit_content_filter', 'owner_id'].includes(key));
        if (notable.length) {
            await sendSecurityAlert(guild, {
                title: putBack.length ? 'Safety settings put back' : 'Server settings changed',
                description: `<@${executorId}> changed: **${notable.map((key) => key.replace(/_hash$/, '').replace(/_/g, ' ')).join(', ')}**.` +
                    (putBack.length ? `\nThey aren't trusted, so I **put the ${putBack.join(' and ')} back**. The owner can make the change (or \`${getPrefix(guild.id)}security trust\` them).` : ''),
                color: putBack.length ? 0xffa500 : 0x5e60ce,
            });
        }
        return true;
    }
    return false;
}

module.exports = { handleAuditWatchdog };
