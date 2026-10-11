function createBanFingerprintStore({ file, fs, ensureDataDir, writeFileAtomic, logger = console, now = Date.now }) {
    let fingerprints = {};

    function load() {
        try {
            if (fs.existsSync(file)) fingerprints = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (err) {
            logger.error('Failed to load ban fingerprints:', err);
        }
    }

    function save() {
        try {
            ensureDataDir();
            writeFileAtomic(file, JSON.stringify(fingerprints));
        } catch (err) {
            logger.error('Failed to save ban fingerprints:', err);
        }
    }

    function remember(guildId, user) {
        const list = (fingerprints[guildId] ?? []).filter((entry) => entry.id !== user.id);
        list.unshift({
            id: user.id,
            username: user.username,
            globalName: user.globalName ?? null,
            avatar: user.avatar ?? null,
            at: now(),
        });
        fingerprints[guildId] = list.slice(0, 300);
        save();
    }

    function forget(guildId, userId) {
        const list = fingerprints[guildId];
        if (!list?.some((entry) => entry.id === userId)) return;
        fingerprints[guildId] = list.filter((entry) => entry.id !== userId);
        save();
    }

    return {
        load,
        remember,
        forget,
        getFingerprints: () => fingerprints,
    };
}

module.exports = { createBanFingerprintStore };
