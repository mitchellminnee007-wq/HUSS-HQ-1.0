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

const STORE_PATH                 = path.join(__dirname, '..', 'data', 'trainings.json');
const DEFAULT_TRAININGS_CHANNEL_ID = '1386239217998233660';
const OFFICER_RANKS              = ['Officer', 'Commander'];

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

function getTraining(guildId, msgId) {
  return readStore().guilds[guildId]?.[msgId] ?? null;
}

function saveTraining(guildId, msgId, data) {
  const store = readStore();
  if (!store.guilds[guildId]) store.guilds[guildId] = {};
  store.guilds[guildId][msgId] = data;
  writeStore(store);
}

function deleteTraining(guildId, msgId) {
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
  const dmyMatch = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (dmyMatch) {
    const [, d, mo, y, h, mi] = dmyMatch;
    return new Date(`${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}T${h.padStart(2,'0')}:${mi}:00`);
  }
  const isoMatch = input.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})$/);
  if (isoMatch) {
    const [, y, mo, d, h, mi] = isoMatch;
    return new Date(`${y}-${mo}-${d}T${h.padStart(2,'0')}:${mi}:00`);
  }
  return null;
}

// ── Build the training overview embed ─────────────────────────────────────────
function buildTrainingEmbed(tr) {
  const timestamp = Math.floor(tr.time / 1000);
  const fmt = (list) => list.length ? list.map(e => e.name).join('\n') : '*None yet*';

  return new EmbedBuilder()
    .setColor(0xF39C12)
    .setTitle(`🎓 ${tr.title}`)
    .addFields(
      { name: '🕐 Time', value: `<t:${timestamp}:F>\n<t:${timestamp}:R>` },
      { name: `✅ Attending (${tr.attendees.accepted.length})`,  value: fmt(tr.attendees.accepted),  inline: true },
      { name: `❌ Declined (${tr.attendees.declined.length})`,   value: fmt(tr.attendees.declined),  inline: true },
      { name: `❓ Tentative (${tr.attendees.tentative.length})`, value: fmt(tr.attendees.tentative), inline: true },
    )
    .setFooter({ text: `Created by ${tr.createdByName} • Powered by Hypha` })
    .setTimestamp(tr.createdAt);
}

// ── Build RSVP + management buttons ──────────────────────────────────────────
function buildTrainingRows(msgId) {
  const rsvp = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tr_accept:${msgId}`   ).setEmoji('✅').setStyle(ButtonStyle.Success  ),
    new ButtonBuilder().setCustomId(`tr_decline:${msgId}`  ).setEmoji('❌').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`tr_tentative:${msgId}`).setEmoji('❓').setStyle(ButtonStyle.Secondary),
  );
  const mgmt = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tr_edit:${msgId}`  ).setLabel('Edit'  ).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`tr_delete:${msgId}`).setLabel('Delete').setStyle(ButtonStyle.Danger ),
  );
  return [rsvp, mgmt];
}

// ── Refresh the training message ───────────────────────────────────────────────
async function refreshTrainingMessage(interaction, tr, msgId) {
  const channel = interaction.guild.channels.cache.get(tr.channelId)
    ?? await interaction.guild.channels.fetch(tr.channelId).catch(() => null);
  if (!channel) return;
  const msg = await channel.messages.fetch(msgId).catch(() => null);
  if (msg) await msg.edit({ embeds: [buildTrainingEmbed(tr)], components: buildTrainingRows(msgId) }).catch(() => {});
}

// ── Module export ─────────────────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName('training')
    .setDescription('Create a new training sign-up.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    if (!isOfficer(interaction.member)) {
      return interaction.reply({ content: 'Only Officers and Commanders can create trainings.', ephemeral: true });
    }

    const modal = new ModalBuilder()
      .setCustomId('tr_create_modal')
      .setTitle('Create Training');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('time').setLabel('Date & Time (DD/MM/YYYY HH:MM)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('28/05/2026 19:00'),
      ),
    );

    await interaction.showModal(modal);
  },

  // ── Button interactions ─────────────────────────────────────────────────────
  async handleButton(interaction) {
    const [action, msgId] = interaction.customId.split(':');
    const tr = getTraining(interaction.guildId, msgId);

    if (!tr) return interaction.reply({ content: 'This training no longer exists.', ephemeral: true });

    // ── RSVP buttons ────────────────────────────────────────────────────────
    if (action === 'tr_accept' || action === 'tr_decline' || action === 'tr_tentative') {
      const listMap = { tr_accept: 'accepted', tr_decline: 'declined', tr_tentative: 'tentative' };
      const list    = listMap[action];

      const alreadyIn = tr.attendees[list].some(e => e.id === interaction.user.id);
      for (const key of ['accepted', 'declined', 'tentative']) {
        tr.attendees[key] = tr.attendees[key].filter(e => e.id !== interaction.user.id);
      }
      if (!alreadyIn) {
        tr.attendees[list].push({ id: interaction.user.id, name: interaction.member.displayName });
      }

      saveTraining(interaction.guildId, msgId, tr);
      await refreshTrainingMessage(interaction, tr, msgId);

      const labels = { accepted: '✅ Attending', declined: '❌ Declined', tentative: '❓ Tentative' };
      const msg = alreadyIn
        ? `Removed your RSVP from **${labels[list]}**.`
        : `Marked you as **${labels[list]}**.`;
      return interaction.reply({ content: msg, ephemeral: true });
    }

    // ── Edit (officer only) ─────────────────────────────────────────────────
    if (action === 'tr_edit') {
      if (!isOfficer(interaction.member) && interaction.user.id !== tr.createdBy) {
        return interaction.reply({ content: 'Only Officers, Commanders or the creator can edit trainings.', ephemeral: true });
      }

      const date = new Date(tr.time);
      const dd   = String(date.getDate()).padStart(2, '0');
      const mm   = String(date.getMonth() + 1).padStart(2, '0');
      const yyyy = date.getFullYear();
      const hh   = String(date.getHours()).padStart(2, '0');
      const min  = String(date.getMinutes()).padStart(2, '0');

      const modal = new ModalBuilder()
        .setCustomId(`tr_edit_modal:${msgId}`)
        .setTitle('Edit Training');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setValue(tr.title),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000).setValue(tr.description),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('time').setLabel('Date & Time (DD/MM/YYYY HH:MM)').setStyle(TextInputStyle.Short).setRequired(true).setValue(`${dd}/${mm}/${yyyy} ${hh}:${min}`),
        ),
      );

      return interaction.showModal(modal);
    }

    // ── Delete (officer only) ───────────────────────────────────────────────
    if (action === 'tr_delete') {
      if (!isOfficer(interaction.member) && interaction.user.id !== tr.createdBy) {
        return interaction.reply({ content: 'Only Officers, Commanders or the creator can delete trainings.', ephemeral: true });
      }

      const channel = interaction.guild.channels.cache.get(tr.channelId)
        ?? await interaction.guild.channels.fetch(tr.channelId).catch(() => null);
      if (channel) {
        const msg = await channel.messages.fetch(msgId).catch(() => null);
        if (msg) {
          if (tr.threadId) {
            const thread = interaction.guild.channels.cache.get(tr.threadId);
            if (thread) await thread.delete().catch(() => {});
          }
          await msg.delete().catch(() => {});
        }
      }

      deleteTraining(interaction.guildId, msgId);
      return interaction.reply({ content: '🗑️ Training deleted.', ephemeral: true });
    }
  },

  // ── Modal submit interactions ───────────────────────────────────────────────
  async handleModal(interaction) {
    const [action, msgId] = interaction.customId.split(':');

    // ── Create new training ─────────────────────────────────────────────────
    if (action === 'tr_create_modal') {
      const title       = interaction.fields.getTextInputValue('title');
      const description = interaction.fields.getTextInputValue('description');
      const timeStr     = interaction.fields.getTextInputValue('time');

      const parsedDate = parseDateTime(timeStr);
      if (!parsedDate || isNaN(parsedDate.getTime())) {
        return interaction.reply({ content: '❌ Invalid date format. Please use `DD/MM/YYYY HH:MM` (e.g. `28/05/2026 19:00`).', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      const channelId = getConfig(interaction.guildId, 'TRAININGS_CHANNEL_ID') ?? DEFAULT_TRAININGS_CHANNEL_ID;
      const channel   = interaction.guild.channels.cache.get(channelId)
        ?? await interaction.guild.channels.fetch(channelId).catch(() => null);

      if (!channel) {
        return interaction.editReply('❌ Trainings channel not found. Set it with `/config set-channel`.');
      }

      const tr = {
        title,
        description,
        time:          parsedDate.getTime(),
        createdBy:     interaction.user.id,
        createdByName: interaction.member.displayName,
        createdAt:     Date.now(),
        channelId:     channel.id,
        threadId:      null,
        attendees:     { accepted: [], declined: [], tentative: [] },
      };

      const msg = await channel.send({ embeds: [buildTrainingEmbed(tr)], components: buildTrainingRows('placeholder') });
      await msg.edit({ embeds: [buildTrainingEmbed(tr)], components: buildTrainingRows(msg.id) });

      const thread = await msg.startThread({
        name:                title.slice(0, 100),
        autoArchiveDuration: 10080,
      }).catch(() => null);

      if (thread) {
        await thread.send(`🎓 **${title}**\n\n${description}`).catch(() => {});
        tr.threadId = thread.id;
      }

      saveTraining(interaction.guildId, msg.id, tr);
      return interaction.editReply(`✅ Training **${title}** posted in ${channel}!`);
    }

    // ── Edit existing training ──────────────────────────────────────────────
    if (action === 'tr_edit_modal') {
      const tr = getTraining(interaction.guildId, msgId);
      if (!tr) return interaction.reply({ content: 'Training not found.', ephemeral: true });

      const title       = interaction.fields.getTextInputValue('title');
      const description = interaction.fields.getTextInputValue('description');
      const timeStr     = interaction.fields.getTextInputValue('time');

      const parsedDate = parseDateTime(timeStr);
      if (!parsedDate || isNaN(parsedDate.getTime())) {
        return interaction.reply({ content: '❌ Invalid date format. Please use `DD/MM/YYYY HH:MM`.', ephemeral: true });
      }

      tr.title       = title;
      tr.description = description;
      tr.time        = parsedDate.getTime();
      saveTraining(interaction.guildId, msgId, tr);

      await refreshTrainingMessage(interaction, tr, msgId);

      if (tr.threadId) {
        const thread = interaction.guild.channels.cache.get(tr.threadId);
        if (thread) {
          await thread.setName(title.slice(0, 100)).catch(() => {});
          const msgs   = await thread.messages.fetch({ limit: 5 });
          const botMsg = msgs.find(m => m.author.id === interaction.client.user.id);
          if (botMsg) await botMsg.edit(`🎓 **${title}**\n\n${description}`).catch(() => {});
        }
      }

      return interaction.reply({ content: `✅ Training **${title}** updated.`, ephemeral: true });
    }
  },
};
