const test = require('node:test');
const assert = require('node:assert/strict');
const {
    classifyMusicUrl,
    isSpotifyUrl,
    isSoundCloudSearch,
    soundCloudSearchQuery,
    validateMusicTarget,
    validateMusicUrl,
} = require('../music-sources');

test('music URLs accept SoundCloud and reject YouTube or insecure sources', () => {
    assert.equal(classifyMusicUrl('https://soundcloud.com/artist/track'), 'soundcloud');
    assert.equal(classifyMusicUrl('https://on.soundcloud.com/example'), 'soundcloud');
    assert.equal(classifyMusicUrl('https://cdn.example.com/track.mp3?download=1'), 'direct-audio');
    assert.equal(classifyMusicUrl('https://youtube.com/watch?v=abc'), 'youtube');
    assert.equal(classifyMusicUrl('https://youtu.be/abc'), 'youtube');
    assert.equal(classifyMusicUrl('http://cdn.example.com/track.mp3'), 'unsupported');
    assert.equal(classifyMusicUrl('https://example.com/page'), 'unsupported');
});

test('SoundCloud search prefixes are capped at five candidates', () => {
    assert.equal(soundCloudSearchQuery('artist - track', 20), 'scsearch5:artist - track');
    assert.equal(soundCloudSearchQuery('track', 1), 'scsearch1:track');
    assert.equal(isSoundCloudSearch('scsearch5:track'), true);
    assert.equal(isSoundCloudSearch('scsearch99:track'), false);
    assert.equal(isSoundCloudSearch('scsearch5:'), false);
    assert.throws(() => soundCloudSearchQuery(''));
});

test('Spotify metadata URLs are restricted to supported Spotify pages', () => {
    assert.equal(isSpotifyUrl('https://open.spotify.com/track/3likT1mQU8U5YVzulBQe1x'), true);
    assert.equal(isSpotifyUrl('https://open.spotify.com/intl-en/album/abc123'), true);
    assert.equal(isSpotifyUrl('https://open.spotify.com.evil.example/track/abc123'), false);
    assert.equal(isSpotifyUrl('http://open.spotify.com/track/abc123'), false);
});

test('direct audio URLs are limited to publicly resolved hosts', async () => {
    const documentationLookup = async () => [{ address: '203.0.113.2', family: 4 }];
    const realPublicLookup = async () => [{ address: '8.8.8.8', family: 4 }];
    const privateLookup = async () => [{ address: '127.0.0.1', family: 4 }];
    const publicIpv6Lookup = async () => [{ address: '2606:4700:4700::1111', family: 6 }];
    const privateIpv6Lookup = async () => [{ address: 'fc00::1', family: 6 }];

    await assert.rejects(validateMusicUrl('https://cdn.example.com/song.mp3', documentationLookup), /public internet/);
    assert.equal(await validateMusicUrl('https://cdn.example.com/song.mp3', realPublicLookup), 'https://cdn.example.com/song.mp3');
    await assert.rejects(validateMusicUrl('https://cdn.example.com/song.mp3', privateLookup), /public internet/);
    assert.equal(await validateMusicUrl('https://cdn.example.com/song.mp3', publicIpv6Lookup), 'https://cdn.example.com/song.mp3');
    await assert.rejects(validateMusicUrl('https://cdn.example.com/song.mp3', privateIpv6Lookup), /public internet/);
    await assert.rejects(validateMusicTarget('https://youtube.com/watch?v=abc'), /YouTube links are not supported/);
});
