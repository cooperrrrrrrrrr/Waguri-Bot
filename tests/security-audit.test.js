const assert = require('node:assert/strict');
const test = require('node:test');
const { runSecurityAudit } = require('../commands/moderation/security-audit');

function createEmbed() {
    return {
        setColor(value) { this.color = value; return this; },
        setTitle(value) { this.title = value; return this; },
        setDescription(value) { this.description = value; return this; },
        setTimestamp(value) { this.timestamp = value; return this; },
    };
}

const asCollection = (values) => ({
    ...values,
    filter(predicate) {
        const filtered = values.filter(predicate);
        filtered.size = filtered.length;
        return filtered;
    },
});

function setup({
    everyonePermissions = [],
    botPermissions = ['Administrator', 'ManageRoles', 'ManageMessages', 'ModerateMembers', 'BanMembers', 'ManageGuild'],
    members = [],
    rolePosition = 100,
    highestRolePosition = 100,
    verification = 2,
    explicitFilter = 1,
    mfa = 1,
    notifications = 1,
    webhookCount = 2,
    webhooksError = false,
    rules = [{ name: 'csam-rule', enabled: true }],
    rulesError = false,
    alertChannel = { id: 'alerts' },
    verifyEnabled = true,
    backups = ['backup'],
} = {}) {
    const calls = [];
    const flags = {
        Administrator: 'Administrator',
        ManageGuild: 'ManageGuild',
        ManageRoles: 'ManageRoles',
        ManageChannels: 'ManageChannels',
        BanMembers: 'BanMembers',
        KickMembers: 'KickMembers',
        ManageWebhooks: 'ManageWebhooks',
        MentionEveryone: 'MentionEveryone',
        ManageMessages: 'ManageMessages',
        ModerateMembers: 'ModerateMembers',
    };
    const permissions = (granted) => ({ has: (permission) => granted.includes(permission) });
    const botMember = {
        id: 'bot-id',
        user: { id: 'bot-id', username: 'Ruby', bot: true },
        permissions: permissions(botPermissions),
        roles: { highest: { id: 'bot-role', position: rolePosition } },
    };
    const memberCache = asCollection([botMember, ...members]);
    const guild = {
        id: 'guild',
        roles: {
            everyone: { permissions: permissions(everyonePermissions) },
            highest: { id: 'top-role', position: highestRolePosition },
        },
        members: {
            me: botMember,
            cache: memberCache,
            fetch: async () => { calls.push(['membersFetch']); },
        },
        verificationLevel: verification,
        explicitContentFilter: explicitFilter,
        mfaLevel: mfa,
        defaultMessageNotifications: notifications,
        fetchWebhooks: async () => {
            calls.push(['fetchWebhooks']);
            if (webhooksError) throw new Error('Discord unavailable');
            return { size: webhookCount };
        },
        autoModerationRules: {
            fetch: async () => {
                calls.push(['fetchRules']);
                if (rulesError) throw new Error('Discord unavailable');
                return { some: (predicate) => rules.some(predicate) };
            },
        },
    };
    const dependencies = {
        permissionFlags: flags,
        verificationLevel: { Medium: 1 },
        explicitContentFilter: { AllMembers: 1 },
        mfaLevel: { Elevated: 1 },
        defaultMessageNotifications: { OnlyMentions: 1 },
        clientUserId: 'bot-id',
        botName: 'Ruby',
        securitySettings: { get: () => ({ verify: verifyEnabled ? { enabled: true } : null }) },
        getSecurityAlertChannel: () => alertChannel,
        getPrefix: () => '.',
        listBackups: () => backups,
        automodCsamRule: 'csam-rule',
        createEmbed,
    };
    return { calls, dependencies, guild };
}

test('reports a perfect score when all security checks pass', async () => {
    const admin = {
        id: 'admin',
        user: { bot: false, username: 'Admin' },
        permissions: { has: (permission) => permission === 'Administrator' },
    };
    const { calls, dependencies, guild } = setup({ members: [admin] });
    const embed = await runSecurityAudit(guild, dependencies);

    assert.equal(embed.title, '🛡️ Security audit - 100/100 🟢 Excellent');
    assert.match(embed.description, /^14 of 14 checks passed\./);
    assert.match(embed.description, /Security alert channel is set/);
    assert.match(embed.description, /AutoMod blocker is set up/);
    assert.equal(calls.filter(([name]) => name === 'membersFetch').length, 1);
});

test('reports failed permission, admin-bot, role, webhook, and configuration checks', async () => {
    const adminBot = {
        id: 'unsafe-bot',
        user: { bot: true, username: 'UnsafeBot' },
        permissions: { has: (permission) => permission === 'Administrator' },
    };
    const { dependencies, guild } = setup({
        everyonePermissions: ['ManageGuild', 'BanMembers'],
        botPermissions: [],
        members: [adminBot],
        rolePosition: 20,
        highestRolePosition: 100,
        verification: 0,
        explicitFilter: 0,
        mfa: 0,
        notifications: 0,
        webhookCount: 12,
        rules: [],
        alertChannel: null,
        verifyEnabled: false,
        backups: [],
    });
    const embed = await runSecurityAudit(guild, dependencies);

    assert.match(embed.title, /Security audit - \d+\/100/);
    assert.match(embed.description, /@everyone can: ManageGuild, BanMembers/);
    assert.match(embed.description, /1 other bot\(s\) have Administrator: UnsafeBot/);
    assert.match(embed.description, /Ruby's role isn't near the top/);
    assert.match(embed.description, /12 webhooks exist/);
    assert.match(embed.description, /No security alert channel/);
    assert.match(embed.description, /AutoMod blocker is not set up/);
    assert.match(embed.description, /Verification gate is off/);
    assert.match(embed.description, /No server backups yet/);
    assert.equal(embed.color, 0xed4245);
});

test('preserves report generation when optional Discord fetches fail', async () => {
    const { dependencies, guild } = setup({ webhooksError: true, rulesError: true });
    const embed = await runSecurityAudit(guild, dependencies);
    assert.match(embed.title, /Security audit/);
    assert.match(embed.description, /AutoMod blocker is not set up/);
    assert.doesNotMatch(embed.description, /webhooks exist/);
});

test("caps the audit description at Discord's 4096-character limit", async () => {
    const manyAdminBots = Array.from({ length: 100 }, (_, index) => ({
        id: `bot-${index}`,
        user: { bot: true, username: `Bot-${index}-${'x'.repeat(80)}` },
        permissions: { has: (permission) => permission === 'Administrator' },
    }));
    const { dependencies, guild } = setup({ members: manyAdminBots });
    const embed = await runSecurityAudit(guild, dependencies);
    assert.ok(embed.description.length <= 4096);
});
