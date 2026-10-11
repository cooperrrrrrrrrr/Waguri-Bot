const THEME_DEFAULTS = {
    botName: 'Sora',
    serverName: 'the server',
    color: '#6fa8dc',
    errorColor: '#e06666',
    currency: '¥',
    helpTitle: '🍵 Help',
    helpIntro: 'Hi, I\'m **Sora**. Pick a category below to see what I can do.',
    welcomeImages: [],
    showLevelBotCommands: false,
};

let themeFile = {};
try {
    themeFile = require('./theme.json');
} catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') console.error('theme.json could not be read, using the default theme:', err.message);
}

const THEME = { ...THEME_DEFAULTS, ...themeFile };

const themeColor = (value, fallback) => {
    const hex = String(value ?? '').replace(/^#/, '');
    return /^[0-9a-f]{6}$/i.test(hex) ? parseInt(hex, 16) : fallback;
};

module.exports = { THEME, themeColor };
