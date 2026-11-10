const { getConfig } = require('./config');
const ranks = ['Cadet', 'Private', 'Legionaire', 'Dragoon', 'Hussar', 'Officer', 'Commander'];
function matchesRank(role, rank) {
  const name = role.name.trim().toLowerCase();
  return name === rank.toLowerCase() || (rank === 'Hussar' && name === 'hussars');
}
function getRankRole(guild, rank) {
  const id = getConfig(guild.id, `${rank.toUpperCase()}_ROLE_ID`);
  return id ? guild.roles.cache.get(id) || null : guild.roles.cache.find(role => matchesRank(role, rank)) || null;
}
function getMemberRank(member) {
  return ranks.slice().reverse().find(rank => member.roles.cache.some(role => matchesRank(role, rank))) || null;
}
function isOfficer(member) { return ['Officer', 'Commander'].includes(getMemberRank(member)); }
function canModerate(executor, target) {
  if (!isOfficer(executor) || executor.id === target.id) return false;
  return ranks.indexOf(getMemberRank(executor)) > ranks.indexOf(getMemberRank(target));
}
module.exports = { ranks, matchesRank, getRankRole, getMemberRank, isOfficer, canModerate };
