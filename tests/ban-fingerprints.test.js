const assert = require('node:assert/strict');
const test = require('node:test');
const { createBanFingerprintStore } = require('../commands/moderation/ban-fingerprints');

function setup(initialFile = null, overrides = {}) {
    let fileContent = initialFile;
    let writes = 0;
    let ensured = 0;
    const errors = [];
    const fs = {
        existsSync: () => fileContent !== null,
        readFileSync: () => fileContent,
    };
    const store = createBanFingerprintStore({
        file: 'fingerprints.json',
        fs,
        ensureDataDir: () => { ensured++; },
        writeFileAtomic: (_file, content) => {
            writes++;
            fileContent = content;
        },
        logger: { error: (...args) => errors.push(args) },
        now: () => 1234,
        ...overrides,
    });
    return {
        store,
        errors,
        get fileContent() { return fileContent; },
        get writes() { return writes; },
        get ensured() { return ensured; },
    };
}

test('loads persisted guild fingerprints and leaves missing-file state empty', () => {
    const serialized = JSON.stringify({ guild: [{ id: 'banned', username: 'old-name' }] });
    const stored = setup(serialized);
    stored.store.load();
    assert.deepEqual(stored.store.getFingerprints(), JSON.parse(serialized));
    assert.equal(stored.errors.length, 0);

    const missing = setup();
    missing.store.load();
    assert.deepEqual(missing.store.getFingerprints(), {});
    assert.equal(missing.errors.length, 0);
});

test('reports malformed persisted JSON and retains usable empty state', () => {
    const stored = setup('{broken json');
    stored.store.load();
    assert.deepEqual(stored.store.getFingerprints(), {});
    assert.equal(stored.errors.length, 1);
    assert.match(stored.errors[0][0], /Failed to load ban fingerprints/);
    assert.ok(stored.errors[0][1] instanceof SyntaxError);
});

test('remembers a user once, stores optional fields and timestamp, and caps each guild at 300', () => {
    const stored = setup();
    for (let index = 0; index < 301; index++) {
        stored.store.remember('guild', { id: `user-${index}`, username: `name-${index}` });
    }
    stored.store.remember('guild', {
        id: 'user-300',
        username: 'updated-name',
        globalName: 'Updated',
        avatar: 'avatar-hash',
    });
    const entries = stored.store.getFingerprints().guild;
    assert.equal(entries.length, 300);
    assert.deepEqual(entries[0], {
        id: 'user-300',
        username: 'updated-name',
        globalName: 'Updated',
        avatar: 'avatar-hash',
        at: 1234,
    });
    assert.equal(entries.filter((entry) => entry.id === 'user-300').length, 1);
    assert.equal(entries.some((entry) => entry.id === 'user-0'), false);
    assert.equal(stored.writes, 302);
    assert.equal(stored.ensured, 302);
    assert.deepEqual(JSON.parse(stored.fileContent), stored.store.getFingerprints());
});

test('forget removes only the matching guild fingerprint and does not write for missing entries', () => {
    const serialized = JSON.stringify({
        guild: [{ id: 'keep', username: 'keep' }, { id: 'remove', username: 'remove' }],
        other: [{ id: 'remove', username: 'other guild' }],
    });
    const stored = setup(serialized);
    stored.store.load();
    stored.store.forget('guild', 'absent');
    assert.equal(stored.writes, 0);
    stored.store.forget('guild', 'remove');
    assert.deepEqual(stored.store.getFingerprints(), {
        guild: [{ id: 'keep', username: 'keep' }],
        other: [{ id: 'remove', username: 'other guild' }],
    });
    assert.equal(stored.writes, 1);
    assert.deepEqual(JSON.parse(stored.fileContent), stored.store.getFingerprints());
});

test('logs persistence failures while retaining in-memory ban state', () => {
    const stored = setup(null, {
        ensureDataDir: () => { throw new Error('disk unavailable'); },
    });
    stored.store.remember('guild', { id: 'banned', username: 'old-name' });
    assert.equal(stored.store.getFingerprints().guild[0].id, 'banned');
    assert.equal(stored.errors.length, 1);
    assert.match(stored.errors[0][0], /Failed to save ban fingerprints/);
    assert.match(stored.errors[0][1].message, /disk unavailable/);
});
