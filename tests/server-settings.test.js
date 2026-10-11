const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveServerSetting } = require('../server-settings');

const options = [
    { key: 'welcome', type: 'channel', env: 'WELCOME_CHANNEL_ID', config: 'welcomeChannelId' },
    { key: 'adminrole', type: 'role', env: 'ADMIN_ROLE_ID', config: 'adminRoleId' },
];
const settings = (guildOrId, key, { serverSetup = {}, env = {}, config = {} } = {}) =>
    resolveServerSetting(guildOrId, key, { serverSetup, options, env, config });

test('uses a configured per-guild value before any legacy fallback', () => {
    const guild = { id: 'guild-a', channels: { cache: { has: () => false } } };
    assert.equal(settings(guild, 'welcome', {
        serverSetup: { 'guild-a': { welcome: 'channel-a' } },
        env: { WELCOME_CHANNEL_ID: 'legacy-channel' },
    }), 'channel-a');
});

test('uses legacy channel and role IDs only when they exist in that guild', () => {
    const guild = {
        id: 'guild-a',
        channels: { cache: { has: (id) => id === 'channel-a' } },
        roles: { cache: { has: (id) => id === 'role-a' } },
    };
    assert.equal(settings(guild, 'welcome', { env: { WELCOME_CHANNEL_ID: 'channel-a' } }), 'channel-a');
    assert.equal(settings(guild, 'adminrole', { env: { ADMIN_ROLE_ID: 'role-a' } }), 'role-a');
    assert.equal(settings(guild, 'adminrole', { env: { ADMIN_ROLE_ID: 'other-guild-role' } }), '');
});

test('does not apply legacy global IDs when given only a guild ID', () => {
    assert.equal(settings('guild-a', 'adminrole', { env: { ADMIN_ROLE_ID: 'legacy-role' } }), '');
});
