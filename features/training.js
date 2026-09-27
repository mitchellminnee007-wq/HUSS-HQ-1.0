const fs = require('node:fs');
const path = require('node:path');
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const { getConfig } = require('../utils/config');

const STORE_PATH                 = path.join(__dirname, '..', 'data', 'trainings.json');
const DEFAULT_TRAININGS_CHANNEL_ID = '1386239217998233660';
const OFFICER_RANKS              = ['Officer', 'Commander'];
const DEFAULT_TIME_ZONE           = 'Europe/Amsterdam';
const REMINDER_MS                 = 15 * 60 * 1000;
const MAX_TIMEOUT_MS              = 2 ** 31 - 1;
const reminderTimers              = new Map();
const QUALIFICATIONS = [
  { key: 'scout_plane', name: 'Qualified - Scout Plane', threshold: 3 },
  { key: 'fighter_plane', name: 'Qualified - Fighter Plane', threshold: 3, closed: true },
  { key: 'dive_bomber', name: 'Qualified - Dive Bomber', threshold: 3, closed: true },
  { key: 'paratrooper', name: 'Qualified - Paratrooper', threshold: 2, closed: true },
  { key: 'heavy_bomber', name: 'Qualified - Heavy Bomber', threshold: 4, closed: true },
  { key: 'tank_driver', name: 'Qualified - Tank Driver', threshold: 2 },
  { key: 'tank_gunner', name: 'Qualified - Tank Gunner', threshold: 2 },
  { key: 'heavy_tank', name: 'Qualified - Heavy Tank', threshold: 4 },
  { key: 'small_vessel', name: 'Qualified - Small Vessel', threshold: 3 },
  { key: 'large_vessel', name: 'Qualified - Large Vessel', threshold: 6, closed: true },
  { key: 'logistics', name: 'Qualified - Logistics', threshold: 2 },
  { key: 'facility_engineer', name: 'Qualified - Facility Engineer', threshold: 2 },
  { key: 'facility_worker', name: 'Qualified - Facility Worker', threshold: 2 },
  { key: 'artillery_spotter', name: 'Qualified - Artillery Spotter', threshold: 3 },
];
const QUALIFICATION_BY_KEY = new Map(QUALIFICATIONS.map(qualification => [qualification.key, qualification]));
const TRAINER_ROLE_ID = '1552000664912142447';
const TRAINING_REQUEST_THRESHOLD = 1;
const QUALIFICATION_ROLE_IDS = {
  scout_plane: '1475394015859048539',
  fighter_plane: '1523003566099267686',
  dive_bomber: '1484967015138594896',
  paratrooper: '1475394242628030637',
  heavy_bomber: '1485001900569919498',
  tank_driver: '1475394319404892220',
  tank_gunner: '1475430629066801214',
  heavy_tank: '1485002146142228652',
  small_vessel: '1475430659387293698',
  large_vessel: '1475430703050002544',
  logistics: '1475430732938612848',
  facility_engineer: '1475430778325434542',
  facility_worker: '1475431764976730144',
  artillery_spotter: '1475430814756900965',
};

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

function buildQualificationEmbed(board, guild) {
  return new EmbedBuilder()
    .setColor(0xF39C12)
    .setTitle('🎓  HUSS Qualification Training')
    .setDescription(
      '## How it works\n' +
      'Choose every qualification you want training for. You can change your choices at any time.\n\n' +
      '## When enough members sign up\n' +
      'A private discussion thread will open automatically so the selected members can agree on a date and time.\n\n' +
      '## Available qualifications'
    )
    .addFields(
      QUALIFICATIONS.map(qualification => {
        const signups = board.signups[qualification.key] ?? [];
        const threadStatus = board.threads[qualification.key] ? ' • thread opened' : '';
        const status = qualification.closed
          ? '**CLOSED**'
          : `\`${signups.length} signed up\`${threadStatus}`;
        const roleId = QUALIFICATION_ROLE_IDS[qualification.key];
        return {
          name: '\u200b',
          value: `${roleId ? `<@&${roleId}>` : qualification.name} ${status}`,
          inline: false,
        };
      })
    )
    .setFooter({ text: '⚔️ HUSS Command  •  Select a qualification below' })
    .setTimestamp(board.createdAt);
}

function buildQualificationRows(msgId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`tr_choose_qualifications:${msgId}`)
        .setLabel('Manage my applications')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Primary)
    ),
  ];
}

function buildPersonalQualificationRows(msgId, board, userId) {
  const selectedKeys = new Set(
    QUALIFICATIONS
      .filter(qualification => (board.signups[qualification.key] ?? []).some(member => member.id === userId))
      .map(qualification => qualification.key)
  );

  return [new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`tr_manage_qualifications:${msgId}`)
      .setPlaceholder('Update my qualifications')
      .setMinValues(0)
      .setMaxValues(QUALIFICATIONS.length)
      .addOptions(QUALIFICATIONS.map(qualification => ({
        label: qualification.name.replace('Qualified - ', ''),
        description: qualification.closed ? 'Currently closed' : 'Request training for this qualification',
        value: qualification.key,
        default: selectedKeys.has(qualification.key),
        disabled: qualification.closed,
      })))
  )];
}

async function refreshQualificationBoard(interaction, board, msgId) {
  const channel = interaction.guild.channels.cache.get(board.channelId)
    ?? await interaction.guild.channels.fetch(board.channelId).catch(() => null);
  if (!channel) return;
  const msg = await channel.messages.fetch(msgId).catch(() => null);
  if (msg) {
    await msg.edit({
      embeds: [buildQualificationEmbed(board, interaction.guild)],
      components: buildQualificationRows(msgId),
      allowedMentions: {
        roles: QUALIFICATIONS
          .map(qualification => QUALIFICATION_ROLE_IDS[qualification.key])
          .filter(Boolean),
      },
    }).catch(() => {});
  }
}

async function refreshStoredQualificationBoards(client) {
  const store = readStore();
  for (const [guildId, trainings] of Object.entries(store.guilds)) {
    const guild = client.guilds.cache.get(guildId)
      ?? await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) continue;

    for (const [msgId, board] of Object.entries(trainings)) {
      if (board.type !== 'qualification-board') continue;

      const channel = guild.channels.cache.get(board.channelId)
        ?? await guild.channels.fetch(board.channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) continue;

      const message = await channel.messages.fetch(msgId).catch(() => null);
      if (!message) continue;

      await message.edit({
        embeds: [buildQualificationEmbed(board, guild)],
        components: buildQualificationRows(msgId),
        allowedMentions: {
          roles: QUALIFICATIONS
            .map(qualification => QUALIFICATION_ROLE_IDS[qualification.key])
            .filter(Boolean),
        },
      }).catch(error => {
        console.error(`Could not refresh qualification board ${msgId}:`, error);
      });
    }
  }
}

async function openQualificationThread(interaction, board, qualification) {
  if (board.threads[qualification.key]) return;

  const channel = interaction.guild.channels.cache.get(board.channelId)
    ?? await interaction.guild.channels.fetch(board.channelId).catch(() => null);
  if (!channel) return;

  const thread = await channel.threads.create({
    name: qualification.name.slice(0, 100),
    type: ChannelType.PrivateThread,
    autoArchiveDuration: 10080,
    reason: `Qualification training discussion for ${qualification.name}`,
  }).catch(() => null);
  if (!thread) return;

  const signups = board.signups[qualification.key] ?? [];
  const userIds = signups.map(member => member.id);
  board.threads[qualification.key] = thread.id;

  for (const userId of userIds) {
    await thread.members.add(userId).catch(error => {
      console.error(`Could not add ${userId} to qualification thread ${thread.id}:`, error);
    });
  }

  await thread.send({
    content:
      `# ${qualification.name}\n\n` +
      `## Training group ready\n` +
      `🎓 Training has been requested by \`${signups.length}\` member${signups.length === 1 ? '' : 's'}.\n\n` +
      `## Next step\n` +
      `Please use this thread to agree on a date and time.\n\n` +
      `Need help or want to get a trainer's attention? Ping <@&${TRAINER_ROLE_ID}>.\n\n` +
      `## Members\n${userIds.map(id => `<@${id}>`).join(' ')}`,
    allowedMentions: { users: userIds, roles: [TRAINER_ROLE_ID] },
  }).catch(() => {});

}

async function updateQualificationThreadMember(interaction, board, qualification, userId, shouldHaveAccess) {
  const threadId = board.threads[qualification.key];
  if (!threadId) return;

  const thread = interaction.guild.channels.cache.get(threadId)
    ?? await interaction.guild.channels.fetch(threadId).catch(() => null);
  if (!thread || !thread.isThread()) return;

  if (shouldHaveAccess) {
    const signups = board.signups[qualification.key] ?? [];
    for (const member of signups) {
      await thread.members.add(member.id).catch(error => {
        console.error(`Could not add ${member.id} to qualification thread ${threadId}:`, error);
      });
    }
    return;
  }

  await thread.members.remove(userId).catch(error => {
    console.error(`Could not remove ${userId} from qualification thread ${threadId}:`, error);
  });
}

async function closeQualificationThread(interaction, board, qualification) {
  const threadId = board.threads[qualification.key];
  if (!threadId) return;

  const thread = interaction.guild.channels.cache.get(threadId)
    ?? await interaction.guild.channels.fetch(threadId).catch(() => null);
  if (thread?.isThread()) {
    await thread.setLocked(true, 'No applicants remain for this qualification').catch(error => {
      console.error(`Could not lock qualification thread ${threadId}:`, error);
    });
    await thread.setArchived(true, 'No applicants remain for this qualification').catch(error => {
      console.error(`Could not archive qualification thread ${threadId}:`, error);
    });
  }

  board.threads[qualification.key] = null;
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
    .setDescription('Post the qualification training signup board.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  init(client) {
    scheduleAllTrainingReminders(client);
    client.once('ready', () => {
      refreshStoredQualificationBoards(client);
    });
  },

  async execute(interaction) {
    if (!isOfficer(interaction.member)) {
      return interaction.reply({ content: 'Only Officers and Commanders can create trainings.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const channelId = getConfig(interaction.guildId, 'TRAININGS_CHANNEL_ID') ?? DEFAULT_TRAININGS_CHANNEL_ID;
    const channel = interaction.guild.channels.cache.get(channelId)
      ?? await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      return interaction.editReply('❌ Trainings channel not found. Set it with `/config set-channel`.');
    }

    const board = {
      type: 'qualification-board',
      createdBy: interaction.user.id,
      createdByName: interaction.member.displayName,
      createdAt: Date.now(),
      channelId: channel.id,
      signups: Object.fromEntries(QUALIFICATIONS.map(qualification => [qualification.key, []])),
      threads: {},
    };
    const msg = await channel.send({
      embeds: [buildQualificationEmbed(board, interaction.guild)],
      allowedMentions: {
        roles: QUALIFICATIONS
          .map(qualification => QUALIFICATION_ROLE_IDS[qualification.key])
          .filter(Boolean),
      },
    });
    await msg.edit({
      embeds: [buildQualificationEmbed(board, interaction.guild)],
      components: buildQualificationRows(msg.id),
      allowedMentions: {
        roles: QUALIFICATIONS
          .map(qualification => QUALIFICATION_ROLE_IDS[qualification.key])
          .filter(Boolean),
      },
    });
    saveTraining(interaction.guildId, msg.id, board);

    return interaction.editReply(`✅ Qualification signup board posted in ${channel}.`);
  },

  // ── Button interactions ─────────────────────────────────────────────────────
  async handleButton(interaction) {
    const [action, msgId, qualificationKey] = interaction.customId.split(':');
    const tr = getTraining(interaction.guildId, msgId);

    if (!tr) return interaction.reply({ content: 'This training no longer exists.', ephemeral: true });

    if (action === 'tr_choose_qualifications' || action === 'tr_my_qualifications') {
      if (tr.type !== 'qualification-board') {
        return interaction.reply({ content: 'This is not a qualification signup board.', ephemeral: true });
      }
      return interaction.reply({
        content: 'Your current qualifications are checked. Select the qualifications you want to keep, then submit.',
        components: buildPersonalQualificationRows(msgId, tr, interaction.user.id),
        ephemeral: true,
      });
    }

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

  // ── Qualification select menu interactions ────────────────────────────────
  async handleSelect(interaction) {
    const [action, msgId] = interaction.customId.split(':');
    if (action !== 'tr_qualify' && action !== 'tr_manage_qualifications') return;

    const tr = getTraining(interaction.guildId, msgId);
    const qualifications = interaction.values
      .map(value => QUALIFICATION_BY_KEY.get(value))
      .filter(Boolean);
    if (!tr || tr.type !== 'qualification-board' || qualifications.length !== interaction.values.length) {
      return interaction.reply({ content: 'This qualification signup is no longer available.', ephemeral: true });
    }

    if (action === 'tr_manage_qualifications') {
      const selectedKeys = new Set(interaction.values);
      const added = [];
      const removed = [];
      for (const qualification of QUALIFICATIONS) {
        const signups = tr.signups[qualification.key] ?? [];
        const alreadySignedUp = signups.some(member => member.id === interaction.user.id);
        const shouldBeSignedUp = !qualification.closed && selectedKeys.has(qualification.key);
        if (alreadySignedUp === shouldBeSignedUp) continue;

        tr.signups[qualification.key] = shouldBeSignedUp
          ? [...signups, { id: interaction.user.id, name: interaction.member.displayName }]
          : signups.filter(member => member.id !== interaction.user.id);
        (shouldBeSignedUp ? added : removed).push(qualification.name);

        if (shouldBeSignedUp
          && tr.signups[qualification.key].length >= TRAINING_REQUEST_THRESHOLD
          && !tr.threads[qualification.key]) {
          await openQualificationThread(interaction, tr, qualification);
        }
        await updateQualificationThreadMember(
          interaction,
          tr,
          qualification,
          interaction.user.id,
          shouldBeSignedUp
        );
        if (!shouldBeSignedUp && tr.signups[qualification.key].length === 0) {
          await closeQualificationThread(interaction, tr, qualification);
        }
      }

      saveTraining(interaction.guildId, msgId, tr);
      await refreshQualificationBoard(interaction, tr, msgId);
      return interaction.update({
        content: [
          added.length ? `Signed you up for: ${added.map(name => `**${name}**`).join(', ')}.` : '',
          removed.length ? `Removed your signup from: ${removed.map(name => `**${name}**`).join(', ')}.` : '',
          !added.length && !removed.length ? 'No changes made.' : '',
        ].filter(Boolean).join('\n'),
        components: buildPersonalQualificationRows(msgId, tr, interaction.user.id),
      });
    }

    const added = [];
    const removed = [];
    for (const qualification of qualifications) {
      if (qualification.closed) {
        removed.push(`${qualification.name} is closed`);
        continue;
      }
      const signups = tr.signups[qualification.key] ?? [];
      const alreadySignedUp = signups.some(member => member.id === interaction.user.id);
      tr.signups[qualification.key] = alreadySignedUp
        ? signups.filter(member => member.id !== interaction.user.id)
        : [...signups, { id: interaction.user.id, name: interaction.member.displayName }];

      const updatedSignups = tr.signups[qualification.key];
      if (alreadySignedUp) {
        removed.push(qualification.name);
      } else {
        added.push(qualification.name);
        if (updatedSignups.length >= TRAINING_REQUEST_THRESHOLD && !tr.threads[qualification.key]) {
          await openQualificationThread(interaction, tr, qualification);
        }
      }
      await updateQualificationThreadMember(
        interaction,
        tr,
        qualification,
        interaction.user.id,
        !alreadySignedUp
      );
      if (alreadySignedUp && tr.signups[qualification.key].length === 0) {
        await closeQualificationThread(interaction, tr, qualification);
      }
    }

    saveTraining(interaction.guildId, msgId, tr);
    await refreshQualificationBoard(interaction, tr, msgId);
    return interaction.reply({
      content: [
        added.length ? `Signed you up for: ${added.map(name => `**${name}**`).join(', ')}.` : '',
        removed.length ? `Removed your signup from: ${removed.map(name => `**${name}**`).join(', ')}.` : '',
      ].filter(Boolean).join('\n'),
      ephemeral: true,
    });
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
