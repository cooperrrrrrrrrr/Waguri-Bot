const assert = require('node:assert/strict');
const test = require('node:test');
const { handleRemoveWarningCommand, handleClearWarningsCommand } = require('../commands/moderation/warnings');

const target = { id: '12345678901234567', user: { id: '12345678901234567' }, displayName: 'Target' };

function setup(overrides = {}) {
    const calls = [];
    const entries = [
        { type: 'warn', active: true, targetId: target.id, at: 300, reason: 'third' },
        { type: 'warn', active: false, targetId: target.id, at: 100, reason: 'already removed' },
        { type: 'warn', active: true, targetId: target.id, at: 100, reason: 'first' },
        { type: 'warn', active: true, targetId: 'other', at: 200, reason: 'other member' },
        { type: 'mute', active: true, targetId: target.id, at: 400, reason: 'not a warning' },
    ];
    const message = {
        member: { id: 'moderator' },
        author: { id: 'moderator' },
        guild: { id: 'guild' },
        channel: { id: 'channel' },
    };
    const dependencies = {
        permission: 'moderate-members',
        hasModerationPermission: () => true,
        resolveTargetMember: async (_message, arg) => { calls.push(['resolve', arg]); return target; },
        guildCases: () => entries,
        saveCases: () => calls.push(['save']),
        addCase: (...args) => calls.push(['case', ...args]),
        replyEmbed: (_message, text, options) => { calls.push(['reply', text, options]); return 'replied'; },
        sendEmbed: (...args) => { calls.push(['send', ...args]); return 'sent'; },
        errorColor: 123,
        ...overrides,
    };
    return { calls, dependencies, entries, message };
}

test('denies unauthorized moderators before target lookup', async () => {
    const { calls, dependencies, message } = setup({ hasModerationPermission: () => false });
    assert.equal(await handleRemoveWarningCommand(message, [], '.', dependencies), 'replied');
    assert.match(calls[0][1], /Only staff can remove warnings/);
    assert.equal(calls.some(([name]) => name === 'resolve'), false);
});

test('removes a warning by its active chronological number, preserving inactive and unrelated cases', async () => {
    const { calls, dependencies, entries, message } = setup();
    assert.equal(await handleRemoveWarningCommand(message, [`<@${target.id}>`, '#2'], '.', dependencies), 'sent');
    assert.deepEqual(calls.map(([name]) => name), ['resolve', 'save', 'case', 'send']);
    assert.equal(entries[0].active, false);
    assert.equal(entries[1].active, false);
    assert.equal(entries[2].active, true);
    assert.equal(entries[3].active, true);
    assert.equal(entries[4].active, true);
    assert.match(calls[2][2].reason, /Removed warning: third/);
    assert.match(calls[3][2], /Removed warning \*\*2\*.*third/s);
    assert.match(calls[3][2], /now have \*\*1\*\* active warning/);
});

test('rejects invalid targets, warning numbers, and out-of-range warning numbers', async () => {
    const invalid = setup({ resolveTargetMember: async () => null });
    await handleRemoveWarningCommand(invalid.message, ['invalid', '1'], '.', invalid.dependencies);
    assert.match(invalid.calls[0][1], /Usage: `\.removewarn/);

    const noNumber = setup();
    await handleRemoveWarningCommand(noNumber.message, [`<@${target.id}>`, 'one'], '.', noNumber.dependencies);
    assert.match(noNumber.calls[1][1], /Usage: `\.removewarn/);

    const outOfRange = setup();
    await handleRemoveWarningCommand(outOfRange.message, [`<@${target.id}>`, '9'], '.', outOfRange.dependencies);
    assert.match(outOfRange.calls[1][1], /only has \*\*2\*\* active warnings/);
    assert.equal(outOfRange.calls.some(([name]) => name === 'save' || name === 'case'), false);
});

test('clears all active warnings but leaves removed warnings and other case types untouched', async () => {
    const { calls, dependencies, entries, message } = setup();
    assert.equal(await handleClearWarningsCommand(message, [`<@${target.id}>`], '.', dependencies), 'sent');
    assert.deepEqual(calls.map(([name]) => name), ['resolve', 'save', 'case', 'send']);
    assert.equal(entries[0].active, false);
    assert.equal(entries[1].active, false);
    assert.equal(entries[2].active, false);
    assert.equal(entries[3].active, true);
    assert.equal(entries[4].active, true);
    assert.equal(calls[2][2].reason, 'Cleared all 2 warning(s)');
    assert.match(calls[3][2], /Cleared \*\*2\*\* warnings from \*\*Target\*\*/);
});

test('clear-warnings validation and authorization failures do not mutate cases', async () => {
    const denied = setup({ hasModerationPermission: () => false });
    await handleClearWarningsCommand(denied.message, [], '.', denied.dependencies);
    assert.match(denied.calls[0][1], /Only staff can clear warnings/);
    assert.equal(denied.calls.some(([name]) => name === 'resolve'), false);

    const missing = setup({ resolveTargetMember: async () => null });
    await handleClearWarningsCommand(missing.message, [], '.', missing.dependencies);
    assert.match(missing.calls[0][1], /Usage: `\.clearwarns/);
    assert.equal(missing.calls.some(([name]) => name === 'save' || name === 'case'), false);

    const none = setup({ guildCases: () => [] });
    await handleClearWarningsCommand(none.message, [`<@${target.id}>`], '.', none.dependencies);
    assert.match(none.calls[1][1], /has no active warnings/);
    assert.equal(none.calls.some(([name]) => name === 'save' || name === 'case'), false);
});
