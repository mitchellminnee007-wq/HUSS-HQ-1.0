const db = require('./atomic-json')('ux-release');
const BASE_WAR = 142;
const TARGET_WAR = 144;
function eligible(war, now = Date.now()) {
  return Boolean(war?.current?.warNumber >= TARGET_WAR && war.current.warId &&
    war.current.conquestStartTime && !war.current.conquestEndTime && !war.error &&
    Number.isFinite(war.lastPoll) && now >= war.lastPoll && now - war.lastPoll <= 900000);
}
function state(guildId) { return db.read().guilds[guildId] || {}; }
function enabled(guildId) { return state(guildId).released === true; }
function release(guildId, actor, war) {
  if (!eligible(war)) throw new Error('UX release requires fresh Able tracking of an active War 144 or later. War 143 cannot unlock it.');
  return db.transact(guildId, g => Object.assign(g, {released:true, targetWar:TARGET_WAR, releasedBy:actor, releasedAt:Date.now(), warId:war.current.warId}));
}
function hold(guildId, actor) { db.transact(guildId, g => Object.assign(g, {released:false, heldBy:actor, heldAt:Date.now()})); }
module.exports = {BASE_WAR, TARGET_WAR, eligible, state, enabled, release, hold};
