const assert = require('node:assert/strict');
const test = require('node:test');
const { handleSecurityStatusCommand } = require('../commands/moderation/security-status');

function createEmbed() {
    return {
        setColor(value) { this.color = value; return this; },
        setTitle(value) { this.title = value; return this; },
        setDescription(value) { this.description = value; return this; },
        addFields(...fields) { this.fields = fields; return this; },
    };
}

function setup({ granted = [], rules = [], fetchRules = async () => rules, ...overrides } = {}) {
    const calls = [];
    const message = {
        guild: {
            id: 'guild',
            members: { me: { permissions: { has: (flag) => granted.includes(flag) } } },
            autoModerationRules: {
                fetch: async () => { calls.push(['fetchRules']); return fetchRules(); },
            },
        },
        channel: { send: (payload) => { calls.push(['send', payload]); return 'sent'; } },
    };
    const dependencies = {
        permissionFlags: {
            ManageMessages: 'manage-messages',
            ModerateMembers: 'moderate-members',
            BanMembers: 'ban-members',
            ManageGuild: 'manage-guild',
        },
        getSecurityAlertChannel: (guild) => { calls.push(['alertChannel', guild]); return '<#alerts>'; },
        securitySettings: { get: (guildId) => { calls.push(['settings', guildId]); return { limits: 'strict', punish: 'ban' }; } },
        createEmbed,
        themeColor: 456,
        botName: 'Ruby',
        phishingDomainCount: 1234,
        automodCsamRule: 'Ruby • CSAM blocker',
        mentionSpamTrigger: 'mention-spam',
        spamTrigger: 'spam',
        ...overrides,
    };
    return { calls, dependencies, message };
}

test('reports security posture, current permissions, alert channel, and configured settings', async () => {
    const { calls, dependencies, message } = setup({
        granted: ['manage-messages', 'ban-members'],
        getSecurityAlertChannel: () => null,
    });
    assert.equal(await handleSecurityStatusCommand(message, '.', dependencies), 'sent');
    const embed = calls.find(([name]) => name === 'send')[1].embeds[0];
    assert.equal(embed.title, '🛡️ Ruby Security');
    assert.match(embed.description, /Anti-nuke \(limits: \*\*strict\*\*, punishment: \*\*ban\*\*\)/);
    assert.match(embed.description, /1,234 phishing domains/);
    assert.deepEqual(embed.fields[0], { name: 'Alert channel', value: '❌ Not set - `.security alerts #channel`' });
    assert.match(embed.fields[1].value, /✅ Manage Messages/);
    assert.match(embed.fields[1].value, /❌ Moderate Members/);
    assert.match(embed.fields[1].value, /✅ Ban Members/);
});

test('does not fetch AutoMod rules without Manage Server permission', async () => {
    const { calls, dependencies, message } = setup();
    await handleSecurityStatusCommand(message, '.', dependencies);
    assert.equal(calls.some(([name]) => name === 'fetchRules'), false);
    const embed = calls.find(([name]) => name === 'send')[1].embeds[0];
    assert.match(embed.fields[2].value, /Could not read AutoMod rules \(needs Manage Server\)/);
});

test('reports enabled default and custom AutoMod rules accurately', async () => {
    const { calls, dependencies, message } = setup({
        granted: ['manage-guild'],
        rules: [
            { name: 'Ruby • CSAM blocker', triggerType: 'keyword', enabled: true },
            { name: 'Block Mention Spam', triggerType: 'mention-spam', enabled: true },
            { name: 'Custom Spam Rule', triggerType: 'spam', enabled: true },
        ],
    });
    await handleSecurityStatusCommand(message, '.', dependencies);
    assert.equal(calls.some(([name]) => name === 'fetchRules'), true);
    const rules = calls.find(([name]) => name === 'send')[1].embeds[0].fields[2].value;
    assert.match(rules, /✅ CSAM-advertising blocker\n✅ Mention-spam limit \(your rule "Block Mention Spam"\)\n✅ Suspected-spam filter \(your rule "Custom Spam Rule"\)/);
    assert.match(rules, /Set up \/ refresh: `\.security automod`/);
});

test('reports missing or unavailable AutoMod rules without failing the security report', async () => {
    const missing = setup({ granted: ['manage-guild'], rules: [] });
    await handleSecurityStatusCommand(missing.message, '.', missing.dependencies);
    const missingRules = missing.calls.find(([name]) => name === 'send')[1].embeds[0].fields[2].value;
    assert.match(missingRules, /❌ CSAM-advertising blocker\n❌ Mention-spam limit\n❌ Suspected-spam filter/);

    const unavailable = setup({
        granted: ['manage-guild'],
        fetchRules: async () => { throw new Error('Discord unavailable'); },
    });
    await handleSecurityStatusCommand(unavailable.message, '.', unavailable.dependencies);
    const unavailableRules = unavailable.calls.find(([name]) => name === 'send')[1].embeds[0].fields[2].value;
    assert.match(unavailableRules, /❌ CSAM-advertising blocker\n❌ Mention-spam limit\n❌ Suspected-spam filter/);
});
