const assert = require('node:assert/strict');
const test = require('node:test');
const { createAutomatedSpamGuard } = require('../commands/moderation/automated-spam');

function setup(overrides = {}) {
    const calls = [];
    const alerts = [];
    const logs = [];
    const markedDeleted = [];
    const deletedMessages = [];
    let now = 10_000_000;
    const guild = {
        id: 'guild',
        channels: {
            cache: new Map([
                ['channel', {
                    messages: {
                        delete: async (id) => deletedMessages.push(id),
                    },
                }],
            ]),
        },
        members: { fetch: async (id) => { calls.push(['fetch-member', id]); return null; } },
    };
    const clientUser = { id: 'ruby' };
    const guard = createAutomatedSpamGuard({
        floodThresholds: { webhook: 3, bot: 4 },
        floodWindowMs: 10_000,
        pingThreshold: 2,
        pingWindowMs: 60_000,
        cooldownMs: 300_000,
        now: () => now,
        markSecurityDeleted: (id) => markedDeleted.push(id),
        removeMessage: async (targetGuild, channelId, messageId) => {
            calls.push(['remove-message', targetGuild.id, channelId, messageId]);
            return targetGuild.channels.cache.get(channelId)?.messages?.delete(messageId);
        },
        fetchWebhook: async (message) => message.fetchWebhook(),
        getClientUser: () => clientUser,
        botName: 'Ruby',
        kickBot: async (member, reason) => {
            calls.push(['kick-bot', reason]);
            return member.kick(reason);
        },
        logModAction: (entry) => logs.push(entry),
        sendSecurityAlert: async (_guild, alert) => alerts.push(alert),
        ...overrides,
    });
    const makeMessage = (overrides = {}) => {
        const message = {
            id: `message-${Math.random()}`,
            guild,
            author: { id: 'bot-author', bot: true, username: 'spam-bot', toString: () => '<@bot-author>' },
            webhookId: null,
            applicationId: null,
            channelId: 'channel',
            mentions: { everyone: false },
            member: {
                kickable: true,
                kick: async (reason) => calls.push(['kick-member', reason]),
            },
            delete: async () => calls.push(['delete-current', message.id]),
            ...overrides,
        };
        return message;
    };
    return {
        guard, calls, alerts, logs, markedDeleted, deletedMessages, guild, clientUser, makeMessage,
        setNow: (value) => { now = value; },
    };
}

test('ignores human messages, DMs, and messages authored by the bot itself', async () => {
    const context = setup();
    assert.equal(await context.guard.check(context.makeMessage({ author: { id: 'human', bot: false } })), false);
    assert.equal(await context.guard.check(context.makeMessage({ guild: null })), false);
    assert.equal(await context.guard.check(context.makeMessage({ author: context.clientUser })), false);
    assert.equal(context.guard.activity.size, 0);
});

test('treats application webhooks as bot traffic rather than regular webhooks', async () => {
    const context = setup();
    const message = context.makeMessage({ webhookId: 'application', applicationId: 'application' });
    assert.equal(await context.guard.check(message), false);
    assert.deepEqual([...context.guard.activity.keys()], ['guild:bot-author']);
});

test('kicks a bot at its flood threshold, deletes recent messages, and logs the enforcement', async () => {
    const context = setup();
    const messages = [1, 2, 3, 4].map((n) => context.makeMessage({ id: `bot-${n}` }));
    for (const message of messages.slice(0, 3)) assert.equal(await context.guard.check(message), false);
    assert.equal(await context.guard.check(messages[3]), true);
    assert.equal(context.guard.activity.has('guild:bot-author'), false);
    assert.equal(context.guard.stopped.has('guild:bot-author'), true);
    assert.deepEqual(context.calls.filter(([kind]) => kind === 'kick-bot').length, 1);
    assert.deepEqual(context.deletedMessages, messages.map(({ id }) => id));
    assert.deepEqual(context.markedDeleted, messages.map(({ id }) => id));
    assert.equal(context.logs[0].action, 'security:automated-spam');
    assert.equal(context.logs[0].target, messages[3].author);
    assert.equal(context.alerts[0].title, 'Bot spam stopped');
    assert.match(context.alerts[0].description, /The bot was \*\*kicked\*\*/);
});

test('deletes external webhook after repeated everyone pings even below its flood threshold', async () => {
    const context = setup();
    const deletedHooks = [];
    const makeWebhookMessage = (id) => context.makeMessage({
        id,
        author: { id: 'webhook-author', bot: false, username: 'Hook' },
        webhookId: 'hook-id',
        mentions: { everyone: true },
        fetchWebhook: async () => ({
            owner: { id: 'different-owner' },
            delete: async (reason) => deletedHooks.push(reason),
        }),
    });
    assert.equal(await context.guard.check(makeWebhookMessage('hook-1')), false);
    assert.equal(await context.guard.check(makeWebhookMessage('hook-2')), true);
    assert.equal(deletedHooks.length, 1);
    assert.match(deletedHooks[0], /pinged @everyone\/@here again and again/);
    assert.equal(context.logs[0].target.id, 'hook-id');
    assert.equal(context.alerts[0].title, 'Webhook spam stopped');
    assert.match(context.alerts[0].description, /The webhook \*\*Hook\*\*[\s\S]*deleted/);
});

test('does not disable Ruby-owned webhook and clears its false-positive cooldown', async () => {
    const context = setup();
    const messages = [];
    for (let n = 1; n <= 2; n++) {
        messages.push(context.makeMessage({
            id: `own-${n}`,
            author: { id: 'hook-user', username: 'Ruby webhook' },
            webhookId: 'own-hook',
            fetchWebhook: async () => ({ owner: { id: 'ruby' }, delete: async () => assert.fail('must not delete Ruby webhook') }),
        }));
    }
    assert.equal(await context.guard.check(messages[0]), false);
    assert.equal(await context.guard.check(messages[1]), false);
    assert.equal(context.guard.stopped.has('guild:own-hook'), false);
    assert.equal(context.alerts.length, 0);
});

test('deletes subsequent messages during cooldown and expires old history outside the window', async () => {
    const context = setup();
    const messages = [];
    for (let n = 1; n <= 4; n++) {
        const message = context.makeMessage({ id: `bot-${n}` });
        messages.push(message);
        await context.guard.check(message);
    }
    const stoppedMessage = context.makeMessage({ id: 'during-cooldown' });
    assert.equal(await context.guard.check(stoppedMessage), true);
    assert.deepEqual(context.calls.at(-1), ['delete-current', 'during-cooldown']);

    const otherSourceFirst = context.makeMessage({ id: 'fresh-bot-1', author: { id: 'fresh-bot', bot: true } });
    await context.guard.check(otherSourceFirst);
    context.setNow(10_061_000);
    const otherSourceNext = context.makeMessage({ id: 'fresh-bot-2', author: { id: 'fresh-bot', bot: true } });
    assert.equal(await context.guard.check(otherSourceNext), false);
    assert.equal(context.guard.activity.get('guild:fresh-bot').length, 1);
});

test('reports failed bot removal accurately while still cleaning up and alerting', async () => {
    const context = setup({
        kickBot: async () => { throw new Error('cannot kick bot'); },
    });
    let handled = false;
    for (let n = 1; n <= 4; n++) {
        handled = await context.guard.check(context.makeMessage({ id: `failed-${n}` }));
    }
    assert.equal(handled, true);
    assert.match(context.alerts[0].description, /could not stop it/);
    assert.equal(context.deletedMessages.length, 4);
});
