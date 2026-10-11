async function handleSecurityToolsCommand(message, args, prefix, subcommand, {
    setting,
    setupAutoModRules,
    runSecuritySelfTest,
    replyEmbed,
    sendEmbed,
    errorColor,
}) {
    if (subcommand === 'automod') {
        const results = await setupAutoModRules(message.guild);
        return {
            handled: true,
            result: sendEmbed(message.channel, results.join('\n'), { title: '🛡️ Discord AutoMod setup' }),
        };
    }

    if (subcommand === 'test') {
        const testChannelId = setting(message.guild, 'securitytest');
        if (!testChannelId) {
            return {
                handled: true,
                result: replyEmbed(message, `Pick a staff-only channel for the security self-test first: \`${prefix}setup securitytest #channel\`.`, { color: errorColor }),
            };
        }
        if (message.channelId !== testChannelId) {
            return {
                handled: true,
                result: replyEmbed(message, `The security self-test only runs in <#${testChannelId}>, since its results mention sensitive categories.`, { title: '🛡️ Security self-test', color: errorColor }),
            };
        }
        return {
            handled: true,
            result: sendEmbed(message.channel, runSecuritySelfTest().join('\n'), { title: '🛡️ Security self-test' }),
        };
    }

    return { handled: false };
}

module.exports = { handleSecurityToolsCommand };
