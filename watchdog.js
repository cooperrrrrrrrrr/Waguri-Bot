const fs = require('node:fs');
const path = require('node:path');
const { THEME } = require('./theme');

const DATA_DIR = path.join(__dirname, 'data');
const HEARTBEAT_FILE = path.join(DATA_DIR, 'heartbeat.json');
const WEBHOOKS_FILE = path.join(DATA_DIR, 'watchdog.json');
const STATE_FILE = path.join(DATA_DIR, 'watchdog_state.json');
const STALE_MS = 3 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 1000;

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return fallback;
    }
}

async function alertAll(title, description, color) {
    const hooks = Object.values(readJson(WEBHOOKS_FILE, {}));
    for (const url of hooks) {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: `${THEME.botName} Watchdog`,
                embeds: [{ title, description, color, timestamp: new Date().toISOString(), footer: { text: `${THEME.botName} Security • watchdog` } }],
                allowed_mentions: { parse: [] },
            }),
        }).catch((err) => console.warn('[watchdog] could not post:', err.message));
    }
}

async function check() {
    const lastBeat = readJson(HEARTBEAT_FILE, {}).at ?? 0;
    if (!lastBeat) return;
    const offline = Date.now() - lastBeat > STALE_MS;
    const state = readJson(STATE_FILE, { down: false });

    if (offline && !state.down) {
        await alertAll(`⚠️ ${THEME.botName} is offline`,
            `${THEME.botName} hasn't checked in since <t:${Math.floor(lastBeat / 1000)}:R>. **Server protection is paused** until it's back.\nIf this lasts, check the host machine and the bot's process logs.`,
            0xed4245);
        fs.writeFileSync(STATE_FILE, JSON.stringify({ down: true, since: lastBeat }));
        console.log(`[watchdog] ${THEME.botName} is offline - alert sent`);
    } else if (!offline && state.down) {
        const minutes = Math.max(1, Math.round((Date.now() - state.since) / 60000));
        await alertAll(`✅ ${THEME.botName} is back online`, `Protection is running again after about **${minutes} minute(s)** offline.`, 0x57f287);
        fs.writeFileSync(STATE_FILE, JSON.stringify({ down: false }));
        console.log(`[watchdog] ${THEME.botName} is back - alert sent`);
    }
}

console.log(`[watchdog] watching ${THEME.botName}'s heartbeat`);
check().catch((err) => console.error('[watchdog]', err));
setInterval(() => check().catch((err) => console.error('[watchdog]', err)), CHECK_EVERY_MS);
