const assert = require('node:assert/strict');
const test = require('node:test');
const { handleSecuritySettingsCommand } = require('../commands/moderation/security-settings');

function setup({ settings = {}, ...overrides } = {}) {
    const calls = [];
    const stored = new Map([['guild', settings]]);
    const channel = { id: 'alerts', isTextBased: () => true, toString: () => '<#alerts>' };
    const target = { id: 'trusted-user', toString: () => '<@trusted-user>' };
    const message = {
        author: { id: 'owner' },
        guild: { id: 'guild', name: 'Test server' },
        mentions: { channels: { first: () => channel } },
        channel: {
            id: 'channel',
            send: (payload) => { calls.push(['sendRaw', payload]); return 'sent'; },
        },
    };
    const dependencies = {
        botName: 'Ruby',
        securitySettings: {
            get: (guildId) => stored.get(guildId),
            set: (guildId, value) => { calls.push(['set', guildId, value]); stored.set(guildId, value); },
        },
        saveSecuritySettings: () => calls.push(['save']),
        updateGuildSecurity: (guildId, patch) => calls.push(['update', guildId, patch]),
        isOwnerOf: () => true,
        resolveTargetMember: async (_message, arg) => { calls.push(['resolve', arg]); return target; },
        limitPresets: { strict: 0.5, normal: 1, relaxed: 2 },
        replyEmbed: (_message, text, options) => { calls.push(['reply', text, options]); return 'replied'; },
        sendEmbed: (...args) => { calls.push(['send', ...args]); return 'sent'; },
        makeEmbed: (text, options) => ({ text, options }),
        logModAction: (entry) => calls.push(['log', entry]),
        errorColor: 123,
        ...overrides,
    };
    return { calls, channel, dependencies, message, stored, target };
}

test('returns unhandled for subcommands outside the security-settings group', async () => {
    const { dependencies, message } = setup();
    assert.deepEqual(await handleSecuritySettingsCommand(message, [], '.', 'audit', dependencies), { handled: false });
});

test('sets alert channel and prompts staff to configure Discord AutoMod', async () => {
    const { calls, channel, dependencies, message, stored } = setup({ settings: { trusted: ['u1'] } });
    const result = await handleSecuritySettingsCommand(message, [], '.', 'alerts', dependencies);
    assert.equal(result.handled, true);
    assert.equal(stored.get('guild').alertChannelId, channel.id);
    assert.deepEqual(stored.get('guild').trusted, ['u1']);
    assert.deepEqual(calls.map(([name]) => name), ['set', 'save', 'send']);
    assert.match(calls[2][2], /security automod/);
});

test('requires a text-based channel for security alerts', async () => {
    const { calls, dependencies, message } = setup();
    message.mentions.channels.first = () => null;
    const result = await handleSecuritySettingsCommand(message, [], '.', 'alerts', dependencies);
    assert.equal(result.result, 'replied');
    assert.match(calls[0][1], /Usage: `\.security alerts #channel`/);
    assert.equal(calls.some(([name]) => name === 'save' || name === 'set'), false);
});

test('lists trusted members without allowing mentions to notify users', async () => {
    const { calls, dependencies, message } = setup({ settings: { trusted: ['u1', 'u2'] } });
    const result = await handleSecuritySettingsCommand(message, [], '.', 'trusted', dependencies);
    assert.equal(result.handled, true);
    assert.match(calls[0][1].embeds[0].text, /<@u1>\n• <@u2>/);
    assert.deepEqual(calls[0][1].allowedMentions, { parse: [] });
});

test('only the owner may change trusted members; trust deduplicates and untrust removes', async () => {
    const notOwner = setup({ isOwnerOf: () => false });
    const denied = await handleSecuritySettingsCommand(notOwner.message, ['trust', 'user'], '.', 'trust', notOwner.dependencies);
    assert.equal(denied.result, 'replied');
    assert.match(notOwner.calls[0][1], /server owner or co-owner/);
    assert.equal(notOwner.calls.some(([name]) => name === 'resolve'), false);

    const trusted = setup({ settings: { trusted: ['trusted-user'] } });
    await handleSecuritySettingsCommand(trusted.message, ['trust', 'user'], '.', 'trust', trusted.dependencies);
    assert.deepEqual(trusted.calls[1][2], { trusted: ['trusted-user'] });

    const untrusted = setup({ settings: { trusted: ['trusted-user', 'other'] } });
    await handleSecuritySettingsCommand(untrusted.message, ['untrust', 'user'], '.', 'untrust', untrusted.dependencies);
    assert.deepEqual(untrusted.calls[1][2], { trusted: ['other'] });
});

test('validates target lookup before changing trusted membership', async () => {
    const { calls, dependencies, message } = setup({ resolveTargetMember: async () => null });
    const result = await handleSecuritySettingsCommand(message, ['trust'], '.', 'trust', dependencies);
    assert.equal(result.result, 'replied');
    assert.match(calls[0][1], /Usage: `\.security trust @user`/);
    assert.equal(calls.some(([name]) => name === 'update'), false);
});

test('sets or disables the account-age gate with bounded days and supported actions', async () => {
    const off = setup();
    await handleSecuritySettingsCommand(off.message, ['minage', 'off'], '.', 'minage', off.dependencies);
    assert.deepEqual(off.calls[0][2], { minAge: null });

    const set = setup();
    await handleSecuritySettingsCommand(set.message, ['minage', '30', 'kick'], '.', 'minage', set.dependencies);
    assert.deepEqual(set.calls[0][2], { minAge: { days: 30, action: 'kick' } });
    assert.match(set.calls[1][2], /kicked \(with a DM explaining why\)/);

    for (const args of [['minage', '0'], ['minage', '366'], ['minage', '10', 'ban']]) {
        const invalid = setup();
        const result = await handleSecuritySettingsCommand(invalid.message, args, '.', 'minage', invalid.dependencies);
        assert.equal(result.result, 'replied');
        assert.match(invalid.calls[0][1], /Usage: `\.security minage/);
        assert.equal(invalid.calls.some(([name]) => name === 'update'), false);
    }
});

test('shows anti-nuke options and limits changes to owner-approved values', async () => {
    const view = setup({ settings: { limits: 'strict' } });
    await handleSecuritySettingsCommand(view.message, ['limits'], '.', 'limits', view.dependencies);
    assert.match(view.calls[0][2], /Currently \*\*strict\*\*/);
    assert.match(view.calls[0][2], /`strict`.*`normal`.*`relaxed`/s);

    const denied = setup({ isOwnerOf: () => false });
    const deniedResult = await handleSecuritySettingsCommand(denied.message, ['limits', 'relaxed'], '.', 'limits', denied.dependencies);
    assert.equal(deniedResult.result, 'replied');
    assert.match(denied.calls[0][1], /server owner or co-owner/);
    assert.equal(denied.calls.some(([name]) => name === 'update'), false);

    const invalid = setup();
    await handleSecuritySettingsCommand(invalid.message, ['punish', 'delete'], '.', 'punish', invalid.dependencies);
    assert.match(invalid.calls[0][1], /Usage: `\.security punish <strip\|kick\|ban>`/);
});

test('updates anti-nuke settings only for valid owner-selected values and records an audit action', async () => {
    const { calls, dependencies, message } = setup();
    const result = await handleSecuritySettingsCommand(message, ['punish', 'ban'], '.', 'punish', dependencies);
    assert.equal(result.handled, true);
    assert.deepEqual(calls.map(([name]) => name), ['update', 'log', 'send']);
    assert.deepEqual(calls[0].slice(1), ['guild', { punish: 'ban' }]);
    assert.equal(calls[1][1].action, 'security:punish');
    assert.equal(calls[1][1].reason, 'ban');
});
