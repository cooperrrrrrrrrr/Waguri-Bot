const assert = require('node:assert/strict');
const test = require('node:test');
const { handleSecurityToolsCommand } = require('../commands/moderation/security-tools');

function setup(overrides = {}) {
    const calls = [];
    const message = {
        guild: { id: 'guild' },
        channelId: 'staff-test',
        channel: { id: 'channel' },
    };
    const dependencies = {
        setting: (guild, key) => {
            calls.push(['setting', guild, key]);
            return key === 'securitytest' ? 'staff-test' : null;
        },
        setupAutoModRules: async (guild) => { calls.push(['automod', guild]); return ['Rule created', 'Rule updated']; },
        runSecuritySelfTest: () => { calls.push(['selftest']); return ['Check 1', 'Check 2']; },
        replyEmbed: (_message, text, options) => { calls.push(['reply', text, options]); return 'replied'; },
        sendEmbed: (...args) => { calls.push(['send', ...args]); return 'sent'; },
        errorColor: 123,
        ...overrides,
    };
    return { calls, dependencies, message };
}

test('returns unhandled for unrelated security subcommands', async () => {
    const { dependencies, message } = setup();
    assert.deepEqual(await handleSecurityToolsCommand(message, [], '.', 'status', dependencies), { handled: false });
});

test('sets up Discord AutoMod and reports each result', async () => {
    const { calls, dependencies, message } = setup();
    const result = await handleSecurityToolsCommand(message, [], '.', 'automod', dependencies);
    assert.equal(result.handled, true);
    assert.equal(result.result, 'sent');
    assert.deepEqual(calls.map(([name]) => name), ['automod', 'send']);
    assert.equal(calls[0][1], message.guild);
    assert.equal(calls[1][2], 'Rule created\nRule updated');
    assert.equal(calls[1][3].title, '🛡️ Discord AutoMod setup');
});

test('requires a configured staff test channel before running sensitive diagnostics', async () => {
    const { calls, dependencies, message } = setup({ setting: () => null });
    const result = await handleSecurityToolsCommand(message, [], '.', 'test', dependencies);
    assert.equal(result.result, 'replied');
    assert.match(calls[0][1], /Pick a staff-only channel/);
    assert.equal(calls.some(([name]) => name === 'selftest' || name === 'send'), false);
});

test('does not disclose self-test results outside the configured staff channel', async () => {
    const { calls, dependencies, message } = setup();
    message.channelId = 'public-channel';
    const result = await handleSecurityToolsCommand(message, [], '.', 'test', dependencies);
    assert.equal(result.result, 'replied');
    assert.match(calls[1][1], /only runs in <#staff-test>/);
    assert.equal(calls.some(([name]) => name === 'selftest' || name === 'send'), false);
});

test('sends self-test results only inside the configured staff channel', async () => {
    const { calls, dependencies, message } = setup();
    const result = await handleSecurityToolsCommand(message, [], '.', 'test', dependencies);
    assert.equal(result.handled, true);
    assert.deepEqual(calls.map(([name]) => name), ['setting', 'selftest', 'send']);
    assert.equal(calls[2][2], 'Check 1\nCheck 2');
    assert.equal(calls[2][3].title, '🛡️ Security self-test');
});
