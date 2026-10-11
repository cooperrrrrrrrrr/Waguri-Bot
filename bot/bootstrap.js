const { Client, GatewayIntentBits, Partials } = require('discord.js');

function createClient() {
    return new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildVoiceStates,
            GatewayIntentBits.AutoModerationExecution,
            GatewayIntentBits.GuildModeration,
            GatewayIntentBits.GuildMessageReactions,
        ],
        partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    });
}

function startBot(client, token) {
    client.login(token).catch((err) => {
        console.error('Failed to log in to Discord:', err);
        process.exit(1);
    });
}

module.exports = { createClient, startBot };
