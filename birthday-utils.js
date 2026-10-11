function birthdayKey(guildId, userId) {
    return guildId && userId ? `${guildId}:${userId}` : null;
}

function getBirthday(birthdays, guildId, userId) {
    const key = birthdayKey(guildId, userId);
    return key ? birthdays.get(key) : undefined;
}

function setBirthday(birthdays, guildId, userId, date) {
    const key = birthdayKey(guildId, userId);
    if (key) birthdays.set(key, date);
}

function removeBirthday(birthdays, guildId, userId) {
    const key = birthdayKey(guildId, userId);
    return key ? birthdays.delete(key) : false;
}

function birthdaysForGuild(birthdays, guildId) {
    const prefix = `${guildId}:`;
    return [...birthdays.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, date]) => [key.slice(prefix.length), date]);
}

function serializeBirthdayRecords(records, legacyRecords = new Map()) {
    return Object.fromEntries([...legacyRecords, ...records]);
}

function findMigrationGuild(guilds, primaryGuildId, ownerId, hasBirthdaySetup) {
    const primaryGuild = guilds.find((guild) => guild.id === primaryGuildId);
    if (primaryGuild) return primaryGuild;

    const configuredGuilds = guilds.filter(hasBirthdaySetup);
    return configuredGuilds.find((guild) => ownerId && guild.ownerId === ownerId)
        ?? (configuredGuilds.length === 1 ? configuredGuilds[0] : null);
}

function wasAnnounced(announced, guildId, userId, date) {
    const key = birthdayKey(guildId, userId);
    return Boolean(key && announced.get(key) === date);
}

function markAnnounced(announced, guildId, userId, date) {
    const key = birthdayKey(guildId, userId);
    if (key) announced.set(key, date);
}

function clearAnnouncements(announced, guildId, userId) {
    const key = birthdayKey(guildId, userId);
    if (key) announced.delete(key);
}

function formatBirthdayDate(day, month) {
    return `${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}`;
}

module.exports = {
    birthdayKey,
    getBirthday,
    setBirthday,
    removeBirthday,
    birthdaysForGuild,
    serializeBirthdayRecords,
    findMigrationGuild,
    wasAnnounced,
    markAnnounced,
    clearAnnouncements,
    formatBirthdayDate,
};
