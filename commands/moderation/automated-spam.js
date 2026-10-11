function createAutomatedSpamGuard({
    floodThresholds,
    floodWindowMs,
    pingThreshold,
    pingWindowMs,
    cooldownMs = 5 * 60 * 1000,
    now = Date.now,
    activity = new Map(),
    stopped = new Map(),
    markSecurityDeleted,
    removeMessage,
    fetchWebhook,
    getClientUser,
    botName,
    kickBot,
    logModAction,
    sendSecurityAlert,
}) {
    async function check(message) {
        const clientUser = getClientUser();
        if (!message.guild || message.author?.id === clientUser?.id) return false;
        const clientUserId = clientUser?.id;
        const isWebhook = Boolean(message.webhookId) && message.webhookId !== message.applicationId;
        if (!isWebhook && !message.author?.bot) return false;
        const sourceId = isWebhook ? message.webhookId : message.author.id;
        const key = `${message.guild.id}:${sourceId}`;
        const timestamp = now();
        if (timestamp - (stopped.get(key) ?? 0) < cooldownMs) {
            markSecurityDeleted(message.id);
            await message.delete().catch(() => {});
            return true;
        }

        const history = (activity.get(key) ?? []).filter((item) => timestamp - item.at < pingWindowMs);
        history.push({
            at: timestamp,
            ping: message.mentions?.everyone ?? false,
            channelId: message.channelId,
            messageId: message.id,
        });
        activity.set(key, history);

        const flood = history.filter((item) => timestamp - item.at < floodWindowMs).length >= floodThresholds[isWebhook ? 'webhook' : 'bot'];
        const pings = history.filter((item) => item.ping).length >= pingThreshold;
        if (!flood && !pings) return false;

        stopped.set(key, timestamp);
        activity.delete(key);
        const why = pings ? 'pinged @everyone/@here again and again' : 'flooded messages';
        let action = '⚠️ I could not stop it - please remove it manually.';
        if (isWebhook) {
            const hook = await fetchWebhook(message).catch(() => null);
            if (hook?.owner?.id === clientUserId) {
                stopped.delete(key);
                return false;
            }
            if (hook && await hook.delete(`${botName} Security: webhook ${why}`).then(() => true).catch(() => false)) {
                action = 'The webhook was **deleted**.';
            }
        } else {
            const bot = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
            if (bot?.kickable && await kickBot(bot, `${botName} Security: bot ${why}`).then(() => true).catch(() => false)) {
                action = 'The bot was **kicked**.';
            }
        }
        for (const item of history) {
            markSecurityDeleted(item.messageId);
            removeMessage(message.guild, item.channelId, item.messageId);
        }
        logModAction({
            guildId: message.guild.id,
            moderator: clientUser,
            target: isWebhook ? { id: sourceId, tag: `webhook ${message.author?.username ?? sourceId}` } : message.author,
            action: 'security:automated-spam',
            reason: why,
        });
        await sendSecurityAlert(message.guild, {
            title: isWebhook ? 'Webhook spam stopped' : 'Bot spam stopped',
            description: `${isWebhook ? `The webhook **${message.author?.username ?? 'unknown'}**` : `The bot ${message.author}`} ${why} in <#${message.channelId}>.\n${action} Its recent messages were removed.`,
            color: 0xffa500,
        });
        return true;
    }

    return { check, activity, stopped };
}

module.exports = { createAutomatedSpamGuard };
