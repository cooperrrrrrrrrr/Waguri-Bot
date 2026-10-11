const test = require('node:test');
const assert = require('node:assert/strict');
const { guildModActions, userReminders } = require('../guild-data');

test('staff action history is limited to the current guild', () => {
    const actions = [
        { guildId: 'guild-a', action: 'warn' },
        { guildId: 'guild-b', action: 'ban' },
        { guildId: null, action: 'legacy' },
    ];

    assert.deepEqual(guildModActions(actions, 'guild-a'), [actions[0]]);
});

test("reminders shown in a guild exclude the same user's reminders from other guilds", () => {
    const reminders = [
        { userId: 'user-1', guildId: 'guild-a', text: 'private note A' },
        { userId: 'user-1', guildId: 'guild-b', text: 'private note B' },
        { userId: 'user-2', guildId: 'guild-a', text: 'other user' },
    ];

    assert.deepEqual(userReminders(reminders, 'user-1', 'guild-a'), [reminders[0]]);
    assert.deepEqual(userReminders(reminders, 'user-1'), reminders.slice(0, 2));
});
