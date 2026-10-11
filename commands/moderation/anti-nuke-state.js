function restoreAntiNukeState(state, {
    deletedThings,
    deletedBy,
    removedMemberRoles,
    webhooksCreatedBy,
    removedRoleOverwrites,
    nukeActivity,
    recentlyNeutralized,
    bansBy,
    timeoutsBy,
    processedAuditIds,
    rebuiltChannels,
    rebuiltParents,
    rebuiltRoles,
    rebuiltRoleOverwrites,
    lastNukeActivityAt,
    raidModeUntil,
    prune,
}) {
    const fill = (map, entries, convert = (value) => value) => {
        for (const [key, value] of entries ?? []) map.set(key, convert(value));
    };
    fill(deletedThings, state.deletedThings);
    fill(deletedBy, state.deletedBy);
    fill(removedMemberRoles, state.removedMemberRoles);
    fill(webhooksCreatedBy, state.webhooksCreatedBy, (ids) => new Set(ids));
    fill(removedRoleOverwrites, state.removedRoleOverwrites, (channels) => new Map(channels));
    fill(nukeActivity, state.nukeActivity);
    fill(recentlyNeutralized, state.recentlyNeutralized);
    fill(bansBy, state.bansBy);
    fill(timeoutsBy, state.timeoutsBy);
    fill(processedAuditIds, state.processedAuditIds);
    fill(rebuiltChannels, state.rebuiltChannels);
    fill(rebuiltParents, state.rebuiltParents);
    fill(rebuiltRoles, state.rebuiltRoles);
    fill(rebuiltRoleOverwrites, state.rebuiltRoleOverwrites);
    fill(lastNukeActivityAt, state.lastNukeActivityAt);
    fill(raidModeUntil, state.raidModeUntil);
    prune();
}

module.exports = { restoreAntiNukeState };
