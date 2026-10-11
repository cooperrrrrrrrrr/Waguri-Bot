const test = require('node:test');
const assert = require('node:assert/strict');
const { visibleTrackPlayCount } = require('../lastfm-display');

test('Last.fm hides track play counts below ten and shows ten or more', () => {
    assert.equal(visibleTrackPlayCount(undefined), null);
    assert.equal(visibleTrackPlayCount(0), null);
    assert.equal(visibleTrackPlayCount(9), null);
    assert.equal(visibleTrackPlayCount(10), 10);
    assert.equal(visibleTrackPlayCount('27'), 27);
});
