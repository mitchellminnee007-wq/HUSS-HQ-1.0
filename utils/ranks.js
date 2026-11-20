const { getConfig } = require('./config');
const ranks = ['Cadet', 'Private', 'Legionaire', 'Dragoon', 'Hussar', 'Officer', 'Commander'];
function matchesRank(role, rank) {
  const name = String(role?.name || '').trim().toLowerCase();
  return name === rank.toLowerCase() || (rank === 'Hussar' && name === 'hussars');
}
function roleId(guildId,rank){return getConfig(guildId,`${rank.toUpperCase()}_ROLE_ID`) || (rank==='Commander'?getConfig(guildId,'SQUAD_COMMANDER_ROLE_ID'):null);}
function matchesConfiguredRank(role, rank, guildId) {
  const id=roleId(guildId,rank);
  return id ? role?.id===id : !getConfig(guildId,'PERMISSIONS_REQUIRE_ROLE_IDS') && matchesRank(role,rank);
}
function getRankRole(guild, rank) {
  return guild.roles.cache.find(role=>matchesConfiguredRank(role,rank,guild.id))||null;
}
function hasRank(member,rank){return Boolean(member?.roles?.cache?.some(role=>matchesConfiguredRank(role,rank,member.guild?.id)));}
function getMemberRank(member) {return ranks.slice().reverse().find(rank=>hasRank(member,rank))||null;}
function getMemberRankRoles(member){return [...member.roles.cache.values()].filter(role=>ranks.some(rank=>matchesConfiguredRank(role,rank,member.guild?.id)));}
function hasConfiguredRole(member,key,legacyName){
 const id=getConfig(member?.guild?.id,key);
 if(id)return Boolean(member?.roles?.cache?.has(id));
 return Boolean(legacyName&&!getConfig(member?.guild?.id,'PERMISSIONS_REQUIRE_ROLE_IDS')&&member?.roles?.cache?.some(r=>r.name===legacyName));
}
function isOfficer(member){return hasRank(member,'Officer')||hasRank(member,'Commander');}
function isCommander(member){return hasRank(member,'Commander');}
function isVerifiedMember(member){return hasConfiguredRole(member,'VERIFIED_MEMBER_ROLE_ID','Member');}
function canModerate(executor,target){return isOfficer(executor)&&executor.id!==target.id&&ranks.indexOf(getMemberRank(executor))>ranks.indexOf(getMemberRank(target));}
module.exports={ranks,matchesRank,matchesConfiguredRank,getRankRole,hasRank,getMemberRank,getMemberRankRoles,hasConfiguredRole,isOfficer,isCommander,isVerifiedMember,canModerate};
