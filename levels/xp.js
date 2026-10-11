const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const db = require('./db');
const { ROLE_LEVELS, roleName, COLORS, FOOTER } = require('./config');
const { xpNeeded, levelFromTotal, weekKey, monthKey, activeBoosts, totalMultiplier, rankForLevel } = require('./levels');
const { updateRoles } = require('./roles');
const { renderRankCard } = require('./rankcard');
const { getPrefs, uploadPath } = require('./cardprefs');

function applyXpChange(row, delta, { countWeekly = true } = {}) {
  const week = weekKey();
  if (row.week_key !== week) {
    row.week_key = week;
    row.weekly_xp = 0;
  }
  const month = monthKey();
  if (row.month_key !== month) {
    row.month_key = month;
    row.monthly_xp = 0;
  }
  row.total_xp = Math.max(0, row.total_xp + delta);
  if (delta > 0 && countWeekly) {
    row.weekly_xp += delta;
    row.monthly_xp += delta;
  }
  const { level, xp } = levelFromTotal(row.total_xp);
  row.level = level;
  row.xp = xp;
  return row;
}

async function buildRankCard(guild, user, member = null, prefs = null) {
  const row = db.getUser(guild.id, user.id);
  const { current, next } = rankForLevel(row.level);
  const look = prefs ?? getPrefs(user.id);
  return renderRankCard({
    name: member?.displayName ?? user.globalName ?? user.username,
    fallbackName: user.username,
    avatarUrl: (member ?? user).displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }),
    level: row.level,
    xp: row.xp,
    xpNeeded: xpNeeded(row.level),
    rank: row.total_xp > 0 ? db.rankOf(row.guild_id, row.total_xp) : db.countUsers(row.guild_id) + 1,
    rankTitle: current.name,
    nextRank: next,
    messages: row.messages,
    voiceMinutes: row.voice_minutes,
    streak: row.daily_streak,
    totalXp: row.total_xp,
    seed: user.id,
    bgFile: uploadPath(user.id, look.bgImage),
  }, look);
}

function announcementChannel(guild, fallbackChannel) {
  const { levelup_channel_id: channelId } = db.getSettings(guild.id);
  const configured = channelId ? guild.channels.cache.get(channelId) : null;
  return configured?.isTextBased() ? configured : fallbackChannel;
}

async function announceLevelUp(member, oldLevel, newLevel, fallbackChannel) {
  const channel = announcementChannel(member.guild, fallbackChannel);
  if (!channel?.isTextBased()) return;

  const promotionLevel = [...ROLE_LEVELS].reverse().find((l) => l > oldLevel && l <= newLevel);
  const promotion = promotionLevel ? { level: promotionLevel, name: roleName(promotionLevel) } : null;
  const { next } = rankForLevel(newLevel);

  const embed = new EmbedBuilder()
    .setColor(promotion ? COLORS.gold : COLORS.main)
    .setTitle(promotion ? 'New level role' : 'Level up')
    .setDescription(promotion
      ? `${member} is now **level ${newLevel}** and got the **${promotion.name}** role.`
      : `${member} is now **level ${newLevel}**.`)
    .setFooter({ text: FOOTER });

  if (next) {
    embed.setDescription(`${embed.data.description}\n-# Next role at level ${next.level}`);
  }

  embed.setThumbnail(member.displayAvatarURL({ extension: 'png', size: 256 }));

  const embeds = [embed];
  const files = [];
  if (promotion) {
    try {
      files.push(new AttachmentBuilder(await buildRankCard(member.guild, member.user, member), { name: 'rank.png' }));
      embeds.push(new EmbedBuilder().setColor(COLORS.gold).setImage('attachment://rank.png'));
    } catch (err) {
      console.error('[Level up] Could not draw rank card:', err);
    }
  }

  await channel.send({
    content: `${member}`,
    embeds,
    files,
    allowedMentions: { users: [member.id] },
  }).catch((err) => console.warn(`[Level up] Could not announce in #${channel.name}:`, err.message));
}

async function grantXp(member, baseAmount, { channel = null, update = null, boosted = true } = {}) {
  const row = db.getUser(member.guild.id, member.id);
  const oldLevel = row.level;
  const boosts = boosted ? activeBoosts(member, db.getSettings(member.guild.id)) : [];
  const gained = Math.round(baseAmount * totalMultiplier(boosts));

  if (update) update(row);
  applyXpChange(row, gained);
  db.saveUser(row);

  updateRoles(member, row.level).catch((err) => console.error('[Roles]', err.message));

  if (row.level > oldLevel) {
    await announceLevelUp(member, oldLevel, row.level, channel);
  }
  return { gained, boosts, oldLevel, newLevel: row.level, row };
}

function adjustXp(guildId, userId, delta) {
  const row = db.getUser(guildId, userId);
  const oldLevel = row.level;
  applyXpChange(row, delta, { countWeekly: false });
  db.saveUser(row);
  return { oldLevel, newLevel: row.level, row };
}

module.exports = { grantXp, adjustXp, applyXpChange, buildRankCard, announceLevelUp };
