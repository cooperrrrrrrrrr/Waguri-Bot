const { Events } = require('discord.js');
const { MESSAGE_COOLDOWN_MS, MESSAGE_XP, VOICE_XP, MIN_MESSAGE_LENGTH } = require('./config');
const db = require('./db');
const { randomBetween } = require('./levels');
const { updateRoles, setRoleSource } = require('./roles');
const { grantXp } = require('./xp');
const commands = require('./commands');

const cooldowns = new Map();
const lastRewardedText = new Map();

async function voiceTick(client) {
  for (const guild of client.guilds.cache.values()) {
    const byChannel = new Map();
    for (const state of guild.voiceStates.cache.values()) {
      if (!state.channelId || state.channelId === guild.afkChannelId) continue;
      if (!state.member || state.member.user.bot) continue;
      if (!byChannel.has(state.channelId)) byChannel.set(state.channelId, []);
      byChannel.get(state.channelId).push(state);
    }
    for (const [channelId, states] of byChannel) {
      if (db.isNoXpChannel(guild.id, channelId)) continue;
      const listening = states.filter((s) => !s.selfDeaf && !s.serverDeaf);
      if (listening.length < 2) continue;
      for (const state of listening) {
        await grantXp(state.member, randomBetween(VOICE_XP), {
          channel: state.channel,
          update: (row) => { row.voice_minutes += 1; },
        }).catch((err) => console.error('[Voice XP]', err.message));
      }
    }
  }
}

function init(client, { getLevelRoles, saveLevelRoles, isAdmin, isOwner }) {
  setRoleSource(getLevelRoles);
  commands.setup({ saveLevelRoles, isAdmin, isOwner });

  const startVoice = () => setInterval(() => voiceTick(client).catch((err) => console.error('[Voice XP]', err)), 60 * 1000).unref();
  if (client.isReady()) startVoice();
  else client.once(Events.ClientReady, startVoice);

  client.on(Events.GuildMemberAdd, async (member) => {
    if (member.user.bot) return;
    const { level } = db.getUser(member.guild.id, member.id);
    if (level > 0) await updateRoles(member, level).catch((err) => console.error('[Level roles]', err.message));
  });
}

async function onMessage(message) {
  if (message.author.bot || !message.guild || !message.member) return;
  if (db.isNoXpChannel(message.guild.id, message.channelId)) return;
  if (message.channel.parentId && db.isNoXpChannel(message.guild.id, message.channel.parentId)) return;

  const key = `${message.guild.id}-${message.author.id}`;
  const now = Date.now();
  if (now - (cooldowns.get(key) || 0) < MESSAGE_COOLDOWN_MS) return;

  const text = message.content.trim().toLowerCase();
  const hasMedia = message.attachments.size > 0 || message.stickers.size > 0;
  if (!hasMedia && text.length < MIN_MESSAGE_LENGTH) return;
  if (text && lastRewardedText.get(key) === text) return;

  cooldowns.set(key, now);
  lastRewardedText.set(key, text);

  await grantXp(message.member, randomBetween(MESSAGE_XP), {
    channel: message.channel,
    update: (row) => { row.messages += 1; },
  });
}

module.exports = { init, onMessage, handleCommand: commands.handleCommand, handleInteraction: commands.handleInteraction, COMMAND_NAMES: commands.COMMAND_NAMES };
