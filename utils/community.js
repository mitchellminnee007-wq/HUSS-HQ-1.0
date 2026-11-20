const {randomUUID} = require('node:crypto');
const {EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle} = require('discord.js');
const db = require('./atomic-json')('community');
const safe = {allowedMentions: {parse: []}};
const state = id => db.read().guilds[id] || {};
const text = (value, max = 1000) => {
  const result = String(value || '').trim();
  if (!result || result.length > max) throw new Error(`Enter 1–${max} characters.`);
  return result;
};
const id = () => randomUUID().slice(0, 12);
function member(i) {
  if (!require('./logistics-access').memberAccess(i.member)) throw new Error('Verified regiment member access required.');
}
function officer(i) {
  if (!require('./ranks').isOfficer(i.member)) throw new Error('Officer or Commander access required.');
}
function button(command, action, label) {
  return new ButtonBuilder().setCustomId(`cx_${command}:${action}`).setLabel(label).setStyle(ButtonStyle.Secondary);
}
function rows(buttons) {
  return Array.from({length: Math.ceil(buttons.length / 5)}, (_, n) => new ActionRowBuilder().addComponents(...buttons.slice(n * 5, n * 5 + 5)));
}
function page(title, lines, command, action = 'list', number = 1, extra = []) {
  const groups=[[]];let length=0;
  for(const line of lines){const value=String(line).slice(0,3500);if(groups.at(-1).length>=5||length+value.length>3800){groups.push([]);length=0;}groups.at(-1).push(value);length+=value.length+2;}
  const pages = groups.length;
  number = Math.max(1, Math.min(pages, Number(number) || 1));
  return {...safe, embeds: [new EmbedBuilder().setColor(0x8b2525).setTitle(title)
    .setDescription(groups[number-1].join('\n\n') || 'Nothing to show yet.')
    .setFooter({text: `Page ${number}/${pages} • Your current permissions apply`})],
  components: rows([...extra, button(command, `${action}:${number - 1}`, 'Previous').setDisabled(number <= 1), button(command, `${action}:${number}:refresh`, 'Refresh'), button(command, `${action}:${number + 1}`, 'Next').setDisabled(number >= pages)])};
}
async function run(i, fn, feature) {
  await i.deferReply({ephemeral: true});
  try {
    if (!i.guildId) throw new Error('Use this action in the server.');
    i.member = await i.guild.members.fetch({user: i.user.id, force: true});
    const held = require('./maintenance').active(i.guildId, feature || i.commandName || i.customId.split(':')[0].slice(3));
    if (held) return i.editReply(require('./maintenance').notice(held));
    return i.editReply({...safe, ...await fn(i)});
  } catch (e) { return i.editReply({...safe, content: e.message}); }
}
function absence(guildId, now = Date.now()) {
  return Object.entries(state(guildId).absences || {}).filter(([, v]) => !v.clearedAt && v.until > now);
}
function absenceReview(guildId, respondents = new Set(), now = Date.now()) {
  const all = absence(guildId, now), pending = all.filter(([id]) => !respondents.has(id));
  return `${all.length} current absence notices; ${pending.length} have not responded. Review /absence list before confirming. Absence does not exempt anyone from rollover.`;
}
module.exports = {...db, state, safe, text, id, member, officer, button, rows, page, run, absence, absenceReview};
