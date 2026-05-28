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
const { getConfig } = require('../utils/config');

const STORE_PATH              = path.join(__dirname, '..', 'data', 'operations.json');
const DEFAULT_OPS_CHANNEL_ID  = '1386239322209910885';
const OFFICER_RANKS           = ['Officer', 'Commander'];

// ── Store helpers ─────────────────────────────────────────────────────────────
function readStore() {
  if (!fs.existsSync(STORE_PATH)) return { guilds: {} };
  try { return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); }
  catch { return { guilds: {} }; }
}

function writeStore(data) {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

function getOp(guildId, msgId) {
  return readStore().guilds[guildId]?.[msgId] ?? null;
}

function saveOp(guildId, msgId, data) {
  const store = readStore();
  if (!store.guilds[guildId]) store.guilds[guildId] = {};
  store.guilds[guildId][msgId] = data;
  writeStore(store);
}

function deleteOp(guildId, msgId) {
  const store = readStore();
  if (store.guilds[guildId]) {
    delete store.guilds[guildId][msgId];
    writeStore(store);
  }
}

function isOfficer(member) {
  return member.roles.cache.some(r => OFFICER_RANKS.includes(r.name));
}

// ── Parse date input (accepts DD/MM/YYYY HH:MM or YYYY-MM-DD HH:MM) ──────────
function parseDateTime(input) {
  // Try DD/MM/YYYY HH:MM
  const dmyMatch = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (dmyMatch) {
    const [, d, mo, y, h, mi] = dmyMatch;
    return new Date(`${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}T${h.padStart(2,'0')}:${mi}:00`);
  }
  // Try YYYY-MM-DD HH:MM
  const isoMatch = input.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})$/);
  if (isoMatch) {
    const [, y, mo, d, h, mi] = isoMatch;
    return new Date(`${y}-${mo}-${d}T${h.padStart(2,'0')}:${mi}:00`);
  }
  return null;
}

// ── Build the operation overview embed ───────────────────────────────────────
function buildOpEmbed(op) {
  const timestamp = Math.floor(op.time / 1000);

  const fmt = (list) =>
    list.length ? list.map(e => e.name).join('\n') : '*None yet*';

  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(op.title)
    .addFields(
      { name: '🕐 Time', value: `<t:${timestamp}:F>\n<t:${timestamp}:R>` },
      {
        name:   `✅ Accepted (${op.attendees.accepted.length})`,
        value:  fmt(op.attendees.accepted),
        inline: true,
      },
      {
        name:   `❌ Declined (${op.attendees.declined.length})`,
        value:  fmt(op.attendees.declined),
        inline: true,
      },
      {
        name:   `❓ Tentative (${op.attendees.tentative.length})`,
        value:  fmt(op.attendees.tentative),
        inline: true,
      },
    )
    .setFooter({ text: `Created by ${op.createdByName} • Powered by Hypha` })
    .setTimestamp(op.createdAt);
}

// ── Build RSVP + management buttons ──────────────────────────────────────────
function buildOpRows(msgId) {
  const rsvp = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`op_accept:${msgId}`  ).setEmoji('✅').setStyle(ButtonStyle.Success  ),
    new ButtonBuilder().setCustomId(`op_decline:${msgId}` ).setEmoji('❌').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`op_tentative:${msgId}`).setEmoji('❓').setStyle(ButtonStyle.Secondary),
  );
  const mgmt = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`op_edit:${msgId}`  ).setLabel('Edit'  ).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`op_delete:${msgId}`).setLabel('Delete').setStyle(ButtonStyle.Danger ),
  );
  return [rsvp, mgmt];
}

// ── Toggle a user in/out of a list, removing from the other two ───────────────
function toggleAttendee(op, userId, displayName, list) {
  for (const key of ['accepted', 'declined', 'tentative']) {
    op.attendees[key] = op.attendees[key].filter(e => e.id !== userId);
  }
  // If user was already in the target list it's now removed (toggle off), else add
  const wasRemoved = true; // we always remove first; re-add below
  op.attendees[list].push({ id: userId, name: displayName });
  return op;
}

// ── Refresh the operation message ─────────────────────────────────────────────
async function refreshOpMessage(interaction, op, msgId) {
  const channel = interaction.guild.channels.cache.get(op.channelId)
    ?? await interaction.guild.channels.fetch(op.channelId).catch(() => null);
  if (!channel) return;
  const msg = await channel.messages.fetch(msgId).catch(() => null);
  if (msg) await msg.edit({ embeds: [buildOpEmbed(op)], components: buildOpRows(msgId) }).catch(() => {});
}

// ── Module export ─────────────────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName('operation')
    .setDescription('Create a new operation sign-up.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    if (!isOfficer(interaction.member)) {
      return interaction.reply({ content: 'Only Officers and Commanders can create operations.', ephemeral: true });
    }

    const modal = new ModalBuilder()
      .setCustomId('op_create_modal')
      .setTitle('Create Operation');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('time').setLabel('Date & Time (DD/MM/YYYY HH:MM)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('28/05/2026 19:00')
      ),
    );

    await interaction.showModal(modal);
  },

  // ── Button interactions ─────────────────────────────────────────────────────
  async handleButton(interaction) {
    const [action, msgId] = interaction.customId.split(':');
    const op = getOp(interaction.guildId, msgId);

    if (!op) return interaction.reply({ content: 'This operation no longer exists.', ephemeral: true });

    // ── RSVP buttons ────────────────────────────────────────────────────────
    if (action === 'op_accept' || action === 'op_decline' || action === 'op_tentative') {
      const listMap = { op_accept: 'accepted', op_decline: 'declined', op_tentative: 'tentative' };
      const list    = listMap[action];

      // Toggle: if already in this list, remove them
      const alreadyIn = op.attendees[list].some(e => e.id === interaction.user.id);
      for (const key of ['accepted', 'declined', 'tentative']) {
        op.attendees[key] = op.attendees[key].filter(e => e.id !== interaction.user.id);
      }
      if (!alreadyIn) {
        op.attendees[list].push({ id: interaction.user.id, name: interaction.member.displayName });
      }

      saveOp(interaction.guildId, msgId, op);
      await refreshOpMessage(interaction, op, msgId);

      const labels = { accepted: '✅ Accepted', declined: '❌ Declined', tentative: '❓ Tentative' };
      const msg = alreadyIn
        ? `Removed your RSVP from **${labels[list]}**.`
        : `Marked you as **${labels[list]}**.`;
      return interaction.reply({ content: msg, ephemeral: true });
    }

    // ── Edit (officer only) ─────────────────────────────────────────────────
    if (action === 'op_edit') {
      if (!isOfficer(interaction.member) && interaction.user.id !== op.createdBy) {
        return interaction.reply({ content: 'Only Officers, Commanders or the creator can edit operations.', ephemeral: true });
      }

      const date = new Date(op.time);
      const dd   = String(date.getDate()).padStart(2, '0');
      const mm   = String(date.getMonth() + 1).padStart(2, '0');
      const yyyy = date.getFullYear();
      const hh   = String(date.getHours()).padStart(2, '0');
      const min  = String(date.getMinutes()).padStart(2, '0');

      const modal = new ModalBuilder()
        .setCustomId(`op_edit_modal:${msgId}`)
        .setTitle('Edit Operation');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setValue(op.title)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000).setValue(op.description)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('time').setLabel('Date & Time (DD/MM/YYYY HH:MM)').setStyle(TextInputStyle.Short).setRequired(true).setValue(`${dd}/${mm}/${yyyy} ${hh}:${min}`)
        ),
      );

      return interaction.showModal(modal);
    }

    // ── Delete (officer only) ───────────────────────────────────────────────
    if (action === 'op_delete') {
      if (!isOfficer(interaction.member) && interaction.user.id !== op.createdBy) {
        return interaction.reply({ content: 'Only Officers, Commanders or the creator can delete operations.', ephemeral: true });
      }

      const channel = interaction.guild.channels.cache.get(op.channelId)
        ?? await interaction.guild.channels.fetch(op.channelId).catch(() => null);
      if (channel) {
        const msg = await channel.messages.fetch(msgId).catch(() => null);
        if (msg) {
          // Delete thread if it exists
          if (op.threadId) {
            const thread = interaction.guild.channels.cache.get(op.threadId);
            if (thread) await thread.delete().catch(() => {});
          }
          await msg.delete().catch(() => {});
        }
      }

      deleteOp(interaction.guildId, msgId);
      return interaction.reply({ content: '🗑️ Operation deleted.', ephemeral: true });
    }
  },

  // ── Modal submit interactions ───────────────────────────────────────────────
  async handleModal(interaction) {
    const [action, msgId] = interaction.customId.split(':');

    // ── Create new operation ────────────────────────────────────────────────
    if (action === 'op_create_modal') {
      const title       = interaction.fields.getTextInputValue('title');
      const description = interaction.fields.getTextInputValue('description');
      const timeStr     = interaction.fields.getTextInputValue('time');

      const parsedDate = parseDateTime(timeStr);
      if (!parsedDate || isNaN(parsedDate.getTime())) {
        return interaction.reply({ content: '❌ Invalid date format. Please use `DD/MM/YYYY HH:MM` (e.g. `28/05/2026 19:00`).', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      const opsChannelId = getConfig(interaction.guildId, 'OPERATIONS_CHANNEL_ID') ?? DEFAULT_OPS_CHANNEL_ID;
      const opsChannel   = interaction.guild.channels.cache.get(opsChannelId)
        ?? await interaction.guild.channels.fetch(opsChannelId).catch(() => null);

      if (!opsChannel) {
        return interaction.editReply('❌ Operations channel not found. Set it with `/config set-channel`.');
      }

      const op = {
        title,
        description,
        time:          parsedDate.getTime(),
        createdBy:     interaction.user.id,
        createdByName: interaction.member.displayName,
        createdAt:     Date.now(),
        channelId:     opsChannel.id,
        threadId:      null,
        attendees:     { accepted: [], declined: [], tentative: [] },
      };

      // Post a placeholder to get the message ID first
      const msg = await opsChannel.send({ embeds: [buildOpEmbed(op)], components: buildOpRows('placeholder') });

      // Now we have the real message ID — update buttons with it
      op.channelId = opsChannel.id;
      await msg.edit({ embeds: [buildOpEmbed(op)], components: buildOpRows(msg.id) });

      // Create a thread for the description
      const thread = await msg.startThread({
        name:                 title.slice(0, 100),
        autoArchiveDuration:  10080, // 7 days
      }).catch(() => null);

      if (thread) {
        await thread.send(`📋 **${title}**\n\n${description}`).catch(() => {});
        op.threadId = thread.id;
      }

      saveOp(interaction.guildId, msg.id, op);

      return interaction.editReply(`✅ Operation **${title}** posted in ${opsChannel}!`);
    }

    // ── Edit existing operation ─────────────────────────────────────────────
    if (action === 'op_edit_modal') {
      const op = getOp(interaction.guildId, msgId);
      if (!op) return interaction.reply({ content: 'Operation not found.', ephemeral: true });

      const title       = interaction.fields.getTextInputValue('title');
      const description = interaction.fields.getTextInputValue('description');
      const timeStr     = interaction.fields.getTextInputValue('time');

      const parsedDate = parseDateTime(timeStr);
      if (!parsedDate || isNaN(parsedDate.getTime())) {
        return interaction.reply({ content: '❌ Invalid date format. Please use `DD/MM/YYYY HH:MM`.', ephemeral: true });
      }

      op.title       = title;
      op.description = description;
      op.time        = parsedDate.getTime();
      saveOp(interaction.guildId, msgId, op);

      await refreshOpMessage(interaction, op, msgId);

      // Update thread name and description post if thread exists
      if (op.threadId) {
        const thread = interaction.guild.channels.cache.get(op.threadId);
        if (thread) {
          await thread.setName(title.slice(0, 100)).catch(() => {});
          const msgs   = await thread.messages.fetch({ limit: 5 });
          const botMsg = msgs.find(m => m.author.id === interaction.client.user.id);
          if (botMsg) await botMsg.edit(`📋 **${title}**\n\n${description}`).catch(() => {});
        }
      }

      return interaction.reply({ content: `✅ Operation **${title}** updated.`, ephemeral: true });
    }
  },
};
