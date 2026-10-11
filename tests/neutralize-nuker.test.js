const assert = require('node:assert/strict');
const test = require('node:test');
const { neutralizeNuker } = require('../commands/moderation/neutralize-nuker');

const dangerousPermissions = [1n, 2n];
const guild = { id: 'guild', members: {} };

function roleCollection(roles) {
    return {
        filter(predicate) {
            const selected = roles.filter(predicate);
            return {
                size: selected.length,
                keys: function* keys() { for (const role of selected) yield role.id; },
                map: (mapper) => selected.map(mapper),
            };
        },
    };
}

function setup(overrides = {}) {
    const order = [];
    const alerts = [];
    const logs = [];
    const dms = [];
    const errors = [];
    const lastNukeActivityAt = new Map();
    const recentlyNeutralized = new Map();
    const member = {
        id: 'attacker',
        user: { id: 'attacker', bot: false },
        bannable: true,
        kickable: true,
        kick: async () => { order.push('kick'); },
        roles: {
            cache: roleCollection([]),
            remove: async (ids) => { order.push(['remove-roles', ids]); },
        },
    };
    guild.members.fetch = async (query) => {
        order.push(['fetch', query]);
        return member;
    };
    guild.members.ban = async (id) => { order.push(['ban', id]); };
    const dependencies = {
        lastNukeActivityAt,
        markAntiNukeDirty: () => order.push('dirty'),
        recentlyNeutralized,
        undoAttack: async () => {
            order.push('undo');
            return { roles: 0, channels: 0, memberRoles: 0, failed: [] };
        },
        saveAntiNukeState: () => order.push('save'),
        securitySettings: new Map(),
        botName: 'Ruby',
        membersFetch: (query) => guild.members.fetch(query),
        dmPunishment: async (...args) => {
            order.push(['dm', args[2]]);
            dms.push(args);
            return { delete: async () => order.push('delete-dm') };
        },
        safeTimeout: async () => true,
        getPrefix: () => '.',
        dangerousPermissions,
        hasDangerousPermission: (bits, flags) => flags.some((flag) => (BigInt(bits ?? 0) & flag) === flag),
        sleep: async (ms) => order.push(['sleep', ms]),
        removeAttackerWebhooks: async () => {
            order.push('remove-webhooks');
            return 0;
        },
        logModAction: (entry) => logs.push(entry),
        clientUser: { id: 'bot' },
        sendSecurityAlert: async (_guild, alert) => alerts.push(alert),
        now: () => 1_000_000,
        logger: { error: (...args) => errors.push(args) },
        ...overrides,
    };
    return { order, alerts, logs, dms, errors, lastNukeActivityAt, recentlyNeutralized, member, dependencies };
}

test('repeat neutralization only rebuilds additional damage within the cooldown', async () => {
    const context = setup();
    context.recentlyNeutralized.set('guild:attacker', 900_000);
    await neutralizeNuker(guild, 'attacker', 'deleted channels', 3, context.dependencies);
    assert.equal(context.lastNukeActivityAt.get('guild'), 1_000_000);
    assert.deepEqual(context.order, ['dirty', 'undo']);
    assert.equal(context.logs.length, 0);
    assert.equal(context.alerts.length, 0);
});

test('configured kick sends the DM first, retracts it on failure, then still repairs damage', async () => {
    const context = setup({
        securitySettings: new Map([['guild', { punish: 'kick' }]]),
    });
    context.member.kick = async () => {
        context.order.push('kick');
        throw new Error('kick rejected');
    };
    context.dependencies.undoAttack = async () => {
        context.order.push('undo');
        return { roles: 1, channels: 2, memberRoles: 0, failed: [] };
    };
    context.dependencies.removeAttackerWebhooks = async () => {
        context.order.push('remove-webhooks');
        return 1;
    };
    await neutralizeNuker(guild, 'attacker', 'deleted channels', 3, context.dependencies);
    assert.deepEqual(context.order.slice(0, 6), [
        'dirty',
        'save',
        ['fetch', 'attacker'],
        ['dm', 'kick'],
        'kick',
        'delete-dm',
    ]);
    assert.match(context.alerts[0].description, /They have no powerful roles I can remove/);
    assert.match(context.alerts[0].description, /Rebuilt \*\*2\*\* deleted channel/);
    assert.match(context.alerts[0].description, /Deleted \*\*1\*\* webhook/);
    assert.equal(context.logs[0].action, 'security:anti-nuke');
    assert.equal(context.logs[0].reason, '3 deleted channels in a minute');
});

test('falls back to removing powerful roles, timing out, and explaining repairs', async () => {
    const context = setup();
    const role = { id: 'admin-role', name: 'Admin', editable: true, managed: false, permissions: { bitfield: 1n } };
    context.member.roles.cache = roleCollection([role]);
    const freshMember = { ...context.member, id: 'fresh-attacker' };
    guild.members.fetch = async (query) => {
        context.order.push(['fetch', query]);
        return typeof query === 'object' ? freshMember : context.member;
    };
    context.dependencies.safeTimeout = async (target, duration) => {
        context.order.push(['timeout', target, duration]);
        return true;
    };
    context.dependencies.undoAttack = async () => {
        context.order.push('undo');
        throw new Error('role restoration API failed');
    };
    context.dependencies.removeAttackerWebhooks = async () => {
        context.order.push('remove-webhooks');
        throw new Error('webhook fetch failed');
    };
    await neutralizeNuker(guild, 'attacker', 'edited roles', 1, context.dependencies);
    assert.deepEqual(context.order.slice(0, 7), [
        'dirty',
        'save',
        ['fetch', 'attacker'],
        ['remove-roles', ['admin-role']],
        ['fetch', { user: 'attacker', force: true }],
        ['timeout', freshMember, 60 * 60 * 1000],
        ['dm', 'anti-nuke'],
    ]);
    assert.match(context.alerts[0].description, /Removed their powerful roles: \*\*Admin\*\*, and timed them out/);
    assert.match(context.alerts[0].description, /unmute/);
    assert.match(context.alerts[0].description, /Couldn't rebuild: role restoration API failed/);
    assert.equal(context.errors.length, 1);
});

test('bans bots when configured and falls back to kicking if the ban fails', async () => {
    const context = setup({ securitySettings: new Map([['guild', { punish: 'ban' }]]) });
    context.member.user.bot = true;
    context.member.bannable = true;
    context.member.kickable = true;
    guild.members.ban = async () => {
        context.order.push('ban');
        throw new Error('ban failed');
    };
    context.member.kick = async () => context.order.push('kick');
    await neutralizeNuker(guild, 'attacker', 'created webhooks', 1, context.dependencies);
    assert.ok(context.order.indexOf('ban') < context.order.indexOf('kick'));
    assert.match(context.alerts[0].description, /The bot was \*\*kicked\*\*/);
    assert.equal(context.dms.length, 0);
});
