function resolveServerSetting(guildOrId, key, { serverSetup, options, env, config }) {
    const guildId = typeof guildOrId === 'string' ? guildOrId : guildOrId?.id;
    const chosen = guildId ? serverSetup[guildId]?.[key] : null;
    if (chosen) return chosen;

    const option = options.find((item) => item.key === key);
    const fallback = String((option && (env[option.env] ?? config[option.config])) ?? '').trim();
    if (!fallback || !guildOrId || typeof guildOrId === 'string') return '';

    const cache = option.type === 'role' ? guildOrId.roles?.cache : guildOrId.channels?.cache;
    return cache?.has(fallback) ? fallback : '';
}

module.exports = { resolveServerSetting };
