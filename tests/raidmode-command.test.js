const assert = require('node:assert/strict');
const test = require('node:test');
const { handleRaidmodeCommand } = require('../commands/moderation/raidmode');

function setup(overrides = {}) {
    const calls = [];
    const raidModeUntil = new Map();
    const message = {
        member: { id: 'moderator' },
        author: { id: 'moderator', toString: () => '<@moderator>' },
        guild: { id: 'guild', name: 'Test server' },
        channel: { id: 'channel' },
    };
    const dependencies = {
        isStaffMember: () => true,
        replyEmbed: (_message, text, options) => { calls.push(['reply', text, options]); return 'replied'; },
        setRaidMode: (...args) => calls.push(['set', ...args]),
        logModAction: (entry) => calls.push(['log', entry]),
        sendSecurityAlert: async (...args) => calls.push(['alert', ...args]),
        sendEmbed: (...args) => { calls.push(['send', ...args]); return 'sent'; },
        raidModeUntil,
        isRaidMode: (guildId) => (raidModeUntil.get(guildId) ?? 0) > Date.now(),
        raidQuarantineAccountDays: 7,
        raidJoins: 10,
        errorColor: 123,
        ...overrides,
    };
    return { calls, dependencies, message, raidModeUntil };
}

test('denies non-staff before changing raid-mode state', async () => {
    const { calls, dependencies, message } = setup({ isStaffMember: () => false });
    assert.equal(await handleRaidmodeCommand(message, ['on'], '.', dependencies), 'replied');
    assert.match(calls[0][1], /Only staff can change raid mode/);
    assert.equal(calls.some(([name]) => name === 'set' || name === 'log'), false);
});

test('turns raid mode on for the requested minutes and alerts staff', async () => {
    const { calls, dependencies, message } = setup();
    assert.equal(await handleRaidmodeCommand(message, ['on', '45'], '.', dependencies), 'sent');
    assert.deepEqual(calls.map(([name]) => name), ['set', 'log', 'alert', 'send']);
    assert.deepEqual(calls[0].slice(1), ['guild', 45 * 60 * 1000]);
    assert.equal(calls[1][1].action, 'raidmode:on');
    assert.equal(calls[1][1].reason, '45 minutes');
    assert.equal(calls[2][2].title, 'Raid mode turned ON');
    assert.match(calls[2][2].description, /7 days.*timed out for 1 hour/);
    assert.match(calls[3][2], /45 minutes/);
    assert.match(calls[3][2], /under 7 days/);
});

test('defaults to 30 minutes and clamps requested durations from one minute through 24 hours', async () => {
    const defaultDuration = setup();
    await handleRaidmodeCommand(defaultDuration.message, ['on', 'not-a-duration'], '.', defaultDuration.dependencies);
    assert.equal(defaultDuration.calls[0][2], 30 * 60 * 1000);

    const minimum = setup();
    await handleRaidmodeCommand(minimum.message, ['on', '-5'], '.', minimum.dependencies);
    assert.equal(minimum.calls[0][2], 60 * 1000);

    const maximum = setup();
    await handleRaidmodeCommand(maximum.message, ['on', '1500'], '.', maximum.dependencies);
    assert.equal(maximum.calls[0][2], 24 * 60 * 60 * 1000);
    assert.equal(maximum.calls[1][1].reason, '1440 minutes');
});

test('turns raid mode off without sending an alert', async () => {
    const { calls, dependencies, message } = setup();
    assert.equal(await handleRaidmodeCommand(message, ['off'], '.', dependencies), 'sent');
    assert.deepEqual(calls.map(([name]) => name), ['set', 'log', 'send']);
    assert.deepEqual(calls[0].slice(1), ['guild', 0]);
    assert.equal(calls[1][1].action, 'raidmode:off');
    assert.equal(calls[1][1].reason, 'Manual');
    assert.match(calls[2][2], /raid mode is \*\*off\*\*/i);
});

test('reports active and inactive status, including automatic activation threshold', async () => {
    const active = setup({ isRaidMode: () => true });
    active.raidModeUntil.set('guild', 1_700_000_000_000);
    await handleRaidmodeCommand(active.message, [], '.', active.dependencies);
    assert.match(active.calls[0][2], /Raid mode is \*\*on\*\* until <t:1700000000:t>/);

    const inactive = setup();
    await handleRaidmodeCommand(inactive.message, ['status'], '.', inactive.dependencies);
    assert.match(inactive.calls[0][2], /10\+ members join within a minute/);
    assert.match(inactive.calls[0][2], /`\.raidmode on \[minutes\]`/);
});
