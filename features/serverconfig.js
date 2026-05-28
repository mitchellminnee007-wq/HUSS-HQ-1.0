const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { getConfig, setConfig, getAllConfig } = require('../utils/config');

const CHANNEL_SETTINGS = [
  { name: 'Welcome Channel',        value: 'WELCOME_CHANNEL_ID' },
  { name: 'Verification Channel',   value: 'VERIFICATION_CHANNEL_ID' },
  { name: 'Rules Channel',          value: 'RULES_CHANNEL_ID' },
  { name: 'Leave Log Channel',      value: 'LOG_CHANNEL_ID' },
  { name: 'Officer Channel',        value: 'OFFICER_CHANNEL_ID' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure bot settings for this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)

    // /config set-channel
    .addSubcommand(sub =>
      sub.setName('set-channel')
        .setDescription('Assign a channel to a bot feature.')
        .addStringOption(opt =>
          opt.setName('setting')
            .setDescription('Which feature to configure')
            .setRequired(true)
            .addChoices(...CHANNEL_SETTINGS)
        )
        .addChannelOption(opt =>
          opt.setName('channel')
            .setDescription('The channel to use')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )

    // /config set-image
    .addSubcommand(sub =>
      sub.setName('set-image')
        .setDescription('Set the welcome message image URL.')
        .addStringOption(opt =>
          opt.setName('url')
            .setDescription('Direct URL to the image (https://...)')
            .setRequired(true)
        )
    )

    // /config view
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription('View the current bot configuration for this server.')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ── /config set-channel ─────────────────────────────────────────────────
    if (sub === 'set-channel') {
      const key     = interaction.options.getString('setting', true);
      const channel = interaction.options.getChannel('channel', true);
      const label   = CHANNEL_SETTINGS.find(s => s.value === key)?.name ?? key;

      setConfig(interaction.guildId, key, channel.id);

      return interaction.reply({
        content: `✅ **${label}** has been set to ${channel}.`,
        ephemeral: true
      });
    }

    // ── /config set-image ───────────────────────────────────────────────────
    if (sub === 'set-image') {
      const url = interaction.options.getString('url', true);

      if (!/^https?:\/\/.+/i.test(url)) {
        return interaction.reply({ content: 'Please provide a valid `https://` URL.', ephemeral: true });
      }

      setConfig(interaction.guildId, 'WELCOME_IMAGE_URL', url);

      return interaction.reply({
        content: `✅ Welcome image URL has been updated.`,
        ephemeral: true
      });
    }

    // ── /config view ────────────────────────────────────────────────────────
    if (sub === 'view') {
      const cfg = getAllConfig(interaction.guildId);

      const channelFields = CHANNEL_SETTINGS.map(s => ({
        name: s.name,
        value: cfg[s.value] ? `<#${cfg[s.value]}>` : '*Not set*',
        inline: true
      }));

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('⚙️ Server Configuration')
        .addFields(
          ...channelFields,
          { name: 'Welcome Image', value: cfg.WELCOME_IMAGE_URL ? `[Link](${cfg.WELCOME_IMAGE_URL})` : '*Not set*', inline: true }
        )
        .setFooter({ text: 'Use /config set-channel or /config set-image to update • Powered by Hypha' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
};
