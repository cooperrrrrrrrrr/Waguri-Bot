const { THEME, themeColor } = require('../theme');

// --- XP ---
const MESSAGE_COOLDOWN_MS = 60 * 1000;
const MESSAGE_XP = { min: 15, max: 25 };
const VOICE_XP = { min: 8, max: 12 };
const MIN_MESSAGE_LENGTH = 3;

const BOOSTER_MULTIPLIER = 2;
const WEEKEND_MULTIPLIER = 1.25;

const DAILY_XP = { base: 150, perStreakDay: 25, maxStreakBonus: 250 };

// --- Level roles ---
const ROLE_LEVELS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100];
const roleName = (level) => `Level ${level}`;

// --- Look ---
const COLORS = {
    main: themeColor(THEME.color, 0x6fa8dc),
    gold: 0xffc857,
    error: themeColor(THEME.errorColor, 0xe06666),
};
const FOOTER = `${THEME.botName} Levels`;

module.exports = {
    MESSAGE_COOLDOWN_MS,
    MESSAGE_XP,
    VOICE_XP,
    MIN_MESSAGE_LENGTH,
    BOOSTER_MULTIPLIER,
    WEEKEND_MULTIPLIER,
    DAILY_XP,
    ROLE_LEVELS,
    roleName,
    COLORS,
    FOOTER,
};
