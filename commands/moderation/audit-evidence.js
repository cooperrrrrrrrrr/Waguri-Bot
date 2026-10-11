function recordAuditEvidence(entry, guild, executorKey, isOwner, {
    auditLogEvent,
    deletedBy,
    deletedThings,
    rememberDeletedFromSnapshot,
    webhooksCreatedBy,
    removedMemberRoles,
    bansBy,
    timeoutsBy,
    rememberByExecutor,
    now = Date.now,
}) {
    if (entry.action === auditLogEvent.ChannelDelete || entry.action === auditLogEvent.RoleDelete) {
        deletedBy.set(entry.targetId, entry.executorId);
        if (!deletedThings.has(entry.targetId)) {
            rememberDeletedFromSnapshot(guild, entry.action === auditLogEvent.RoleDelete ? 'role' : 'channel', entry.targetId);
        }
    }
    if (entry.action === auditLogEvent.WebhookCreate && entry.targetId) {
        if (!webhooksCreatedBy.has(executorKey)) webhooksCreatedBy.set(executorKey, new Set());
        webhooksCreatedBy.get(executorKey).add(entry.targetId);
    }
    if (entry.action === auditLogEvent.MemberRoleUpdate) {
        const removed = (entry.changes.find((change) => change.key === '$remove')?.new ?? []).map((role) => role.id);
        if (removed.length && !isOwner) {
            rememberByExecutor(removedMemberRoles, executorKey, { memberId: entry.targetId, roleIds: removed, at: now() });
        }
    }
    if (entry.action === auditLogEvent.MemberBanAdd && entry.targetId && !isOwner) {
        rememberByExecutor(bansBy, executorKey, { userId: entry.targetId, at: now() });
    }
    const timeoutChange = entry.action === auditLogEvent.MemberUpdate
        ? entry.changes.find((change) => change.key === 'communication_disabled_until')
        : null;
    const gaveTimeout = Boolean(timeoutChange?.new);
    if (gaveTimeout && !isOwner) {
        rememberByExecutor(timeoutsBy, executorKey, { memberId: entry.targetId, at: now() });
    }
    return gaveTimeout;
}

module.exports = { recordAuditEvidence };
