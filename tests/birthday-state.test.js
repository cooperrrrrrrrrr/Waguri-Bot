const test = require('node:test');
const assert = require('node:assert/strict');
const {
    birthdaysForGuild,
    clearAnnouncements,
    findMigrationGuild,
    formatBirthdayDate,
    getBirthday,
    markAnnounced,
    removeBirthday,
    serializeBirthdayRecords,
    setBirthday,
    wasAnnounced,
} = require('../birthday-utils');

test('birthday announcements are tracked independently for each guild', () => {
    const announced = new Map();
    markAnnounced(announced, 'guild-a', 'user-1', '2026-10-06');

    assert.equal(wasAnnounced(announced, 'guild-a', 'user-1', '2026-10-06'), true);
    assert.equal(wasAnnounced(announced, 'guild-b', 'user-1', '2026-10-06'), false);
});

test('birthday announcement state can be cleared for one guild only', () => {
    const announced = new Map([
        ['guild-a:user-1', '2026-10-06'],
        ['guild-b:user-1', '2026-10-06'],
        ['guild-a:user-2', '2026-10-06'],
        ['user-1', '2026-10-06'],
    ]);

    clearAnnouncements(announced, 'guild-a', 'user-1');

    assert.equal(announced.has('guild-a:user-1'), false);
    assert.equal(announced.has('guild-b:user-1'), true);
    assert.equal(announced.has('user-1'), true);
    assert.equal(announced.has('guild-a:user-2'), true);
});

test('birthday records are isolated by guild', () => {
    const birthdays = new Map();
    setBirthday(birthdays, 'guild-a', 'user-1', { day: 6, month: 10, year: 2000 });
    setBirthday(birthdays, 'guild-b', 'user-1', { day: 7, month: 10, year: 1999 });

    assert.deepEqual(getBirthday(birthdays, 'guild-a', 'user-1'), { day: 6, month: 10, year: 2000 });
    assert.deepEqual(birthdaysForGuild(birthdays, 'guild-b'), [['user-1', { day: 7, month: 10, year: 1999 }]]);
    assert.equal(removeBirthday(birthdays, 'guild-a', 'user-1'), true);
    assert.equal(getBirthday(birthdays, 'guild-a', 'user-1'), undefined);
    assert.deepEqual(getBirthday(birthdays, 'guild-b', 'user-1'), { day: 7, month: 10, year: 1999 });
});

test('legacy birthdays migrate only when the main guild is identifiable', () => {
    const main = { id: 'main', ownerId: 'owner' };
    const secondary = { id: 'secondary', ownerId: 'other' };
    const guilds = [main, secondary];
    const configured = (guild) => guild.id === 'main' || guild.id === 'secondary';

    assert.equal(findMigrationGuild(guilds, 'main', 'owner', configured), main);
    assert.equal(findMigrationGuild(guilds, '', 'owner', configured), main);
    assert.equal(findMigrationGuild(guilds, '', 'someone-else', configured), null);
    assert.equal(findMigrationGuild([secondary], '', '', configured), secondary);
});

test('saving scoped birthdays preserves legacy records until migration succeeds', () => {
    const scoped = new Map([['guild-a:user-1', { day: 6, month: 10, year: 2000 }]]);
    const legacy = new Map([['user-2', { day: 7, month: 10, year: 1999 }]]);

    assert.deepEqual(serializeBirthdayRecords(scoped, legacy), {
        'user-2': { day: 7, month: 10, year: 1999 },
        'guild-a:user-1': { day: 6, month: 10, year: 2000 },
    });
    assert.deepEqual(serializeBirthdayRecords(scoped), {
        'guild-a:user-1': { day: 6, month: 10, year: 2000 },
    });
});

test('public birthday date formatting omits birth year', () => {
    assert.equal(formatBirthdayDate(6, 10), '06-10');
});
