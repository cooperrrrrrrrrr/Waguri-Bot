const assert = require('node:assert/strict');
const test = require('node:test');
const { handleVerificationGateCommand } = require('../commands/moderation/verification');

function setup(overrides = {}) {
    const calls = [];
    const verificationChannel = {
        id: 'verify-channel',
        name: 'verify',
        isTextBased: () => true,
        toString: () => '<#verify-channel>',
    };
    const status = {
        edit: async (payload) => { calls.push(['statusEdit', payload]); return 'edited'; },
    };
    const message = {
        member: { id: 'admin' },
        author: { id: 'admin', tag: 'Admin#1234' },
        guild: { id: 'guild', name: 'Test server' },
        mentions: { channels: { first: () => verificationChannel } },
        channel: {
            send: async (payload) => { calls.push(['statusSend', payload]); return status; },
        },
    };
    const dependencies = {
        hasAdminAccess: () => true,
        denyAdminCommand: (...args) => { calls.push(['deny', ...args]); return 'denied'; },
        replyEmbed: (_message, text, options) => { calls.push(['reply', text, options]); return 'replied'; },
        sendEmbed: (...args) => { calls.push(['send', ...args]); return 'sent'; },
        makeEmbed: (text, options) => ({ text, options }),
        setupVerification: async (...args) => {
            calls.push(['setup', ...args.slice(0, 2)]);
            await args[2]('progress');
            return { role: '<@&role>', channels: 3 };
        },
        disableVerification: async (guild) => { calls.push(['disable', guild]); return 4; },
        verifySettings: () => ({ channelId: 'verify-channel', roleId: 'role' }),
        logModAction: (entry) => calls.push(['log', entry]),
        errorColor: 123,
        ...overrides,
    };
    return { calls, dependencies, message, verificationChannel };
}

test('denies non-admin users before running verification actions', async () => {
    const { calls, dependencies, message } = setup({ hasAdminAccess: () => false });
    assert.equal(await handleVerificationGateCommand(message, ['setup'], '.', dependencies), 'denied');
    assert.deepEqual(calls, [['deny', message, '.verify']]);
});

test('requires a text channel to set up the verification gate', async () => {
    const { calls, dependencies, message } = setup();
    message.mentions.channels.first = () => null;
    assert.equal(await handleVerificationGateCommand(message, ['setup'], '.', dependencies), 'replied');
    assert.match(calls[0][1], /Usage: `\.verify setup #verify-channel`/);
    assert.equal(calls.some(([name]) => name === 'setup'), false);

    const voiceChannel = setup();
    voiceChannel.message.mentions.channels.first = () => ({ isTextBased: () => false });
    await handleVerificationGateCommand(voiceChannel.message, ['setup'], '.', voiceChannel.dependencies);
    assert.equal(voiceChannel.calls[0][0], 'reply');
});

test('sets up the gate, shows progress, logs completion, and presents the recovery command', async () => {
    const { calls, dependencies, message, verificationChannel } = setup();
    assert.equal(await handleVerificationGateCommand(message, ['setup'], '.', dependencies), 'edited');
    assert.deepEqual(calls.map(([name]) => name), ['statusSend', 'setup', 'statusEdit', 'log', 'statusEdit']);
    assert.deepEqual(calls[1].slice(1), [message.guild, verificationChannel]);
    assert.equal(calls[2][1].embeds[0].text, 'progress');
    assert.equal(calls[3][1].action, 'verify:setup');
    assert.equal(calls[3][1].reason, '#verify');
    assert.match(calls[4][1].embeds[0].text, /3 channels are hidden/);
    assert.match(calls[4][1].embeds[0].text, /`\.verify off`/);
});

test('turns the verification gate off and reports released members', async () => {
    const { calls, dependencies, message } = setup();
    assert.equal(await handleVerificationGateCommand(message, ['off'], '.', dependencies), 'sent');
    assert.deepEqual(calls.map(([name]) => name), ['disable', 'send']);
    assert.equal(calls[0][1], message.guild);
    assert.match(calls[1][2], /4 waiting member\(s\) were let in/);
});

test('reports the configured gate status or setup instructions', async () => {
    const active = setup();
    await handleVerificationGateCommand(active.message, [], '.', active.dependencies);
    assert.match(active.calls[0][2], /\*\*on\*\* in <#verify-channel> \(role <@&role>\)/);

    const inactive = setup({ verifySettings: () => null });
    await handleVerificationGateCommand(inactive.message, ['status'], '.', inactive.dependencies);
    assert.match(inactive.calls[0][2], /off.*`\.verify setup #channel`/);
});
