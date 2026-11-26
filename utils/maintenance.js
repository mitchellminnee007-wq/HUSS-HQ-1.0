const { getConfig, setConfig } = require('./config');
const TARGETS = { warvote:'Next-war member voting', hub:'War hub', feedback:'Feedback reports', absence:'Absence notices', healthalerts:'Officer health alerts', onboarding:'Member onboarding', debrief:'Operation debriefs', 'squad-review':'Squad goal reviews', notifications:'Notification preferences', wararchive:'War archive',  approvals:'Officer approval queue', tasklink:'External task links', help:'Command guide', 'operation-team': 'Squad operation coordination', squad: 'Squads', warflow: 'War lifecycle', commendation: 'Regiment commendations', server: 'Entire server', stockpile: 'Stockpiles', order: 'Orders', manifest: 'Shipping manifests', tts: 'Voice TTS', ticketpanel: 'Verification / tickets', operation: 'Operations', training: 'Training', logitask: 'Logistics tasks' };
function states(guildId) { return getConfig(guildId, 'MAINTENANCE') || {}; }
function active(guildId, feature) { const all = states(guildId); return all.server || all[feature] || (feature === 'squad-review' ? all.squad : feature === 'debrief' ? all.operation : feature === 'tasklink' ? all.order || all.stockpile || all.logitask : feature === 'operation-team' ? all.squad || all.operation : feature === 'manifest' ? all.order || all.stockpile : feature === 'order' ? all.stockpile : null) || null; }
function set(guildId, target, reason, userId) {
  if (!TARGETS[target]) throw new Error('Unknown maintenance target.');
  const all = { ...states(guildId) };
  if (reason === null) delete all[target];
  else all[target] = { reason: reason.slice(0, 300), by: userId, since: Date.now() };
  setConfig(guildId, 'MAINTENANCE', all);
}
function feature(interaction) {
  if(interaction.customId?.startsWith('cx_'))return interaction.customId.split(':')[0].slice(3);
  if (interaction.commandName === 'operation-team') return 'operation-team';
  if (interaction.commandName) return ['certify', 'logitest'].includes(interaction.commandName) ? 'training' : interaction.commandName;
  const id = interaction.customId || '';
  for (const [prefix, name] of [['aq_', 'approvals'], ['nav_', 'help'], ['sq_', 'squad'], ['wf_', 'warflow'], ['cm_', 'commendation'], ['mf_', 'manifest'], ['sp_', 'stockpile'], ['ord_', 'order'], ['ticket_', 'ticketpanel'], ['op_', 'operation'], ['tr_', 'training'], ['logitask_', 'logitask']]) if (id.startsWith(prefix)) return name;
  return null;
}
function blocked(interaction) {
  if (!interaction.guildId || ['maintenance', 'botstatus', 'health'].includes(interaction.commandName) || interaction.customId?.startsWith('botstatus:')) return null;
  return active(interaction.guildId, feature(interaction));
}
function notice(state) { return { content: `🛠️ This feature is temporarily under maintenance.\n${state.reason}\nPlease try again later. Use /botstatus view for the current status.`, allowedMentions: { parse: [] } }; }
async function guard(interaction) {
  const state = blocked(interaction);
  if (!state) return false;
  if (interaction.isAutocomplete()) await interaction.respond([]);
  else await interaction.reply({ ...notice(state), ephemeral: true });
  return true;
}
module.exports = { TARGETS, states, active, set, feature, blocked, notice, guard };
