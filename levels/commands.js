const path = require('node:path');
const {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, MessageFlags, PermissionFlagsBits,
} = require('discord.js');
const { createEditorLink } = require('./cardprefs');
const db = require('./db');
const { ROLE_LEVELS, roleName, COLORS, FOOTER, DAILY_XP, MESSAGE_XP, VOICE_XP, BOOSTER_MULTIPLIER, WEEKEND_MULTIPLIER } = require('./config');
const { xpNeeded, totalXpForLevel, dayKey, activeBoosts, totalMultiplier, rankForLevel } = require('./levels');
const { updateRoles, levelRolesFor } = require('./roles');
const { grantXp, adjustXp, buildRankCard } = require('./xp');
const { leaderboardCommand } = require('./leaderboard');

let hooks = {
  isAdmin: (member) => member?.permissions.has(PermissionFlagsBits.ManageGuild),
  isOwner: (member) => member?.guild?.ownerId === member?.id,
  saveLevelRoles: () => {},
};
const setup = (h) => { hooks = { ...hooks, ...h }; };

const embed = (description, title) => new EmbedBuilder()
  .setColor(COLORS.main)
  .setTitle(title ?? null)
  .setDescription(description)
  .setFooter({ text: FOOTER });

const errorEmbed = (description) => new EmbedBuilder()
  .setColor(COLORS.error)
  .setDescription(description);

const formatNumber = (n) => Number(n).toLocaleString('en-US');

async function resolveTarget(message, arg) {
  const id = arg?.match(/^<@!?(\d{17,20})>$/)?.[1] ?? arg?.match(/^(\d{17,20})$/)?.[1];
  if (!id) return null;
  const member = await message.guild.members.fetch(id).catch(() => null);
  if (member) return { member, user: member.user };
  const user = await message.client.users.fetch(id).catch(() => null);
  return user ? { member: null, user } : null;
}

// --- .rank ---
async function rank(message, args, prefix) {
  const target = args[0] ? await resolveTarget(message, args[0]) : { member: message.member, user: message.author };
  if (!target) return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}rank [@user]\``)] });
  if (target.user.bot) return message.reply({ embeds: [errorEmbed("Bots don't have levels.")] });

  await message.channel.sendTyping().catch(() => {});
  try {
    const png = await buildRankCard(message.guild, target.user, target.member);
    const components = target.user.id === message.author.id ? [customizeRow()] : [];
    return message.reply({ files: [new AttachmentBuilder(png, { name: 'rank.png' })], components, allowedMentions: { repliedUser: false } });
  } catch (err) {
    console.error('[Rank card]', err);
    const row = db.getUser(message.guild.id, target.user.id);
    return message.reply({
      embeds: [embed(
        `Level **${row.level}** · ${rankForLevel(row.level).current.name}\nXP: **${formatNumber(row.xp)} / ${formatNumber(xpNeeded(row.level))}**`,
        `${target.user.username}'s rank`,
      )],
    });
  }
}

// --- Card editor ---
const customizeRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('rankcard:edit').setLabel('Edit my card').setEmoji('🖌️').setStyle(ButtonStyle.Secondary),
);

function editorLinkReply(userId, guildId) {
  const link = createEditorLink(userId, guildId);
  return {
    embeds: [embed(`Pick colours, scenery and a pfp shape for your rank and stats cards. This private link works for ${link.minutes} minutes.`, 'Card studio')],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open card studio').setURL(link.url))],
  };
}

async function rankCard(message) {
  const sent = await message.author.send(editorLinkReply(message.author.id, message.guild.id)).catch(() => null);
  if (sent) return message.react('📬').catch(() => {});
  return message.reply({ embeds: [errorEmbed('I couldn\'t DM you the link. Turn on DMs from server members, or press **Edit my card** under your `rank` card.')] });
}

async function handleInteraction(interaction) {
  if (!interaction.isButton() || interaction.customId !== 'rankcard:edit' || !interaction.guild) return false;
  await interaction.reply({ ...editorLinkReply(interaction.user.id, interaction.guild.id), flags: MessageFlags.Ephemeral });
  return true;
}

// --- .daily ---
async function daily(message) {
  const row = db.getUser(message.guild.id, message.author.id);
  const today = dayKey();

  if (row.last_daily === today) {
    const nextReset = new Date(`${today}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000;
    return message.reply({
      embeds: [embed(`Already claimed today. Next one <t:${Math.floor(nextReset / 1000)}:R> · streak **${row.daily_streak} day${row.daily_streak === 1 ? '' : 's'}**`, 'Daily')],
    });
  }

  const yesterday = dayKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const streak = row.last_daily === yesterday ? row.daily_streak + 1 : 1;
  const base = DAILY_XP.base + Math.min(DAILY_XP.perStreakDay * (streak - 1), DAILY_XP.maxStreakBonus);

  const result = await grantXp(message.member, base, {
    channel: message.channel,
    update: (r) => {
      r.daily_streak = streak;
      r.last_daily = today;
    },
  });

  const boostText = result.boosts.length ? `\n-# Boosts: ${result.boosts.map((b) => `${b.label} ×${b.value}`).join(', ')}` : '';
  const brokeStreak = row.daily_streak > 1 && streak === 1 ? `\n-# Your ${row.daily_streak}-day streak ended.` : '';
  return message.reply({
    embeds: [embed(
      `**+${formatNumber(result.gained)} XP** · streak **${streak} day${streak === 1 ? '' : 's'}**${boostText}${brokeStreak}`,
      'Daily',
    )],
  });
}

// --- .ranks ---
async function ranks(message) {
  const row = db.getUser(message.guild.id, message.author.id);
  const { current, next } = rankForLevel(row.level);
  const linked = levelRolesFor(message.guild.id);
  const lines = ROLE_LEVELS.map((l) => {
    const icon = l === current.level && row.level >= l ? '⭐' : row.level >= l ? '✅' : '🔒';
    const role = linked[l] ? `<@&${linked[l]}>` : `**${roleName(l)}**`;
    return `${icon} Lv ${l} · ${role}`;
  });
  const progress = next
    ? `\n\n**${next.level - row.level}** level${next.level - row.level === 1 ? '' : 's'} to go until **${next.name}**.`
    : "\n\nYou've got the top level role.";
  return message.reply({ embeds: [embed(lines.join('\n') + progress, 'Level roles')], allowedMentions: { parse: [] } });
}

// --- .levelhelp ---
function levelHelp(message, args, prefix) {
  const p = prefix;
  const help = embed(
    'You get XP for chatting and for being in voice with other people. Some levels come with a role.',
    'Levels',
  )
    .addFields(
      {
        name: 'Everyone',
        value: [
          `\`${p}rank [@user]\` - Your rank card (press **Edit my card** to style it)`,
          `\`${p}lb [board] [page]\` - Leaderboards: all time, weekly, monthly, messages, voice, streak (e.g. \`${p}lb voice\`)`,
          `\`${p}daily\` - Daily XP bonus (keep your streak going)`,
          `\`${p}ranks\` - Every level role and which you've unlocked`,
          `\`${p}xpinfo\` - How XP works and today's boosts`,
        ].join('\n'),
      },
      {
        name: 'Admins',
        value: [
          `\`${p}levelroles create\` / \`auto\` / \`clear\` - Make or link the Level 5-100 roles`,
          `\`${p}setlevel @user <level>\` - Set a level`,
          `\`${p}addxp @user <amount>\` / \`${p}removexp @user <amount>\``,
          `\`${p}levelchannel #channel\` / \`off\` - Where level-ups are announced`,
          `\`${p}noxp #channel\` - Turn XP off/on in a channel`,
          `\`${p}xpevent <multiplier> <hours>\` / \`off\` - Run an XP event`,
          `\`${p}levelconfig\` - See all level settings`,
          `\`${p}resetlevel @user\` / \`${p}resetlevels\` - Reset one member or everyone`,
        ].join('\n'),
      },
    );
  return message.reply({ embeds: [help] });
}

// --- .xpinfo ---
function xpInfo(message) {
  const boosts = activeBoosts(message.member, db.getSettings(message.guild.id));
  const boostText = boosts.length
    ? `${boosts.map((b) => `${b.label} ×${b.value}`).join(', ')} (total ×${totalMultiplier(boosts).toFixed(2)})`
    : 'No boosts right now.';
  return message.reply({
    embeds: [embed(
      [
        `**Chatting:** ${MESSAGE_XP.min}-${MESSAGE_XP.max} XP, at most once a minute`,
        `**Voice:** ${VOICE_XP.min}-${VOICE_XP.max} XP a minute (not deafened, not alone, not AFK)`,
        `**Daily:** ${DAILY_XP.base} XP, plus ${DAILY_XP.perStreakDay} per streak day (up to +${DAILY_XP.maxStreakBonus})`,
        `**Boosters** get ×${BOOSTER_MULTIPLIER}, and **weekends** are ×${WEEKEND_MULTIPLIER}.`,
        '',
        `**Your boosts right now:** ${boostText}`,
      ].join('\n'),
      'How XP works',
    )],
  });
}

// --- Admin commands ---
async function adminTarget(message, args, usage) {
  const target = await resolveTarget(message, args[0]);
  if (!target?.member) {
    await message.reply({ embeds: [errorEmbed(`Usage: \`${usage}\``)] });
    return null;
  }
  if (target.user.bot) {
    await message.reply({ embeds: [errorEmbed("Bots don't have levels.")] });
    return null;
  }
  return target.member;
}

function rolesNote(result) {
  let text = `Roles added: **${result.added}**, removed: **${result.removed}**.`;
  if (result.missing.length) {
    text += `\nSome linked level roles no longer exist: ${result.missing.join(', ')}. Run \`levelroles auto\` or \`levelroles create\` again.`;
  }
  return text;
}

async function syncRolesAndReply(message, member, newLevel, summary) {
  try {
    const result = await updateRoles(member, newLevel);
    return message.reply({ embeds: [embed(`${summary}\n${rolesNote(result)}`)] });
  } catch (err) {
    console.error(err);
    return message.reply({
      embeds: [errorEmbed(`${summary}\nBut I couldn't update their roles. Check that my role is above the level roles and that I have **Manage Roles**.`)],
    });
  }
}

async function setLevel(message, args, prefix) {
  const member = await adminTarget(message, args, `${prefix}setlevel @user <level>`);
  if (!member) return;
  const newLevel = Number(args[args.length - 1]);
  if (!Number.isInteger(newLevel) || newLevel < 0 || newLevel > 1000) {
    return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}setlevel @user <level>\` (level from 0 to 1000)`)] });
  }
  const row = db.getUser(message.guild.id, member.id);
  row.level = newLevel;
  row.xp = 0;
  row.total_xp = totalXpForLevel(newLevel);
  db.saveUser(row);
  return syncRolesAndReply(message, member, newLevel, `Set **${member.displayName}** to level **${newLevel}**.`);
}

async function changeXp(message, args, sign, prefix) {
  const name = sign > 0 ? 'addxp' : 'removexp';
  const member = await adminTarget(message, args, `${prefix}${name} @user <amount>`);
  if (!member) return;
  const amount = Number(args[1]);
  if (!Number.isInteger(amount) || amount <= 0 || amount > 10_000_000) {
    return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}${name} @user <amount>\` (1 to 10,000,000)`)] });
  }
  const { oldLevel, newLevel } = adjustXp(message.guild.id, member.id, sign * amount);
  const levelText = newLevel === oldLevel ? `They're still level **${newLevel}**.` : `Level **${oldLevel}** → **${newLevel}**.`;
  return syncRolesAndReply(
    message, member, newLevel,
    `${sign > 0 ? 'Gave' : 'Took'} **${formatNumber(amount)} XP** ${sign > 0 ? 'to' : 'from'} **${member.displayName}**. ${levelText}`,
  );
}

async function resetLevel(message, args, prefix) {
  const member = await adminTarget(message, args, `${prefix}resetlevel @user`);
  if (!member) return;
  const row = db.getUser(message.guild.id, member.id);
  Object.assign(row, { level: 0, xp: 0, total_xp: 0, weekly_xp: 0, monthly_xp: 0 });
  db.saveUser(row);
  return syncRolesAndReply(message, member, 0, `Reset **${member.displayName}** to level **0**.`);
}

async function levelChannel(message, args, prefix) {
  const settings = db.getSettings(message.guild.id);
  if ((args[0] || '').toLowerCase() === 'off') {
    db.saveSettings({ ...settings, levelup_channel_id: null });
    return message.reply({ embeds: [embed('Level-ups will be announced wherever they happen.', 'Level-ups')] });
  }
  const channel = message.mentions.channels.first();
  if (!channel?.isTextBased()) {
    return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}levelchannel #channel\` or \`${prefix}levelchannel off\``)] });
  }
  db.saveSettings({ ...settings, levelup_channel_id: channel.id });
  return message.reply({ embeds: [embed(`Level-ups will be announced in ${channel}.`, 'Level-ups')] });
}

async function noXp(message, args, prefix) {
  const channel = message.mentions.channels.first();
  if (!channel) return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}noxp #channel\` (run again to turn XP back on)`)] });
  if (db.isNoXpChannel(message.guild.id, channel.id)) {
    db.removeNoXpChannel(message.guild.id, channel.id);
    return message.reply({ embeds: [embed(`XP is back **on** in ${channel}.`, 'XP channels')] });
  }
  db.addNoXpChannel(message.guild.id, channel.id);
  return message.reply({ embeds: [embed(`XP is now **off** in ${channel} (messages and voice).`, 'XP channels')] });
}

async function xpEvent(message, args, prefix) {
  const settings = db.getSettings(message.guild.id);
  if ((args[0] || '').toLowerCase() === 'off') {
    db.saveSettings({ ...settings, event_multiplier: 1, event_ends_at: 0 });
    return message.reply({ embeds: [embed('XP event ended. Back to normal XP.', 'XP event')] });
  }
  const multiplier = Number(args[0]);
  const hours = Number(args[1]);
  if (!(multiplier > 1 && multiplier <= 5) || !(hours > 0 && hours <= 168)) {
    return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}xpevent <multiplier> <hours>\`, e.g. \`${prefix}xpevent 2 24\` (×1.1-×5, up to 168 hours), or \`${prefix}xpevent off\``)] });
  }
  const endsAt = Date.now() + hours * 60 * 60 * 1000;
  db.saveSettings({ ...settings, event_multiplier: multiplier, event_ends_at: endsAt });
  return message.channel.send({
    embeds: [embed(`Everyone earns **×${multiplier} XP** until <t:${Math.floor(endsAt / 1000)}:f> (<t:${Math.floor(endsAt / 1000)}:R>).`, 'XP event').setColor(COLORS.gold)],
  });
}

async function levelConfig(message, args, prefix) {
  const settings = db.getSettings(message.guild.id);
  const noXpChannels = db.listNoXpChannels(message.guild.id);
  const eventActive = settings.event_multiplier > 1 && settings.event_ends_at > Date.now();
  const linked = levelRolesFor(message.guild.id);
  const linkedCount = ROLE_LEVELS.filter((l) => linked[l] && message.guild.roles.cache.has(linked[l])).length;
  const me = message.guild.members.me;

  return message.reply({
    embeds: [embed(null, 'Level settings').addFields(
      { name: 'Level-up channel', value: settings.levelup_channel_id ? `<#${settings.levelup_channel_id}>` : 'Where the level-up happens' },
      { name: 'No-XP channels', value: noXpChannels.map((id) => `<#${id}>`).join(', ') || 'None' },
      { name: 'XP event', value: eventActive ? `×${settings.event_multiplier} until <t:${Math.floor(settings.event_ends_at / 1000)}:f>` : 'None running' },
      { name: 'Level roles', value: linkedCount ? `✅ ${linkedCount} of ${ROLE_LEVELS.length} linked` : `None yet. Run \`${prefix}levelroles create\` to make them.` },
      { name: 'My permissions', value: ['ManageRoles', 'AttachFiles', 'EmbedLinks'].map((p) => `${me?.permissions.has(PermissionFlagsBits[p]) ? '✅' : '❌'} ${p.replace(/([a-z])([A-Z])/g, '$1 $2')}`).join('\n') },
    )],
  });
}

// --- .levelroles create | auto | clear ---
async function levelRoles(message, args, prefix) {
  const sub = (args[0] || '').toLowerCase();
  const guild = message.guild;
  if (sub === 'clear') {
    hooks.saveLevelRoles(guild.id, {});
    return message.reply({ embeds: [embed('Level roles unlinked. Nobody gets level roles until you link them again (the roles themselves were not deleted).', 'Level roles')] });
  }
  if (sub === 'auto' || sub === 'create') {
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return message.reply({ embeds: [errorEmbed('I need the **Manage Roles** permission for that.')] });
    }
    const linked = { ...levelRolesFor(guild.id) };
    let made = 0;
    let found = 0;
    for (const l of [...ROLE_LEVELS].reverse()) {
      if (linked[l] && guild.roles.cache.has(linked[l])) continue;
      const existing = guild.roles.cache.find((r) => r.name.toLowerCase() === roleName(l).toLowerCase());
      if (existing) { linked[l] = existing.id; found++; continue; }
      if (sub === 'create') {
        const role = await guild.roles.create({ name: roleName(l), permissions: [], reason: `${message.author.tag}: level roles` }).catch(() => null);
        if (role) { linked[l] = role.id; made++; }
      }
    }
    hooks.saveLevelRoles(guild.id, linked);
    const total = ROLE_LEVELS.filter((l) => linked[l]).length;
    const missing = ROLE_LEVELS.length - total;
    return message.reply({
      embeds: [embed(
        `${made ? `Made **${made}** new role${made === 1 ? '' : 's'}. ` : ''}${found ? `Linked **${found}** existing role${found === 1 ? '' : 's'}. ` : ''}**${total}/${ROLE_LEVELS.length}** level roles are set up.` +
        (missing && sub === 'auto' ? `\nThe rest don't exist yet. Make roles named \`Level 5\`, \`Level 10\`... or run \`${prefix}levelroles create\`.` : '') +
        '\n-# Members get their role the next time they earn XP. Drag my role above the level roles so I can hand them out.',
        'Level roles',
      )],
    });
  }
  const linked = levelRolesFor(guild.id);
  const total = ROLE_LEVELS.filter((l) => linked[l]).length;
  return message.reply({
    embeds: [embed(
      `**${total}/${ROLE_LEVELS.length}** level roles linked.\n\n` +
      `\`${prefix}levelroles create\` - make any missing roles (Level 5, 10 ... 100)\n` +
      `\`${prefix}levelroles auto\` - link roles you already made, named "Level 5" and so on\n` +
      `\`${prefix}levelroles clear\` - unlink them all`,
      'Level roles',
    )],
  });
}

// --- .resetlevels ---
let resetInProgress = false;

async function resetLevels(message) {
  if (resetInProgress) return message.reply({ embeds: [errorEmbed('A level reset is already running.')] });

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('reset_confirm').setLabel('Yes, reset everyone').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('reset_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  const prompt = await message.reply({
    embeds: [embed(
      'This resets **every member** to **level 0** (XP and weekly/monthly XP too) and removes their level roles.\n' +
      'No other roles are touched, and message/voice stats and daily streaks are kept. A backup of the level data is saved first.\n\n' +
      '**Are you sure?** This expires in 30 seconds.',
      'Reset all levels?',
    ).setColor(COLORS.error)],
    components: [confirmRow],
    allowedMentions: { parse: [] },
  });

  const choice = await prompt.awaitMessageComponent({
    componentType: ComponentType.Button,
    time: 30_000,
    filter: (i) => i.user.id === message.author.id,
  }).catch(() => null);

  if (!choice || choice.customId === 'reset_cancel') {
    const cancelled = embed(choice ? 'Reset cancelled, nothing was changed.' : 'No answer, so the reset was cancelled. Nothing was changed.', 'Reset all levels');
    if (choice) await choice.update({ embeds: [cancelled], components: [] }).catch(() => {});
    else await prompt.edit({ embeds: [cancelled], components: [] }).catch(() => {});
    return;
  }

  resetInProgress = true;
  try {
    await choice.update({ embeds: [embed('Saving a backup of the level data...', 'Resetting levels')], components: [] });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(path.dirname(db.FILE), `levels.backup-before-reset-${stamp}.json`);
    await db.backup(backupFile);
    const resetCount = db.resetGuildLevels(message.guild.id);

    const members = [...(await message.guild.members.fetch()).values()].filter((m) => !m.user.bot);
    const totals = { added: 0, removed: 0, failed: 0 };
    let done = 0;
    let lastUpdate = 0;

    for (const member of members) {
      try {
        const result = await updateRoles(member, 0);
        totals.added += result.added;
        totals.removed += result.removed;
      } catch {
        totals.failed++;
      }
      done++;
      if (Date.now() - lastUpdate > 4000) {
        lastUpdate = Date.now();
        await prompt.edit({ embeds: [embed(`Updating roles... **${done} / ${members.length}** members`, 'Resetting levels')] }).catch(() => {});
      }
    }

    const failedText = totals.failed
      ? `\nCouldn't update **${totals.failed}** member(s), usually because their highest role is above mine.`
      : '';
    return prompt.edit({
      embeds: [embed(
        'Every member is back to **level 0**.\n\n' +
        `• Level data reset for **${resetCount}** member(s)\n` +
        `• Roles checked for **${members.length}** member(s): **${totals.removed}** removed, **${totals.added}** added${failedText}\n` +
        `• Backup saved as \`${path.basename(backupFile)}\``,
        'Levels reset',
      )],
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    console.error('[Reset levels]', err);
    return prompt.edit({ embeds: [errorEmbed(`The reset stopped with an error: ${err.message}`)] }).catch(() => {});
  } finally {
    resetInProgress = false;
  }
}

const ADMIN_COMMANDS = {
  setlevel: setLevel,
  addxp: (m, a, p) => changeXp(m, a, 1, p),
  removexp: (m, a, p) => changeXp(m, a, -1, p),
  resetlevel: resetLevel,
  levelchannel: levelChannel,
  noxp: noXp,
  xpevent: xpEvent,
  levelconfig: levelConfig,
  levelroles: levelRoles,
  resetlevels: resetLevels,
};

const COMMANDS = {
  rank,
  level: rank,
  leaderboard: leaderboardCommand,
  lb: leaderboardCommand,
  top: leaderboardCommand,
  daily,
  ranks,
  levelhelp: levelHelp,
  xpinfo: xpInfo,
  rankcard: rankCard,
};

const OWNER_ONLY = new Set(['resetlevels']);

const COMMAND_NAMES = new Set([...Object.keys(ADMIN_COMMANDS), ...Object.keys(COMMANDS)]);

async function handleCommand(message, command, args, prefix = '.') {
  if (!message.guild) return false;
  if (OWNER_ONLY.has(command)) {
    if (!hooks.isOwner(message.member)) {
      await message.reply({ embeds: [errorEmbed('Only the server owner can reset everyone\'s levels.')] });
      return true;
    }
    await ADMIN_COMMANDS[command](message, args, prefix);
    return true;
  }
  if (Object.hasOwn(ADMIN_COMMANDS, command)) {
    if (!hooks.isAdmin(message.member)) {
      await message.reply({ embeds: [errorEmbed('Only admins can do that.')] });
      return true;
    }
    await ADMIN_COMMANDS[command](message, args, prefix);
    return true;
  }
  if (Object.hasOwn(COMMANDS, command)) {
    await COMMANDS[command](message, args, prefix);
    return true;
  }
  return false;
}

module.exports = { handleCommand, handleInteraction, setup, COMMAND_NAMES };
