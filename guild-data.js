function guildModActions(actions, guildId) {
    return actions.filter((entry) => entry.guildId === guildId);
}

function userReminders(reminders, userId, guildId = null) {
    return reminders.filter((reminder) =>
        reminder.userId === userId && (!guildId || reminder.guildId === guildId));
}

module.exports = { guildModActions, userReminders };
