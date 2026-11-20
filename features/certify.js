const { SlashCommandBuilder } = require('discord.js');
const { isOfficer } = require('../utils/ranks');
const { getConfig } = require('../utils/config');
const { QUALIFICATIONS, QUALIFICATION_ROLE_IDS } = require('./training');
const audit = require('../utils/audit');
module.exports = {
  data: new SlashCommandBuilder().setName('certify').setDescription('Award or revoke a qualification after a trainer assessment.').setDMPermission(false)
    .addUserOption(option => option.setName('user').setDescription('Member assessed').setRequired(true))
    .addStringOption(option => option.setName('qualification').setDescription('Qualification').setRequired(true).addChoices(...QUALIFICATIONS.map(item => ({ name: item.name, value: item.key }))))
    .addStringOption(option => option.setName('result').setDescription('Assessment result').setRequired(true).addChoices({ name: 'Passed — award role', value: 'passed' }, { name: 'Revoke qualification', value: 'revoked' }))
    .addStringOption(option => option.setName('reason').setDescription('Assessment notes or revocation reason').setRequired(true).setMaxLength(500)),
  async execute(interaction) {
    const trainerId = getConfig(interaction.guildId, 'TRAINER_ROLE_ID');
    const trainer = require('../utils/ranks').hasConfiguredRole(interaction.member,'TRAINER_ROLE_ID','Trainer');
    if (!isOfficer(interaction.member) && !trainer) return interaction.reply({ content: 'Only trainers, Officers and Commanders can certify members.', ephemeral: true });
    const user = interaction.options.getUser('user', true);
    if (user.id === interaction.user.id) return interaction.reply({ content: 'Another trainer must assess you.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const qualification = QUALIFICATIONS.find(item => item.key === interaction.options.getString('qualification'));
    const member = await interaction.guild.members.fetch(user.id);
    await interaction.guild.roles.fetch();
    const configured = getConfig(interaction.guildId, `QUALIFICATION_${qualification.key.toUpperCase()}_ROLE_ID`);
    const role = require('../utils/qualifications').qualificationRole(interaction.guild,qualification.key);
    if (!role?.editable || role.managed || role.id === interaction.guildId) return interaction.editReply('Configure an editable qualification role with /config set-role. The bot must have Manage Roles and be above it.');
    const result = interaction.options.getString('result');
    const reason = interaction.options.getString('reason');
    if (result === 'passed') await member.roles.add(role, reason);
    else await member.roles.remove(role, reason);
    audit.record(interaction, `qualification.${result}`, user.id, { qualification: qualification.name, reason });
    return interaction.editReply({ content: `${qualification.name}: **${result}** for <@${user.id}>. Role updated and assessment recorded.`, allowedMentions: { parse: [] } });
  },
};
