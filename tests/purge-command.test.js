const assert = require('node:assert/strict');
const test = require('node:test');
const { handlePurgeCommand } = require('../commands/moderation/purge');

const USER_ID = '12345678901234567';
const now = 1_700_000_000_000;
const freshMessage = (id, authorId = 'someone', age = 1000) => ({
    id,
    author: { id: authorId },
    createdTimestamp: now - age,
});
const collection = (entries) => ({
    size: entries.length,
    values: () => entries.values(),
    last: () => entries.at(-1),
});

function setup({ fetched = [], deleted = [], ...overrides } = {}) {
    const calls = [];
    const channel = {
        id: 'channel',
        messages: {
            fetch: async (options) => { calls.push(['fetch', options]); return collection(fetched); },
        },
        bulkDelete: async (targets, filterOld) => {
            calls.push(['bulkDelete', targets, filterOld]);
            return new Map(deleted.map((entry) => [entry.id, entry]));
        },
    };
    const message = {
        id: 'command-message',
        member: { id: 'moderator' },
        channel,
        delete: async () => { calls.push(['deleteCommand']); },
    };
    const dependencies = {
        permission: 'manage-messages',
        hasModerationPermission: () => true,
        replyEmbed: (_message, text, options) => { calls.push(['reply', text, options]); return 'replied'; },
        sendEmbed: async (...args) => { calls.push(['send', ...args]); return { delete: async () => calls.push(['deleteConfirmation']) }; },
        errorColor: 123,
        now: () => now,
        scheduleDelete: (callback, delay) => calls.push(['schedule', callback, delay]),
        logError: (err) => calls.push(['error', err.message]),
        ...overrides,
    };
    return { calls, dependencies, message };
}

test('denies members without permission and validates the count', async () => {
    const denied = setup({ hasModerationPermission: () => false });
    assert.equal(await handlePurgeCommand(denied.message, ['10'], '.', denied.dependencies), 'replied');
    assert.match(denied.calls[0][1], /Only staff/);
    assert.equal(denied.calls.some(([name]) => name === 'fetch'), false);

    const invalid = setup();
    await handlePurgeCommand(invalid.message, ['0'], '.', invalid.dependencies);
    assert.match(invalid.calls[0][1], /Usage: `\.purge/);
    assert.equal(invalid.calls.some(([name]) => name === 'fetch'), false);
});

test('bulk deletes up to 100 recent messages including the command but reports only others', async () => {
    const command = freshMessage('command-message');
    const other = freshMessage('other-message');
    const old = freshMessage('old-message', 'someone', 14 * 24 * 60 * 60 * 1000);
    const { calls, dependencies, message } = setup({
        fetched: [command, other, old],
        deleted: [command, other],
    });

    await handlePurgeCommand(message, ['99'], '.', dependencies);
    assert.deepEqual(calls[0], ['fetch', { limit: 100 }]);
    assert.deepEqual(calls[1], ['bulkDelete', [command, other], true]);
    assert.match(calls[2][2], /^Deleted 1 message \(1 skipped - older than 14 days\)\.$/);
    await calls[3][1]();
    assert.deepEqual(calls[4], ['deleteConfirmation']);
    assert.equal(calls[3][2], 5000);
});

test('filters user messages, skips old messages, and removes the command message', async () => {
    const recentTarget = freshMessage('target-message', USER_ID);
    const recentOther = freshMessage('other-message', 'someone');
    const oldTarget = freshMessage('old-target', USER_ID, 14 * 24 * 60 * 60 * 1000);
    const { calls, dependencies, message } = setup({ fetched: [recentTarget, recentOther, oldTarget] });
    message.channel.messages.fetch = async (options) => {
        calls.push(['fetch', options]);
        return collection([recentTarget, recentOther, oldTarget]);
    };
    message.channel.bulkDelete = async (targets, filterOld) => {
        calls.push(['bulkDelete', targets, filterOld]);
        return new Map(targets.map((entry) => [entry.id, entry]));
    };

    await handlePurgeCommand(message, [`<@${USER_ID}>`, '2'], '.', dependencies);
    assert.deepEqual(calls[0], ['fetch', { limit: 100, before: message.id }]);
    assert.deepEqual(calls[1], ['deleteCommand']);
    assert.deepEqual(calls[2], ['bulkDelete', [recentTarget], true]);
    assert.deepEqual(calls[3][1], message.channel);
    assert.match(calls[3][2], new RegExp(`Deleted 1 message from <@${USER_ID}> \\(1 skipped`));
    assert.equal(calls[4][0], 'schedule');
    assert.equal(calls[4][2], 5000);
});

test('reports failures from fetching or bulk deletion', async () => {
    const { calls, dependencies, message } = setup({
        fetched: [freshMessage('recent')],
        logError: (err) => calls.push(['error', err.message]),
    });
    message.channel.bulkDelete = async () => { throw new Error('Discord failure'); };

    assert.equal(await handlePurgeCommand(message, ['1'], '.', dependencies), undefined);
    assert.deepEqual(calls.map(([name]) => name), ['fetch', 'error', 'reply']);
    assert.match(calls[2][1], /Failed to delete messages/);
});
