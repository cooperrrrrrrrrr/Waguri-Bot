const ONE_MINUTE = 60 * 1000;
const MAX_LOOKBACK = 30 * 60 * 1000;

async function replayMissedAuditEntries(lastAlive, {
    guilds,
    processedAuditIds,
    handleAuditEntry,
    now = Date.now,
    logger = console,
}) {
    const from = Math.max((lastAlive ?? now()) - ONE_MINUTE, now() - MAX_LOOKBACK);
    for (const guild of guilds) {
        const logs = await guild.fetchAuditLogs({ limit: 100 }).catch(() => null);
        const missed = [...(logs?.entries.values() ?? [])]
            .filter((entry) => entry.createdTimestamp >= from && !processedAuditIds.has(entry.id))
            .reverse();
        for (const entry of missed) {
            await handleAuditEntry(entry, guild, { at: entry.createdTimestamp })
                .catch((err) => logger.error('[security] audit replay failed:', err));
        }
        if (missed.length) logger.log(`[security] Checked ${missed.length} audit-log entries missed while restarting in ${guild.name}`);
    }
}

module.exports = { replayMissedAuditEntries };
