const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { clearQualificationApplications } = require('./training');

const OFFICER_RANKS = ['Officer', 'Commander'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('training-clear-applications')
    .setDescription('Clear all qualification applications and remove applicants from training threads.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addBooleanOption(option =>
      option.setName('confirm')
        .setDescription('Confirm permanent removal of all qualification applications.')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!require('../utils/ranks').isOfficer(interaction.member)) {
      return interaction.reply({
        content: 'Only Officers and Commanders can clear qualification applications.',
        ephemeral: true,
      });
    }
    const apply = interaction.options.getBoolean('confirm') === true;

    await interaction.deferReply({ ephemeral: true });
    const result = await clearQualificationApplications(interaction.guild, apply);
    if (!apply) return interaction.editReply(`Preview: ${result.applicationsRemoved} applications would be cleared. Run with confirm:True to apply.`);
    return interaction.editReply(
      `Cleared ${result.applicationsRemoved} qualification application(s).` +
      (result.threadRemovalFailures
        ? ` Failed to remove thread access for ${result.threadRemovalFailures} member/thread pair(s); check the bot logs.`
        : ' Removed recorded applicants from the linked qualification threads.')
    );
  },
};
