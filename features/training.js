const fs = require('../utils/data-fs');
const path = require('node:path');
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
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
const qualificationThreadTasks     = new Map();
const QUALIFICATIONS = [
  { key: 'scout_plane', name: 'Qualified - Scout Plane', closed: false },
  { key: 'fighter_plane', name: 'Qualified - Fighter Plane', closed: true },
  { key: 'dive_bomber', name: 'Qualified - Dive Bomber', closed: true },
  { key: 'paratrooper', name: 'Qualified - Paratrooper', closed: true },
  { key: 'heavy_bomber', name: 'Qualified - Heavy Bomber', closed: true },
  { key: 'tank_driver', name: 'Qualified - Tank Driver', closed: false },
  { key: 'tank_gunner', name: 'Qualified - Tank Gunner', closed: false },
  { key: 'heavy_tank', name: 'Qualified - Heavy Tank', closed: true },
  { key: 'small_vessel', name: 'Qualified - Small Vessel', closed: false },
  { key: 'large_vessel', name: 'Qualified - Large Vessel', closed: true },
  { key: 'logistics', name: 'Qualified - Logistics', closed: false },
  { key: 'facility_engineer', name: 'Qualified - Facility Engineer', closed: false },
  { key: 'facility_worker', name: 'Qualified - Facility Worker', closed: false },
  { key: 'artillery_spotter', name: 'Qualified - Artillery Spotter', closed: false },
];
const QUALIFICATION_BY_KEY = new Map(QUALIFICATIONS.map(qualification => [qualification.key, qualification]));
const TRAINER_ROLE_ID = '1552000664912142447';
const TRAINER_ROLE_IDS = {
  scout_plane: TRAINER_ROLE_ID,
  fighter_plane: TRAINER_ROLE_ID,
  dive_bomber: TRAINER_ROLE_ID,
  paratrooper: TRAINER_ROLE_ID,
  heavy_bomber: TRAINER_ROLE_ID,
  tank_driver: '1552027850008174612',
  tank_gunner: '1552027850008174612',
  heavy_tank: '1552027850008174612',
  small_vessel: '1553871532407922728',
  large_vessel: '1553871532407922728',
  logistics: '1552027929708597350',
  facility_engineer: '1552027406624100422',
  facility_worker: '1552027406624100422',
  artillery_spotter: '1553871623189172355',
};
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
const QUALIFICATION_PREREQUISITES = {
  fighter_plane: ['scout_plane'],
  dive_bomber: ['scout_plane'],
  paratrooper: ['fighter_plane'],
  heavy_bomber: ['fighter_plane'],
  heavy_tank: ['tank_driver', 'tank_gunner'],
  facility_engineer: ['facility_worker'],
};

// ── Store helpers ─────────────────────────────────────────────────────────────
function readStore() {
  if (!fs.existsSync(STORE_PATH)) return { guilds: {} };
  const data=JSON.parse(fs.readFileSync(STORE_PATH,'utf8'));
  for(const [guildId,records] of Object.entries(data.guilds||{}))for(const record of Object.values(records))record.guildId=guildId;
  return data;
}

function writeStore(data) {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STORE_PATH+'.tmp', JSON.stringify(data, null, 2));
  fs.renameSync(STORE_PATH+'.tmp',STORE_PATH);
}

function normalizeTraining(training) {
  if (!training || typeof training !== 'object') return null;

  training.attendees ??= {};
  for (const key of ['accepted', 'declined', 'tentative']) {
    if (!Array.isArray(training.attendees[key])) training.attendees[key] = [];
  }

  if (training.type === 'qualification-board') {
    if (!training.signups || typeof training.signups !== 'object') training.signups = {};
    if (!training.threads || typeof training.threads !== 'object') training.threads = {};
    for (const qualification of QUALIFICATIONS) {
      if (!Array.isArray(training.signups[qualification.key])) training.signups[qualification.key] = [];
      training.threads[qualification.key] ??= null;
    }
  }

  return training;
}

function getTraining(guildId, msgId) {
  return normalizeTraining(readStore().guilds[guildId]?.[msgId]);
}

function saveTraining(guildId, msgId, data) {
  data.guildId=guildId;
  const store = readStore();
  if (!store.guilds[guildId]) store.guilds[guildId] = {};
  if(!store.guilds[guildId][msgId]&&data.type!=='qualification-board')require('../utils/war-context').tag(guildId,data);
  store.guilds[guildId][msgId] = data;
  writeStore(store);
}

function getQualificationThreadId(guildId, qualificationKey) {
  return readStore().qualificationThreads?.[guildId]?.[qualificationKey] ?? null;
}

function saveQualificationThreadId(guildId, qualificationKey, threadId) {
  const store = readStore();
  store.qualificationThreads ??= {};
  store.qualificationThreads[guildId] ??= {};
  store.qualificationThreads[guildId][qualificationKey] = threadId;
  writeStore(store);
}

function clearQualificationThreadReferences(guildId, qualificationKey, threadIds) {
  const store = readStore();
  const staleIds = new Set(threadIds);
  const guildThreadIds = store.qualificationThreads?.[guildId];
  if (guildThreadIds?.[qualificationKey] && staleIds.has(guildThreadIds[qualificationKey])) {
    delete guildThreadIds[qualificationKey];
  }

  for (const training of Object.values(store.guilds?.[guildId] ?? {})) {
    if (training.type === 'qualification-board'
      && training.threads?.[qualificationKey]
      && staleIds.has(training.threads[qualificationKey])) {
      training.threads[qualificationKey] = null;
    }
  }
  writeStore(store);
}

function isUnknownChannelError(error) {
  return Number(error?.code ?? error?.rawError?.code) === 10003;
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

function isTimedTraining(training) {
  return training
    && training.type !== 'qualification-board'
    && typeof training.title === 'string'
    && Number.isFinite(training.time);
}

const reminderSending=new Set();
async function sendTrainingReminder(client,guildId,msgId,tr) {
 const key=guildId+':'+msgId;if(reminderSending.has(key))return;reminderSending.add(key);
 try {await deliverTrainingReminder(client,guildId,msgId,tr);}
 catch {require('../utils/health').record('notification_failure',0,guildId);}
 finally {reminderSending.delete(key);}
}
async function deliverTrainingReminder(client, guildId, msgId, tr) {
  tr = normalizeTraining(tr);
  if (!isTimedTraining(tr)) return;
  if (tr.reminderSent || require('../utils/maintenance').active(guildId,'training')) return;

  const notifications=require('../utils/member-notifications');
  const acceptedIds = tr.attendees.accepted.map(member => member.id).filter(id=>notifications.mode(guildId,id,'training')==='channel').slice(0,75);
  const channel = await client.channels.fetch(tr.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

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

  await notifications.eventDMs(client,guildId,msgId,tr,'training');

  // Store the reminder message ID so it can be cleaned up when the training is deleted
  if (reminderMsg) {
    const current=getTraining(guildId,msgId);
    if(current&&current.time===tr.time){current.reminderSent = true;current.reminderMsgId = reminderMsg.id;saveTraining(guildId, msgId, current);}
  }
}

function scheduleTrainingReminder(client, guildId, msgId, tr) {
  clearReminder(guildId, msgId);

  if (!isTimedTraining(tr) || tr.reminderSent) return;

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

const { isOfficer } = require('../utils/ranks');

function getTrainerRoleId(qualificationKey) {
  return TRAINER_ROLE_IDS[qualificationKey] ?? TRAINER_ROLE_ID;
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

function buildQualificationEmbed(board, replaced = false) {
  return new EmbedBuilder()
    .setColor(0xF39C12)
    .setTitle('🎓  HUSS Qualification Training')
    .setDescription(replaced
      ? 'This board has been replaced. Use the latest qualification board to manage your applications.'
      : '## How it works\n' +
        'Choose every qualification you want training for. You can change your choices at any time.\n\n' +
        '## Qualification discussion threads\n' +
        'Each qualification has a dedicated private thread. Signing up adds you to it; removing your signup removes you from it.\n\n' +
        '## Available qualifications'
    )
    .addFields(
      QUALIFICATIONS.map(qualification => {
        const signups = board.signups[qualification.key] ?? [];
        const threadStatus = board.threads[qualification.key] ? ' • dedicated thread' : '';
        const status = qualification.closed
          ? '**CLOSED**'
          : `\`${signups.length} signed up\`${threadStatus}`;
        const roleId = getConfig(board.guildId,`QUALIFICATION_${qualification.key.toUpperCase()}_ROLE_ID`) || QUALIFICATION_ROLE_IDS[qualification.key];
        return {
          name: '\u200b',
          value: `${roleId ? `<@&${roleId}>` : qualification.name} ${status}`,
          inline: false,
        };
      })
    )
    .setFooter({
      text: replaced
        ? '⚔️ HUSS Command  •  Replaced by a newer qualification board'
        : '⚔️ HUSS Command  •  Select a qualification below'
    })
    .setTimestamp(board.createdAt);
}

function buildQualificationRows(msgId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`tr_choose_qualifications:${msgId}`)
        .setLabel('Manage my applications')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`tr_manage_member_applications:${msgId}`)
        .setLabel('Remove member applications')
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function getMissingQualificationPrerequisites(member, qualificationKey) {
  return (QUALIFICATION_PREREQUISITES[qualificationKey] ?? [])
    .filter(key => !require('../utils/qualifications').qualified(member,key))
    .map(key => QUALIFICATION_BY_KEY.get(key));
}

function buildPersonalQualificationRows(msgId, board, member) {
  const userId = member.id;
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
      .addOptions(QUALIFICATIONS.map(qualification => {
        const missingPrerequisites = getMissingQualificationPrerequisites(member, qualification.key);
        const isSelected = selectedKeys.has(qualification.key);
        const requirement = missingPrerequisites
          .map(prerequisite => prerequisite.name.replace('Qualified - ', ''))
          .join(' and ');
        return {
          label: qualification.name.replace('Qualified - ', ''),
          description: qualification.closed
            ? 'Currently closed'
            : requirement && !isSelected
              ? `Requires ${requirement} qualification`
              : 'Request training for this qualification',
          value: qualification.key,
          default: isSelected,
          disabled: qualification.closed || (missingPrerequisites.length > 0 && !isSelected),
        };
      }))
  )];
}

async function refreshQualificationBoard(interaction, board, msgId) {
  for (const qualification of QUALIFICATIONS) {
    if (qualification.closed) {
      await clearQualificationSignups(interaction.guild, board, qualification);
    }
  }
  saveTraining(interaction.guildId, msgId, board);

  const channel = interaction.guild.channels.cache.get(board.channelId)
    ?? await interaction.guild.channels.fetch(board.channelId).catch(() => null);
  if (!channel) return;
  const msg = await channel.messages.fetch(msgId).catch(() => null);
  if (msg) {
    await msg.edit({
      embeds: [buildQualificationEmbed(board)],
      components: buildQualificationRows(msgId),
      allowedMentions: {
        roles: QUALIFICATIONS
          .map(qualification => getConfig(board.guildId,`QUALIFICATION_${qualification.key.toUpperCase()}_ROLE_ID`) || QUALIFICATION_ROLE_IDS[qualification.key])
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
      normalizeTraining(board);

      for (const qualification of QUALIFICATIONS) {
        await ensureQualificationThread(guild, board, qualification);
      }
      for (const qualification of QUALIFICATIONS) {
        if (qualification.closed) {
          await clearQualificationSignups(guild, board, qualification);
        } else {
          for (const member of board.signups[qualification.key]) {
            await updateQualificationThreadMember(guild, board, qualification, member.id, true);
          }
        }
      }
      saveTraining(guildId, msgId, board);

      const channel = guild.channels.cache.get(board.channelId)
        ?? await guild.channels.fetch(board.channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) continue;

      const message = await channel.messages.fetch(msgId).catch(() => null);
      if (!message) continue;

      await message.edit({
        embeds: [buildQualificationEmbed(board)],
        components: buildQualificationRows(msgId),
        allowedMentions: {
          roles: QUALIFICATIONS
            .map(qualification => getConfig(board.guildId,`QUALIFICATION_${qualification.key.toUpperCase()}_ROLE_ID`) || QUALIFICATION_ROLE_IDS[qualification.key])
            .filter(Boolean),
        },
      }).catch(error => {
        console.error(`Could not refresh qualification board ${msgId}:`, error);
      });
    }
  }
}

async function ensureQualificationThread(guild, board, qualification, { createIfMissing = false } = {}) {
  const taskKey = `${guild.id}:${qualification.key}`;
  const existingTask = qualificationThreadTasks.get(taskKey);
  if (existingTask) {
    const thread = await existingTask;
    if (thread) board.threads[qualification.key] = thread.id;
    return thread;
  }

  const task = findQualificationThread(guild, board, qualification, createIfMissing);
  qualificationThreadTasks.set(taskKey, task);
  try {
    return await task;
  } finally {
    if (qualificationThreadTasks.get(taskKey) === task) {
      qualificationThreadTasks.delete(taskKey);
    }
  }
}

async function findQualificationThread(guild, board, qualification, createIfMissing) {
  const store = readStore();
  const otherBoards = Object.values(store.guilds?.[guild.id] ?? {});
  const storedThreadIds = [
    getQualificationThreadId(guild.id, qualification.key),
    board.threads[qualification.key],
    ...otherBoards
      .filter(training => training.type === 'qualification-board')
      .map(training => training.threads?.[qualification.key]),
  ].filter((threadId, index, ids) => threadId && ids.indexOf(threadId) === index);
  const staleThreadIds = [];
  let lookupFailed = false;

  for (const threadId of storedThreadIds) {
    let thread;
    try {
      thread = await guild.channels.fetch(threadId, { force: true });
    } catch (error) {
      if (isUnknownChannelError(error)) {
        staleThreadIds.push(threadId);
      } else {
        console.error(`Could not fetch qualification thread ${threadId}:`, error);
        lookupFailed = true;
      }
      continue;
    }
    if (!thread?.isThread() || thread.type !== ChannelType.PrivateThread) {
      if (thread?.isThread()) {
        console.error(`Qualification thread ${thread.id} is not private; it cannot be used as a qualification thread.`);
      }
      staleThreadIds.push(threadId);
      continue;
    }

    if(thread.invitable !== false) await thread.setInvitable(false, 'Disabling member invites to qualification thread').catch(error => {
      console.error(`Could not disable member invites for qualification thread ${thread.id}:`, error);
    });
    board.threads[qualification.key] = thread.id;
    saveQualificationThreadId(guild.id, qualification.key, thread.id);
    return thread;
  }

  if (staleThreadIds.length) {
    clearQualificationThreadReferences(guild.id, qualification.key, staleThreadIds);
    if (staleThreadIds.includes(board.threads[qualification.key])) {
      board.threads[qualification.key] = null;
    }
  }
  if (lookupFailed) {
    return null;
  }
  if (!createIfMissing) {
    return null;
  }

  const channel = guild.channels.cache.get(board.channelId)
    ?? await guild.channels.fetch(board.channelId).catch(error => {
      console.error(`Could not fetch qualification channel ${board.channelId}:`, error);
      return null;
    });
  if (!channel) return null;

  const thread = await channel.threads.create({
    name: qualification.name.slice(0, 100),
    type: ChannelType.PrivateThread,
    invitable: false,
    autoArchiveDuration: 10080,
    reason: `Base qualification thread for ${qualification.name}`,
  }).catch(error => {
    console.error(`Could not create qualification thread for ${qualification.name}:`, error);
    return null;
  });
  if (!thread) return null;

  const signups = board.signups[qualification.key] ?? [];
  const trainerRoleId = getTrainerRoleId(qualification.key);
  board.threads[qualification.key] = thread.id;
  saveQualificationThreadId(guild.id, qualification.key, thread.id);

  for (const member of signups) {
    await thread.members.add(member.id).catch(error => {
      console.error(`Could not add ${member.id} to qualification thread ${thread.id}:`, error);
    });
  }

  await thread.send({
    content:
      `# ${qualification.name}\n\n` +
      `This is the discussion thread for members signed up for this qualification. ` +
      `Use the signup board to join or leave this thread.\n\n` +
      `Agree on a training date and time here. For help, mention <@&${trainerRoleId}>.`,
    allowedMentions: { parse: [] },
  }).catch(error => {
    console.error(`Could not post in qualification thread ${thread.id}:`, error);
  });
  return thread;
}

async function clearPreviousQualificationBoards(guild, board, newMsgId) {
  const store = readStore();
  const oldBoards = Object.entries(store.guilds?.[guild.id] ?? {})
    .filter(([msgId, training]) => msgId !== newMsgId && training.type === 'qualification-board');

  for (const qualification of QUALIFICATIONS) {
    const memberIds = new Set(
      oldBoards.flatMap(([, training]) =>
        (training.signups?.[qualification.key] ?? []).map(member => member.id)
      )
    );
    for (const userId of memberIds) {
      await updateQualificationThreadMember(guild, board, qualification, userId, false);
    }
  }

  for (const [msgId, training] of oldBoards) {
    const channel = guild.channels.cache.get(training.channelId)
      ?? await guild.channels.fetch(training.channelId).catch(error => {
        console.error(`Could not fetch replaced qualification board channel ${training.channelId}:`, error);
        return null;
      });
    if (!channel?.isTextBased()) continue;

    const message = await channel.messages.fetch(msgId).catch(error => {
      console.error(`Could not fetch replaced qualification board ${msgId}:`, error);
      return null;
    });
    if (!message) continue;

    const replacedBoard = normalizeTraining({
      ...training,
      signups: Object.fromEntries(QUALIFICATIONS.map(qualification => [qualification.key, []])),
    });
    await message.edit({
      embeds: [buildQualificationEmbed(replacedBoard, true)],
      components: [],
    }).catch(error => {
      console.error(`Could not mark qualification board ${msgId} as replaced:`, error);
    });
  }

  const updatedStore = readStore();
  const guildTrainings = updatedStore.guilds?.[guild.id] ?? {};
  for (const [msgId, training] of Object.entries(guildTrainings)) {
    if (msgId !== newMsgId && training.type === 'qualification-board') {
      delete guildTrainings[msgId];
    }
  }
  guildTrainings[newMsgId] = board;
  updatedStore.guilds[guild.id] = guildTrainings;
  writeStore(updatedStore);
}

async function updateQualificationThreadMember(guild, board, qualification, userId, shouldHaveAccess) {
  const thread = await ensureQualificationThread(guild, board, qualification);
  if (!thread) return;
  const threadId = thread.id;

  if (thread.locked) {
    await thread.setLocked(false, 'Reopening base qualification thread').catch(error => {
      console.error(`Could not unlock qualification thread ${threadId}:`, error);
    });
  }
  if (thread.archived) {
    await thread.setArchived(false, 'Updating qualification thread membership').catch(error => {
      console.error(`Could not unarchive qualification thread ${threadId}:`, error);
    });
  }

  if (shouldHaveAccess) {
    await thread.members.add(userId).catch(error => {
      console.error(`Could not add ${userId} to qualification thread ${threadId}:`, error);
    });
  } else {
    await thread.members.remove(userId).catch(error => {
      console.error(`Could not remove ${userId} from qualification thread ${threadId}:`, error);
    });
  }
}

async function clearQualificationSignups(guild, board, qualification) {
  const signups = board.signups[qualification.key] ?? [];
  board.signups[qualification.key] = [];

  if (!board.threads[qualification.key]) return;
  for (const member of signups) {
    await updateQualificationThreadMember(guild, board, qualification, member.id, false);
  }
}

async function cleanupQualificationThreads(guild, channel, apply = false) {
  if (!channel || channel.guildId !== guild.id || channel.type !== ChannelType.GuildText) {
    throw new Error('Qualification cleanup requires a text channel from the target guild.');
  }

  const [activeThreads, archivedPublic, archivedPrivate] = await Promise.all([
    channel.threads.fetchActive(),
    channel.threads.fetchArchived({ type: 'public', fetchAll: true }),
    channel.threads.fetchArchived({ type: 'private', fetchAll: true }),
  ]);
  const threads = new Map();
  for (const collection of [activeThreads.threads, archivedPublic.threads, archivedPrivate.threads]) {
    for (const [threadId, thread] of collection) threads.set(threadId, thread);
  }

  const qualificationByName = new Map(QUALIFICATIONS.map(qualification => [qualification.name, qualification]));
  const candidatesByKey = new Map(QUALIFICATIONS.map(qualification => [qualification.key, []]));
  for (const thread of threads.values()) {
    if (thread.parentId !== channel.id) continue;
    const qualification = qualificationByName.get(thread.name);
    if (qualification) candidatesByKey.get(qualification.key).push(thread);
  }

  const store = readStore();
  const boards = Object.values(store.guilds?.[guild.id] ?? {})
    .filter(training => training.type === 'qualification-board');
  const deleted = [];
  const failed = [];
  const kept = [];

  for (const qualification of QUALIFICATIONS) {
    const candidates = candidatesByKey.get(qualification.key);
    if (!candidates.length) continue;

    const savedThreadIds = new Set([
      getQualificationThreadId(guild.id, qualification.key),
      ...boards.map(board => board.threads?.[qualification.key]),
    ].filter(Boolean));
    const keeper = candidates.find(thread => savedThreadIds.has(thread.id))
      ?? candidates.sort((a, b) => (a.createdTimestamp ?? 0) - (b.createdTimestamp ?? 0))[0];
    if (apply) saveQualificationThreadId(guild.id, qualification.key, keeper.id);
    kept.push(keeper);

    for (const thread of candidates) {
      if (thread.id === keeper.id || thread.archived) continue;
      try {
        if (apply) await thread.setArchived(true, 'Archiving duplicate qualification thread');
        deleted.push(thread);
      } catch (error) {
        console.error(`Could not delete duplicate qualification thread ${thread.id}:`, error);
        failed.push(thread);
      }
    }
  }

  return { scanned: threads.size, kept, deleted, failed };
}

async function clearQualificationApplications(guild, apply = false) {
  const store = readStore();
  const boards = Object.entries(store.guilds?.[guild.id] ?? {})
    .filter(([, training]) => training.type === 'qualification-board');
  if (!apply) return { applicationsRemoved: boards.reduce((sum, [, board]) => sum + Object.values(board.signups || {}).reduce((n, members) => n + (Array.isArray(members) ? members.length : 0), 0), 0), threadRemovalFailures: 0 };
  let applicationsRemoved = 0;
  let threadRemovalFailures = 0;

  for (const qualification of QUALIFICATIONS) {
    const memberIds = new Set();
    const threadIds = new Set([
      getQualificationThreadId(guild.id, qualification.key),
      ...boards.map(([, board]) => board.threads?.[qualification.key]),
    ].filter(Boolean));

    for (const [, board] of boards) {
      board.signups ??= {};
      const signups = Array.isArray(board.signups[qualification.key])
        ? board.signups[qualification.key]
        : [];
      applicationsRemoved += signups.length;
      for (const member of signups) memberIds.add(member.id);
      board.signups[qualification.key] = [];
    }

    if (!memberIds.size) continue;
    for (const threadId of threadIds) {
      let thread;
      try {
        thread = await guild.channels.fetch(threadId, { force: true });
      } catch (error) {
        if (!isUnknownChannelError(error)) {
          console.error(`Could not fetch qualification thread ${threadId} while clearing applications:`, error);
          threadRemovalFailures += memberIds.size;
        }
        continue;
      }
      if (!thread?.isThread()) continue;

      for (const userId of memberIds) {
        try {
          await thread.members.remove(userId, 'Clearing qualification applications');
        } catch (error) {
          console.error(`Could not remove ${userId} from qualification thread ${threadId}:`, error);
          threadRemovalFailures += 1;
        }
      }
    }
  }

  writeStore(store);

  for (const [msgId, board] of boards) {
    const channel = guild.channels.cache.get(board.channelId)
      ?? await guild.channels.fetch(board.channelId).catch(error => {
        console.error(`Could not fetch qualification board channel ${board.channelId}:`, error);
        return null;
      });
    if (!channel?.isTextBased()) continue;

    const message = await channel.messages.fetch(msgId).catch(error => {
      console.error(`Could not fetch qualification board ${msgId}:`, error);
      return null;
    });
    if (!message) continue;

    await message.edit({
      embeds: [buildQualificationEmbed(board)],
      components: buildQualificationRows(msgId),
      allowedMentions: {
        roles: QUALIFICATIONS
          .map(qualification => getConfig(board.guildId,`QUALIFICATION_${qualification.key.toUpperCase()}_ROLE_ID`) || QUALIFICATION_ROLE_IDS[qualification.key])
          .filter(Boolean),
      },
    }).catch(error => {
      console.error(`Could not refresh qualification board ${msgId} after clearing applications:`, error);
    });
  }

  return { applicationsRemoved, threadRemovalFailures };
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
  QUALIFICATIONS,
  QUALIFICATION_ROLE_IDS,
  cleanupQualificationThreads,
  clearQualificationApplications,

  data: new SlashCommandBuilder()
    .setName('training')
    .setDescription('Post a fresh qualification board, replacing the previous board and applications.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  init(client) {
    if(client.isReady())scheduleAllTrainingReminders(client);else client.once('clientReady',()=>scheduleAllTrainingReminders(client));
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
      guildId: interaction.guildId,
      type: 'qualification-board',
      createdBy: interaction.user.id,
      createdByName: interaction.member.displayName,
      createdAt: Date.now(),
      channelId: channel.id,
      signups: Object.fromEntries(QUALIFICATIONS.map(qualification => [qualification.key, []])),
      threads: {},
    };
    const msg = await channel.send({
      embeds: [buildQualificationEmbed(board)],
      allowedMentions: {
        roles: QUALIFICATIONS
          .map(qualification => getConfig(board.guildId,`QUALIFICATION_${qualification.key.toUpperCase()}_ROLE_ID`) || QUALIFICATION_ROLE_IDS[qualification.key])
          .filter(Boolean),
      },
    });
    await msg.edit({
      embeds: [buildQualificationEmbed(board)],
      components: buildQualificationRows(msg.id),
      allowedMentions: {
        roles: QUALIFICATIONS
          .map(qualification => getConfig(board.guildId,`QUALIFICATION_${qualification.key.toUpperCase()}_ROLE_ID`) || QUALIFICATION_ROLE_IDS[qualification.key])
          .filter(Boolean),
      },
    });
    await clearPreviousQualificationBoards(interaction.guild, board, msg.id);
    for (const qualification of QUALIFICATIONS) {
      await ensureQualificationThread(interaction.guild, board, qualification, { createIfMissing: true });
    }
    saveTraining(interaction.guildId, msg.id, board);

    return interaction.editReply(`✅ Qualification signup board posted in ${channel}.`);
  },

  // ── Button interactions ─────────────────────────────────────────────────────
  async handleButton(interaction) {
    const [action, msgId] = interaction.customId.split(':');
    const tr = getTraining(interaction.guildId, msgId);

    if (!tr) return interaction.reply({ content: 'This training no longer exists.', ephemeral: true });

    if (action === 'tr_choose_qualifications' || action === 'tr_my_qualifications') {
      if (tr.type !== 'qualification-board') {
        return interaction.reply({ content: 'This is not a qualification signup board.', ephemeral: true });
      }
      return interaction.reply({
        content: 'Your current qualifications are checked. Select the qualifications you want to keep, then submit.',
        components: buildPersonalQualificationRows(msgId, tr, interaction.member),
        ephemeral: true,
      });
    }

    if (action === 'tr_manage_member_applications') {
      if (!isOfficer(interaction.member)) {
        return interaction.reply({ content: 'Only Officers and Commanders can remove member applications.', ephemeral: true });
      }
      if (tr.type !== 'qualification-board') {
        return interaction.reply({ content: 'This is not a qualification signup board.', ephemeral: true });
      }

      return interaction.reply({
        content: 'Choose the member whose applications you want to remove.',
        components: [
          new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
              .setCustomId(`tr_member_app_target:${msgId}`)
              .setPlaceholder('Select a member')
              .setMinValues(1)
              .setMaxValues(1)
          ),
        ],
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
    if (action === 'tr_member_app_target') {
      if (!isOfficer(interaction.member)) {
        return interaction.update({
          content: 'Only Officers and Commanders can remove member applications.',
          components: [],
        });
      }

      const tr = getTraining(interaction.guildId, msgId);
      if (!tr || tr.type !== 'qualification-board') {
        return interaction.update({ content: 'This qualification signup board is no longer available.', components: [] });
      }

      const targetId = interaction.values[0];
      const applications = QUALIFICATIONS.filter(qualification =>
        (tr.signups[qualification.key] ?? []).some(member => member.id === targetId)
      );
      if (!applications.length) {
        return interaction.update({
          content: 'That member has no applications on this board.',
          components: [],
        });
      }

      return interaction.update({
        content: `Select the applications to remove for <@${targetId}>.`,
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`tr_remove_member_applications:${msgId}:${targetId}`)
              .setPlaceholder('Select applications to remove')
              .setMinValues(1)
              .setMaxValues(applications.length)
              .addOptions(applications.map(qualification => ({
                label: qualification.name.replace('Qualified - ', ''),
                value: qualification.key,
              })))
          ),
        ],
      });
    }

    if (action === 'tr_remove_member_applications') {
      if (!isOfficer(interaction.member)) {
        return interaction.update({
          content: 'Only Officers and Commanders can remove member applications.',
          components: [],
        });
      }

      const targetId = interaction.customId.split(':')[2];
      const tr = getTraining(interaction.guildId, msgId);
      if (!tr || tr.type !== 'qualification-board') {
        return interaction.update({ content: 'This qualification signup board is no longer available.', components: [] });
      }

      const removed = [];
      for (const key of interaction.values) {
        const qualification = QUALIFICATION_BY_KEY.get(key);
        if (!qualification) continue;
        const signups = tr.signups[qualification.key] ?? [];
        if (!signups.some(member => member.id === targetId)) continue;

        tr.signups[qualification.key] = signups.filter(member => member.id !== targetId);
        removed.push(qualification.name);
        await updateQualificationThreadMember(
          interaction.guild,
          tr,
          qualification,
          targetId,
          false
        );
      }

      if (removed.length) {
        saveTraining(interaction.guildId, msgId, tr);
        await refreshQualificationBoard(interaction, tr, msgId);
      }
      return interaction.update({
        content: removed.length
          ? `Removed <@${targetId}> from: ${removed.map(name => `**${name}**`).join(', ')}.`
          : 'No applications were removed; the member may no longer be signed up.',
        components: [],
      });
    }

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
      const blocked = [];
      for (const qualification of QUALIFICATIONS) {
        const signups = tr.signups[qualification.key] ?? [];
        const alreadySignedUp = signups.some(member => member.id === interaction.user.id);
        const shouldBeSignedUp = !qualification.closed && selectedKeys.has(qualification.key);
        if (alreadySignedUp === shouldBeSignedUp) continue;

        if (shouldBeSignedUp) {
          const missingPrerequisites = getMissingQualificationPrerequisites(interaction.member, qualification.key);
          if (missingPrerequisites.length) {
            blocked.push(
              `**${qualification.name}** requires ${missingPrerequisites.map(required => `**${required.name}**`).join(' and ')}.`
            );
            continue;
          }
        }

        tr.signups[qualification.key] = shouldBeSignedUp
          ? [...signups, { id: interaction.user.id, name: interaction.member.displayName }]
          : signups.filter(member => member.id !== interaction.user.id);
        (shouldBeSignedUp ? added : removed).push(qualification.name);

        await updateQualificationThreadMember(
          interaction.guild,
          tr,
          qualification,
          interaction.user.id,
          shouldBeSignedUp
        );
      }

      saveTraining(interaction.guildId, msgId, tr);
      await refreshQualificationBoard(interaction, tr, msgId);
      return interaction.update({
        content: [
          added.length ? `Signed you up for: ${added.map(name => `**${name}**`).join(', ')}.` : '',
          removed.length ? `Removed your signup from: ${removed.map(name => `**${name}**`).join(', ')}.` : '',
          blocked.length ? `Could not apply:\n${blocked.join('\n')}` : '',
          !added.length && !removed.length ? 'No changes made.' : '',
        ].filter(Boolean).join('\n'),
        components: buildPersonalQualificationRows(msgId, tr, interaction.member),
      });
    }

    const added = [];
    const removed = [];
    const blocked = [];
    for (const qualification of qualifications) {
      if (qualification.closed) {
        removed.push(`${qualification.name} is closed`);
        continue;
      }
      const signups = tr.signups[qualification.key] ?? [];
      const alreadySignedUp = signups.some(member => member.id === interaction.user.id);
      if (!alreadySignedUp) {
        const missingPrerequisites = getMissingQualificationPrerequisites(interaction.member, qualification.key);
        if (missingPrerequisites.length) {
          blocked.push(
            `**${qualification.name}** requires ${missingPrerequisites.map(required => `**${required.name}**`).join(' and ')}.`
          );
          continue;
        }
      }

      tr.signups[qualification.key] = alreadySignedUp
        ? signups.filter(member => member.id !== interaction.user.id)
        : [...signups, { id: interaction.user.id, name: interaction.member.displayName }];

      if (alreadySignedUp) {
        removed.push(qualification.name);
      } else {
        added.push(qualification.name);
      }
      await updateQualificationThreadMember(
        interaction.guild,
        tr,
        qualification,
        interaction.user.id,
        !alreadySignedUp
      );
    }

    saveTraining(interaction.guildId, msgId, tr);
    await refreshQualificationBoard(interaction, tr, msgId);
    return interaction.reply({
      content: [
        added.length ? `Signed you up for: ${added.map(name => `**${name}**`).join(', ')}.` : '',
        removed.length ? `Removed your signup from: ${removed.map(name => `**${name}**`).join(', ')}.` : '',
        blocked.length ? `Could not apply:\n${blocked.join('\n')}` : '',
      ].filter(Boolean).join('\n'),
      ephemeral: true,
    });
  },

  // ── Modal submit interactions ───────────────────────────────────────────────
  async handleModal(interaction) {
    const [action, msgId] = interaction.customId.split(':');
    const existing = msgId ? getTraining(interaction.guildId, msgId) : null;
    if (!isOfficer(interaction.member) && !(action === 'tr_edit_modal' && existing?.createdBy === interaction.user.id)) return interaction.reply({ content: 'You no longer have permission to create or edit this training.', ephemeral: true });

    // ── Create new training ─────────────────────────────────────────────────
    if (action === 'tr_create_modal') {
      const title       = interaction.fields.getTextInputValue('title');
      const description = interaction.fields.getTextInputValue('description');
      const timeStr     = interaction.fields.getTextInputValue('time');

      const parsedDate = parseDateTime(timeStr);
      if (!require('../utils/event-date').validCalendarInput(timeStr) || !parsedDate || isNaN(parsedDate.getTime()) || parsedDate.getTime() <= Date.now()) {
        return interaction.reply({ content: '❌ Enter a valid future date. Use `DD/MM/YYYY HH:MM` and optionally add a timezone, like `28/05/2026 19:00 EST`, `UTC+10`, or `America/New_York`.', ephemeral: true });
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
      if (!require('../utils/event-date').validCalendarInput(timeStr) || !parsedDate || isNaN(parsedDate.getTime()) || parsedDate.getTime() <= Date.now()) {
        return interaction.reply({ content: '❌ Enter a valid future date. Use `DD/MM/YYYY HH:MM` and optionally add a timezone, like `28/05/2026 19:00 EST`, `UTC+10`, or `America/New_York`.', ephemeral: true });
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
