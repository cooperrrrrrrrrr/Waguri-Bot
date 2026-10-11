const fs = require('node:fs');
const path = require('node:path');

function loadCommands(commandsPath) {
    const commands = [];
    const commandFolders = fs.readdirSync(commandsPath, { withFileTypes: true });

    for (const folder of commandFolders) {
        if (!folder.isDirectory()) continue;
        const folderPath = path.join(commandsPath, folder.name);
        const commandFiles = fs.readdirSync(folderPath).filter((file) => file.endsWith('.js'));

        for (const file of commandFiles) {
            const filePath = path.join(folderPath, file);
            const command = require(filePath);

            if ('data' in command && 'execute' in command) {
                commands.push(command);
            } else if ('data' in command || 'execute' in command) {
                console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
            }
        }
    }

    return commands;
}

module.exports = { loadCommands };
