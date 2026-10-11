function recordNukeActivity(entry, guild, {
    at,
    executorId,
    isOwner,
    trusted,
    nukeActivity,
    lastNukeActivityAt,
    nukeWindowMs,
    nukeLimits,
    nukeLimitFor,
    trustedHardCap,
    memberRoleUpdate,
    gaveTimeout,
}) {
    const strippedRoles = entry.action === memberRoleUpdate && entry.changes.some((change) => change.key === '$remove');
    const rule = strippedRoles
        ? { limit: 10, label: 'removed roles from members', group: 'memberroles' }
        : gaveTimeout
            ? { limit: 8, label: 'timed out members', group: 'timeouts' }
            : nukeLimits[entry.action];
    if (!rule || isOwner) return null;

    lastNukeActivityAt.set(guild.id, Date.now());
    const limit = nukeLimitFor(guild, rule.limit) * (trusted ? trustedHardCap : 1);
    const key = `${guild.id}:${executorId}:${rule.group ?? entry.action}`;
    const times = (nukeActivity.get(key) ?? []).filter((timestamp) => Math.abs(at - timestamp) < nukeWindowMs);
    times.push(at);
    nukeActivity.set(key, times);

    if (times.length < limit) return null;
    return {
        executorId,
        count: times.length,
        label: trusted ? `${rule.label} (far past the limit, even for a trusted person)` : rule.label,
    };
}

module.exports = { recordNukeActivity };
