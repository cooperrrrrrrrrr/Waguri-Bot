const test = require('node:test');
const assert = require('node:assert/strict');
const { editDistance, suggestCommand, helpCommandNames, findHelpPage, findHelpLines } = require('../help-search');

const NAMES = ['play', 'pause', 'skip', 'queue', 'balance', 'leaderboard', 'lyrics', 'help', 'rank', 'ranks'];

test('edit distance counts a swapped pair of letters as one typo', () => {
    assert.equal(editDistance('plya', 'play'), 1);
    assert.equal(editDistance('qeue', 'queue'), 1);
    assert.equal(editDistance('play', 'play'), 0);
    assert.equal(editDistance('balnace', 'balance'), 1);
});

test('typos get a suggestion', () => {
    assert.equal(suggestCommand('plya', NAMES), 'play');
    assert.equal(suggestCommand('qeue', NAMES), 'queue');
    assert.equal(suggestCommand('ballance', NAMES), 'balance');
    assert.equal(suggestCommand('ledaerbord', NAMES), 'leaderboard');
    assert.equal(suggestCommand('LYRCS', NAMES), 'lyrics');
});

test('no suggestion for chat, short words, real commands or ties', () => {
    assert.equal(suggestCommand('lol', NAMES), null);
    assert.equal(suggestCommand('ok', NAMES), null);
    assert.equal(suggestCommand('play', NAMES), null);
    assert.equal(suggestCommand('hello', NAMES), null);
    assert.equal(suggestCommand('ranx', NAMES), 'rank');
    assert.equal(suggestCommand('slip', ['skip', 'ship']), null);
    assert.equal(suggestCommand('...', NAMES), null);
    assert.equal(suggestCommand(undefined, NAMES), null);
});

const PAGES = [
    { id: 'music', label: 'Music', lines: ['`{{PREFIX}}play <song>` - Play a song.', '`{{PREFIX}}playlist` - Your playlists.', '-# `{{PREFIX}}play` tip line'] },
    { id: 'lastfm', label: 'Last.fm', lines: ['`{{PREFIX}}fm` - Now playing.'] },
    { id: 'birthdays', label: 'Birthdays & Time', lines: ['`{{PREFIX}}setbirthday` - Save your birthday.'] },
];

test('help pages are found by id or by name', () => {
    assert.equal(findHelpPage(PAGES, 'music').id, 'music');
    assert.equal(findHelpPage(PAGES, 'Last.fm').id, 'lastfm');
    assert.equal(findHelpPage(PAGES, 'birth').id, 'birthdays');
    assert.equal(findHelpPage(PAGES, 'mu'), null);
    assert.equal(findHelpPage(PAGES, 'cooking'), null);
});

test('help lines are found for one command, not commands that start with it', () => {
    const lines = findHelpLines(PAGES, 'play');
    assert.equal(lines.length, 1);
    assert.equal(lines[0].page.id, 'music');
    assert.match(lines[0].line, /Play a song/);
    assert.deepEqual(findHelpLines(PAGES, 'nope'), []);
    assert.deepEqual(findHelpLines(PAGES, 'pl(ay'), []);
    assert.deepEqual([...helpCommandNames(PAGES)].sort(), ['fm', 'play', 'playlist', 'setbirthday']);
});
