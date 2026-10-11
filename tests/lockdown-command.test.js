const assert = require('node:assert/strict');
const test = require('node:test');
const { handleLockdownCommand, handleUnlockCommand } = require('../commands/moderation/lockdown');

function setup(overrides = {}) {
    const calls = [];
    const message = {
        member: { id: 'moderator' },
        author: { id: 'moderator', tag: 'Mod#1234', toString: () => '<@moderator>' },
        guild: { id: 'guild', name: 'Test server' },
        channel: {
            id: 'channel',
            name: 'general',
            permissionOverwrites: {
                cache: new Map(),
                edit: async (...args) => calls.push(['edit', ...args]),
            },
            send: async (payload) => {
                calls.push(['statusSend', payload]);
                return { edit: async (editPayload) => { calls.push(['statusEdit', editPayload]); } };
            },
        },
    };
    const dependencies = {
        permission: 'manage-channels',
        hasModerationPermission: () => true,
        securitySettings: { get: () => null },
        replyEmbed: (_message, text, options) => { calls.push(['reply', text, options]); return 'replied'; },
        sendEmbed: (...args) => { calls.push(['send', ...args]); return 'sent'; },
        makeEmbed: (text, options) => ({ text, options }),
        lockdownServer: async (_guild, onProgress) => { calls.push(['lockdownServer']); onProgress('progress'); return 3; },
        unlockServer: async () => { calls.push(['unlockServer']); return 2; },
        logModAction: (entry) => calls.push(['log', entry]),
        sendSecurityAlert: async (...args) => calls.push(['alert', ...args]),
        editChannelOverwrite: (channel, guildId, permissions) => channel.permissionOverwrites.edit(guildId, permissions),
        isSendMessagesDenied: (overwrite) => overwrite && overwrite.deny.has('SendMessages'),
        errorColor: 123,
        ...overrides,
    };
    return { calls, dependencies, message };
}

test('denies non-staff before changing channel permissions', async () => {
    const { calls, dependencies, message } = setup({ hasModerationPermission: () => false });
    assert.equal(await handleLockdownCommand(message, [], '.', dependencies), 'replied');
    assert.match(calls[0][1], /Only staff can lock down/);
    assert.equal(calls.some(([name]) => name === 'edit' || name === 'lockdownServer'), false);
});

test('locks the current channel and records the action only after the overwrite succeeds', async () => {
    const { calls, dependencies, message } = setup();
    assert.equal(await handleLockdownCommand(message, [], '.', dependencies), 'sent');
    assert.deepEqual(calls.map(([name]) => name), ['edit', 'log', 'send']);
    assert.deepEqual(calls[0].slice(1), [message.guild.id, { SendMessages: false }]);
    assert.equal(calls[1][1].action, 'lockdown');
});

test('does not edit a channel that is already locked', async () => {
    const { calls, dependencies, message } = setup({
        isSendMessagesDenied: () => true,
    });
    assert.equal(await handleLockdownCommand(message, [], '.', dependencies), 'sent');
    assert.deepEqual(calls.map(([name]) => name), ['send']);
    assert.match(calls[0][2], /already locked down/);
});

test('locks down the server, reports progress, alerts, and explains recovery', async () => {
    const { calls, dependencies, message } = setup();
    assert.equal(await handleLockdownCommand(message, ['server', 'incident'], '.', dependencies), undefined);
    assert.deepEqual(calls.map(([name]) => name), ['statusSend', 'lockdownServer', 'statusEdit', 'log', 'alert', 'statusEdit']);
    assert.equal(calls[2][1].embeds[0].text, 'progress');
    assert.equal(calls[3][1].action, 'lockdown:server');
    assert.equal(calls[3][1].reason, 'incident');
    assert.equal(calls[4][2].title, 'Server locked down');
    assert.match(calls[5][1].embeds[0].text, /Lift it with `\.unlock server`/);
});

test('refuses a second server lockdown while one is active', async () => {
    const { calls, dependencies, message } = setup({
        securitySettings: { get: () => ({ lockdown: { at: 1, channels: {} } }) },
    });
    assert.equal(await handleLockdownCommand(message, ['server'], '.', dependencies), 'replied');
    assert.deepEqual(calls.map(([name]) => name), ['reply']);
    assert.match(calls[0][1], /already locked down/);
});

test('denies non-staff from unlocking', async () => {
    const { calls, dependencies, message } = setup({ hasModerationPermission: () => false });
    assert.equal(await handleUnlockCommand(message, [], dependencies), 'replied');
    assert.match(calls[0][1], /Only staff can unlock/);
    assert.equal(calls.some(([name]) => name === 'edit' || name === 'unlockServer'), false);
});

test('unlocks the current channel and records the action', async () => {
    const { calls, dependencies, message } = setup();
    assert.equal(await handleUnlockCommand(message, [], dependencies), 'sent');
    assert.deepEqual(calls.map(([name]) => name), ['edit', 'log', 'send']);
    assert.deepEqual(calls[0].slice(1), [message.guild.id, { SendMessages: null }]);
    assert.equal(calls[1][1].action, 'unlock');
});

test('does not claim server restoration if no lockdown is active', async () => {
    const calls = [];
    const { dependencies, message } = setup({
        unlockServer: async () => { calls.push(['unlockServer']); return null; },
        replyEmbed: (_message, text, options) => { calls.push(['reply', text, options]); return 'replied'; },
    });
    assert.equal(await handleUnlockCommand(message, ['server'], dependencies), 'replied');
    assert.deepEqual(calls.map(([name]) => name), ['unlockServer', 'reply']);
    assert.match(calls[1][1], /isn't locked down/);
});

test('restores the server, alerts, and confirms the restored channel count', async () => {
    const calls = [];
    const { dependencies, message } = setup({
        unlockServer: async () => { calls.push(['unlockServer']); return 2; },
        logModAction: (entry) => calls.push(['log', entry]),
        sendSecurityAlert: async (...args) => calls.push(['alert', ...args]),
        sendEmbed: (...args) => { calls.push(['send', ...args]); return 'sent'; },
    });
    assert.equal(await handleUnlockCommand(message, ['server'], dependencies), 'sent');
    assert.deepEqual(calls.map(([name]) => name), ['unlockServer', 'log', 'alert', 'send']);
    assert.equal(calls[1][1].action, 'unlock:server');
    assert.equal(calls[2][2].title, 'Server lockdown lifted');
    assert.match(calls[3][2], /2\*\* channels are back/);
});
