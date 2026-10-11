const assert = require('node:assert/strict');
const test = require('node:test');
const { handleAuditWatchdog } = require('../commands/moderation/audit-watchdog');

const events = {
    BotAdd: 1,
    WebhookCreate: 2,
    RoleUpdate: 3,
    MemberRoleUpdate: 4,
    GuildUpdate: 5,
};

function setup(overrides = {}) {
    const alerts = [];
    const calls = [];
    const roleCollection = new Map();
    const member = {
        id: 'member',
        kickable: true,
        kick: async (reason) => calls.push(['kick', reason]),
        roles: { remove: async (...args) => calls.push(['remove-roles', ...args]) },
    };
    const me = { roles: { cache: new Map(), add: async (...args) => calls.push(['restore-self-role', ...args]) } };
    const guild = {
        id: 'guild',
        members: { me, fetch: async (id) => { calls.push(['fetch-member', id]); return member; } },
        roles: { cache: roleCollection },
        setVerificationLevel: async (...args) => calls.push(['verification', ...args]),
        setExplicitContentFilter: async (...args) => calls.push(['content-filter', ...args]),
    };
    const dependencies = {
        auditLogEvent: events,
        clientUserId: 'bot',
        botName: 'Ruby',
        membersFetch: (id) => guild.members.fetch(id),
        hasDangerousPermission: (bits) => (BigInt(bits ?? 0) & 1n) === 1n,
        lostDangerousPermission: (before, after) => (BigInt(before ?? 0) & 1n) === 1n && (BigInt(after ?? 0) & 1n) !== 1n,
        neutralizeNuker: async (...args) => calls.push(['neutralize', ...args]),
        sendSecurityAlert: async (_guild, alert) => alerts.push(alert),
        getPrefix: () => '.',
        ...overrides,
    };
    return { alerts, calls, roleCollection, member, me, guild, dependencies };
}

const run = (context, entry, trusted = false, executorId = 'admin') =>
    handleAuditWatchdog({ executorId, ...entry }, context.guild, trusted, executorId, context.dependencies);

test('removes unapproved bots and alerts, while trusted bot adds only alert', async () => {
    const context = setup();
    assert.equal(await run(context, { action: events.BotAdd, targetId: 'new-bot' }), false);
    assert.equal(context.calls[0][0], 'fetch-member');
    assert.match(context.alerts[0].title, /Unapproved bot removed/);

    context.alerts.length = 0;
    context.calls.length = 0;
    await run(context, { action: events.BotAdd, targetId: 'trusted-bot' }, true);
    assert.equal(context.calls.length, 0);
    assert.equal(context.alerts[0].title, 'A bot was added');
});

test('reverts dangerous role permissions for untrusted executors', async () => {
    const context = setup();
    const role = { id: 'admin-role', editable: true, setPermissions: async (...args) => context.calls.push(['set-permissions', ...args]) };
    context.roleCollection.set(role.id, role);
    const handled = await run(context, {
        action: events.RoleUpdate,
        targetId: role.id,
        changes: [{ key: 'permissions', old: 0n, new: 1n }],
    });
    assert.equal(handled, false);
    assert.deepEqual(context.calls[0], ['set-permissions', 0n, 'Ruby Security: powerful permissions added by someone who is not trusted']);
    assert.equal(context.alerts[0].title, 'Powerful permissions undone');
});

test('takes a newly assigned powerful role back from an untrusted member', async () => {
    const context = setup();
    const role = { id: 'admin-role', editable: true, permissions: { bitfield: 1n } };
    context.roleCollection.set(role.id, role);
    await run(context, {
        action: events.MemberRoleUpdate,
        targetId: 'target-member',
        changes: [{ key: '$add', new: [{ id: role.id }] }],
    });
    assert.deepEqual(context.calls[1], [
        'remove-roles',
        [role.id],
        'Ruby Security: powerful role given by someone who is not trusted',
    ]);
    assert.equal(context.alerts[0].title, 'Powerful role taken back');
});

test('restores Ruby role after removal and immediately neutralizes the executor', async () => {
    const context = setup();
    const role = { id: 'ruby-role', editable: true };
    context.roleCollection.set(role.id, role);
    context.me.roles.cache.set(role.id, role);
    const handled = await run(context, {
        action: events.MemberRoleUpdate,
        targetId: 'bot',
        changes: [{ key: '$remove', new: [{ id: role.id }] }],
    });
    assert.equal(handled, true);
    assert.deepEqual(context.calls[0], ['restore-self-role', [role.id], 'Ruby Security: someone took roles away from Ruby']);
    assert.equal(context.calls[1][0], 'neutralize');
});

test('restores lowered server safety settings and does not neutralize trusted changes', async () => {
    const context = setup();
    const handled = await run(context, {
        action: events.GuildUpdate,
        changes: [
            { key: 'verification_level', old: 3, new: 1 },
            { key: 'explicit_content_filter', old: 2, new: 0 },
        ],
    });
    assert.equal(handled, true);
    assert.deepEqual(context.calls.map(([type]) => type), ['verification', 'content-filter']);
    assert.equal(context.alerts[0].title, 'Safety settings put back');
    assert.match(context.alerts[0].description, /verification level and explicit media filter back/);

    context.calls.length = 0;
    context.alerts.length = 0;
    await run(context, {
        action: events.GuildUpdate,
        changes: [{ key: 'verification_level', old: 3, new: 1 }],
    }, true);
    assert.equal(context.calls.length, 0);
    assert.equal(context.alerts[0].title, 'Server settings changed');
});

test('neutralizes an untrusted vanity-url change immediately', async () => {
    const context = setup();
    const handled = await run(context, {
        action: events.GuildUpdate,
        changes: [{ key: 'vanity_url_code', old: 'safe', new: 'stolen' }],
    });
    assert.equal(handled, true);
    assert.equal(context.calls[0][0], 'neutralize');
    assert.match(context.calls[0][3], /vanity URL/);
    assert.equal(context.alerts.length, 0);
});
