const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadCommands } = require('../command-loader');
const { parsePrefixCommand, resolveCommandName } = require('../commands/prefix');

test('loads valid commands from command folders and warns about invalid modules', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ruby-bot-commands-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    fs.writeFileSync(path.join(root, 'prefix.js'), 'module.exports = {};');
    const folder = path.join(root, 'utility');
    fs.mkdirSync(folder);
    fs.writeFileSync(
        path.join(folder, 'ping.js'),
        'module.exports = { data: { name: "ping" }, execute() {} };',
    );
    fs.writeFileSync(path.join(folder, 'invalid.js'), 'module.exports = { execute() {} };');
    fs.writeFileSync(path.join(folder, 'helper.js'), 'module.exports = { handle() {} };');

    const messages = [];
    const originalLog = console.log;
    console.log = (message) => messages.push(message);

    try {
        const commands = loadCommands(root);
        assert.deepEqual(commands.map((command) => command.data.name), ['ping']);
        assert.equal(messages.length, 1);
        assert.match(messages[0], /invalid\.js is missing a required "data" or "execute" property/);
    } finally {
        console.log = originalLog;
    }
});

test('resolves existing prefix aliases and preserves canonical names', () => {
    assert.equal(resolveCommandName('q'), 'queue');
    assert.equal(resolveCommandName('neverhaveiever'), 'nhie');
    assert.equal(resolveCommandName('queue'), 'queue');
    assert.equal(resolveCommandName('unknown'), 'unknown');
});

test('parses prefixed command names and arguments with existing whitespace behavior', () => {
    assert.deepEqual(parsePrefixCommand('.Q   song name  ', '.'), { commandName: 'queue', args: ['song', 'name'] });
    assert.deepEqual(parsePrefixCommand('!unknown', '!'), { commandName: 'unknown', args: [] });
    assert.deepEqual(parsePrefixCommand('.', '.'), { commandName: '', args: [] });
    assert.equal(parsePrefixCommand('not a command', '.'), null);
});
