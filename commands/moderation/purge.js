async function handlePurgeCommand(message, args, prefix, {
    permission,
    hasModerationPermission,
    replyEmbed,
    sendEmbed,
    errorColor,
    now = Date.now,
    scheduleDelete = (callback, delay) => setTimeout(callback, delay),
    logError = console.error,
}) {
    if (!hasModerationPermission(message.member, permission)) {
        return replyEmbed(message, 'Only staff can purge messages.', { title: '🔒 Staff only', color: errorColor });
    }

    const userArg = args.find((arg) => /^<@!?\d{17,20}>$|^\d{17,20}$/.test(arg));
    const userId = userArg?.match(/\d{17,20}/)?.[0] ?? null;
    const numberArg = args.find((arg) => /^\d{1,3}$/.test(arg));
    const count = numberArg ? parseInt(numberArg, 10) : userId ? 100 : NaN;
    if (!Number.isInteger(count) || count < 1 || count > 100) {
        return replyEmbed(message, `Usage: \`${prefix}purge <1-100>\` · \`${prefix}purge @user [1-100]\``, { color: errorColor });
    }

    const fresh = (entry) => now() - entry.createdTimestamp < 14 * 24 * 60 * 60 * 1000;
    try {
        let targets;
        let skippedOld = 0;
        if (userId) {
            targets = [];
            let before = message.id;
            for (let page = 0; page < 5 && targets.length < count; page++) {
                const batch = await message.channel.messages.fetch({ limit: 100, before });
                if (!batch.size) break;
                for (const entry of batch.values()) {
                    if (entry.author.id !== userId) continue;
                    if (!fresh(entry)) {
                        skippedOld++;
                        continue;
                    }
                    if (targets.length < count) targets.push(entry);
                }
                before = batch.last().id;
                if (!fresh(batch.last())) break;
            }
            await message.delete().catch(() => {});
        } else {
            const fetched = await message.channel.messages.fetch({ limit: Math.min(count + 1, 100) });
            targets = [...fetched.values()].filter(fresh);
            skippedOld = fetched.size - targets.length;
        }
        const deleted = targets.length ? await message.channel.bulkDelete(targets, true) : new Map();
        const deletedCount = deleted.has(message.id) ? Math.max(deleted.size - 1, 0) : deleted.size;
        const who = userId ? ` from <@${userId}>` : '';
        const note = skippedOld > 0 ? ` (${skippedOld} skipped - older than 14 days)` : '';
        sendEmbed(message.channel, `Deleted ${deletedCount} message${deletedCount === 1 ? '' : 's'}${who}${note}.`, { title: '🧹' })
            .then((sentMessage) => scheduleDelete(() => sentMessage.delete().catch(() => {}), 5000));
    } catch (err) {
        logError(err);
        replyEmbed(message, 'Failed to delete messages.', { color: errorColor });
    }
}

module.exports = { handlePurgeCommand };
