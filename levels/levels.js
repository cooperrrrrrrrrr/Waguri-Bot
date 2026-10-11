const { ROLE_LEVELS, roleName, BOOSTER_MULTIPLIER, WEEKEND_MULTIPLIER } = require('./config');

const xpNeeded = (level) => 5 * level ** 2 + 50 * level + 100;

function totalXpForLevel(level) {
  let total = 0;
  for (let l = 0; l < level; l++) total += xpNeeded(l);
  return total;
}

function levelFromTotal(totalXp) {
  let level = 0;
  let remaining = Math.max(0, totalXp);
  while (remaining >= xpNeeded(level)) {
    remaining -= xpNeeded(level);
    level++;
  }
  return { level, xp: remaining };
}

const randomBetween = ({ min, max }) => min + Math.floor(Math.random() * (max - min + 1));

function weekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const dayKey = (date = new Date()) => date.toISOString().slice(0, 10);

const monthKey = (date = new Date()) => date.toISOString().slice(0, 7);

const isWeekend = (date = new Date()) => [0, 6].includes(date.getUTCDay());

function activeBoosts(member, settings, now = Date.now()) {
  const boosts = [];
  if (member?.premiumSince) boosts.push({ label: 'Server Booster', value: BOOSTER_MULTIPLIER });
  if (isWeekend(new Date(now))) boosts.push({ label: 'Weekend', value: WEEKEND_MULTIPLIER });
  if (settings?.event_multiplier > 1 && settings.event_ends_at > now) {
    boosts.push({ label: 'XP Event', value: settings.event_multiplier });
  }
  return boosts;
}

const totalMultiplier = (boosts) => boosts.reduce((product, b) => product * b.value, 1);

function rankForLevel(level) {
  const reached = ROLE_LEVELS.filter((l) => level >= l);
  const at = reached.length ? reached[reached.length - 1] : null;
  const nextLevel = ROLE_LEVELS.find((l) => l > level) ?? null;
  return {
    current: { level: at ?? 0, name: at ? roleName(at) : 'Newcomer' },
    next: nextLevel ? { level: nextLevel, name: roleName(nextLevel) } : null,
  };
}

module.exports = {
  xpNeeded,
  totalXpForLevel,
  levelFromTotal,
  randomBetween,
  weekKey,
  monthKey,
  dayKey,
  isWeekend,
  activeBoosts,
  totalMultiplier,
  rankForLevel,
};
