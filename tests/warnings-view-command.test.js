const assert = require('node:assert/strict');
const test = require('node:test');
const { handleWarningsViewCommand } = require('../commands/moderation/warnings-view');

function makeEmbedBuilder() {
    return {
        setColor(value) { this.color = value; return this; },
        setTitle(value) { this.title = value; return this; },
        setThumbnail(value) { this.thumbnail = value; return this; },
        addFields(...value) { this.fields = value; return this; },
        setDescription(value) { this.description = value; return this; },
        setFooter(value) { this.footer = value; return this; },
    };
}

function setup(overrides = {}) {
    const calls = [];
    const message = {
        member: { id: 'self', displayName: 'Self' },
        guild: { id: 'guild' },
        channel: { send: (payload) => { calls.push(['send', payload]); return 'sent'; } },
    };
    const entries = [
        { type: 'warn', targetId: 'target', active: true, at: 3000, modTag: 'Mod', reason: 'third\nline' },
        { type: 'warn', targetId: 'target', active: false, at: 1000, modTag: 'Mod', reason: 'removed' },
        { type: 'warn', targetId: 'target', active: true, at: 1000, modTag: 'Mod', reason: 'first' },
        { type: 'mute', targetId: 'target', active: true, at: 2000, modTag: 'Mod', reason: 'not a warning' },
    ];
    const dependencies = {
        permission: 'moderate-members',
        hasModerationPermission: () => true,
        resolveTargetMember: async (_message, arg) => { calls.push(['resolve', arg]); return { id: 'target', displayName: 'Target' }; },
        guildCases: () => entries,
        createEmbed: () => makeEmbedBuilder(),
        themeColor: 456,
        avatarOf: (...args) => { calls.push(['avatar', ...args]); return 'avatar-url'; },
        replyEmbed: (_message, text, options) => { calls.push(['reply', text, options]); return 'replied'; },
        errorColor: 123,
        ...overrides,
    };
    return { calls, dependencies, entries, message };
}

test('denies staff-only warning lookup before resolving another member', async () => {
    const { calls, dependencies, message } = setup({ hasModerationPermission: () => false });
    assert.equal(await handleWarningsViewCommand('warnings', message, ['target'], '.', dependencies), 'replied');
    assert.match(calls[0][1], /Only staff can view other people's warnings/);
    assert.equal(calls.some(([name]) => name === 'resolve'), false);
});

test('shows active warnings in chronological order with removed counts and staff help', async () => {
    const { calls, dependencies, message } = setup();
    assert.equal(await handleWarningsViewCommand('warnings', message, ['target'], '.', dependencies), 'sent');
    const embed = calls.find(([name]) => name === 'send')[1].embeds[0];
    assert.equal(embed.title, '⚠️ Warnings for Target');
    assert.deepEqual(embed.fields.map(({ name, value }) => [name, value]), [
        ['Active', '`2`'],
        ['Removed', '`1`'],
        ['Total', '`3`'],
    ]);
    assert.match(embed.description, /^\*\*1\.\*\* <t:1:d> · by Mod\n> first/);
    assert.match(embed.description, /\*\*2\.\*\* <t:3:d> · by Mod\n> third\n> line/);
    assert.equal(embed.footer.text, '.removewarn @user <number> · .clearwarns @user');
    assert.equal(calls[0][0], 'resolve');
});

test('my-warning aliases use the invoking member and do not require staff permissions', async () => {
    const { calls, dependencies, message } = setup({
        hasModerationPermission: () => false,
        guildCases: () => [{ type: 'warn', targetId: 'self', active: true, at: 1000, modTag: 'Mod', reason: 'own warning' }],
    });
    assert.equal(await handleWarningsViewCommand('mywarns', message, ['ignored'], '.', dependencies), 'sent');
    const embed = calls.find(([name]) => name === 'send')[1].embeds[0];
    assert.equal(embed.title, '⚠️ Your warnings');
    assert.match(embed.description, /own warning/);
    assert.equal(embed.footer, undefined);
    assert.equal(calls.some(([name]) => name === 'resolve' || name === 'reply'), false);
    assert.equal(calls.find(([name]) => name === 'avatar')[1].id, 'self');
});

test('falls back to the caller when a staff lookup has no resolvable target', async () => {
    const { calls, dependencies, message } = setup({
        resolveTargetMember: async () => null,
        guildCases: () => [],
    });
    await handleWarningsViewCommand('warnings', message, [], '.', dependencies);
    const embed = calls.find(([name]) => name === 'send')[1].embeds[0];
    assert.equal(embed.title, '⚠️ Warnings for Self');
    assert.equal(embed.description, 'No active warnings.');
});

test('limits display to 20 warnings and indicates the remaining count', async () => {
    const entries = Array.from({ length: 24 }, (_, index) => ({
        type: 'warn',
        targetId: 'target',
        active: true,
        at: index * 1000,
        modTag: 'Mod',
        reason: `warning ${index + 1}`,
    }));
    const { calls, dependencies, message } = setup({ guildCases: () => entries });
    await handleWarningsViewCommand('warnings', message, ['target'], '.', dependencies);
    const description = calls.find(([name]) => name === 'send')[1].embeds[0].description;
    assert.match(description, /\*\*20\.\*\*/);
    assert.match(description, /...and 4 more\./);
    assert.doesNotMatch(description, /warning 21/);
});
