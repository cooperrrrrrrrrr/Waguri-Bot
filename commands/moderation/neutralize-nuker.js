async function neutralizeNuker(guild, executorId, label, count, {
    lastNukeActivityAt,
    markAntiNukeDirty,
    recentlyNeutralized,
    undoAttack,
    saveAntiNukeState,
    securitySettings,
    botName,
    membersFetch,
    dmPunishment,
    safeTimeout,
    getPrefix,
    dangerousPermissions,
    hasDangerousPermission,
    sleep,
    removeAttackerWebhooks,
    logModAction,
    clientUser,
    sendSecurityAlert,
    now = Date.now,
    logger = console,
}) {
    const key = `${guild.id}:${executorId}`;
    lastNukeActivityAt.set(guild.id, now());
    markAntiNukeDirty();
    if (now() - (recentlyNeutralized.get(key) ?? 0) < 5 * 60 * 1000) {
        await undoAttack(guild, executorId).catch((err) => logger.error('[anti-nuke] undo failed:', err));
        return;
    }
    recentlyNeutralized.set(key, now());
    saveAntiNukeState();

    const punish = securitySettings.get(guild.id)?.punish ?? 'strip';
    const reason = `${botName} Security: anti-nuke (${label})`;
    const member = await membersFetch(executorId).catch(() => null);
    let action = '⚠️ I could not act on them (they may have left, or rank above me). Please check them immediately.';

    if (member?.user.bot) {
        if (punish === 'ban' && member.bannable && await guild.members.ban(member.id, { reason }).then(() => true).catch(() => false)) {
            action = 'The bot was **banned**.';
        } else if (member.kickable && await member.kick(reason).then(() => true).catch(() => false)) {
            action = 'The bot was **kicked**.';
        }
    } else if (member) {
        const why = `Anti-nuke: ${label}${count > 1 ? ` (${count} times in under a minute)` : ''}`;
        const hackedNote = 'If this wasn\'t you, your account may be hacked - change your password, turn on 2FA and contact the server staff.';
        const removeWithDm = async (dmAction, run) => {
            const dm = await dmPunishment(member.user, guild, dmAction, { reason: why, automatic: true, note: hackedNote });
            if (await run().then(() => true).catch(() => false)) return true;
            await dm?.delete().catch(() => {});
            return false;
        };
        if (punish === 'ban' && member.bannable && await removeWithDm('ban', () => guild.members.ban(member.id, { reason }))) {
            action = 'They were **banned** (anti-nuke punishment is set to ban).';
        } else if (punish === 'kick' && member.kickable && await removeWithDm('kick', () => member.kick(reason))) {
            action = 'They were **kicked** (anti-nuke punishment is set to kick).';
        } else {
            const dangerous = member.roles.cache.filter((role) => role.editable && !role.managed
                && hasDangerousPermission(role.permissions.bitfield, dangerousPermissions));
            if (dangerous.size) {
                const removed = await member.roles.remove([...dangerous.keys()], reason).then(() => true).catch(() => false);
                if (removed) {
                    const fresh = await guild.members.fetch({ user: member.id, force: true }).catch(() => member);
                    const timedOut = await safeTimeout(fresh, 60 * 60 * 1000, reason);
                    action = `Removed their powerful roles: ${dangerous.map((role) => `**${role.name}**`).join(', ')}${timedOut ? ', and timed them out for 1 hour' : ''}.` +
                        `\nIf this was a mistake, give them back from Server Settings → Members${timedOut ? ` and \`${getPrefix(guild.id)}unmute\` them` : ''}.`;
                    await dmPunishment(member.user, guild, 'anti-nuke', {
                        reason: why,
                        automatic: true,
                        until: timedOut ? now() + 60 * 60 * 1000 : undefined,
                        note: `Your powerful roles were removed${timedOut ? ' and you were muted for 1 hour' : ''}. ${hackedNote}`,
                    });
                }
            } else {
                action = "They have no powerful roles I can remove. They may be the owner's co-admin or rank above me - please check.";
            }
        }
    }

    await sleep(1500);
    const webhooks = await removeAttackerWebhooks(guild, executorId).catch(() => 0);
    const rebuilt = await undoAttack(guild, executorId).catch((err) => {
        logger.error('[anti-nuke] undo failed:', err);
        return { roles: 0, channels: 0, memberRoles: 0, failed: [err.message] };
    });
    const repairs = [
        rebuilt.channels && `🔁 Rebuilt **${rebuilt.channels}** deleted channel(s) with their permissions`,
        rebuilt.roles && `🔁 Rebuilt **${rebuilt.roles}** deleted role(s)`,
        rebuilt.permissions && `🔐 Put back **${rebuilt.permissions}** channel permission(s) for rebuilt roles`,
        rebuilt.memberRoles && `👥 Gave roles back to **${rebuilt.memberRoles}** member(s)`,
        rebuilt.unbanned && `🔓 Unbanned **${rebuilt.unbanned}** member(s) they banned`,
        rebuilt.untimedOut && `🔈 Lifted **${rebuilt.untimedOut}** timeout(s) they gave`,
        webhooks && `🪝 Deleted **${webhooks}** webhook(s) they made`,
        rebuilt.failed.length && `⚠️ Couldn't rebuild: ${rebuilt.failed.slice(0, 5).join('; ')}`,
    ].filter(Boolean);

    logModAction({
        guildId: guild.id,
        moderator: clientUser,
        target: member?.user ?? { id: executorId },
        action: 'security:anti-nuke',
        reason: `${count} ${label} in a minute`,
    });
    await sendSecurityAlert(guild, {
        title: 'Anti-nuke: stopped a possible server wipe',
        description: `<@${executorId}> ${label}${count > 1 ? ` **${count} times in under a minute**` : ''}.\n\n${action}` +
            `${repairs.length ? `\n\n**Repairs:**\n${repairs.join('\n')}` : ''}` +
            `\n\n-# Trusted people (\`${getPrefix(guild.id)}security trust @user\`) are only stopped if they go far past the limits. Rebuilt channels start empty - Discord can't bring back deleted messages.`,
    });
}

module.exports = { neutralizeNuker };
