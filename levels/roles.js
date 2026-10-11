const { ROLE_LEVELS } = require('./config');

let roleSource = () => ({});
const setRoleSource = (fn) => { roleSource = fn; };
const levelRolesFor = (guildId) => roleSource(guildId) ?? {};

async function updateRoles(member, level) {
  const result = { added: 0, removed: 0, missing: [] };
  const linked = levelRolesFor(member.guild.id);
  if (!Object.keys(linked).length) return result;

  const reached = ROLE_LEVELS.filter((l) => level >= l && linked[l]);
  const keepLevel = reached.length ? reached[reached.length - 1] : null;

  for (const l of ROLE_LEVELS) {
    const roleId = linked[l];
    if (!roleId) continue;
    const role = member.guild.roles.cache.get(roleId);
    if (!role) {
      result.missing.push(`the level ${l} role`);
      continue;
    }
    const hasIt = member.roles.cache.has(role.id);
    if (l === keepLevel && !hasIt) { await member.roles.add(role); result.added++; }
    if (l !== keepLevel && hasIt) { await member.roles.remove(role); result.removed++; }
  }
  return result;
}

module.exports = { updateRoles, setRoleSource, levelRolesFor };
