const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'rankcards.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'card_uploads');
const PUBLIC_HOST = (process.env.DASHBOARD_HOST || 'ruby-bot.lol').toLowerCase();

const BACKGROUNDS = {
  sky: { label: 'Waguri Sky', css: 'linear-gradient(120deg,#1f5a8f,#3a7fbf 55%,#6fa8dc)' },
  rain: { label: 'Rain', css: 'repeating-linear-gradient(100deg,rgba(255,255,255,.08) 0 2px,transparent 2px 22px),linear-gradient(180deg,#3d4f63,#6b7f94)' },
  teahouse: { label: 'Tea House', css: 'linear-gradient(160deg,#3a2414,#7a4a26 60%,#c8925a)' },
  fireflies: { label: 'Fireflies', css: 'radial-gradient(circle at 30% 40%,rgba(212,255,120,.45),transparent 12%),radial-gradient(circle at 70% 65%,rgba(212,255,120,.35),transparent 10%),linear-gradient(180deg,#07150f,#123326)' },
  starry: { label: 'Starry Night', css: 'radial-gradient(circle at 20% 30%,#fff 0 1px,transparent 2px),radial-gradient(circle at 75% 20%,#fff 0 1px,transparent 2px),linear-gradient(180deg,#0a1024,#1f2a5c)' },
  koi: { label: 'Koi Pond', css: 'radial-gradient(circle at 70% 60%,rgba(255,255,255,.12) 0 20%,transparent 21%),linear-gradient(140deg,#0d4a5a,#1b7f8a)' },
  snow: { label: 'Snowfall', css: 'radial-gradient(circle at 25% 35%,#fff 0 2px,transparent 3px),radial-gradient(circle at 65% 70%,#fff 0 2px,transparent 3px),linear-gradient(180deg,#7d94ad,#c9d6e3)' },
  lanterns: { label: 'Lanterns', css: 'radial-gradient(circle at 25% 30%,rgba(255,170,80,.6),transparent 18%),radial-gradient(circle at 75% 45%,rgba(255,120,60,.5),transparent 16%),linear-gradient(180deg,#1a0c12,#3b1622)' },
  bamboo: { label: 'Bamboo', css: 'repeating-linear-gradient(90deg,rgba(0,0,0,.18) 0 6px,transparent 6px 70px),linear-gradient(120deg,#1e4d2b,#4f8a3c)' },
  petals: { label: 'Petals', css: 'radial-gradient(ellipse at 30% 40%,#ffd6e5 0 3px,transparent 4px),radial-gradient(ellipse at 70% 60%,#ffd6e5 0 3px,transparent 4px),linear-gradient(140deg,#f3c1d3,#fbe7ef)' },
};

const OLD_BACKGROUNDS = { waguri: 'sky', clouds: 'sky', night: 'starry', waves: 'rain', ocean: 'koi', aurora: 'fireflies', dusk: 'lanterns', sunset: 'lanterns', forest: 'bamboo', sakura: 'petals', sand: 'teahouse' };

const PRESETS = {
  waguri: { label: 'Waguri Blue', accent: '#ffffff', bg: '#2f6ea8', text: '#ffffff', bgBuiltin: 'sky' },
  rainy: { label: 'Rainy Day', accent: '#a9c4dc', bg: '#3d4f63', text: '#ffffff', bgBuiltin: 'rain' },
  matcha: { label: 'Matcha', accent: '#b5d98a', bg: '#1d2b1a', text: '#f3f7ea', bgBuiltin: 'bamboo' },
  hojicha: { label: 'Hojicha', accent: '#e9b77c', bg: '#2b1a10', text: '#fbeee0', bgBuiltin: 'teahouse' },
  mochi: { label: 'Sakura Mochi', accent: '#e66b98', bg: '#f6d3e0', text: '#4a1f30', bgBuiltin: 'petals' },
  ramune: { label: 'Ramune', accent: '#7fe3f0', bg: '#0d4a5a', text: '#ffffff', bgBuiltin: 'koi' },
  lavender: { label: 'Lavender Night', accent: '#c4a7f0', bg: '#1e1633', text: '#f1ebff', bgBuiltin: 'starry' },
  yuzu: { label: 'Yuzu', accent: '#ffd23f', bg: '#2a2410', text: '#fffbe8', bgBuiltin: 'fireflies' },
  moonlight: { label: 'Moonlight', accent: '#dfe8f5', bg: '#141c2b', text: '#ffffff', bgBuiltin: 'snow' },
  hanabi: { label: 'Hanabi', accent: '#ff8a5b', bg: '#1a0c12', text: '#fff1e8', bgBuiltin: 'lanterns' },
  summer: { label: 'Summer Sky', accent: '#ffe08a', bg: '#2f6ea8', text: '#ffffff', bgBuiltin: 'sky' },
  washi: { label: 'Washi', accent: '#9a6b4f', bg: '#f1e8da', text: '#3a2a20', bgBuiltin: null },
};

const POSITIONS = ['left', 'top', 'centre', 'bottom', 'right'];

const DEFAULT = {
  accent: '#ffffff', bg: '#2f6ea8', text: '#ffffff',
  bar: 'gradient', barColor: null, glow: false, shape: 'circle',
  bgBuiltin: 'sky', bgImage: null, bgPos: 'centre', blur: 0, tint: 0,
};

const hex = (v, fallback) => (/^#[0-9a-f]{6}$/i.test(String(v ?? '')) ? String(v).toLowerCase() : fallback);
const num = (v, min, max, fallback) => (Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Math.round(Number(v)))) : fallback);

function sanitize(input = {}) {
  const p = { ...DEFAULT };
  p.accent = hex(input.accent, DEFAULT.accent);
  p.bg = hex(input.bg, DEFAULT.bg);
  p.text = hex(input.text, DEFAULT.text);
  p.bar = input.bar === 'solid' ? 'solid' : 'gradient';
  p.barColor = input.barColor ? hex(input.barColor, null) : null;
  p.glow = Boolean(input.glow);
  p.shape = input.shape === 'rounded' ? 'rounded' : 'circle';
  let image = null;
  if (/^upload:[0-9a-f]{16}$/.test(String(input.bgImage ?? ''))) image = input.bgImage;
  else {
    try {
      const url = new URL(String(input.bgImage ?? ''));
      if (url.protocol === 'https:' && url.href.length <= 600 && !url.username && !url.password) image = url.href;
    } catch {}
  }
  const builtin = OLD_BACKGROUNDS[input.bgBuiltin] ?? input.bgBuiltin;
  if (Object.hasOwn(input, 'bgBuiltin')) p.bgBuiltin = Object.hasOwn(BACKGROUNDS, builtin) ? builtin : null;
  else p.bgBuiltin = image ? null : DEFAULT.bgBuiltin;
  p.bgImage = p.bgBuiltin ? null : image;
  p.bgPos = POSITIONS.includes(input.bgPos) ? input.bgPos : 'centre';
  p.blur = num(input.blur, 0, 30, 0);
  p.tint = num(input.tint, 0, 100, 0);
  return p;
}

let store = {};
try {
  if (fs.existsSync(FILE)) store = JSON.parse(fs.readFileSync(FILE, 'utf8')) ?? {};
} catch (err) {
  console.error('[rank cards] Could not read rankcards.json:', err.message);
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(store));
    fs.renameSync(`${FILE}.tmp`, FILE);
  } catch (err) {
    console.error('[rank cards] Could not save rankcards.json:', err.message);
  }
}

const getPrefs = (userId) => sanitize(store[userId] ?? DEFAULT);
function setPrefs(userId, prefs) {
  store[userId] = sanitize(prefs);
  save();
  pruneUploads(userId, 2);
  return store[userId];
}
function resetPrefs(userId) {
  delete store[userId];
  save();
  pruneUploads(userId, 0);
}

// --- Uploaded pictures ---
const MAX_UPLOAD_SIDE = 1600;
const safeId = (id) => String(id).replace(/[^0-9]/g, '');

function uploadPath(userId, ref) {
  const match = /^upload:([0-9a-f]{16})$/.exec(String(ref ?? ''));
  if (!match) return null;
  const file = path.join(UPLOAD_DIR, `${safeId(userId)}-${match[1]}.jpg`);
  return fs.existsSync(file) ? file : null;
}

async function saveUpload(userId, buffer) {
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  let image;
  try { image = await loadImage(buffer); } catch { return null; }
  if (!image?.width || !image?.height) return null;
  const scale = Math.min(1, MAX_UPLOAD_SIDE / Math.max(image.width, image.height));
  const canvas = createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const jpeg = await canvas.encode('jpeg', 88);
  const hash = crypto.createHash('sha1').update(jpeg).digest('hex').slice(0, 16);
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, `${safeId(userId)}-${hash}.jpg`), jpeg);
  pruneUploads(userId, 3);
  return `upload:${hash}`;
}

function pruneUploads(userId, keepRecent) {
  let files;
  try { files = fs.readdirSync(UPLOAD_DIR).filter((f) => f.startsWith(`${safeId(userId)}-`)); } catch { return; }
  const inUse = store[userId]?.bgImage?.startsWith('upload:') ? `${safeId(userId)}-${store[userId].bgImage.slice(7)}.jpg` : null;
  const byAge = files
    .filter((f) => f !== inUse)
    .map((f) => ({ f, at: fs.statSync(path.join(UPLOAD_DIR, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  for (const { f } of byAge.slice(keepRecent)) fs.rmSync(path.join(UPLOAD_DIR, f), { force: true });
}

const TOKEN_TTL_MS = 30 * 60 * 1000;
const tokens = new Map();

function createEditorLink(userId, guildId) {
  const now = Date.now();
  for (const [t, v] of tokens) if (v.expires <= now || v.userId === userId) tokens.delete(t);
  const token = crypto.randomBytes(24).toString('base64url');
  tokens.set(token, { userId, guildId, expires: now + TOKEN_TTL_MS });
  return { token, url: `https://${PUBLIC_HOST}/card/${token}`, minutes: TOKEN_TTL_MS / 60000 };
}

function checkEditorToken(token) {
  const entry = tokens.get(String(token ?? ''));
  if (!entry || entry.expires <= Date.now()) return null;
  return entry;
}

module.exports = { BACKGROUNDS, PRESETS, POSITIONS, DEFAULT, sanitize, getPrefs, setPrefs, resetPrefs, createEditorLink, checkEditorToken, saveUpload, uploadPath };
