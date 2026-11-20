const { isOfficer, getMemberRank } = require('./ranks');
const { getConfig } = require('./config');
function manager(member) {
  const id = getConfig(member.guild.id, 'LOGISTICS_ROLE_ID');
  return isOfficer(member) || Boolean(id && member.roles.cache.has(id));
}
function memberAccess(member) {
  const id = getConfig(member.guild.id, 'VERIFIED_MEMBER_ROLE_ID');
  return manager(member) || Boolean(getMemberRank(member)) || require('./ranks').isVerifiedMember(member);
}
function canViewStockpile(member, pile) {
  return Boolean(pile && memberAccess(member) && (pile.visibility !== 'officers' || isOfficer(member)));
}
function canViewOrder(member, order, guild) {
  return [order.sourceId, order.destinationId].filter(Boolean).every(id => canViewStockpile(member, guild.stockpiles[id]));
}
module.exports = { manager, memberAccess, canViewStockpile, canViewOrder };
