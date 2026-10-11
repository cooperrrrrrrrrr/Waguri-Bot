const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ensureDataDir, writeFileAtomic } = require('../storage/files');

test('creates the application data directory recursively', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ruby-bot-data-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const directory = path.join(root, 'nested', 'data');

    ensureDataDir(directory);
    ensureDataDir(directory);

    assert.equal(fs.statSync(directory).isDirectory(), true);
});

test('atomically replaces persisted data', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ruby-bot-save-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const file = path.join(root, 'state.json');

    fs.writeFileSync(file, '{"old":true}');
    writeFileAtomic(file, '{"saved":true}');

    assert.equal(fs.readFileSync(file, 'utf8'), '{"saved":true}');
    assert.equal(fs.existsSync(`${file}.${process.pid}.tmp`), false);
});
