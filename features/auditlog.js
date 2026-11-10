const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { isOfficer } = require('../utils/ranks');
const audit = require('../utils/audit');
module.exports = {
  data: new SlashCommandBuilder().setName('auditlog').setDescription('Review recorded bot administration actions.').setDMPermission(false)
    .addIntegerOption(option => option.setName('page').setDescription('Page number').setMinValue(1).setRequired(false))
    .addUserOption(option => option.setName('user').setDescription('Filter by actor or affected member').setRequired(false)),
  async execute(interaction) {
    if (!isOfficer(interaction.member)) return interaction.reply({ content: 'Only Officers and Commanders can view the audit log.', ephemeral: true });
    const user = interaction.options.getUser('user');
    const records = audit.read(interaction.guildId).filter(entry => !user || entry.actorId === user.id || entry.targetId === user.id).reverse();
    const pages = Math.max(1, Math.ceil(records.length / 8));
    const page = Math.min(interaction.options.getInteger('page') || 1, pages);
    const embed = new EmbedBuilder().setTitle('HUSS audit log').setColor(0x5865F2)
      .setDescription(`Page ${page}/${pages} • ${records.length} recorded actions. Recording begins with this update.`);
    for (const entry of records.slice((page - 1) * 8, page * 8)) embed.addFields({ name: entry.action,
      value: `<t:${Math.floor(entry.at / 1000)}:f> • <@${entry.actorId}>${entry.targetId ? ` → ${entry.targetId}` : ''}\n${String(entry.reason || (entry.from && entry.to ? `${entry.from} → ${entry.to}` : '')).slice(0, 650)}` });
    return interaction.reply({ embeds: [embed], ephemeral: true, allowedMentions: { parse: [] } });
  },
};
