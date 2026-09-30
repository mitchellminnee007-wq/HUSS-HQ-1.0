const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { getConfig } = require('../utils/config');
const { getLocationMatch, findLocationMatch } = require('./locations');
const { findFoxholeItem, getFoxholeIconUrl } = require('../utils/foxhole-icons');

const STORE_PATH = path.join(__dirname, '..', 'data', 'logitasks.json');
const OFFICER_ROLE_NAMES = ['Officer', 'Commander'];
const RELAY_MARKER = '[[HUSS_WHL_RELAY]]';
const relayGuard = new Map();
const relayMessageSeen = new Map();

function isRelayBlocked(taskId, messageId) {
  if (!taskId || !messageId) return false;
  const key = `${taskId}:${messageId}`;
  return relayGuard.has(key);
}

function markRelayHandled(taskId, messageId) {
  if (!taskId || !messageId) return;
  const key = `${taskId}:${messageId}`;
  relayGuard.set(key, Date.now());
  setTimeout(() => relayGuard.delete(key), 30000);
}

function hasSeenRelayMessage(taskId, messageId) {
  if (!taskId || !messageId) return false;
  const key = `${taskId}:${messageId}`;
  if (relayMessageSeen.has(key)) return true;
  relayMessageSeen.set(key, Date.now());
  setTimeout(() => relayMessageSeen.delete(key), 30000);
  return false;
}

const PRIORITY_CHOICES = {
  low: '🟢 Low',
  normal: '🟡 Normal',
  critical: '🔴 Critical',
};

const TYPE_CHOICES = {
  transport: '🚛 Transport',
  frontline_supply: '📦 Frontline Supply',
};

const STATUS_CHOICES = {
  open: '📭 Open',
  in_progress: '🚚 In Progress',
  completed: '✅ Completed',
  cancelled: '❌ Cancelled',
};

function getStatusBannerUrl(status) {
  const statusMap = {
    open: { color: '5865F2', label: 'OPEN' },
    in_progress: { color: 'F9A826', label: 'IN PROGRESS' },
    completed: { color: '2EB67D', label: 'COMPLETED' },
    cancelled: { color: 'ED4245', label: 'CANCELLED' },
  };

  const choice = statusMap[status] || statusMap.open;
  return `https://placehold.co/1200x300/${choice.color}/FFFFFF.png?text=${encodeURIComponent(choice.label)}`;
}

const STORAGE_TYPE_CHOICES = {
  depot: 'Depot',
  seaport: 'Seaport',
  aircraft_depot: 'Aircraft Depot',
};

function readStore() {
  if (!fs.existsSync(STORE_PATH)) return { guilds: {} };

  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch (error) {
    console.error('[logitasks] Failed to parse task store, resetting to empty store:', error);
    return { guilds: {} };
  }
}

function writeStore(data) {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

function findTaskById(taskId) {
  const store = readStore();

  for (const guildTasks of Object.values(store.guilds || {})) {
    if (!guildTasks || typeof guildTasks !== 'object') continue;

    for (const task of Object.values(guildTasks)) {
      if (task && task.id === taskId) return task;
    }
  }

  return null;
}

function saveTask(task) {
  const store = readStore();
  if (!store.guilds[task.requestedFromGuild]) store.guilds[task.requestedFromGuild] = {};
  store.guilds[task.requestedFromGuild][task.id] = task;
  writeStore(store);
}

function findTaskByThreadId(threadId) {
  const store = readStore();

  for (const guildTasks of Object.values(store.guilds || {})) {
    if (!guildTasks || typeof guildTasks !== 'object') continue;

    for (const task of Object.values(guildTasks)) {
      if (!task || typeof task !== 'object') continue;
      if (task.whlThreadId === threadId || task.hussThreadId === threadId) return task;
    }
  }

  return null;
}

function getPriorityLabel(priority) {
  return PRIORITY_CHOICES[priority] || PRIORITY_CHOICES.normal;
}

function getTypeLabel(taskType) {
  return TYPE_CHOICES[taskType] || TYPE_CHOICES.other;
}

function getStatusLabel(status) {
  return STATUS_CHOICES[status] || STATUS_CHOICES.open;
}

function normalizePriority(value) {
  const normalized = (value || '').trim().toLowerCase();
  if (!normalized) return null;

  if (['low', 'normal', 'critical'].includes(normalized)) return normalized;
  if (normalized === 'l') return 'low';
  if (normalized === 'n') return 'normal';
  if (normalized === 'c') return 'critical';
  return null;
}

function normalizeTaskType(value) {
  const normalized = (value || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!normalized) return null;

  if (['transport', 'frontline_supply', 'frontline-supply', 'frontline supply'].includes(normalized)) {
    return normalized === 'frontline-supply' || normalized === 'frontline supply' ? 'frontline_supply' : normalized;
  }

  return null;
}

function normalizeStorageType(value) {
  const normalized = (value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (!normalized) return null;

  if (['depot', 'storage_depot', 'storage_depot', 'storage_depot'].includes(normalized)) return 'depot';
  if (['seaport', 'sea_port', 'sea-port'].includes(normalized)) return 'seaport';
  if (['aircraft_depot', 'aircraft_depot', 'aircraft_depot'].includes(normalized)) return 'aircraft_depot';
  if (['depot'].includes(normalized)) return 'depot';

  return null;
}

function getStorageTypeLabel(storageType) {
  return STORAGE_TYPE_CHOICES[storageType] || STORAGE_TYPE_CHOICES.depot;
}

function buildTaskTitle(requestedItems, destination, priority) {
  const itemLines = String(requestedItems || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const compactItemLine = line => line.replace(/^(\d+(?:[.,]\d+)?)\s+crates?\s+(?:of\s+)?/i, '$1c ');
  const itemSummary = itemLines.length > 1
    ? `${compactItemLine(itemLines[0])} +${itemLines.length - 1} more`
    : compactItemLine(itemLines[0] || 'Logistics request');
  const priorityLabel = String(priority || 'normal').replace(/_/g, ' ').toUpperCase();

  return `[${priorityLabel}] ${destination || 'Location pending'} | ${itemSummary}`.slice(0, 100);
}

function parseLogiDestination(value) {
  const input = (value || '').trim();
  if (!input) return null;

  const parts = input
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    const hexInput = parts[0];
    const regionInput = parts.slice(1).join(', ');
    const hexMatch = findLocationMatch(hexInput);
    const regionMatch = findLocationMatch(regionInput);

    const hexName = hexMatch.hex || hexInput;
    const regionName = regionMatch.region || regionInput;

    if (hexMatch.hex && regionMatch.hex === hexMatch.hex && regionMatch.region) {
      return {
        raw: input,
        hex: hexName,
        region: regionName,
        formatted: `${hexName}, ${regionName}`,
      };
    }

    if (hexMatch.hex) {
      return {
        raw: input,
        hex: hexName,
        region: regionName,
        formatted: `${hexName}, ${regionName}`,
      };
    }

    return null;
  }

  const single = findLocationMatch(input);
  if (single.exact) {
    return {
      raw: input,
      hex: single.hex,
      region: single.region,
      formatted: single.exact,
    };
  }

  return null;
}

function isLeadershipMember(member) {
  if (!member) return false;

  if (member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  return member.roles?.cache?.some(role => OFFICER_ROLE_NAMES.includes(role.name)) || false;
}

function buildTaskHeaderContent(task) {
  return `📦 **${task.title || 'Logistics task'}**\n\n**Status:** ${getStatusLabel(task.status)}\n**Destination:** ${task.destination || 'Not specified'}\n**Storage:** ${task.storageType ? getStorageTypeLabel(task.storageType) : 'Not specified'}`;
}

function parseTaskItems(value) {
  const lines = String(value || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  return lines.map(line => {
    const quantityMatch = line.match(/^(\d+(?:[.,]\d+)?)\s*(?:c|crates?)\b\s*(?:of\s+)?(.+)$/i);
    const requested = quantityMatch ? Number(quantityMatch[1].replace(',', '.')) : null;
    const itemName = quantityMatch ? quantityMatch[2].trim() : line;
    const record = findFoxholeItem(itemName);
    return { requested, itemName: record?.name || itemName, record };
  });
}

async function buildTaskEmbeds(task) {
  const items = parseTaskItems(task.quantity);
  const totalCrates = items.reduce((total, item) => total + (item.requested || 0), 0);
  const flatbedSlots = totalCrates ? (totalCrates / 60).toFixed(2) : '0.00';
  const fields = [
    { name: 'Priority', value: getPriorityLabel(task.priority), inline: true },
    { name: 'Type', value: getTypeLabel(task.type), inline: true },
    { name: 'Status', value: getStatusLabel(task.status), inline: true },
    { name: 'Requested by', value: `<@${task.requestedBy}>`, inline: true },
    { name: 'Destination', value: task.destination || 'Not specified', inline: true },
    { name: 'Storage Type', value: task.storageType ? getStorageTypeLabel(task.storageType) : 'Not specified', inline: true },
  ];

  if (task.description) {
    fields.push({
      name: 'Notes',
      value: task.description,
    });
  }

  const workersText = task.workers && task.workers.length
    ? task.workers.map(id => `<@${id}>`).join('\n')
    : 'Nobody is currently working on this task.';

  fields.push({ name: 'Workers', value: workersText });

  const summaryEmbed = new EmbedBuilder()
    .setColor(task.status === 'completed' ? 0x57F287 : task.status === 'cancelled' ? 0xED4245 : 0x5865F2)
    .setTitle('📦 Logistics Request')
    .setDescription(`**Current list (delivered/requested)**\n• **Total order:** \`${totalCrates}\` crates -> \`${flatbedSlots}\` flatbed slots`)
    .setImage(getStatusBannerUrl(task.status))
    .addFields(...fields)
    .setFooter({ text: `HUSS ↔ WHL Logistics • Task ID: ${task.id}` })
    .setTimestamp(task.createdAt);

  const itemEmbeds = await Promise.all(items.map(async (item, index) => {
    const requestedLabel = item.requested === null ? '?' : item.requested;
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`${index + 1}. \`0\` / \`${requestedLabel}\` crates`)
      .setDescription(`**${item.itemName}**`);
    const iconUrl = await getFoxholeIconUrl(item.itemName);
    if (iconUrl) embed.setThumbnail(iconUrl);
    return embed;
  }));

  return [summaryEmbed, ...itemEmbeds].slice(0, 10);
}

function buildTaskButtons(task) {
  const disabled = task.status === 'completed';

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`logitask_start:${task.id}`)
      .setLabel('Start Task')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),

    new ButtonBuilder()
      .setCustomId(`logitask_stop:${task.id}`)
      .setLabel('Stop Working')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),

    new ButtonBuilder()
      .setCustomId(`logitask_complete:${task.id}`)
      .setLabel('Complete Task')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),

    new ButtonBuilder()
      .setCustomId(`logitask_cancel:${task.id}`)
      .setLabel('Cancel Task')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );
}

async function resolveForumTagId(forumChannel, tagName) {
  if (!forumChannel || !forumChannel.availableTags) return null;
  const tag = forumChannel.availableTags.find(item => item.name.toLowerCase() === tagName.toLowerCase());
  return tag ? tag.id : null;
}

async function ensureForumTags(forumChannel, task) {
  const required = [
    getPriorityLabel(task.priority),
    getStatusLabel('open'),
    getTypeLabel(task.type),
  ];

  const missing = [];

  for (const tagName of required) {
    const id = await resolveForumTagId(forumChannel, tagName);
    if (!id) missing.push(tagName);
  }

  return missing;
}

async function fetchGuildThread(client, guildId, threadId) {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return null;

  return guild.channels.cache.get(threadId)
    ?? await guild.channels.fetch(threadId).catch(() => null);
}

async function relayThreadMessage(client, task, sourceMessage, targetSide) {
  if (!task || !sourceMessage || !sourceMessage.content?.trim()) return;
  if (sourceMessage.author?.bot) return;
  if (sourceMessage.content.includes(RELAY_MARKER)) return;
  if (isRelayBlocked(task.id, sourceMessage.id)) return;
  if (hasSeenRelayMessage(task.id, sourceMessage.id)) return;

  const targetGuildId = targetSide === 'huss' ? task.requestedFromGuild : task.whlGuildId;
  const targetThreadId = targetSide === 'huss' ? task.hussThreadId : task.whlThreadId;

  if (!targetGuildId || !targetThreadId) return;

  const targetThread = await fetchGuildThread(client, targetGuildId, targetThreadId).catch(() => null);
  if (!targetThread || !targetThread.isThread?.()) return;

  const authorName = sourceMessage.member?.displayName || sourceMessage.author?.displayName || sourceMessage.author?.username || 'Member';
  const prefix = targetSide === 'huss' ? '[WHL]' : '[HUSS]';

  markRelayHandled(task.id, sourceMessage.id);
  await targetThread.send(`${prefix} ${authorName}\n${sourceMessage.content}`);
}

async function createHussThread(client, task) {
  try {
    const hussGuildId = task.requestedFromGuild;
    if (!hussGuildId) return null;
    if (hussGuildId === task.whlGuildId) return null;

    const guild = await client.guilds.fetch(hussGuildId).catch(() => null);
    if (!guild) return null;

    const channelId = getConfig(guild.id, 'TASKS_CHANNEL_ID') || getConfig(guild.id, 'OFFICER_CHANNEL_ID') || null;
    if (!channelId) return null;

    const channel = guild.channels.cache.get(channelId)
      ?? await guild.channels.fetch(channelId).catch(() => null);

    if (!channel || !channel.isTextBased?.()) return null;

    const thread = await channel.threads.create({
      name: `${task.title}`.slice(0, 100),
      autoArchiveDuration: 10080,
      reason: `Logistics task thread for ${task.title}`,
    });

    const starterMessage = await thread.send({
      content: buildTaskHeaderContent(task),
      embeds: await buildTaskEmbeds(task),
      components: [buildTaskButtons(task)],
    }).catch(() => null);

    if (starterMessage) {
      task.hussMessageId = starterMessage.id;
      task.messageId = starterMessage.id;
    }

    return thread;
  } catch (error) {
    console.error('[logitasks] Failed to create HUSS task thread:', error);
    return null;
  }
}

async function refreshHussThreadTask(client, task) {
  try {
    if (!task.hussThreadId) return;

    const guild = await client.guilds.fetch(task.requestedFromGuild).catch(() => null);
    if (!guild) return;

    const thread = guild.channels.cache.get(task.hussThreadId)
      ?? await guild.channels.fetch(task.hussThreadId).catch(() => null);

    if (!thread || !thread.isThread?.()) return;

    const messageId = task.hussMessageId || task.messageId;
    const message = messageId
      ? await thread.messages.fetch(messageId).catch(() => null)
      : await thread.fetchStarterMessage().catch(() => null);

    if (!message) {
      const starterMessage = await thread.fetchStarterMessage().catch(() => null);
      if (!starterMessage) return;
      task.hussMessageId = starterMessage.id;
      task.messageId = starterMessage.id;
      await starterMessage.edit({
        content: buildTaskHeaderContent(task),
        embeds: await buildTaskEmbeds(task),
        components: [buildTaskButtons(task)],
      });
      return;
    }

    await message.edit({
      content: buildTaskHeaderContent(task),
      embeds: await buildTaskEmbeds(task),
      components: [buildTaskButtons(task)],
    });
  } catch (error) {
    console.error('[logitasks] Failed to refresh HUSS task thread:', error);
  }
}

async function refreshTaskForumPost(client, task) {
  try {
    const guild = await client.guilds.fetch(task.whlGuildId).catch(() => null);
    if (!guild) return;

    const thread = guild.channels.cache.get(task.forumPostId)
      ?? await guild.channels.fetch(task.forumPostId).catch(() => null);

    if (!thread || !thread.isThread?.()) return;

    const messageId = task.whlMessageId || task.messageId;
    const starterMessage = messageId
      ? await thread.messages.fetch(messageId).catch(() => null)
      : await thread.fetchStarterMessage().catch(() => null);

    if (!starterMessage) {
      const fallbackMessage = await thread.fetchStarterMessage().catch(() => null);
      if (!fallbackMessage) return;
      task.whlMessageId = fallbackMessage.id;
      task.messageId = fallbackMessage.id;
      await fallbackMessage.edit({
        content: buildTaskHeaderContent(task),
        embeds: await buildTaskEmbeds(task),
        components: [buildTaskButtons(task)],
      });
      return;
    }

    await starterMessage.edit({
      content: buildTaskHeaderContent(task),
      embeds: await buildTaskEmbeds(task),
      components: [buildTaskButtons(task)],
    });
  } catch (error) {
    console.error('[logitasks] Failed to refresh forum post:', error);
  }
}

async function syncTaskState(client, task) {
  await updateForumTags(client, task);
  await refreshTaskForumPost(client, task);
  await refreshHussThreadTask(client, task);
}

async function updateForumTags(client, task) {
  try {
    const guild = await client.guilds.fetch(task.whlGuildId).catch(() => null);
    if (!guild) return;

    const forumChannel = guild.channels.cache.get(task.forumChannelId)
      ?? await guild.channels.fetch(task.forumChannelId).catch(() => null);

    if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) return;

    const thread = guild.channels.cache.get(task.forumPostId)
      ?? await guild.channels.fetch(task.forumPostId).catch(() => null);

    if (!thread || !thread.isThread?.()) return;

    const statusTag = getStatusLabel(task.status);
    const priorityTag = getPriorityLabel(task.priority);
    const typeTag = getTypeLabel(task.type);

    const appliedTags = [
      await resolveForumTagId(forumChannel, priorityTag),
      await resolveForumTagId(forumChannel, statusTag),
      await resolveForumTagId(forumChannel, typeTag),
    ].filter(Boolean);

    if (appliedTags.length === 0) return;

    await thread.setAppliedTags(appliedTags);
  } catch (error) {
    console.error('[logitasks] Failed to update forum tags:', error);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logitask')
    .setDescription('Create a HUSS → WHL logistics task.')
    .setDMPermission(false),

  async execute(interaction) {
    if (!isLeadershipMember(interaction.member)) {
      return interaction.reply({
        content: 'Only HUSS officers / leadership can create logistics tasks.',
        ephemeral: true,
      });
    }

    const modal = new ModalBuilder()
      .setCustomId('logitask_create_modal')
      .setTitle('Create Logistics Task');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('priority')
          .setLabel('Priority')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('low / normal / critical')
          .setMaxLength(20)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('type')
          .setLabel('Type')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('transport / frontline supply')
          .setMaxLength(30)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('requested_items')
          .setLabel('Items requested')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder('15 crates of radio\n10 crates of fuel')
          .setMaxLength(500)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('destination')
          .setLabel('Destination')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('Endless Shore, Saltbrook Channel')
          .setMaxLength(200)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('storage_type')
          .setLabel('Storage Type')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('Depot / Seaport / Aircraft Depot')
          .setMaxLength(40)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('notes')
          .setLabel('Notes (optional)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setPlaceholder('Extra details, urgency, or timing')
          .setMaxLength(1000)
      )
    );

    await interaction.showModal(modal);
  },

  async handleModal(interaction) {
    if (interaction.customId !== 'logitask_create_modal') return;

    const priorityInput = interaction.fields.getTextInputValue('priority');
    const typeInput = interaction.fields.getTextInputValue('type');
    const requestedItemsInput = interaction.fields.getTextInputValue('requested_items').trim();
    const destinationInput = interaction.fields.getTextInputValue('destination').trim();
    const storageTypeInput = interaction.fields.getTextInputValue('storage_type').trim();
    const description = interaction.fields.getTextInputValue('notes').trim();
    const parsedDestination = parseLogiDestination(destinationInput);
    const destination = parsedDestination ? parsedDestination.formatted : null;

    const priority = normalizePriority(priorityInput);
    const taskType = normalizeTaskType(typeInput);
    const storageType = normalizeStorageType(storageTypeInput);

    const requestedItems = requestedItemsInput || getTypeLabel(taskType);
    const unmatchedItems = parseTaskItems(requestedItemsInput)
      .filter(item => !item.record)
      .map(item => item.itemName);

    if (unmatchedItems.length) {
      return interaction.reply({
        content: `These requested items are not in the Foxhole production database: ${unmatchedItems.join(', ')}. Use the exact database item names.`,
        ephemeral: true,
      });
    }

    const title = buildTaskTitle(requestedItems, destination, priority);

    if (!priority) {
      return interaction.reply({ content: 'Priority must be one of: low, normal, critical.', ephemeral: true });
    }

    if (!taskType) {
      return interaction.reply({ content: 'Type must be one of: transport, frontline supply.', ephemeral: true });
    }

    if (!requestedItemsInput) {
      return interaction.reply({ content: 'Items requested is required.', ephemeral: true });
    }

    if (!destination) {
      return interaction.reply({ content: 'Destination is required.', ephemeral: true });
    }

    if (!parsedDestination || !parsedDestination.hex || (parsedDestination.region && !getLocationMatch(parsedDestination.region))) {
      const sampleLocations = [
        'Endless Shore, Saltbrook Channel', 'Acrithia, The Heartlands', 'Ash Fields, Basin Sionnach', 'Callahan\'s Passage, Fisherman\'s Row'
      ].join(', ');

      return interaction.reply({
        content: `Location not recognized. Use the format [HEX], [REGION], for example: ${sampleLocations}.`,
        ephemeral: true,
      });
    }

    if (!storageType) {
      return interaction.reply({
        content: 'Storage type must be one of: Depot, Seaport, Aircraft Depot.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const whlGuildId = getConfig(interaction.guildId, 'WHL_GUILD_ID') || process.env.WHL_GUILD_ID || null;
    const whlForumId = getConfig(interaction.guildId, 'WHL_LOGISTICS_FORUM_ID') || process.env.WHL_LOGISTICS_FORUM_ID || null;

    if (!whlGuildId || !whlForumId) {
      return interaction.editReply('This HUSS guild is missing the WHL config. Set the WHL Guild ID and WHL Logistics Forum in the bot config.');
    }

    let whlGuild;
    try {
      whlGuild = await interaction.client.guilds.fetch(whlGuildId);
    } catch (error) {
      console.error('[logitasks] Could not fetch WHL guild:', error);
      return interaction.editReply('The bot is not currently in the configured WHL guild.');
    }

    let forumChannel;
    try {
      forumChannel = whlGuild.channels.cache.get(whlForumId)
        ?? await whlGuild.channels.fetch(whlForumId);
    } catch (error) {
      console.error('[logitasks] Could not fetch WHL forum channel:', error);
      return interaction.editReply('The configured WHL logistics forum channel could not be found.');
    }

    if (forumChannel.type !== ChannelType.GuildForum) {
      return interaction.editReply('The configured WHL logistics channel is not a Forum channel.');
    }

    const missingTags = [];
    const requiredPriorityTag = getPriorityLabel(priority);
    const requiredStatusTag = getStatusLabel('open');
    const requiredTypeTag = getTypeLabel(taskType);

    for (const tagName of [requiredPriorityTag, requiredStatusTag, requiredTypeTag]) {
      if (!(await resolveForumTagId(forumChannel, tagName))) {
        missingTags.push(tagName);
      }
    }

    if (missingTags.length) {
      return interaction.editReply(`The WHL forum is missing required tags: ${missingTags.join(', ')}. Please create them before posting a logistics task.`);
    }

    const taskId = randomUUID();
    const task = {
      id: taskId,
      title,
      description,
      priority,
      type: taskType,
      status: 'open',
      quantity: requestedItemsInput || null,
      destination: destination || null,
      storageType: storageType || null,
      requestedBy: interaction.user.id,
      requestedFromGuild: interaction.guildId,
      workers: [],
      whlGuildId,
      forumChannelId: forumChannel.id,
      forumPostId: null,
      whlThreadId: null,
      hussThreadId: null,
      messageId: null,
      createdAt: Date.now(),
      completedAt: null,
      completedBy: null,
    };

    try {
      const thread = await forumChannel.threads.create({
        name: title,
        message: {
          embeds: await buildTaskEmbeds(task),
          components: [buildTaskButtons(task)],
        },
        appliedTags: [
          await resolveForumTagId(forumChannel, requiredPriorityTag),
          await resolveForumTagId(forumChannel, requiredStatusTag),
          await resolveForumTagId(forumChannel, requiredTypeTag),
        ].filter(Boolean),
        reason: `Logistics task created by ${interaction.user.tag}`,
      });

      task.forumPostId = thread.id;
      task.whlThreadId = thread.id;

      const starterMessage = await thread.fetchStarterMessage().catch(() => null);
      if (starterMessage) {
        task.whlMessageId = starterMessage.id;
        task.messageId = starterMessage.id;
      }

      const hussThread = await createHussThread(interaction.client, task);
      if (hussThread) {
        task.hussThreadId = hussThread.id;
      }

      saveTask(task);

      await starterMessage?.edit({
        embeds: await buildTaskEmbeds(task),
        components: [buildTaskButtons(task)],
      }).catch(() => {});

      return interaction.editReply(`✅ Logistics task created in the WHL forum: ${thread}`);
    } catch (error) {
      console.error('[logitasks] Failed to create forum post:', error);
      return interaction.editReply('The bot could not create the WHL forum post. Check channel permissions and forum tag setup.');
    }
  },

  init(client) {
    client.on('messageCreate', async message => {
      if (message.author.bot || !message.channel || !message.channel.isThread?.()) return;
      if (!message.content || !message.content.trim()) return;
      if (message.content.includes(RELAY_MARKER)) return;
      if (message.content.startsWith('[WHL] ') || message.content.startsWith('[HUSS] ')) return;
      if (isRelayBlocked(message.channel.id, message.id)) return;

      const task = findTaskByThreadId(message.channel.id);
      if (!task) return;

      if (message.channel.id === task.whlThreadId && task.hussThreadId) {
        await relayThreadMessage(client, task, message, 'huss');
      }

      if (message.channel.id === task.hussThreadId && task.whlThreadId) {
        await relayThreadMessage(client, task, message, 'whl');
      }
    });
  },

  async handleButton(interaction) {
    if (!interaction.isButton()) return;

    const [action, taskId] = interaction.customId.split(':');
    if (!taskId || !action || !action.startsWith('logitask_')) return;

    const task = findTaskById(taskId);
    if (!task) {
      return interaction.reply({ content: 'This logistics task no longer exists.', ephemeral: true });
    }

    if (task.status === 'completed' || task.status === 'cancelled') {
      return interaction.reply({
        content: 'This task is already completed or cancelled.',
        ephemeral: true,
      });
    }

    if (action === 'logitask_start') {
      if (task.workers.includes(interaction.user.id)) {
        return interaction.reply({ content: 'You are already working on this task.', ephemeral: true });
      }

      task.workers.push(interaction.user.id);
      task.status = 'in_progress';
      saveTask(task);
      await syncTaskState(interaction.client, task);

      return interaction.reply({
        content: `You are now working on **${task.title}**.`,
        ephemeral: true,
      });
    }

    if (action === 'logitask_stop') {
      if (!task.workers.includes(interaction.user.id)) {
        return interaction.reply({
          content: 'You are not currently assigned to this task.',
          ephemeral: true,
        });
      }

      task.workers = task.workers.filter(id => id !== interaction.user.id);
      if (task.workers.length === 0) task.status = 'open';
      else task.status = 'in_progress';

      saveTask(task);
      await syncTaskState(interaction.client, task);

      return interaction.reply({
        content: `You stopped working on **${task.title}**.`,
        ephemeral: true,
      });
    }

    if (action === 'logitask_complete') {
      const isWorker = task.workers.includes(interaction.user.id);
      const isLeader = isLeadershipMember(interaction.member);

      if (!isWorker && !isLeader) {
        return interaction.reply({
          content: 'Only task workers or HUSS leadership can complete this task.',
          ephemeral: true,
        });
      }

      task.status = 'completed';
      task.completedAt = Date.now();
      task.completedBy = interaction.user.id;
      saveTask(task);
      await syncTaskState(interaction.client, task);

      return interaction.reply({
        content: `✅ **${task.title}** has been marked as completed.`,
        ephemeral: true,
      });
    }

    if (action === 'logitask_cancel') {
      if (!isLeadershipMember(interaction.member)) {
        return interaction.reply({
          content: 'Only HUSS/WHL leadership can cancel a logistics task.',
          ephemeral: true,
        });
      }

      task.status = 'cancelled';
      task.completedAt = Date.now();
      task.completedBy = interaction.user.id;
      saveTask(task);
      await syncTaskState(interaction.client, task);

      return interaction.reply({
        content: `⚠️ **${task.title}** was cancelled.`,
        ephemeral: true,
      });
    }
  },
};
