const assert = require('node:assert/strict');
const test = require('node:test');
const { editDistance, findBanEvasion } = require('../commands/moderation/ban-evasion');

const squashName = (name) => String(name ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');

function member(guildId, user) {
    return { guild: { id: guildId }, user: { id: 'new-user', ...user } };
}

test('edit distance returns exact insertion, deletion, substitution, and length-cap results', () => {
    assert.equal(editDistance('kitten', 'sitten'), 1);
    assert.equal(editDistance('abc', 'ab'), 1);
    assert.equal(editDistance('ab', 'abc'), 1);
    assert.equal(editDistance('short', 'muchlonger'), 3);
    assert.equal(editDistance('same', 'same'), 0);
});

test('matching avatar is a strong match even when names differ', () => {
    const banned = { id: 'banned-user', username: 'old-name', avatar: 'avatar-hash', at: 10 };
    const result = findBanEvasion(member('guild', { username: 'new-name', avatar: 'avatar-hash' }), { guild: [banned] }, squashName);
    assert.deepEqual(result, { strength: 'strong', match: banned, why: 'the same profile picture' });
});

test('matching names after normalization are a weak match', () => {
    const banned = { id: 'banned-user', username: 'R.U.B.Y-123' };
    const result = findBanEvasion(member('guild', { username: 'ruby_123' }), { guild: [banned] }, squashName);
    assert.deepEqual(result, { strength: 'weak', match: banned, why: 'an almost identical name' });
});

test('one-character name differences match only for normalized names at least six characters long', () => {
    const banned = { id: 'banned-user', username: 'luna123' };
    const result = findBanEvasion(member('guild', { username: 'luna124' }), { guild: [banned] }, squashName);
    assert.equal(result?.strength, 'weak');

    const shortResult = findBanEvasion(
        member('guild', { username: 'user2' }),
        { guild: [{ id: 'other', username: 'user1' }] },
        squashName,
    );
    assert.equal(shortResult, null);
});

test('ignores the same user and fingerprints from other guilds', () => {
    const sameUser = { id: 'new-user', username: 'matching-name', avatar: 'same-avatar' };
    assert.equal(
        findBanEvasion(member('guild', { username: 'matching-name', avatar: 'same-avatar' }), { guild: [sameUser] }, squashName),
        null,
    );
    assert.equal(
        findBanEvasion(member('guild', { username: 'matching-name' }), { otherGuild: [{ id: 'banned', username: 'matching-name' }] }, squashName),
        null,
    );
});

test('compares both username and global name but ignores normalized names shorter than four characters', () => {
    const match = { id: 'banned-user', username: 'x', globalName: 'Friendly Person' };
    const result = findBanEvasion(
        member('guild', { username: 'ordinary', globalName: 'Friendly.Person' }),
        { guild: [match] },
        squashName,
    );
    assert.deepEqual(result, { strength: 'weak', match, why: 'an almost identical name' });
});
