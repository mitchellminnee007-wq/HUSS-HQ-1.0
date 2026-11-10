const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { getConfig, setConfig, getAllConfig } = require('../utils/config');
const { QUALIFICATIONS } = require('./training');

const CHANNEL_SETTINGS = [
  { name: 'Admin Panel Channel', value: 'ADMIN_PANEL_CHANNEL_ID' },
  { name: 'Welcome Channel',        value: 'WELCOME_CHANNEL_ID' },
  { name: 'Verification Channel',   value: 'VERIFICATION_CHANNEL_ID' },
  { name: 'Rules Channel',          value: 'RULES_CHANNEL_ID' },
  { name: 'Leave Log Channel',      value: 'LOG_CHANNEL_ID' },
  { name: 'Officer Channel',        value: 'OFFICER_CHANNEL_ID' },
  { name: 'Verification Review Channel', value: 'VERIFICATION_REVIEW_CHANNEL_ID' },
  { name: 'Ticket Category',        value: 'TICKET_CATEGORY_ID' },
  { name: 'Ticket Log Channel',     value: 'TICKET_LOG_CHANNEL_ID' },
  { name: 'Operations Channel',     value: 'OPERATIONS_CHANNEL_ID' },
  { name: 'Trainings Channel',      value: 'TRAININGS_CHANNEL_ID' },
  { name: 'Kill Count Channel',     value: 'KILLCOUNT_CHANNEL_ID' },
  { name: 'WHL Logistics Forum',    value: 'WHL_LOGISTICS_FORUM_ID' },
  { name: 'Logistics Test Forum', value: 'LOGISTICS_TEST_FORUM_ID' },
];

const STRING_SETTINGS = [
  { name: 'WHL Guild ID', value: 'WHL_GUILD_ID' },
  { name: 'WHL Logistics Forum', value: 'WHL_LOGISTICS_FORUM_ID' },
];

const ROLE_SETTINGS = [
  ...QUALIFICATIONS.map(item => ({ name: item.name, value: `QUALIFICATION_${item.key.toUpperCase()}_ROLE_ID` })),
  { name: 'Verified Member Role', value: 'VERIFIED_MEMBER_ROLE_ID' },
  { name: 'Cadet Role', value: 'CADET_ROLE_ID' },
  { name: 'Active War Role',         value: 'ACTIVE_WAR_ROLE_ID' },
  { name: 'Ally Role',                value: 'ALLY_ROLE_ID' },
  { name: 'Collie Role',             value: 'COLLIE_ROLE_ID' },
  { name: 'Unverified Role',         value: 'UNVERIFIED_ROLE_ID' },
  { name: 'Former Member Role',      value: 'FORMER_MEMBER_ROLE_ID' },
  { name: 'Recruitment Officer Role', value: 'RECRUITMENT_OFFICER_ROLE_ID' },
  { name: 'Trainer Role', value: 'TRAINER_ROLE_ID' },
  { name: 'Logistics Role', value: 'LOGISTICS_ROLE_ID' },
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
            .setDescription('The channel or forum to use')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildForum, ChannelType.GuildCategory)
            .setRequired(true)
        )
    )

    // /config set-string
    .addSubcommand(sub =>
      sub.setName('set-string')
        .setDescription('Set a guild or forum ID for cross-server features.')
        .addStringOption(opt =>
          opt.setName('setting')
            .setDescription('Which setting to configure')
            .setRequired(true)
            .addChoices(...STRING_SETTINGS)
        )
        .addStringOption(opt =>
          opt.setName('value')
            .setDescription('The ID or value to store')
            .setRequired(true)
        )
    )

    // /config set-role
    .addSubcommand(sub =>
      sub.setName('set-role')
        .setDescription('Assign a role to a bot feature.')
        .addStringOption(opt =>
          opt.setName('setting')
            .setDescription('Which role to configure')
            .setRequired(true)
            .addChoices(...ROLE_SETTINGS)
        )
        .addRoleOption(opt =>
          opt.setName('role')
            .setDescription('The role to use')
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
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'Manage Server permission is required.', ephemeral: true });
    const sub = interaction.options.getSubcommand();

    // ── /config set-channel ─────────────────────────────────────────────────
    if (sub === 'set-channel') {
      const key     = interaction.options.getString('setting', true);
      const channel = interaction.options.getChannel('channel', true);
      const label   = CHANNEL_SETTINGS.find(s => s.value === key)?.name ?? key;

      const expected = key === 'TICKET_CATEGORY_ID' ? ChannelType.GuildCategory
        : ['WHL_LOGISTICS_FORUM_ID', 'LOGISTICS_TEST_FORUM_ID'].includes(key) ? ChannelType.GuildForum : ChannelType.GuildText;
      if (channel.type !== expected) return interaction.reply({ content: `Choose a ${expected === ChannelType.GuildCategory ? 'category' : expected === ChannelType.GuildForum ? 'forum' : 'text channel'} for ${label}.`, ephemeral: true });
      if (['ADMIN_PANEL_CHANNEL_ID', 'VERIFICATION_REVIEW_CHANNEL_ID'].includes(key) && channel.permissionsFor(interaction.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)) return interaction.reply({ content: 'Choose a private channel with View Channel denied for @everyone.', ephemeral: true });

      if (key === 'WHL_LOGISTICS_FORUM_ID' && channel.type !== ChannelType.GuildForum) {
        return interaction.reply({
          content: '❌ **WHL Logistics Forum** must be a Discord Forum channel from the WHL guild. `#task-board` is not a forum channel.',
          ephemeral: true
        });
      }

      setConfig(interaction.guildId, key, channel.id);

      return interaction.reply({
        content: `✅ **${label}** has been set to ${channel}.`,
        ephemeral: true
      });
    }

    // ── /config set-role ────────────────────────────────────────────────────
    if (sub === 'set-string') {
      const key   = interaction.options.getString('setting', true);
      const value = interaction.options.getString('value', true).trim();
      const label = STRING_SETTINGS.find(s => s.value === key)?.name ?? key;

      if (!value) {
        return interaction.reply({ content: 'Please provide a valid value.', ephemeral: true });
      }

      setConfig(interaction.guildId, key, value);

      return interaction.reply({
        content: `✅ **${label}** has been set to \`${value}\`.`,
        ephemeral: true
      });
    }

    // ── /config set-role ────────────────────────────────────────────────────
    if (sub === 'set-role') {
      const key   = interaction.options.getString('setting', true);
      const role  = interaction.options.getRole('role', true);
      const label = ROLE_SETTINGS.find(s => s.value === key)?.name ?? key;

      if (role.managed || role.id === interaction.guildId) return interaction.reply({ content: 'Choose a normal server role, not a managed role or @everyone.', ephemeral: true });
      setConfig(interaction.guildId, key, role.id);

      return interaction.reply({
        content: `✅ **${label}** has been set to ${role}.`,
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

      const roleFields = ROLE_SETTINGS.map(s => ({
        name: s.name,
        value: cfg[s.value] ? `<@&${cfg[s.value]}>` : '*Not set*',
        inline: true
      }));

      const stringFields = STRING_SETTINGS.map(s => ({
        name: s.name,
        value: cfg[s.value] || '*Not set*',
        inline: true
      }));

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('⚙️ Server Configuration')
        .addFields(
          ...channelFields,
          ...stringFields,
          { name: 'Welcome Image', value: cfg.WELCOME_IMAGE_URL ? `[Link](${cfg.WELCOME_IMAGE_URL})` : '*Not set*', inline: true }
        )
        .setFooter({ text: 'Use /config set-channel or /config set-image to update • Powered by Hypha' })
        .setTimestamp();

      const rolesEmbed = new EmbedBuilder().setColor(0x5865F2).setTitle('Server Roles').addFields(roleFields);
      return interaction.reply({ embeds: [embed, rolesEmbed], ephemeral: true });
    }
  }
};
