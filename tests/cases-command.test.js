const assert = require('node:assert/strict');
const test = require('node:test');
const { handleCaseCommand, handleCasesCommand } = require('../commands/moderation/cases');

const target = { id: 'target-id', displayName: 'Target' };

function setup(overrides = {}) {
    const calls = [];
    const entries = Array.from({ length: 17 }, (_, index) => ({
        id: index + 1,
        type: 'warn',
        active: index !== 15,
        targetId: index === 16 ? 'other-id' : target.id,
        targetTag: `Target#${index}`,
        modTag: 'Mod#1234',
        at: 1_700_000_000_000 + index * 1000,
        reason: `reason ${index + 1}`,
        until: index === 0 ? 1_700_000_100_000 : undefined,
    }));
    const message = {
        member: { id: 'moderator' },
        guild: { id: 'guild' },
        author: { id: 'moderator' },
        channel: { id: 'channel' },
    };
    const dependencies = {
        permission: 'moderate-members',
        hasModerationPermission: () => true,
        resolveTargetMember: async (_message, arg) => { calls.push(['resolve', arg]); return target; },
        guildCases: () => entries,
        formatDurationMs: (duration) => `${duration / 1000}s`,
        replyEmbed: (_message, text, options) => { calls.push(['reply', text, options]); return 'replied'; },
        sendEmbed: (...args) => { calls.push(['send', ...args]); return 'sent'; },
        errorColor: 123,
        ...overrides,
    };
    return { calls, dependencies, entries, message };
}

test('denies unauthorized users before looking up an individual case', async () => {
    const { calls, dependencies, message } = setup({ hasModerationPermission: () => false });
    assert.equal(await handleCaseCommand(message, ['1'], '.', dependencies), 'replied');
    assert.match(calls[0][1], /Only staff can view cases/);
    assert.equal(calls.some(([name]) => name === 'send'), false);
});

test('displays a case with removed status and duration when available', async () => {
    const { calls, dependencies, message } = setup();
    assert.equal(await handleCaseCommand(message, ['1'], '.', dependencies), 'sent');
    assert.equal(calls[0][0], 'send');
    assert.equal(calls[0][2], '**Type:** warn\n**User:** Target#0 (`target-id`)\n**Moderator:** Mod#1234\n**When:** <t:1700000000:F>\n**Duration:** 100s\n**Reason:** reason 1');
    assert.equal(calls[0][3].title, '🗂️ Case #1');

    const removed = setup();
    await handleCaseCommand(removed.message, ['16'], '.', removed.dependencies);
    assert.match(removed.calls[0][2], /\*\*Type:\*\* warn \(removed\)/);
    assert.doesNotMatch(removed.calls[0][2], /Duration:/);
});

test('shows usage when an individual case number is missing or unknown', async () => {
    const missing = setup();
    await handleCaseCommand(missing.message, [], '.', missing.dependencies);
    assert.match(missing.calls[0][1], /Usage: `\.case <number>`/);

    const unknown = setup();
    await handleCaseCommand(unknown.message, ['999'], '.', unknown.dependencies);
    assert.match(unknown.calls[0][1], /Usage: `\.case <number>`/);
});

test('shows at most the latest 15 global cases in reverse chronological order', async () => {
    const { calls, dependencies, message } = setup({ resolveTargetMember: async (_message, arg) => { calls.push(['resolve', arg]); return null; } });
    await handleCasesCommand(message, [], dependencies);
    assert.deepEqual(calls.map(([name]) => name), ['resolve', 'send']);
    assert.equal(calls[0][1], undefined);
    assert.equal(calls[1][3].title, '🗂️ Recent cases');
    const content = calls[1][2];
    assert.match(content, /^\*\*#17\*\*/);
    assert.match(content, /\*\*#3\*\*[^]*reason 3$/);
    assert.doesNotMatch(content, /#2\*\*/);
});

test('filters case history by a resolved target and shows empty-history message otherwise', async () => {
    const filtered = setup();
    await handleCasesCommand(filtered.message, ['target'], filtered.dependencies);
    assert.equal(filtered.calls[1][3].title, '🗂️ Cases for Target');
    assert.doesNotMatch(filtered.calls[1][2], /Target#16/);
    assert.match(filtered.calls[1][2], /\*\(removed\)\*/);

    const empty = setup({ guildCases: () => [] });
    empty.dependencies.resolveTargetMember = async (_message, arg) => { empty.calls.push(['resolve', arg]); return null; };
    await handleCasesCommand(empty.message, [], empty.dependencies);
    assert.equal(empty.calls[1][2], 'No cases yet.');
});

test('denies unauthorized users before target lookup in case history', async () => {
    const { calls, dependencies, message } = setup({ hasModerationPermission: () => false });
    assert.equal(await handleCasesCommand(message, [], dependencies), 'replied');
    assert.match(calls[0][1], /Only staff can view cases/);
    assert.equal(calls.some(([name]) => name === 'resolve'), false);
});
