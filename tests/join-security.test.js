const assert = require('node:assert/strict');
const test = require('node:test');
const { runJoinSecurity } = require('../commands/moderation/join-security');

const DAY = 24 * 60 * 60 * 1000;
const NOW = 200 * DAY;

function setup(overrides = {}) {
    const alerts = [];
    const logs = [];
    const dms = [];
    const timeouts = [];
    const queued = [];
    const recentJoins = new Map();
    const recentJoinMembers = new Map();
    const lastRaidAlert = new Map();
    let raidMode = false;
    const guild = {
        id: 'guild',
        roles: { cache: { has: () => true } },
    };
    const member = {
        id: 'member',
        guild,
        nickname: null,
        kickable: true,
        kick: async () => {},
        roles: { add: async () => {} },
        user: {
            id: 'member',
            username: 'ordinary-user',
            globalName: null,
            tag: 'ordinary-user#0001',
            bot: false,
            createdTimestamp: NOW - 365 * DAY,
        },
    };
    const dependencies = {
        now: () => NOW,
        findCsamPattern: () => false,
        safeBan: async () => true,
        logModAction: (entry) => logs.push(entry),
        clientUser: { id: 'bot' },
        botName: 'Ruby',
        sendSecurityAlert: async (_guild, alert) => alerts.push(alert),
        securitySettings: new Map(),
        safeTimeout: async (target, duration, reason) => {
            timeouts.push({ target, duration, reason });
            return true;
        },
        dmPunishment: async (...args) => {
            dms.push(args);
            return { delete: async () => {} };
        },
        describeUser: () => '<@member>',
        findBanEvasion: () => null,
        getPrefix: () => '.',
        recentJoins,
        recentJoinMembers,
        raidWindowMs: 60_000,
        raidJoins: 10,
        lastRaidAlert,
        isRaidMode: () => raidMode,
        setRaidMode: () => { raidMode = true; },
        raidModeAutoMs: 30 * 60_000,
        raidQuarantineAccountDays: 30,
        queueQuarantineAlert: (_guild, target) => queued.push(target),
        impersonationReason: () => null,
        veryNewAccountMs: 3 * DAY,
        verifySettings: () => null,
        ...overrides,
    };
    return { alerts, logs, dms, timeouts, queued, recentJoins, recentJoinMembers, lastRaidAlert, guild, member, dependencies };
}

test('bans and alerts on CSAM-advertising names without exposing the name', async () => {
    const context = setup({ findCsamPattern: (name) => name.includes('flagged') });
    context.member.user.username = 'flagged-name';
    const result = await runJoinSecurity(context.member, context.dependencies);
    assert.equal(result, true);
    assert.equal(context.logs[0].action, 'security:csam-name');
    assert.equal(context.logs[0].moderator.id, 'bot');
    assert.match(context.alerts[0].fields[0].value, /name hidden/);
    assert.equal(context.alerts[0].fields[0].value.includes('flagged-name'), false);
    assert.equal(context.recentJoins.size, 0);
});

test('kicks accounts below the age gate after DM and retracts the DM if kick fails', async () => {
    const order = [];
    const context = setup();
    context.member.user.createdTimestamp = NOW - DAY;
    context.member.kick = async () => {
        order.push('kick');
        throw new Error('kick failed');
    };
    context.dependencies.securitySettings.set(context.guild.id, { minAge: { days: 7, action: 'kick' } });
    context.dependencies.dmPunishment = async () => {
        order.push('dm');
        return { delete: async () => order.push('delete-dm') };
    };
    const result = await runJoinSecurity(context.member, context.dependencies);
    assert.equal(result, false);
    assert.deepEqual(order, ['dm', 'kick', 'delete-dm']);
    assert.match(context.alerts[0].title, /NOT stopped/);
});

test('times out accounts below the age gate and records the automatic mute notice', async () => {
    const context = setup();
    context.member.user.createdTimestamp = NOW - DAY;
    context.dependencies.securitySettings.set(context.guild.id, { minAge: { days: 7, action: 'timeout' } });
    const result = await runJoinSecurity(context.member, context.dependencies);
    assert.equal(result, true);
    assert.equal(context.timeouts[0].duration, 6 * DAY);
    assert.equal(context.dms[0][2], 'mute');
    assert.equal(context.dms[0][3].until, NOW + 6 * DAY);
    assert.match(context.alerts[0].title, /timed out/);
});

test('detects raid joins, enables raid mode, and quarantines new accounts only', async () => {
    const context = setup();
    const priorNewMember = {
        id: 'prior-new',
        user: { createdTimestamp: NOW - DAY },
    };
    const priorEstablishedMember = {
        id: 'prior-established',
        user: { createdTimestamp: NOW - 90 * DAY },
    };
    context.recentJoins.set(context.guild.id, Array(9).fill(NOW - 1_000));
    context.recentJoinMembers.set(context.guild.id, [
        { member: priorNewMember, at: NOW - 1_000 },
        { member: priorEstablishedMember, at: NOW - 1_000 },
    ]);
    context.member.user.createdTimestamp = NOW - DAY;
    const result = await runJoinSecurity(context.member, context.dependencies);
    assert.equal(result, true);
    assert.equal(context.recentJoins.get(context.guild.id).length, 10);
    assert.equal(context.timeouts.some((entry) => entry.target === priorNewMember), true);
    assert.equal(context.timeouts.some((entry) => entry.target === priorEstablishedMember), false);
    assert.equal(context.timeouts.some((entry) => entry.target === context.member), true);
    assert.deepEqual(context.queued, [priorNewMember, context.member]);
    assert.equal(context.alerts[0].title, 'Raid detected - raid mode is ON');
});

test('continues normal join checks and applies configured verification role', async () => {
    const context = setup();
    let assigned = null;
    context.member.roles.add = async (...args) => { assigned = args; };
    context.dependencies.verifySettings = () => ({ roleId: 'verified-pending' });
    const result = await runJoinSecurity(context.member, context.dependencies);
    assert.equal(result, false);
    assert.deepEqual(assigned, ['verified-pending', 'Ruby Security: verification gate']);
});
