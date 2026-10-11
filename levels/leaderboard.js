const {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, MessageFlags,
  StringSelectMenuBuilder,
} = require('discord.js');
const { createCanvas } = require('@napi-rs/canvas');
const db = require('./db');
const { COLORS, FOOTER } = require('./config');
const { xpNeeded, weekKey, monthKey, dayKey, rankForLevel } = require('./levels');
const { drawableName, roundedRect, starPath, fitText, loadAvatar, seededRandom, formatNumber } = require('./rankcard');
const { THEME } = require('../theme');

const PAGE_SIZE = 10;
const COLLECTOR_MS = 3 * 60 * 1000;

const formatVoice = (minutes) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${formatNumber(h)}h ${m}m` : `${m}m`;
};

const BOARDS = {
  all: { label: 'All-time XP', emoji: '🏆', title: 'Top Members', value: (r) => r.total_xp, on: (r) => r.total_xp > 0, format: (v) => `${formatNumber(v)} XP`, gap: (v) => `${formatNumber(v)} XP` },
  weekly: { label: 'This week', emoji: '📅', title: 'This Week', value: (r) => r.weekly_xp, on: (r, c) => r.week_key === c.week && r.weekly_xp > 0, format: (v) => `${formatNumber(v)} XP`, gap: (v) => `${formatNumber(v)} XP`, note: 'Resets every Monday (UTC)' },
  monthly: { label: 'This month', emoji: '🌙', title: 'This Month', value: (r) => r.monthly_xp, on: (r, c) => r.month_key === c.month && r.monthly_xp > 0, format: (v) => `${formatNumber(v)} XP`, gap: (v) => `${formatNumber(v)} XP`, note: 'Resets on the 1st (UTC)' },
  messages: { label: 'Messages', emoji: '💬', title: 'Most Messages', value: (r) => r.messages, on: (r) => r.messages > 0, format: (v) => `${formatNumber(v)} msgs`, gap: (v) => `${formatNumber(v)} message${v === 1 ? '' : 's'}` },
  voice: { label: 'Voice time', emoji: '🎤', title: 'Most Voice Time', value: (r) => r.voice_minutes, on: (r) => r.voice_minutes > 0, format: formatVoice, gap: formatVoice },
  streak: { label: 'Daily streak', emoji: '🔥', title: 'Longest Streaks', value: (r) => r.daily_streak, on: (r, c) => r.daily_streak > 0 && (r.last_daily ?? '') >= c.yesterday, format: (v) => `${v} day${v === 1 ? '' : 's'}`, gap: (v) => `${v} day${v === 1 ? '' : 's'}`, note: 'Active streaks only' },
};

const BOARD_ALIASES = {
  all: 'all', alltime: 'all', xp: 'all', total: 'all',
  weekly: 'weekly', week: 'weekly', w: 'weekly',
  monthly: 'monthly', month: 'monthly', m: 'monthly',
  messages: 'messages', message: 'messages', msgs: 'messages', chat: 'messages',
  voice: 'voice', vc: 'voice',
  streak: 'streak', streaks: 'streak', daily: 'streak',
};

function boardData(guildId, key, page, userId) {
  const board = BOARDS[key];
  const ctx = { week: weekKey(), month: monthKey(), yesterday: dayKey(new Date(Date.now() - 24 * 60 * 60 * 1000)) };
  const ranked = db.allRows(guildId)
    .filter((r) => board.on(r, ctx))
    .map((r) => ({ user_id: r.user_id, level: r.level, xp: r.xp, total_xp: r.total_xp, value: board.value(r) }))
    .sort((a, b) => b.value - a.value || b.total_xp - a.total_xp);

  const total = ranked.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.max(0, Math.min(page, pages - 1));
  const rows = ranked.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  let me = null;
  const index = ranked.findIndex((r) => r.user_id === userId);
  if (index >= 0) {
    const above = index > 0 ? ranked[index - 1] : null;
    me = { position: index + 1, value: ranked[index].value, gap: above ? Math.max(0, above.value - ranked[index].value) : null };
  }
  return { rows, total, pages, page: current, me };
}

// --- Drawing ---
const WIDTH = 900;
const HEADER = 170;
const ROW_H = 84;
const ROW_GAP = 10;
const PODIUM = [
  { fill: ['#ffe08a', '#ffb700'], glow: '#ffc857' },
  { fill: ['#f4f4f8', '#b8bcc8'], glow: '#d9dce6' },
  { fill: ['#f1b27a', '#c07a3d'], glow: '#e39a5b' },
];

const avatarCache = new Map();

async function cachedAvatar(url) {
  if (!url) return null;
  const hit = avatarCache.get(url);
  if (hit && Date.now() - hit.at < 15 * 60 * 1000) return hit.image;
  const image = await loadAvatar(url);
  if (avatarCache.size > 500) avatarCache.clear();
  avatarCache.set(url, { image, at: Date.now() });
  return image;
}

function drawBackground(ctx, height) {
  roundedRect(ctx, 0, 0, WIDTH, height, 30);
  ctx.save();
  ctx.clip();
  const base = ctx.createLinearGradient(0, 0, WIDTH * 0.4, height);
  base.addColorStop(0, '#0b1a2e');
  base.addColorStop(0.55, '#123a63');
  base.addColorStop(1, '#2a6fa8');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, WIDTH, height);

  for (const [x, color] of [[180, 'rgba(111,168,220,0.18)'], [460, 'rgba(191,227,255,0.10)'], [760, 'rgba(58,168,232,0.14)']]) {
    const beam = ctx.createLinearGradient(x, 0, x, height * 0.7);
    beam.addColorStop(0, color);
    beam.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(x - 25, 0);
    ctx.lineTo(x + 25, 0);
    ctx.lineTo(x + 200, height * 0.7);
    ctx.lineTo(x - 200, height * 0.7);
    ctx.closePath();
    ctx.fill();
  }

  const random = seededRandom('leaderboard');
  for (let i = 0; i < 40; i++) {
    ctx.globalAlpha = 0.2 + random() * 0.5;
    ctx.fillStyle = random() > 0.5 ? '#e3f2ff' : '#cfe8ff';
    starPath(ctx, random() * WIDTH, random() * height, 2 + random() * 5, 1.5, 4);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  roundedRect(ctx, 2, 2, WIDTH - 4, height - 4, 29);
  const border = ctx.createLinearGradient(0, 0, WIDTH, 0);
  border.addColorStop(0, '#6fa8dc');
  border.addColorStop(0.5, '#bfe3ff');
  border.addColorStop(1, '#3aa8e8');
  ctx.strokeStyle = border;
  ctx.lineWidth = 4;
  ctx.stroke();
}

function drawHeader(ctx, board, info) {
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  ctx.font = '16px "Poppins Bold"';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(THEME.botName.toUpperCase().split('').join(' '), WIDTH / 2, 48);

  ctx.font = '46px "Poppins Bold"';
  const title = board.title.toUpperCase();
  const titleWidth = ctx.measureText(title).width;
  const gradient = ctx.createLinearGradient(WIDTH / 2 - titleWidth / 2, 0, WIDTH / 2 + titleWidth / 2, 0);
  gradient.addColorStop(0, '#bfe3ff');
  gradient.addColorStop(0.5, '#ffffff');
  gradient.addColorStop(1, '#8fc3ee');
  ctx.fillStyle = gradient;
  ctx.shadowColor = 'rgba(111,168,220,0.6)';
  ctx.shadowBlur = 18;
  ctx.fillText(title, WIDTH / 2, 104);
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#bfe3ff';
  for (const side of [-1, 1]) {
    starPath(ctx, WIDTH / 2 + side * (titleWidth / 2 + 34), 88, 16, 7, 4);
    ctx.fill();
  }

  ctx.font = '20px "Poppins Medium"';
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  const parts = [board.label, `Page ${info.page + 1} of ${info.pages}`, `${formatNumber(info.total)} member${info.total === 1 ? '' : 's'}`];
  if (board.note) parts.push(board.note);
  ctx.fillText(parts.join('   ·   '), WIDTH / 2, 142);
}

async function drawRow(ctx, entry, y, board) {
  const x = 26;
  const w = WIDTH - 52;
  const podium = entry.position <= 3 ? PODIUM[entry.position - 1] : null;

  roundedRect(ctx, x, y, w, ROW_H, 20);
  if (podium) {
    const tint = ctx.createLinearGradient(x, 0, x + w, 0);
    tint.addColorStop(0, `${podium.glow}40`);
    tint.addColorStop(1, 'rgba(20,6,32,0.55)');
    ctx.fillStyle = tint;
  } else {
    ctx.fillStyle = entry.isMe ? 'rgba(255,111,174,0.22)' : 'rgba(255,255,255,0.08)';
  }
  ctx.fill();

  ctx.save();
  if (podium) {
    ctx.shadowColor = podium.glow;
    ctx.shadowBlur = 14;
  }
  roundedRect(ctx, x, y, w, ROW_H, 20);
  ctx.lineWidth = entry.isMe || podium ? 3 : 1.5;
  ctx.strokeStyle = entry.isMe ? '#6fa8dc' : podium ? podium.glow : 'rgba(255,255,255,0.14)';
  ctx.stroke();
  ctx.restore();

  const cx = x + 44;
  const cy = y + ROW_H / 2;
  ctx.textAlign = 'center';
  if (podium) {
    const medal = ctx.createLinearGradient(cx - 24, cy - 24, cx + 24, cy + 24);
    medal.addColorStop(0, podium.fill[0]);
    medal.addColorStop(1, podium.fill[1]);
    ctx.fillStyle = medal;
    ctx.beginPath();
    ctx.arc(cx, cy, 25, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '26px "Poppins Bold"';
    ctx.fillStyle = '#3a1d0a';
    ctx.fillText(String(entry.position), cx, cy + 9);
  } else {
    ctx.font = entry.position >= 100 ? '22px "Poppins Bold"' : '28px "Poppins Bold"';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(`#${entry.position}`, cx, cy + 10);
  }

  const ax = x + 122;
  const radius = 30;
  ctx.save();
  ctx.fillStyle = podium ? podium.glow : '#6fa8dc';
  ctx.beginPath();
  ctx.arc(ax, cy, radius + 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ax, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  const avatar = await cachedAvatar(entry.avatarUrl);
  if (avatar) {
    ctx.drawImage(avatar, ax - radius, cy - radius, radius * 2, radius * 2);
  } else {
    ctx.fillStyle = '#10253f';
    ctx.fillRect(ax - radius, cy - radius, radius * 2, radius * 2);
    ctx.fillStyle = '#6fa8dc';
    starPath(ctx, ax, cy, 16, 7, 4);
    ctx.fill();
  }
  ctx.restore();

  ctx.textAlign = 'right';
  ctx.font = '28px "Poppins Bold"';
  ctx.fillStyle = podium ? podium.fill[0] : '#ffffff';
  const valueText = board.format(entry.value);
  ctx.fillText(valueText, x + w - 22, cy + 10);
  const valueWidth = ctx.measureText(valueText).width;

  const textX = ax + radius + 18;
  const maxName = x + w - 22 - valueWidth - 24 - textX;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  const name = fitText(ctx, drawableName(entry.name, entry.fallbackName), maxName, 'Poppins Bold', 27, 18);
  ctx.fillText(name, textX, cy - 4);
  if (entry.isMe) {
    const nameWidth = ctx.measureText(name).width;
    if (nameWidth + 70 < maxName) {
      roundedRect(ctx, textX + nameWidth + 10, cy - 26, 52, 24, 12);
      ctx.fillStyle = '#6fa8dc';
      ctx.fill();
      ctx.font = '14px "Poppins Bold"';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('YOU', textX + nameWidth + 21, cy - 8);
    }
  }
  ctx.font = '17px "Poppins SemiBold"';
  ctx.fillStyle = '#cfe8ff';
  ctx.fillText(fitText(ctx, `LEVEL ${entry.level}`, maxName, 'Poppins SemiBold', 17, 13), textX, cy + 22);

  const progress = Math.max(0, Math.min(1, entry.xp / xpNeeded(entry.level)));
  roundedRect(ctx, textX, y + ROW_H - 12, x + w - 22 - textX, 4, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fill();
  if (progress > 0) {
    roundedRect(ctx, textX, y + ROW_H - 12, Math.max(4, (x + w - 22 - textX) * progress), 4, 2);
    ctx.fillStyle = '#8fc3ee';
    ctx.fill();
  }
}

async function renderLeaderboard(board, info, entries) {
  const rowsHeight = entries.length ? entries.length * (ROW_H + ROW_GAP) : 130;
  const height = HEADER + rowsHeight + 26;
  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext('2d');

  drawBackground(ctx, height);
  drawHeader(ctx, board, info);

  if (!entries.length) {
    ctx.textAlign = 'center';
    ctx.font = '26px "Poppins SemiBold"';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('Nobody on this board yet. Start chatting!', WIDTH / 2, HEADER + 70);
  }

  await Promise.all(entries.map((e) => cachedAvatar(e.avatarUrl)));
  for (const [i, entry] of entries.entries()) {
    await drawRow(ctx, entry, HEADER + i * (ROW_H + ROW_GAP), board);
  }
  return canvas.encode('png');
}

// --- Discord message ---
async function resolveEntries(guild, rows, pageStart, viewerId) {
  const ids = rows.map((r) => r.user_id);
  const members = ids.length ? await guild.members.fetch({ user: ids }).catch(() => null) : null;

  return Promise.all(rows.map(async (row, i) => {
    const member = members?.get(row.user_id) ?? null;
    const user = member?.user ?? await guild.client.users.fetch(row.user_id).catch(() => null);
    return {
      userId: row.user_id,
      position: pageStart + i + 1,
      name: member?.displayName ?? user?.globalName ?? user?.username ?? 'Former member',
      fallbackName: user?.username ?? 'Former member',
      avatarUrl: (member ?? user)?.displayAvatarURL({ extension: 'png', size: 128, forceStatic: true }) ?? null,
      level: row.level,
      xp: row.xp,
      rankTitle: rankForLevel(row.level).current.name,
      value: row.value,
      isMe: row.user_id === viewerId,
    };
  }));
}

function standingText(board, data) {
  if (!data.me) return "📍 You're not on this board yet.";
  const base = `📍 You're **#${data.me.position}** · ${board.format(data.me.value)}`;
  if (data.me.position === 1) return `${base}, top of the board.`;
  return `${base}, **${board.gap(data.me.gap)}** behind #${data.me.position - 1}`;
}

function components(key, data) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('lb_board')
    .setPlaceholder('Choose a leaderboard')
    .addOptions(Object.entries(BOARDS).map(([value, b]) => ({ label: b.label, value, emoji: b.emoji, default: value === key })));
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('lb_prev').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(data.page === 0),
    new ButtonBuilder().setCustomId('lb_me').setEmoji('📍').setLabel('Me').setStyle(ButtonStyle.Primary).setDisabled(!data.me),
    new ButtonBuilder().setCustomId('lb_next').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(data.page >= data.pages - 1),
  );
  return [new ActionRowBuilder().addComponents(menu), buttons];
}

async function buildMessage(guild, key, page, viewerId) {
  const board = BOARDS[key];
  const data = boardData(guild.id, key, page, viewerId);
  const entries = await resolveEntries(guild, data.rows, data.page * PAGE_SIZE, viewerId);

  const embed = new EmbedBuilder()
    .setColor(COLORS.main)
    .setTitle(board.title)
    .setDescription(standingText(board, data))
    .setFooter({ text: `Page ${data.page + 1} of ${data.pages} • ${FOOTER}` });

  try {
    const png = await renderLeaderboard(board, data, entries);
    embed.setImage('attachment://leaderboard.png');
    return { data, payload: { embeds: [embed], files: [new AttachmentBuilder(png, { name: 'leaderboard.png' })], components: components(key, data) } };
  } catch (err) {
    console.error('[Leaderboard image]', err);
    const list = entries.map((e) => `**#${e.position}** <@${e.userId}> · Lv ${e.level} · ${board.format(e.value)}`);
    embed.setDescription(`${standingText(board, data)}\n\n${list.join('\n') || 'Nobody on this board yet!'}`);
    return { data, payload: { embeds: [embed], files: [], components: components(key, data) } };
  }
}

function parseArgs(args) {
  let key = 'all';
  let page = 0;
  for (const arg of args) {
    const lower = arg.toLowerCase();
    if (BOARD_ALIASES[lower]) key = BOARD_ALIASES[lower];
    else if (/^\d+$/.test(arg)) page = Math.max(0, Number(arg) - 1);
  }
  return { key, page };
}

async function leaderboardCommand(message, args, prefix = '.') {
  let { key, page } = parseArgs(args);
  await message.channel.sendTyping().catch(() => {});

  const first = await buildMessage(message.guild, key, page, message.author.id);
  page = first.data.page;
  const reply = await message.reply({ ...first.payload, allowedMentions: { parse: [] } });

  const collector = reply.createMessageComponentCollector({ time: COLLECTOR_MS });
  collector.on('collect', async (interaction) => {
    if (interaction.user.id !== message.author.id) {
      return interaction.reply({ content: `Run \`${prefix}lb\` to get your own leaderboard.`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    collector.resetTimer();

    if (interaction.componentType === ComponentType.StringSelect) {
      key = interaction.values[0];
      page = 0;
    } else if (interaction.customId === 'lb_prev') {
      page -= 1;
    } else if (interaction.customId === 'lb_next') {
      page += 1;
    } else if (interaction.customId === 'lb_me') {
      const { me } = boardData(message.guild.id, key, 0, message.author.id);
      if (me) page = Math.floor((me.position - 1) / PAGE_SIZE);
    }

    await interaction.deferUpdate().catch(() => {});
    const next = await buildMessage(message.guild, key, page, message.author.id);
    page = next.data.page;
    await interaction.editReply({ ...next.payload, attachments: [] }).catch((err) => console.warn('[Leaderboard]', err.message));
  });
  collector.on('end', () => reply.edit({ components: [] }).catch(() => {}));
}

module.exports = { leaderboardCommand, renderLeaderboard, boardData, BOARDS, parseArgs };
