const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'levels.json');

let store = { users: {}, settings: {}, noxp: {} };
try {
  if (fs.existsSync(FILE)) store = { users: {}, settings: {}, noxp: {}, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
} catch (err) {
  console.error('[levels] Could not read levels.json, starting fresh:', err.message);
}

let saveTimer = null;
function writeNow() {
  saveTimer = null;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store));
    fs.renameSync(tmp, FILE);
  } catch (err) {
    console.error('[levels] Could not save levels.json:', err.message);
  }
}
function scheduleSave() {
  if (!saveTimer) saveTimer = setTimeout(writeNow, 2000);
}
process.once('exit', () => { if (saveTimer) { clearTimeout(saveTimer); writeNow(); } });

const DEFAULT_ROW = {
  xp: 0, level: 0, total_xp: 0, messages: 0, voice_minutes: 0,
  daily_streak: 0, last_daily: null, weekly_xp: 0, week_key: null, monthly_xp: 0, month_key: null,
};

const guildUsers = (guildId) => (store.users[guildId] ??= {});
const allRows = (guildId) => Object.entries(store.users[guildId] ?? {}).map(([userId, row]) => ({ ...DEFAULT_ROW, ...row, guild_id: guildId, user_id: userId }));

function getUser(guildId, userId) {
  return { ...DEFAULT_ROW, ...(store.users[guildId]?.[userId] ?? {}), guild_id: guildId, user_id: userId };
}

function saveUser(row) {
  const { guild_id: guildId, user_id: userId, ...data } = row;
  guildUsers(guildId)[userId] = data;
  scheduleSave();
}

function getSettings(guildId) {
  return { guild_id: guildId, levelup_channel_id: null, event_multiplier: 1, event_ends_at: 0, ...(store.settings[guildId] ?? {}) };
}

function saveSettings(settings) {
  const { guild_id: guildId, ...data } = settings;
  store.settings[guildId] = data;
  scheduleSave();
}

const rankOf = (guildId, totalXp) => allRows(guildId).filter((r) => r.total_xp > totalXp).length + 1;
const countUsers = (guildId) => allRows(guildId).filter((r) => r.total_xp > 0).length;

function isNoXpChannel(guildId, channelId) {
  return (store.noxp[guildId] ?? []).includes(channelId);
}
function addNoXpChannel(guildId, channelId) {
  const list = (store.noxp[guildId] ??= []);
  if (!list.includes(channelId)) list.push(channelId);
  scheduleSave();
}
function removeNoXpChannel(guildId, channelId) {
  store.noxp[guildId] = (store.noxp[guildId] ?? []).filter((id) => id !== channelId);
  scheduleSave();
}
const listNoXpChannels = (guildId) => [...(store.noxp[guildId] ?? [])];

function resetGuildLevels(guildId) {
  const users = store.users[guildId] ?? {};
  for (const row of Object.values(users)) Object.assign(row, { xp: 0, level: 0, total_xp: 0, weekly_xp: 0, monthly_xp: 0 });
  scheduleSave();
  return Object.keys(users).length;
}

async function backup(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(store));
}

module.exports = {
  FILE,
  getUser,
  saveUser,
  getSettings,
  saveSettings,
  allRows,
  rankOf,
  countUsers,
  isNoXpChannel,
  addNoXpChannel,
  removeNoXpChannel,
  listNoXpChannels,
  resetGuildLevels,
  backup,
};
