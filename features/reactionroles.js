const fs = require('node:fs');
const path = require('node:path');
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} = require('discord.js');

const RR_STORE_PATH = path.join(__dirname, '..', 'data', 'reactionroles.json');
const { getAllConfig } = require('../utils/config');
const OFFICER_RANKS = ['Officer', 'Commander'];

function isOfficer(member) {
  return member.roles.cache.some(r => OFFICER_RANKS.includes(r.name));
}

function safeSelfRole(role) {
  const sensitive = [PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers, PermissionFlagsBits.ManageWebhooks, PermissionFlagsBits.ModerateMembers];
  return role && !role.managed && role.id !== role.guild.id && role.editable
    && !role.permissions.any(sensitive)
    && !Object.entries(getAllConfig(role.guild.id)).some(([key, value]) => key.endsWith('_ROLE_ID') && value === role.id)
    && !/^(officer|commander|recruitment officer|trainer|cadet|private|legionaire|dragoon|hussars?|member|ally|unverified|warning.*|qualified.*)$/i.test(role.name);
}

function readRRStore() {
  if (!fs.existsSync(RR_STORE_PATH)) return { messages: {} };
  try {
    return JSON.parse(fs.readFileSync(RR_STORE_PATH, 'utf8'));
  } catch {
    return { messages: {} };
  }
}

function writeRRStore(data) {
  const dir = path.dirname(RR_STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(RR_STORE_PATH, JSON.stringify(data, null, 2));
}

function saveReactionRoleMessage(messageId, roles) {
  const store = readRRStore();
  store.messages[messageId] = { roles };
  writeRRStore(store);
}

function getReactionRoleMessage(messageId) {
  const store = readRRStore();
  return store.messages[messageId];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('Set up reaction roles for your server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand(sub =>
      sub.setName('setup')
        .setDescription('Create a reaction role message with toggleable buttons.')
    ),

  async execute(interaction) {
    if (!isOfficer(interaction.member)) {
      return interaction.reply({
        content: 'Only Officers and Commanders can set up reaction roles.',
        ephemeral: true
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'setup') {
      // Show modal to collect reaction role data
      const modal = new ModalBuilder()
        .setCustomId('rr_setup_modal')
        .setTitle('Create Reaction Roles');

      const titleInput = new TextInputBuilder()
        .setCustomId('rr_title')
        .setLabel('Title for the message')
        .setPlaceholder('e.g., Select Your Roles')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const descriptionInput = new TextInputBuilder()
        .setCustomId('rr_description')
        .setLabel('Description')
        .setPlaceholder('e.g., Click a button below to join a role!')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      const rolesInput = new TextInputBuilder()
        .setCustomId('rr_roles')
        .setLabel('Roles (format: roleID:label per line)')
        .setPlaceholder('e.g., 1234567890:Gaming\n0987654321:Art')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(titleInput),
        new ActionRowBuilder().addComponents(descriptionInput),
        new ActionRowBuilder().addComponents(rolesInput)
      );

      await interaction.showModal(modal);
    }
  },

  async handleModal(interaction) {
    if (interaction.customId !== 'rr_setup_modal') return;
    if (!isOfficer(interaction.member)) return interaction.reply({ content: 'Only Officers and Commanders can configure self-select roles.', ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    const title = interaction.fields.getTextInputValue('rr_title');
    const description = interaction.fields.getTextInputValue('rr_description');
    const rolesInput = interaction.fields.getTextInputValue('rr_roles');

    try {
      // Parse roles input
      const roles = {};
      const lines = rolesInput.split('\n').filter(line => line.trim());

      for (const line of lines) {
        const [roleId, buttonLabel] = line.split(':').map(s => s.trim());

        if (!roleId || !buttonLabel) {
          throw new Error(`Invalid format: "${line}". Use format: roleID:buttonLabel`);
        }

        // Validate role exists
        const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
        if (!role) {
          throw new Error(`Role with ID ${roleId} not found.`);
        }
        if (!safeSelfRole(role)) throw new Error('Choose an editable interest/notification role without staff permissions or membership/rank privileges.');
        if (buttonLabel.length > 80) throw new Error('Button labels must be at most 80 characters.');

        roles[roleId] = buttonLabel;
      }

      if (Object.keys(roles).length === 0) {
        throw new Error('No valid roles provided.');
      }
      if (Object.keys(roles).length > 25) throw new Error('Use at most 25 roles per panel.');
      if (title.length > 256 || description.length > 4096) throw new Error('Title or description is too long.');

      // Create embed
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(title)
        .setDescription(description)
        .setFooter({ text: 'Click a button to toggle your role' })
        .setTimestamp();

      // Create buttons (max 5 per row, max 25 total)
      const buttons = [];
      for (const [roleId, buttonLabel] of Object.entries(roles)) {
        buttons.push(
          new ButtonBuilder()
            .setCustomId(`rr_toggle:${roleId}`)
            .setLabel(buttonLabel)
            .setStyle(ButtonStyle.Primary)
        );
      }

      const rows = [];
      for (let i = 0; i < buttons.length; i += 5) {
        rows.push(
          new ActionRowBuilder().addComponents(buttons.slice(i, i + 5))
        );
      }

      // Send message
      const message = await interaction.channel.send({
        embeds: [embed],
        components: rows
      });

      // Save config
      saveReactionRoleMessage(message.id, roles);

      await interaction.editReply({
        content: `✅ Reaction role message created! [View message](${message.url})`
      });

    } catch (error) {
      console.error('Error setting up reaction roles:', error);
      await interaction.editReply({
        content: `❌ Error: ${error.message}`
      });
    }
  },

  async handleButton(interaction) {
    const [, roleId] = interaction.customId.split(':');

    if (!roleId) return;

    const rrData = getReactionRoleMessage(interaction.message.id);
    if (!rrData) {
      return interaction.reply({
        content: 'This reaction role message is no longer configured.',
        ephemeral: true
      });
    }
    if (!rrData.roles[roleId]) return interaction.reply({ content: 'This role is not configured on this panel.', ephemeral: true });

    try {
      const role = await interaction.guild.roles.fetch(roleId).catch(() => null);

      if (!role) {
        return interaction.reply({
          content: 'This role no longer exists.',
          ephemeral: true
        });
      }
      if (!safeSelfRole(role)) return interaction.reply({ content: 'This role is no longer eligible for self-selection. Ask an officer to update the panel.', ephemeral: true });

      const hasRole = interaction.member.roles.cache.has(roleId);

      if (hasRole) {
        await interaction.member.roles.remove(roleId);
        await interaction.reply({
          content: `✅ Removed you from **${role.name}**.`,
          ephemeral: true
        });
      } else {
        await interaction.member.roles.add(roleId);
        await interaction.reply({
          content: `✅ Added you to **${role.name}**.`,
          ephemeral: true
        });
      }
    } catch (error) {
      console.error('Error toggling reaction role:', error);
      await interaction.reply({
        content: 'There was an error toggling your role.',
        ephemeral: true
      });
    }
  }
};
