const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { readData } = require('../utils/member-data');
const { isOfficer } = require('../utils/ranks');
module.exports = {
  data: new SlashCommandBuilder().setName('warreport').setDescription('Summarize kills, event signups and logistics for a tracked war.').setDMPermission(false)
    .addStringOption(option => option.setName('war').setDescription('Which war').addChoices({ name: 'Current', value: 'current' }, { name: 'Last completed', value: 'last' }).setRequired(false)),
  async execute(interaction) {
    if (!isOfficer(interaction.member)) return interaction.reply({ content: 'Only Officers and Commanders can view war reports.', ephemeral: true });
    const data = readData('killcount').guilds?.[interaction.guildId] || {};
    const war = interaction.options.getString('war') === 'last' ? data.history?.at(-1) : data.active;
    if (!war) return interaction.reply({ content: 'No matching war recorded. Completed-war history starts with this update.', ephemeral: true });
    const end = war.endedAt || Date.now();
    const inWindow = time => time >= war.startedAt && time <= end;
    const belongs = (record,time) => record.warRef && war.apiWarId ? record.warRef.shard==='Able' && record.warRef.id===war.apiWarId : inWindow(time);
    const events = ['operations', 'trainings'].flatMap(name => Object.values(readData(name).guilds?.[interaction.guildId] || {})).filter(event => belongs(event,event.time));
    const participants = new Set(events.flatMap(event => (event.attendees?.accepted || []).map(member => member.id)));
    const tasks = Object.values(readData('logitasks').guilds || {}).flatMap(value => Object.values(value.tasks || value)).filter(task => task.requestedFromGuild === interaction.guildId && task.status === 'completed' && inWindow(task.completedAt));
    const orders = Object.values(readData('logistics-inventory').guilds?.[interaction.guildId]?.orders || {}).filter(order => ['delivered','completed_with_losses'].includes(order.status) && belongs(order,order.completedAt));
    const embed = new EmbedBuilder().setColor(0x8b2525).setTitle(`War report • ${String(war.name).slice(0, 100)}`)
      .setDescription(`<t:${Math.floor(war.startedAt / 1000)}:D> — ${war.endedAt ? `<t:${Math.floor(end / 1000)}:D>` : 'ongoing'}`)
      .addFields({ name: 'Reported kills', value: String(war.kills.reduce((sum, entry) => sum + entry.count, 0)), inline: true },
        { name: 'Contributors', value: String(new Set(war.kills.map(entry => entry.reportedBy)).size), inline: true },
        { name: 'Stored events', value: String(events.length), inline: true }, { name: 'Members signed up', value: String(participants.size), inline: true },
        { name: 'Completed logistics tasks', value: String(tasks.length), inline: true }, { name: 'Completed stockpile orders', value: String(orders.length), inline: true })
      .setFooter({ text: 'Linked war IDs preferred; older unlinked records use dates. RSVPs are not attendance.' });
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
