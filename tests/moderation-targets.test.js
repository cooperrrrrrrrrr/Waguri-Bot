const assert = require('node:assert/strict');
const test = require('node:test');
const { getTargetUserId, resolveTargetMember } = require('../permissions/targets');

const userId = '12345678901234567';

test('accepts raw IDs and Discord user mention forms only', () => {
    assert.equal(getTargetUserId(userId), userId);
    assert.equal(getTargetUserId(`<@${userId}>`), userId);
    assert.equal(getTargetUserId(`<@!${userId}>`), userId);
    assert.equal(getTargetUserId('1234567890123456'), null);
    assert.equal(getTargetUserId('123456789012345678901'), null);
    assert.equal(getTargetUserId(`<@&${userId}>`), null);
    assert.equal(getTargetUserId('not-a-user'), null);
    assert.equal(getTargetUserId(undefined), null);
});

test('resolves a valid target using the guild member fetch API', async () => {
    const member = { id: userId };
    const fetched = [];
    const message = { guild: { members: { fetch: async (id) => { fetched.push(id); return member; } } } };

    assert.equal(await resolveTargetMember(message, `<@${userId}>`), member);
    assert.deepEqual(fetched, [userId]);
});

test('does not fetch invalid IDs or targets outside a guild', async () => {
    let fetches = 0;
    const message = { guild: { members: { fetch: async () => { fetches++; } } } };

    assert.equal(await resolveTargetMember(message, `<@&${userId}>`), null);
    assert.equal(await resolveTargetMember({ guild: null }, userId), null);
    assert.equal(fetches, 0);
});

test('returns null when Discord cannot resolve a valid target ID', async () => {
    const message = { guild: { members: { fetch: async () => { throw new Error('Unknown member'); } } } };

    assert.equal(await resolveTargetMember(message, userId), null);
});
