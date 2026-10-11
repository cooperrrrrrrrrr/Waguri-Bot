const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const auth = require('../dashboard/auth');

test('loads missing and valid account files but reports corrupted files', (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ruby-dashboard-users-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'users.json');

    assert.deepEqual(auth.loadUsers(file), {});
    fs.writeFileSync(file, JSON.stringify({ staff: { hash: 'value' } }));
    assert.deepEqual(auth.loadUsers(file), { staff: { hash: 'value' } });

    fs.writeFileSync(file, '{broken');
    assert.throws(() => auth.loadUsers(file), /Dashboard account file is not valid JSON/);
    fs.writeFileSync(file, '[]');
    assert.throws(() => auth.loadUsers(file), /must contain a JSON object/);
});

test('normalizes security answers consistently', () => {
    assert.equal(auth.normalizeAnswer('  Sadaharu   Is Here  '), 'sadaharu is here');
    assert.equal(auth.normalizeAnswer(null), '');
});

test('enforces password length, username, and repeated-character rules', () => {
    assert.match(auth.checkPasswordRules('short', 'cooper'), /at least 12 characters/);
    assert.match(auth.checkPasswordRules('a'.repeat(201), 'cooper'), /under 200 characters/);
    assert.match(auth.checkPasswordRules('Cooper-needs-a-long-password', 'cooper'), /contain the username/);
    assert.match(auth.checkPasswordRules('a'.repeat(12), 'cooper'), /one character repeated/);
    assert.equal(auth.checkPasswordRules('A-distinct-password-42', 'cooper'), null);
});

test('generates and verifies time-based authenticator codes', () => {
    const secret = auth.newTotpSecret();
    const step = 60_000;
    const code = auth.totpAt(secret, step);

    assert.match(code, /^\d{6}$/);
    assert.equal(auth.checkTotp(secret, code, step * 30_000), step);
    assert.equal(auth.checkTotp(secret, 'not-a-code', step * 30_000), null);
});

test('verifies normalized passwords synchronously and asynchronously', async () => {
    const password = 'Cafe\u0301-with-a-long-password';
    const record = auth.hashPassword(password);

    assert.equal(auth.verifyPassword(password.normalize('NFKC'), record), true);
    assert.equal(auth.verifyPassword('a different password', record), false);
    assert.equal(await auth.verifyPasswordAsync(password.normalize('NFKC'), record), true);
    assert.equal(await auth.verifyPasswordAsync('a different password', record), false);
});
