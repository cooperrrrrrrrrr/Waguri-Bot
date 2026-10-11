const assert = require('node:assert/strict');
const test = require('node:test');
const { replayMissedAuditEntries } = require('../commands/moderation/audit-replay');

function makeGuild(name, entries, { fetchError } = {}) {
    return {
        name,
        fetchAuditLogs: async (options) => {
            if (fetchError) throw fetchError;
            return { entries: new Map(entries.map((entry) => [entry.id, entry])) };
        },
    };
}

function setup(overrides = {}) {
    const calls = [];
    const errors = [];
    const logs = [];
    const dependencies = {
        guilds: [],
        processedAuditIds: new Set(),
        handleAuditEntry: async (...args) => calls.push(args),
        now: () => 1_000_000,
        logger: {
            error: (...args) => errors.push(args),
            log: (...args) => logs.push(args),
        },
        ...overrides,
    };
    return { calls, errors, logs, dependencies };
}

test('replays qualifying audit entries oldest first and passes event timestamps through', async () => {
    const recentLast = { id: 'recent', createdTimestamp: 999_500 };
    const olderLast = { id: 'older', createdTimestamp: 999_100 };
    const alreadyHandled = { id: 'processed', createdTimestamp: 999_800 };
    const tooOld = { id: 'old', createdTimestamp: 938_999 };
    const guild = makeGuild('guild', [recentLast, olderLast, alreadyHandled, tooOld]);
    const context = setup({
        guilds: [guild],
        processedAuditIds: new Set(['processed']),
    });

    await replayMissedAuditEntries(999_000, context.dependencies);
    assert.deepEqual(context.calls.map(([entry]) => entry.id), ['older', 'recent']);
    assert.deepEqual(context.calls.map(([, receivedGuild]) => receivedGuild), [guild, guild]);
    assert.deepEqual(context.calls.map(([, , options]) => options), [
        { at: olderLast.createdTimestamp },
        { at: recentLast.createdTimestamp },
    ]);
    assert.deepEqual(context.logs, [['[security] Checked 2 audit-log entries missed while restarting in guild']]);
});

test('caps a long downtime replay window at the most recent 30 minutes', async () => {
    const exactlyAtBoundary = { id: 'boundary', createdTimestamp: 200_000 };
    const tooOld = { id: 'expired', createdTimestamp: 199_999 };
    const guild = makeGuild('guild', [exactlyAtBoundary, tooOld]);
    const context = setup({ guilds: [guild], now: () => 2_000_000 });

    await replayMissedAuditEntries(0, context.dependencies);
    assert.deepEqual(context.calls.map(([entry]) => entry.id), ['boundary']);
});

test('does not replay audit entries newer than the last-alive one-minute window', async () => {
    const oldEnough = { id: 'old-enough', createdTimestamp: 939_999 };
    const recent = { id: 'recent', createdTimestamp: 940_000 };
    const guild = makeGuild('guild', [oldEnough, recent]);
    const context = setup({ guilds: [guild] });

    await replayMissedAuditEntries(1_000_000, context.dependencies);
    assert.deepEqual(context.calls.map(([entry]) => entry.id), ['recent']);
});

test('continues across guild fetch failures and audit-entry handler failures', async () => {
    const guildA = makeGuild('unavailable', [], { fetchError: new Error('missing audit permission') });
    const failingEntry = { id: 'fails', createdTimestamp: 999_900 };
    const successfulEntry = { id: 'succeeds', createdTimestamp: 999_800 };
    const guildB = makeGuild('available', [failingEntry, successfulEntry]);
    const context = setup({
        guilds: [guildA, guildB],
        handleAuditEntry: async (entry) => {
            context.calls.push(entry.id);
            if (entry.id === 'succeeds') throw new Error('audit handler failed');
        },
    });

    await replayMissedAuditEntries(999_000, context.dependencies);
    assert.deepEqual(context.calls, ['succeeds', 'fails']);
    assert.equal(context.errors.length, 1);
    assert.match(context.errors[0][0], /audit replay failed/);
    assert.equal(context.logs.length, 1);
});

test('queries at most 100 audit entries per guild', async () => {
    const optionsSeen = [];
    const guild = {
        name: 'guild',
        fetchAuditLogs: async (options) => {
            optionsSeen.push(options);
            return { entries: new Map() };
        },
    };
    const context = setup({ guilds: [guild] });

    await replayMissedAuditEntries(null, context.dependencies);
    assert.deepEqual(optionsSeen, [{ limit: 100 }]);
});
