async function undoAttack(guild, executorId, {
    deletedThings,
    deletedBy,
    liveSnapshots,
    channelType,
    restoreBackup,
    rebuiltChannels,
    rebuiltParents,
    reattachRebuiltChannels,
    rebuiltRoles,
    removedRoleOverwrites,
    rebuiltRoleOverwrites,
    putPermission,
    botName,
    removedMemberRoles,
    bansBy,
    timeoutsBy,
    forgetBan,
    markAntiNukeDirty,
}) {
    const mine = [...deletedThings.entries()].filter(([id, item]) => item.guildId === guild.id && deletedBy.get(id) === executorId);
    const snapshot = {
        roles: mine.filter(([, item]) => item.kind === 'role').map(([, item]) => item.data),
        channels: mine.filter(([, item]) => item.kind === 'channel').map(([, item]) => item.data)
            .sort((a, b) => (a.type === channelType.GuildCategory ? 0 : 1) - (b.type === channelType.GuildCategory ? 0 : 1) || a.position - b.position),
        memberRoles: liveSnapshots.get(guild.id)?.memberRoles ?? {},
    };
    const result = (snapshot.roles.length || snapshot.channels.length)
        ? await restoreBackup(guild, snapshot)
        : { roles: 0, channels: 0, memberRoles: 0, failed: [] };
    for (const [id] of mine) {
        deletedThings.delete(id);
        deletedBy.delete(id);
    }

    for (const [oldId, newId] of result.channelMap ?? []) {
        if (oldId === newId) continue;
        rebuiltChannels.set(oldId, newId);
        const original = snapshot.channels.find((channel) => channel.id === oldId);
        if (original?.parentId) rebuiltParents.set(newId, original.parentId);
    }
    await reattachRebuiltChannels(guild);

    for (const [oldId, newId] of result.roleMap ?? []) {
        rebuiltRoles.set(oldId, newId);
        const role = snapshot.roles.find((item) => item.id === oldId);
        const overwrites = new Map((role?.overwrites ?? []).map((overwrite) => [overwrite.channelId, overwrite]));
        for (const overwrite of removedRoleOverwrites.get(oldId)?.values() ?? []) {
            overwrites.set(overwrite.channelId, overwrite);
        }
        removedRoleOverwrites.delete(oldId);
        if (overwrites.size) rebuiltRoleOverwrites.set(oldId, [...overwrites.values()]);
    }
    for (const [oldId, overwrites] of rebuiltRoleOverwrites) {
        const newId = rebuiltRoles.get(oldId);
        if (!guild.roles.cache.has(newId)) continue;
        for (const overwrite of overwrites) {
            const channel = guild.channels.cache.get(rebuiltChannels.get(overwrite.channelId) ?? overwrite.channelId);
            if (!channel || channel.permissionOverwrites.cache.has(newId)) continue;
            await putPermission(channel.id, newId, {
                type: 0,
                allow: overwrite.allow,
                deny: overwrite.deny,
            }, `${botName} Security: undo attack`)
                .then(() => { result.permissions = (result.permissions ?? 0) + 1; })
                .catch(() => {});
        }
    }

    const key = `${guild.id}:${executorId}`;
    for (const { memberId, roleIds } of removedMemberRoles.get(key) ?? []) {
        const member = await guild.members.fetch(memberId).catch(() => null);
        const back = roleIds.filter((id) => guild.roles.cache.has(id));
        if (member && back.length
            && await member.roles.add(back, `${botName} Security: undo attack`).then(() => true).catch(() => false)) {
            result.memberRoles++;
        }
    }
    removedMemberRoles.delete(key);

    for (const { userId } of bansBy.get(key) ?? []) {
        if (await guild.members.unban(userId, `${botName} Security: undo attack`).then(() => true).catch(() => false)) {
            forgetBan(guild.id, userId);
            result.unbanned = (result.unbanned ?? 0) + 1;
        }
    }
    bansBy.delete(key);
    for (const { memberId } of timeoutsBy.get(key) ?? []) {
        const member = await guild.members.fetch(memberId).catch(() => null);
        if (member?.isCommunicationDisabled()
            && await member.timeout(null, `${botName} Security: undo attack`).then(() => true).catch(() => false)) {
            result.untimedOut = (result.untimedOut ?? 0) + 1;
        }
    }
    timeoutsBy.delete(key);
    markAntiNukeDirty();
    return result;
}

module.exports = { undoAttack };
