const path = require('node:path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const FONT_DIR = path.join(__dirname, 'fonts');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Poppins-Bold.ttf'), 'Poppins Bold');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Poppins-SemiBold.ttf'), 'Poppins SemiBold');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Poppins-Medium.ttf'), 'Poppins Medium');

const WIDTH = 1000;
const HEIGHT = 330;

function drawableName(...candidates) {
  for (const candidate of candidates) {
    const cleaned = String(candidate ?? '')
      .replace(/^\[AFK\]\s*/i, '')
      .normalize('NFKC')
      .replace(/[^ -\u024f\u2018-\u201f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if ((cleaned.match(/[A-Za-z0-9À-ɏ]/g) ?? []).length >= 2) return cleaned;
  }
  return 'Member';
}

function seededRandom(seed) {
  let state = 0;
  for (const ch of String(seed)) state = (state * 31 + ch.charCodeAt(0)) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function starPath(ctx, cx, cy, outer, inner, points, rotation = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = rotation + (i * Math.PI) / points;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function fitText(ctx, text, maxWidth, family, startSize, minSize) {
  let size = startSize;
  ctx.font = `${size}px "${family}"`;
  while (ctx.measureText(text).width > maxWidth && size > minSize) {
    size -= 2;
    ctx.font = `${size}px "${family}"`;
  }
  let result = text;
  while (ctx.measureText(result).width > maxWidth && result.length > 1) result = result.slice(0, -1);
  return result === text ? text : `${result.trimEnd()}...`;
}

const formatNumber = (n) => Number(n).toLocaleString('en-US');

async function loadAvatar(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    return await loadImage(Buffer.from(await response.arrayBuffer()));
  } catch {
    return null;
  }
}

// --- Background images from a link ---
const dns = require('node:dns').promises;
const net = require('node:net');
const imageCache = new Map();

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = address.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

async function loadPublicImage(rawUrl) {
  const hit = imageCache.get(rawUrl);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.image;
  let url;
  try { url = new URL(rawUrl); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  const addresses = await dns.lookup(url.hostname, { all: true }).catch(() => []);
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (!response.ok || !/^image\//i.test(response.headers.get('content-type') ?? '')) return null;
    if (Number(response.headers.get('content-length') ?? 0) > 5 * 1024 * 1024) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 5 * 1024 * 1024) return null;
    const image = await loadImage(buffer);
    if (imageCache.size > 200) imageCache.clear();
    imageCache.set(rawUrl, { image, at: Date.now() });
    return image;
  } catch {
    return null;
  }
}

// --- Colours ---
function rgba(hexColor, alpha) {
  const n = parseInt(String(hexColor).slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
function lighten(hexColor, amount) {
  const n = parseInt(String(hexColor).slice(1), 16);
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}

// --- Built-in backgrounds ---
function gradientFill(ctx, stops, horizontal = false) {
  const g = horizontal ? ctx.createLinearGradient(0, 0, WIDTH, 0) : ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}
function softCircles(ctx, color, circles) {
  ctx.fillStyle = color;
  for (const [x, y, r] of circles) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
}
const inTextArea = (x, y, pad = 12) => x > 300 - pad && x < 955 + pad && y > 45 - pad && y < 275 + pad;
const CLOUD_SPOTS = [[60, 320, 70], [150, 338, 60], [250, 348, 55], [830, 30, 45], [890, 18, 55], [960, 45, 40], [700, 345, 50], [790, 335, 62], [890, 348, 55]];
function glowBlob(ctx, x, y, r, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}
const BUILTIN_PAINT = {
  sky: (ctx) => { gradientFill(ctx, ['#1f5a8f', '#3a7fbf', '#6fa8dc']); softCircles(ctx, 'rgba(255,255,255,0.1)', CLOUD_SPOTS); },
  rain: (ctx, seed) => {
    gradientFill(ctx, ['#334457', '#55697f', '#6b7f94']);
    const random = seededRandom(`${seed}rain`);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 70; i++) {
      const x = random() * (WIDTH + 100);
      const y = random() * HEIGHT;
      const len = 14 + random() * 22;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - len * 0.25, y + len);
      ctx.stroke();
    }
  },
  teahouse: (ctx) => {
    gradientFill(ctx, ['#2b1a10', '#5e391e', '#9a6a3c']);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 2;
    for (let y = 18; y < HEIGHT; y += 26) {
      ctx.beginPath();
      for (let x = 0; x <= WIDTH; x += 20) {
        const yy = y + Math.sin(x / 90 + y) * 3;
        if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
  },
  fireflies: (ctx, seed) => {
    gradientFill(ctx, ['#06130d', '#0f2a1f', '#173b2b']);
    const random = seededRandom(`${seed}fireflies`);
    for (let i = 0; i < 40; i++) {
      const x = random() * WIDTH;
      const y = random() * HEIGHT;
      if (inTextArea(x, y, 18)) continue;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 14 + random() * 10);
      glow.addColorStop(0, 'rgba(222,255,140,0.75)');
      glow.addColorStop(1, 'rgba(222,255,140,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - 30, y - 30, 60, 60);
    }
  },
  starry: (ctx, seed) => {
    gradientFill(ctx, ['#0a1024', '#16204a', '#26306a']);
    const random = seededRandom(`${seed}stars`);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 60; i++) {
      ctx.globalAlpha = 0.2 + random() * 0.6;
      ctx.beginPath();
      ctx.arc(random() * WIDTH, random() * HEIGHT, 0.6 + random() * 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,248,220,0.85)';
    ctx.beginPath();
    ctx.arc(920, 62, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#16204a';
    ctx.beginPath();
    ctx.arc(932, 54, 23, 0, Math.PI * 2);
    ctx.fill();
  },
  koi: (ctx) => {
    gradientFill(ctx, ['#0b3f4d', '#11606d', '#1b7f8a']);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 2;
    for (const [x, y] of [[760, 230], [430, 70]]) {
      for (const r of [24, 48, 74]) { ctx.beginPath(); ctx.ellipse(x, y, r * 1.6, r * 0.7, 0, 0, Math.PI * 2); ctx.stroke(); }
    }
    for (const [x, y, rot, color] of [[880, 270, -0.4, '#f28c38'], [600, 300, 0.3, '#f4f1ea']]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(0, 0, 26, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-24, 0); ctx.lineTo(-38, -8); ctx.lineTo(-38, 8); ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  },
  snow: (ctx, seed) => {
    gradientFill(ctx, ['#5d7590', '#8ba1b8', '#bccbdb']);
    const random = seededRandom(`${seed}snow`);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 70; i++) {
      ctx.globalAlpha = 0.35 + random() * 0.5;
      ctx.beginPath();
      ctx.arc(random() * WIDTH, random() * HEIGHT, 1 + random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },
  lanterns: (ctx) => {
    gradientFill(ctx, ['#140910', '#2b111b', '#3d1824']);
    for (const [x, y, size] of [[60, 48, 1], [965, 290, 0.9], [700, 24, 0.7], [480, 310, 0.75]]) {
      glowBlob(ctx, x, y, 120 * size, 'rgba(255,150,70,0.35)');
      ctx.fillStyle = 'rgba(255,170,90,0.85)';
      roundedRect(ctx, x - 14 * size, y - 20 * size, 28 * size, 40 * size, 12 * size);
      ctx.fill();
      ctx.fillStyle = 'rgba(60,20,20,0.6)';
      ctx.fillRect(x - 16 * size, y - 22 * size, 32 * size, 4 * size);
      ctx.fillRect(x - 16 * size, y + 18 * size, 32 * size, 4 * size);
    }
  },
  bamboo: (ctx) => {
    gradientFill(ctx, ['#173d24', '#2c6136', '#4f8a3c']);
    for (const [x, w] of [[12, 20], [58, 14], [278, 14], [968, 20]]) {
      ctx.fillStyle = 'rgba(190,230,140,0.18)';
      ctx.fillRect(x, 0, w, HEIGHT);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      for (let y = 40; y < HEIGHT; y += 80) ctx.fillRect(x - 2, y, w + 4, 4);
    }
  },
  petals: (ctx, seed) => {
    gradientFill(ctx, ['#e9a9c0', '#f3c1d3', '#fbe7ef']);
    const random = seededRandom(`${seed}petals`);
    for (let i = 0; i < 30; i++) {
      const x = random() * WIDTH;
      const y = random() * HEIGHT;
      const turn = random() * Math.PI;
      const alpha = 0.5 + random() * 0.4;
      const color = random() > 0.5 ? '#ffffff' : '#f7b3c9';
      if (inTextArea(x, y)) continue;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(turn);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(0, 0, 9, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  },
};

function drawCover(ctx, image, position, blur) {
  const scale = Math.max(WIDTH / image.width, HEIGHT / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  const x = position === 'left' ? 0 : position === 'right' ? WIDTH - w : (WIDTH - w) / 2;
  const y = position === 'top' ? 0 : position === 'bottom' ? HEIGHT - h : (HEIGHT - h) / 2;
  if (blur > 0) { try { ctx.filter = `blur(${blur}px)`; } catch {} }
  const pad = blur * 2;
  ctx.drawImage(image, x - pad, y - pad, w + pad * 2, h + pad * 2);
  ctx.filter = 'none';
}

const DEFAULT_PREFS = {
  accent: '#ffffff', bg: '#2f6ea8', text: '#ffffff', bar: 'gradient', barColor: null, glow: false, shape: 'circle',
  bgBuiltin: 'sky', bgImage: null, bgPos: 'centre', blur: 0, tint: 0,
};

async function renderRankCard(data, prefs = DEFAULT_PREFS) {
  const p = { ...DEFAULT_PREFS, ...prefs };
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const [avatar, bgImage] = await Promise.all([
    data.avatarUrl ? loadAvatar(data.avatarUrl) : null,
    p.bgImage ? (p.bgImage.startsWith('upload:') ? (data.bgFile ? loadImage(data.bgFile).catch(() => null) : null) : loadPublicImage(p.bgImage)) : null,
  ]);

  roundedRect(ctx, 0, 0, WIDTH, HEIGHT, 24);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  if (p.bgBuiltin && BUILTIN_PAINT[p.bgBuiltin]) BUILTIN_PAINT[p.bgBuiltin](ctx, data.seed);
  else if (bgImage) drawCover(ctx, bgImage, p.bgPos, p.blur);
  if (p.tint > 0 && (p.bgBuiltin || bgImage)) {
    ctx.fillStyle = rgba(p.bg, p.tint / 100);
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
  ctx.restore();

  const text = p.text;
  const muted = rgba(text, 0.78);
  const soft = rgba(text, 0.62);

  const cx = 160;
  const cy = HEIGHT / 2;
  const r = 105;
  const avatarPath = (grow = 0) => {
    if (p.shape === 'rounded') roundedRect(ctx, cx - r - grow, cy - r - grow, (r + grow) * 2, (r + grow) * 2, 34 + grow);
    else { ctx.beginPath(); ctx.arc(cx, cy, r + grow, 0, Math.PI * 2); }
  };
  if (p.glow) {
    ctx.save();
    ctx.shadowColor = p.accent;
    ctx.shadowBlur = 28;
    ctx.fillStyle = p.accent;
    avatarPath(4);
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  avatarPath();
  ctx.clip();
  if (avatar) ctx.drawImage(avatar, cx - r, cy - r, r * 2, r * 2);
  else { ctx.fillStyle = rgba(text, 0.2); ctx.fillRect(cx - r, cy - r, r * 2, r * 2); }
  ctx.restore();
  ctx.lineWidth = 5;
  ctx.strokeStyle = p.accent;
  avatarPath();
  ctx.stroke();

  const left = 310;
  const right = WIDTH - 50;
  ctx.textBaseline = 'alphabetic';

  ctx.textAlign = 'right';
  ctx.font = '50px "Poppins Bold"';
  ctx.fillStyle = text;
  const levelText = String(data.level);
  ctx.fillText(levelText, right, 92);
  const levelW = ctx.measureText(levelText).width;
  ctx.font = '18px "Poppins SemiBold"';
  ctx.fillStyle = soft;
  ctx.fillText('LEVEL', right - levelW - 10, 92);
  const levelBlock = right - levelW - 10 - ctx.measureText('LEVEL').width;
  ctx.font = '36px "Poppins Bold"';
  ctx.fillStyle = text;
  const rankText = `#${data.rank}`;
  ctx.fillText(rankText, levelBlock - 26, 92);
  const rankW = ctx.measureText(rankText).width;
  ctx.font = '18px "Poppins SemiBold"';
  ctx.fillStyle = soft;
  ctx.fillText('RANK', levelBlock - 26 - rankW - 10, 92);
  const rankBlock = levelBlock - 26 - rankW - 10 - ctx.measureText('RANK').width;

  ctx.textAlign = 'left';
  ctx.fillStyle = text;
  const name = fitText(ctx, drawableName(data.name, data.fallbackName), rankBlock - left - 24, 'Poppins Bold', 42, 22);
  ctx.fillText(name, left, 90);
  ctx.font = '20px "Poppins Medium"';
  ctx.fillStyle = muted;
  ctx.fillText(data.rankTitle === 'Newcomer' ? 'No level role yet' : `${data.rankTitle} role`, left, 124);

  const barY = 186;
  const barH = 16;
  const barW = right - left;
  const progress = Math.max(0, Math.min(1, data.xp / data.xpNeeded));
  ctx.font = '18px "Poppins Medium"';
  ctx.fillStyle = muted;
  ctx.fillText(data.nextRank ? `Next role at level ${data.nextRank.level}` : 'Top level role', left, barY - 14);
  ctx.textAlign = 'right';
  ctx.fillStyle = text;
  ctx.fillText(`${formatNumber(data.xp)} / ${formatNumber(data.xpNeeded)} XP`, right, barY - 14);
  roundedRect(ctx, left, barY, barW, barH, barH / 2);
  ctx.fillStyle = rgba(text, 0.2);
  ctx.fill();
  if (progress > 0) {
    const fillW = Math.max(barH, barW * progress);
    roundedRect(ctx, left, barY, fillW, barH, barH / 2);
    const barColor = p.barColor ?? p.accent;
    if (p.bar === 'solid') ctx.fillStyle = barColor;
    else {
      const g = ctx.createLinearGradient(left, 0, left + fillW, 0);
      g.addColorStop(0, barColor);
      g.addColorStop(1, lighten(barColor, 0.45));
      ctx.fillStyle = g;
    }
    ctx.fill();
  }

  ctx.textAlign = 'left';
  const stats = [
    `${formatNumber(data.totalXp)} XP total`,
    `${formatNumber(data.messages)} messages`,
    `${formatNumber(data.voiceMinutes)} min in voice`,
    `${data.streak} day streak`,
  ];
  let statSize = 18;
  ctx.font = `${statSize}px "Poppins Medium"`;
  while (ctx.measureText(stats.join('   ·   ')).width > barW && statSize > 12) {
    statSize -= 1;
    ctx.font = `${statSize}px "Poppins Medium"`;
  }
  ctx.fillStyle = soft;
  ctx.fillText(stats.join('   ·   '), left, 262);

  return canvas.encode('png');
}

module.exports = {
  renderRankCard,
  drawableName,
  roundedRect,
  starPath,
  fitText,
  loadAvatar,
  seededRandom,
  formatNumber,
};
