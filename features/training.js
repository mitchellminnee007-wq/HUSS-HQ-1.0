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
const DEFAULT_TIME_ZONE           = 'Europe/Amsterdam';
const REMINDER_MS                 = 15 * 60 * 1000;
const MAX_TIMEOUT_MS              = 2 ** 31 - 1;
const reminderTimers              = new Map();

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

function clearReminder(guildId, msgId) {
  const key = `${guildId}:${msgId}`;
  const timer = reminderTimers.get(key);
  if (timer) clearTimeout(timer);
  reminderTimers.delete(key);
}

async function sendTrainingReminder(client, guildId, msgId, tr) {
  if (tr.reminderSent) return;

  const acceptedIds = tr.attendees.accepted.map(member => member.id);
  const channel = await client.channels.fetch(tr.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  tr.reminderSent = true;
  saveTraining(guildId, msgId, tr);

  const timestamp = Math.floor(tr.time / 1000);
  const content = acceptedIds.length
    ? acceptedIds.map(id => `<@${id}>`).join(' ')
    : undefined;

  const reminderMsg = await channel.send({
    content,
    embeds: [
      new EmbedBuilder()
        .setColor(0xF39C12)
        .setTitle(`⏰  Training starting soon!`)
        .setDescription(
          `> **${tr.title}** begins <t:${timestamp}:R> — <t:${timestamp}:t>\n` +
          `> Make sure you're ready and in position.`
        )
        .setFooter({ text: '⚔️ HUSS Command  •  15-minute reminder' })
    ],
    allowedMentions: { users: acceptedIds }
  }).catch(() => null);

  // Store the reminder message ID so it can be cleaned up when the training is deleted
  if (reminderMsg) {
    tr.reminderMsgId = reminderMsg.id;
    saveTraining(guildId, msgId, tr);
  }
}

function scheduleTrainingReminder(client, guildId, msgId, tr) {
  clearReminder(guildId, msgId);

  if (!tr || tr.reminderSent) return;

  const delay = tr.time - Date.now() - REMINDER_MS;
  if (delay <= 0) {
    if (tr.time > Date.now()) sendTrainingReminder(client, guildId, msgId, tr);
    return;
  }

  const key = `${guildId}:${msgId}`;
  const timer = setTimeout(() => {
    reminderTimers.delete(key);
    const latestTraining = getTraining(guildId, msgId);
    if (!latestTraining) return;
    if (latestTraining.time - Date.now() - REMINDER_MS > 0) {
      scheduleTrainingReminder(client, guildId, msgId, latestTraining);
      return;
    }
    sendTrainingReminder(client, guildId, msgId, latestTraining);
  }, Math.min(delay, MAX_TIMEOUT_MS));
  reminderTimers.set(key, timer);
}

function scheduleAllTrainingReminders(client) {
  const store = readStore();
  for (const [guildId, trainings] of Object.entries(store.guilds)) {
    for (const [msgId, tr] of Object.entries(trainings)) {
      scheduleTrainingReminder(client, guildId, msgId, tr);
    }
  }
}

function isOfficer(member) {
  return member.roles.cache.some(r => OFFICER_RANKS.includes(r.name));
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );

  return asUtc - date.getTime();
}

function zonedTimeToDate(year, month, day, hour, minute, timeZone = DEFAULT_TIME_ZONE) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offset = getTimeZoneOffsetMs(utcGuess, timeZone);
  const date = new Date(utcGuess.getTime() - offset);
  const finalOffset = getTimeZoneOffsetMs(date, timeZone);

  return new Date(utcGuess.getTime() - finalOffset);
}

function offsetTimeToDate(year, month, day, hour, minute, offsetMinutes) {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0) - offsetMinutes * 60 * 1000);
}

function resolveTimeZone(input) {
  if (!input) return { timeZone: DEFAULT_TIME_ZONE };

  const value = input.trim();
  const upper = value.toUpperCase();
  const aliases = {
    UTC: { offsetMinutes: 0 },
    GMT: { offsetMinutes: 0 },
    CET: { timeZone: 'Europe/Amsterdam' },
    CEST: { timeZone: 'Europe/Amsterdam' },
    AMSTERDAM: { timeZone: 'Europe/Amsterdam' },
    NL: { timeZone: 'Europe/Amsterdam' },
    ET: { timeZone: 'America/New_York' },
    EST: { timeZone: 'America/New_York' },
    EDT: { timeZone: 'America/New_York' },
    CT: { timeZone: 'America/Chicago' },
    CST: { timeZone: 'America/Chicago' },
    CDT: { timeZone: 'America/Chicago' },
    MT: { timeZone: 'America/Denver' },
    MST: { timeZone: 'America/Denver' },
    MDT: { timeZone: 'America/Denver' },
    PT: { timeZone: 'America/Los_Angeles' },
    PST: { timeZone: 'America/Los_Angeles' },
    PDT: { timeZone: 'America/Los_Angeles' },
    AWST: { timeZone: 'Australia/Perth' },
    ACST: { timeZone: 'Australia/Adelaide' },
    ACDT: { timeZone: 'Australia/Adelaide' },
    AEST: { timeZone: 'Australia/Sydney' },
    AEDT: { timeZone: 'Australia/Sydney' },
    SYDNEY: { timeZone: 'Australia/Sydney' },
    MELBOURNE: { timeZone: 'Australia/Melbourne' },
    PERTH: { timeZone: 'Australia/Perth' }
  };

  if (aliases[upper]) return aliases[upper];

  const offsetMatch = upper.match(/^(?:UTC|GMT)?([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (offsetMatch) {
    const [, sign, hours, minutes = '00'] = offsetMatch;
    const offsetMinutes = (Number(hours) * 60 + Number(minutes)) * (sign === '+' ? 1 : -1);
    return { offsetMinutes };
  }

  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value }).format(new Date());
    return { timeZone: value };
  } catch {
    return null;
  }
}

function formatDateTimeForInput(time, timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(time));
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));

  return `${values.day}/${values.month}/${values.year} ${values.hour}:${values.minute}`;
}

// ── Parse date input (accepts DD/MM/YYYY HH:MM or YYYY-MM-DD HH:MM) ──────────
function parseDateTime(input) {
  const dmyMatch = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?:\s+(.+))?$/);
  if (dmyMatch) {
    const [, d, mo, y, h, mi, zoneInput] = dmyMatch;
    const zone = resolveTimeZone(zoneInput);
    if (!zone) return null;
    return zone.timeZone
      ? zonedTimeToDate(Number(y), Number(mo), Number(d), Number(h), Number(mi), zone.timeZone)
      : offsetTimeToDate(Number(y), Number(mo), Number(d), Number(h), Number(mi), zone.offsetMinutes);
  }
  const isoMatch = input.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})(?:\s+(.+))?$/);
  if (isoMatch) {
    const [, y, mo, d, h, mi, zoneInput] = isoMatch;
    const zone = resolveTimeZone(zoneInput);
    if (!zone) return null;
    return zone.timeZone
      ? zonedTimeToDate(Number(y), Number(mo), Number(d), Number(h), Number(mi), zone.timeZone)
      : offsetTimeToDate(Number(y), Number(mo), Number(d), Number(h), Number(mi), zone.offsetMinutes);
  }
  return null;
}

// ── Build the training overview embed ─────────────────────────────────────────
function buildTrainingEmbed(tr) {
  const timestamp = Math.floor(tr.time / 1000);
  const fmt = (list) =>
    list.length ? list.map(e => `▸ ${e.name}`).join('\n') : '*None yet*';

  const { accepted, declined, tentative } = tr.attendees;
  const total = accepted.length + declined.length + tentative.length;

  return new EmbedBuilder()
    .setColor(0xF39C12)
    .setTitle(`🎓  ${tr.title}`)
    .setDescription(
      (tr.description ? `> ${tr.description}\n\n` : '') +
      `📅  <t:${timestamp}:F>\n` +
      `⏱️  <t:${timestamp}:R>`
    )
    .addFields(
      {
        name:  `✅  Attending — ${accepted.length}`,
        value: fmt(accepted),
        inline: true,
      },
      {
        name:  `❌  Declined — ${declined.length}`,
        value: fmt(declined),
        inline: true,
      },
      {
        name:  `❓  Maybe — ${tentative.length}`,
        value: fmt(tentative),
        inline: true,
      },
      {
        name:  '📊  Response rate',
        value: total > 0
          ? `\`${accepted.length}/${total}\` confirmed  •  \`${tentative.length}\` maybe`
          : '*No responses yet.*',
        inline: false,
      },
    )
    .setFooter({ text: `⚔️ HUSS Command  •  Organised by ${tr.createdByName}` })
    .setTimestamp(tr.createdAt);
}

// ── Build RSVP + management buttons ──────────────────────────────────────────
function buildTrainingRows(msgId) {
  const rsvp = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`tr_accept:${msgId}`)
      .setLabel('Accept')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`tr_decline:${msgId}`)
      .setLabel('Decline')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`tr_tentative:${msgId}`)
      .setLabel('Maybe')
      .setEmoji('❓')
      .setStyle(ButtonStyle.Primary),
  );
  const mgmt = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`tr_edit:${msgId}`)
      .setLabel('Edit')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`tr_delete:${msgId}`)
      .setLabel('Cancel Training')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger),
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

  init(client) {
    scheduleAllTrainingReminders(client);
  },

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
        new TextInputBuilder().setCustomId('time').setLabel('Date/time + optional timezone').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('28/05/2026 19:00 or 28/05/2026 19:00 EST'),
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
      scheduleTrainingReminder(interaction.client, interaction.guildId, msgId, tr);

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

      const timeValue = formatDateTimeForInput(tr.time);

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
          new TextInputBuilder().setCustomId('time').setLabel('Date/time + optional timezone').setStyle(TextInputStyle.Short).setRequired(true).setValue(timeValue),
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
        // Delete the 15-minute reminder message if it was sent
        if (tr.reminderMsgId) {
          const reminderMsg = await channel.messages.fetch(tr.reminderMsgId).catch(() => null);
          if (reminderMsg) await reminderMsg.delete().catch(() => {});
        }
      }

      deleteTraining(interaction.guildId, msgId);
      clearReminder(interaction.guildId, msgId);
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
        return interaction.reply({ content: '❌ Invalid date format. Use `DD/MM/YYYY HH:MM` and optionally add a timezone, like `28/05/2026 19:00 EST`, `UTC+10`, or `America/New_York`.', ephemeral: true });
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
        reminderSent:   false,
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
      scheduleTrainingReminder(interaction.client, interaction.guildId, msg.id, tr);
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
        return interaction.reply({ content: '❌ Invalid date format. Use `DD/MM/YYYY HH:MM` and optionally add a timezone, like `28/05/2026 19:00 EST`, `UTC+10`, or `America/New_York`.', ephemeral: true });
      }

      tr.title       = title;
      tr.description = description;
      tr.time        = parsedDate.getTime();
      tr.reminderSent = false;
      saveTraining(interaction.guildId, msgId, tr);
      scheduleTrainingReminder(interaction.client, interaction.guildId, msgId, tr);

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
