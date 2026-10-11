async function runJoinSecurity(member, {
    now: getNow = Date.now,
    findCsamPattern,
    safeBan,
    logModAction,
    clientUser,
    botName,
    sendSecurityAlert,
    securitySettings,
    safeTimeout,
    dmPunishment,
    describeUser,
    findBanEvasion,
    getPrefix,
    recentJoins,
    recentJoinMembers,
    raidWindowMs,
    raidJoins,
    lastRaidAlert,
    isRaidMode,
    setRaidMode,
    raidModeAutoMs,
    raidQuarantineAccountDays,
    queueQuarantineAlert,
    impersonationReason,
    veryNewAccountMs,
    verifySettings,
}) {
    const { guild, user } = member;
    const names = [user.username, user.globalName, member.nickname].filter(Boolean).join(' ');
    if (findCsamPattern(names)) {
        const banned = await safeBan(guild, user, `${botName} Security: CSAM-advertising username`);
        logModAction({ guildId: guild.id, moderator: clientUser, target: user, action: 'security:csam-name', reason: 'CSAM-advertising username' });
        await sendSecurityAlert(guild, {
            title: 'Account with a child-abuse advertising name',
            description: banned ? 'They were **banned** as soon as they joined.' : '⚠️ I could not ban them - please ban them manually.',
            fields: [
                { name: 'User', value: `\`${user.id}\` (name hidden)` },
                { name: 'Please also report it', value: 'Report the account to Discord (Trust & Safety) and to NCMEC at report.cybertip.org, or your local authorities.' },
            ],
        });
        return true;
    }

    const now = getNow();

    const minAge = securitySettings.get(guild.id)?.minAge;
    if (minAge && !user.bot && now - user.createdTimestamp < minAge.days * 24 * 60 * 60 * 1000) {
        const oldEnoughAt = user.createdTimestamp + minAge.days * 24 * 60 * 60 * 1000;
        let done = false;
        const ageReason = `Your Discord account is younger than ${minAge.days} day(s), the minimum for this server`;
        if (minAge.action === 'kick') {
            const dm = await dmPunishment(user, guild, 'kick', { reason: ageReason, automatic: true, note: `You can join again <t:${Math.floor(oldEnoughAt / 1000)}:R>. 💙` });
            done = member.kickable && await member.kick(`${botName} Security: account younger than ${minAge.days} days`).then(() => true).catch(() => false);
            if (!done) await dm?.delete().catch(() => {});
        } else {
            const ms = Math.min(oldEnoughAt - now, 28 * 24 * 60 * 60 * 1000);
            done = await safeTimeout(member, ms, `${botName} Security: account younger than ${minAge.days} days`);
            if (done) await dmPunishment(user, guild, 'mute', { reason: ageReason, until: now + ms, automatic: true });
        }
        await sendSecurityAlert(guild, {
            title: `Account-age gate: new account ${done ? (minAge.action === 'kick' ? 'kicked' : 'timed out') : 'NOT stopped'}`,
            description: `Account is younger than **${minAge.days} day(s)**.${done ? '' : ' ⚠️ I could not act on it.'}`,
            fields: [{ name: 'User', value: describeUser(user, member) }],
            color: 0x5e60ce,
        });
        if (done) return true;
    }

    const evasion = findBanEvasion(member);
    if (evasion) {
        const quarantined = evasion.strength === 'strong' && await safeTimeout(member, 60 * 60 * 1000, `${botName} Security: possible ban evasion`);
        if (quarantined) await dmPunishment(user, guild, 'mute', { reason: 'An automatic safety check on new accounts - staff will take a look shortly', until: getNow() + 60 * 60 * 1000, automatic: true });
        await sendSecurityAlert(guild, {
            title: `Possible ban evasion${quarantined ? ' - quarantined' : ''}`,
            description: `This account has ${evasion.why} as **${evasion.match.username}** (\`${evasion.match.id}\`), banned <t:${Math.floor(evasion.match.at / 1000)}:R>.${quarantined ? `\nTimed out for 1 hour so staff can check. \`${getPrefix(guild.id)}unmute @user\` if it's a false alarm.` : ''}`,
            fields: [{ name: 'New account', value: describeUser(user, member) }],
            color: 0xffa500,
        });
        if (quarantined) return true;
    }

    const joins = (recentJoins.get(guild.id) ?? []).filter((at) => now - at < raidWindowMs);
    joins.push(now);
    recentJoins.set(guild.id, joins);
    const joinedMembers = (recentJoinMembers.get(guild.id) ?? []).filter((join) => now - join.at < raidWindowMs);
    joinedMembers.push({ member, at: now });
    recentJoinMembers.set(guild.id, joinedMembers);
    if (joins.length >= raidJoins && now - (lastRaidAlert.get(guild.id) ?? 0) > 10 * 60 * 1000) {
        lastRaidAlert.set(guild.id, now);
        const alreadyOn = isRaidMode(guild.id);
        if (!alreadyOn) {
            setRaidMode(guild.id, raidModeAutoMs);
            for (const { member: earlier } of joinedMembers) {
                if (earlier.id === member.id) continue;
                if (now - earlier.user.createdTimestamp >= raidQuarantineAccountDays * 24 * 60 * 60 * 1000) continue;
                if (await safeTimeout(earlier, 60 * 60 * 1000, `${botName} Security: raid mode quarantine`)) queueQuarantineAlert(guild, earlier);
            }
        }
        await sendSecurityAlert(guild, {
            title: 'Raid detected - raid mode is ON',
            description: `**${joins.length}** members joined in the last minute.\n` +
                `${alreadyOn ? 'Raid mode was already on.' : `Raid mode is on for **${raidModeAutoMs / 60000} minutes**.`} ` +
                `Accounts younger than ${raidQuarantineAccountDays} days that join now are timed out for 1 hour so staff can check them. Established accounts aren't affected.\n` +
                'Staff: `.raidmode off` to end it early, `.raidmode on 30` to extend it.',
        });
    }

    if (isRaidMode(guild.id) && now - user.createdTimestamp < raidQuarantineAccountDays * 24 * 60 * 60 * 1000) {
        const timedOut = await safeTimeout(member, 60 * 60 * 1000, `${botName} Security: raid mode quarantine`);
        if (timedOut) {
            queueQuarantineAlert(guild, member);
            return true;
        }
    }

    const impersonation = impersonationReason(member);
    if (impersonation) {
        await sendSecurityAlert(guild, {
            title: 'Possible impersonator joined',
            description: `Their name ${impersonation}. No action taken - please check them.`,
            fields: [{ name: 'User', value: describeUser(user, member) }],
            color: 0xffa500,
        });
    }

    if (now - user.createdTimestamp < veryNewAccountMs) {
        await sendSecurityAlert(guild, {
            title: 'Very new account joined',
            description: 'Just a heads-up - no action taken. New accounts can\'t post shortened links, IP links or archives for their first day.',
            fields: [{ name: 'User', value: describeUser(user, member) }],
            color: 0x5e60ce,
        });
    }

    const verify = verifySettings(guild.id);
    if (verify && !user.bot && guild.roles.cache.has(verify.roleId)) {
        await member.roles.add(verify.roleId, `${botName} Security: verification gate`).catch((err) => console.warn('[verify] could not add role:', err.message));
    }
    return false;
}

module.exports = { runJoinSecurity };
