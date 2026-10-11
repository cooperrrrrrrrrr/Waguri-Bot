const test = require('node:test');
const assert = require('node:assert/strict');
const { parseChoices, parseWhen, zonedTime, timestampTags, cleanServerAddress, describeMcStatus, ANILIST_QUERY, describeAniListMedia, STICKY_MAX_LENGTH, parseStickyCommand, starboardAction } = require('../extras');

test('choices split on commas, bars and "or"', () => {
    assert.deepEqual(parseChoices('pizza, sushi or ramen'), ['pizza', 'sushi', 'ramen']);
    assert.deepEqual(parseChoices('a | b|c'), ['a', 'b', 'c']);
    assert.deepEqual(parseChoices('stay up or go to bed'), ['stay up', 'go to bed']);
    assert.deepEqual(parseChoices('just one thing'), []);
    assert.deepEqual(parseChoices('same, same'), []);
    assert.deepEqual(parseChoices(''), []);
});

const NOW = Date.UTC(2026, 9, 11, 10, 0);

test('times from now: durations', () => {
    assert.equal(parseWhen('2h30m', { now: NOW }), NOW + 2.5 * 36e5);
    assert.equal(parseWhen('in 45m', { now: NOW }), NOW + 45 * 6e4);
    assert.equal(parseWhen('1d 2h', { now: NOW }), NOW + 26 * 36e5);
});

test('clock times use the person\'s timezone and roll to tomorrow once passed', () => {
    assert.equal(parseWhen('5pm', { now: NOW }), Date.UTC(2026, 9, 11, 17, 0));
    assert.equal(parseWhen('9am', { now: NOW }), Date.UTC(2026, 9, 12, 9, 0));
    assert.equal(parseWhen('17:30', { zone: 'Australia/Adelaide', now: NOW }), zonedTime(2026, 10, 12, 17, 30, 'Australia/Adelaide'));
    assert.equal(parseWhen('tomorrow 9am', { now: NOW }), Date.UTC(2026, 9, 12, 9, 0));
    assert.equal(parseWhen('2026-12-25 18:00', { zone: 'America/New_York', now: NOW }), Date.UTC(2026, 11, 25, 23, 0));
});

test('nonsense and ambiguous times are refused', () => {
    for (const bad of ['', 'banana', '25:00', '13pm', '5', 'next week', '2026-13-01 10:00']) assert.equal(parseWhen(bad, { now: NOW }), null, bad);
});

test('every timestamp style is listed with the same moment', () => {
    const tags = timestampTags(Date.UTC(2026, 0, 1));
    assert.equal(tags.length, 7);
    assert.ok(tags.every(([, tag]) => tag.startsWith('<t:1767225600:')));
    assert.deepEqual(tags.at(-1), ['Relative', '<t:1767225600:R>']);
});

test('server addresses are checked before going into a URL', () => {
    assert.equal(cleanServerAddress('Play.Hypixel.net'), 'play.hypixel.net');
    assert.equal(cleanServerAddress('mc.example.org:25565'), 'mc.example.org:25565');
    assert.equal(cleanServerAddress('localhost'), null);
    assert.equal(cleanServerAddress('evil.com/../x'), null);
    assert.equal(cleanServerAddress(''), null);
});

test('Minecraft status keeps the useful parts', () => {
    assert.deepEqual(describeMcStatus({ online: false }), { online: false });
    const s = describeMcStatus({ online: true, players: { online: 3, max: 20, list: [{ name: 'Steve' }] }, version: '§a1.21', motd: { clean: [' A cozy server '] } });
    assert.equal(s.players, '3/20');
    assert.equal(s.version, '1.21');
    assert.equal(s.motd, 'A cozy server');
    assert.deepEqual(s.names, ['Steve']);
});

test('AniList anime and manga results become short embed fields', () => {
    const a = describeAniListMedia({
        siteUrl: 'https://anilist.co/anime/150672', title: { romaji: 'Oshi no Ko', english: '[Oshi no Ko]' }, coverImage: { large: 'https://img/x.jpg' },
        averageScore: 86, format: 'TV', episodes: 11, status: 'FINISHED', seasonYear: 2023, genres: ['Drama', 'Mystery'],
        description: 'Gorou is a doctor.<br><br>He is a fan of <i>Ai Hoshino</i> &amp; more.' + ' x'.repeat(500) + '\n\n(Source: Yen Press)',
    });
    assert.equal(a.title, '[Oshi no Ko]');
    assert.equal(a.original, 'Oshi no Ko');
    assert.equal(a.type, 'TV · 11 episodes');
    assert.equal(a.score, '8.6/10');
    assert.equal(a.status, 'Finished');
    assert.equal(a.genres, 'Drama, Mystery');
    assert.match(a.synopsis, /^Gorou is a doctor\.\n\nHe is a fan of Ai Hoshino & more\./);
    assert.ok(!a.synopsis.includes('Source') && a.synopsis.length <= 704);
    const m = describeAniListMedia({ title: { romaji: 'Berserk', english: null }, format: 'MANGA', volumes: 42, chapters: null, averageScore: null, status: 'HIATUS', startDate: { year: 1989 } }, 'manga');
    assert.equal(m.title, 'Berserk');
    assert.equal(m.original, null);
    assert.equal(m.type, 'Manga · 42 volumes');
    assert.equal(m.score, 'Not rated yet');
    assert.equal(m.status, 'On hiatus');
    assert.equal(m.year, 1989);
    assert.equal(describeAniListMedia(null), null);
    assert.match(ANILIST_QUERY, /isAdult: false/);
});

test('starboard posts, updates and removes at the threshold', () => {
    assert.equal(starboardAction({ stars: 3, threshold: 3, posted: false }), 'post');
    assert.equal(starboardAction({ stars: 5, threshold: 3, posted: true }), 'update');
    assert.equal(starboardAction({ stars: 2, threshold: 3, posted: true }), 'remove');
    assert.equal(starboardAction({ stars: 1, threshold: 3, posted: false }), 'none');
});

test('sticky commands keep the message text, newlines and all', () => {
    assert.deepEqual(parseStickyCommand(''), { action: 'show' });
    assert.deepEqual(parseStickyCommand('list'), { action: 'list' });
    assert.deepEqual(parseStickyCommand('OFF'), { action: 'remove' });
    assert.deepEqual(parseStickyCommand('remove'), { action: 'remove' });
    assert.deepEqual(parseStickyCommand('set Read the rules!\n**No spam**'), { action: 'set', content: 'Read the rules!\n**No spam**' });
    assert.deepEqual(parseStickyCommand('set'), { action: 'usage' });
    assert.deepEqual(parseStickyCommand(`set ${'x'.repeat(STICKY_MAX_LENGTH + 1)}`), { action: 'usage' });
    assert.deepEqual(parseStickyCommand('banana'), { action: 'usage' });
});
