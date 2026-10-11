const { REST, Routes } = require('discord.js');
const { clientId, guildId, token } = require('./config.json');
const path = require('node:path');
const { loadCommands } = require('./command-loader');

const deployGlobally = process.argv.includes('--global');
if (!deployGlobally && !guildId) {
	console.error('Missing guildId in config.json. Supply a test server ID or pass --global.');
	process.exit(1);
}

const foldersPath = path.join(__dirname, 'commands');
const commands = loadCommands(foldersPath).map((command) => command.data.toJSON());

const rest = new REST().setToken(token);
const route = deployGlobally
	? Routes.applicationCommands(clientId)
	: Routes.applicationGuildCommands(clientId, guildId);

(async () => {
	try {
		const destination = deployGlobally ? 'globally' : `to guild ${guildId}`;
		console.log(`Started refreshing ${commands.length} application (/) commands ${destination}.`);

		const data = await rest.put(route, { body: commands });

		console.log(`Successfully reloaded ${data.length} application (/) commands.`);
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
	}
})();