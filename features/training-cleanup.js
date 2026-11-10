const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { getConfig } = require('../utils/config');
const { cleanupQualificationThreads } = require('./training');

const DEFAULT_TRAININGS_CHANNEL_ID = '1386239217998233660';
const OFFICER_RANKS = ['Officer', 'Commander'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('training-cleanup')
    .setDescription('Preview or archive duplicate qualification threads.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addBooleanOption(option =>
      option.setName('confirm')
        .setDescription('Apply the preview by archiving duplicate threads.')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!interaction.member.roles.cache.some(role => OFFICER_RANKS.includes(role.name))) {
      return interaction.reply({
        content: 'Only Officers and Commanders can clean up qualification threads.',
        ephemeral: true,
      });
    }
    const apply = interaction.options.getBoolean('confirm') === true;

    await interaction.deferReply({ ephemeral: true });

    const channelId = getConfig(interaction.guildId, 'TRAININGS_CHANNEL_ID') ?? DEFAULT_TRAININGS_CHANNEL_ID;
    const channel = interaction.guild.channels.cache.get(channelId)
      ?? await interaction.guild.channels.fetch(channelId).catch(error => {
        console.error(`Could not fetch training channel ${channelId}:`, error);
        return null;
      });
    if (!channel || channel.id !== channelId || channel.guildId !== interaction.guildId
      || channel.type !== ChannelType.GuildText || !channel.threads) {
      return interaction.editReply('Configured training channel must be a text channel in this server. No threads were changed.');
    }

    const result = await cleanupQualificationThreads(interaction.guild, channel, apply);
    return interaction.editReply(
      `Scanned threads under <#${channel.id}> only. Kept ${result.kept.length} qualification threads and ${apply ? 'archived' : 'would archive'} ${result.deleted.length} duplicates. ${apply ? '' : 'Run with confirm:True to apply.'}` +
      (result.failed.length ? ` Failed to archive ${result.failed.length}; check the bot logs for details.` : '')
    );
  },
};
