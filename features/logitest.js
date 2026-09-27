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
} = require('discord.js');
const { getConfig } = require('../utils/config');
const { findFoxholeItem, getFoxholeIconUrl } = require('../utils/foxhole-icons');

const STORE_PATH = path.join(__dirname, '..', 'data', 'logitasks.json');
const OFFICER_ROLE_NAMES = ['Officer', 'Commander'];

const TEST_REQUESTS = [
  {
    priority: 'normal',
    type: 'transport',
    destination: 'Endless Shore, Saltbrook Channel',
    storageType: 'depot',
    requestedItems: '15 crates of Radio\n10 crates of Maintenance Supplies\n5 crates of 7.62mm',
    notes: 'Dummy test request for logistics sync validation.',
  },
  {
    priority: 'critical',
    type: 'frontline_supply',
    destination: 'Ash Fields, Camp Omega',
    storageType: 'seaport',
    requestedItems: '20 crates of 7.62mm\n12 crates of Bandages\n8 crates of Soldier Supplies',
    notes: 'Colonial-side production test order.',
  },
  {
    priority: 'low',
    type: 'transport',
    destination: 'Callahan\'s Passage, Cragstown',
    storageType: 'aircraft_depot',
    requestedItems: '12 crates of Barbed Wire (Material)\n6 crates of Metal Beam',
    notes: 'Factory-capable dummy request.',
  },
  {
    priority: 'normal',
    type: 'frontline_supply',
    destination: 'Acrithia, Legion Ranch',
    storageType: 'depot',
    requestedItems: '18 crates of 40mm\n9 crates of Maintenance Supplies\n5 crates of Trauma Kit',
    notes: 'Mass Production Factory style test batch.',
  },
];

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

function readStore() {
  if (!fs.existsSync(STORE_PATH)) return { guilds: {} };

  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch (error) {
    console.error('[logitest] Failed to parse task store, resetting to empty store:', error);
    return { guilds: {} };
  }
}

function writeStore(data) {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

function saveTask(task) {
  const store = readStore();
  if (!store.guilds[task.requestedFromGuild]) store.guilds[task.requestedFromGuild] = {};
  store.guilds[task.requestedFromGuild][task.id] = task;
  writeStore(store);
}

function getPriorityLabel(priority) {
  return PRIORITY_CHOICES[priority] || PRIORITY_CHOICES.normal;
}

function getTypeLabel(taskType) {
  return TYPE_CHOICES[taskType] || TYPE_CHOICES.transport;
}

function getStatusLabel(status) {
  return STATUS_CHOICES[status] || STATUS_CHOICES.open;
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

function isLeadershipMember(member) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  return member.roles?.cache?.some(role => OFFICER_ROLE_NAMES.includes(role.name)) || false;
}

function buildTaskHeaderContent(task) {
  return `📦 **${task.title || 'Logistics task'}**\n\n**Status:** ${getStatusLabel(task.status)}\n**Destination:** ${task.destination || 'Not specified'}\n**Storage:** ${task.storageType || 'Not specified'}`;
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
    { name: 'Storage Type', value: task.storageType || 'Not specified', inline: true },
  ];

  if (task.description) {
    fields.push({ name: 'Notes', value: task.description });
  }

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
    new ButtonBuilder().setCustomId(`logitask_start:${task.id}`).setLabel('Start Task').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`logitask_stop:${task.id}`).setLabel('Stop Working').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`logitask_complete:${task.id}`).setLabel('Complete Task').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`logitask_cancel:${task.id}`).setLabel('Cancel Task').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
}

async function resolveForumTagId(forumChannel, tagName) {
  if (!forumChannel || !forumChannel.availableTags) return null;
  const tag = forumChannel.availableTags.find(item => item.name.toLowerCase() === tagName.toLowerCase());
  return tag ? tag.id : null;
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

    const channel = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) return null;

    const thread = await channel.threads.create({
      name: `${task.title}`.slice(0, 100),
      autoArchiveDuration: 10080,
      reason: `Dummy logistics task thread for ${task.title}`,
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
    console.error('[logitest] Failed to create HUSS task thread:', error);
    return null;
  }
}

async function updateForumTags(client, task) {
  try {
    const guild = await client.guilds.fetch(task.whlGuildId).catch(() => null);
    if (!guild) return;

    const forumChannel = guild.channels.cache.get(task.forumChannelId) ?? await guild.channels.fetch(task.forumChannelId).catch(() => null);
    if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) return;

    const thread = guild.channels.cache.get(task.forumPostId) ?? await guild.channels.fetch(task.forumPostId).catch(() => null);
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
    console.error('[logitest] Failed to update forum tags:', error);
  }
}

async function refreshTaskForumPost(client, task) {
  try {
    const guild = await client.guilds.fetch(task.whlGuildId).catch(() => null);
    if (!guild) return;

    const thread = guild.channels.cache.get(task.forumPostId) ?? await guild.channels.fetch(task.forumPostId).catch(() => null);
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
    console.error('[logitest] Failed to refresh forum post:', error);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logitest')
    .setDescription('Create a dummy HUSS → WHL logistics request for testing.')
    .setDMPermission(false),

  async execute(interaction) {
    if (!isLeadershipMember(interaction.member)) {
      return interaction.reply({
        content: 'Only HUSS officers / leadership can create test logistics requests.',
        ephemeral: true,
      });
    }

    const request = TEST_REQUESTS[Math.floor(Math.random() * TEST_REQUESTS.length)];
    const type = request.type;
    const priority = request.priority;
    const destination = request.destination;
    const storageType = request.storageType || 'depot';
    const requestedItems = request.requestedItems;
    const notes = request.notes;
    const title = buildTaskTitle(requestedItems, destination, priority);

    const whlGuildId = getConfig(interaction.guildId, 'WHL_GUILD_ID') || process.env.WHL_GUILD_ID || null;
    const whlForumId = getConfig(interaction.guildId, 'WHL_LOGISTICS_FORUM_ID') || process.env.WHL_LOGISTICS_FORUM_ID || null;

    if (!whlGuildId || !whlForumId) {
      return interaction.reply({
        content: 'This HUSS guild is missing the WHL config. Set the WHL Guild ID and WHL Logistics Forum first.',
        ephemeral: true,
      });
    }

    let whlGuild;
    try {
      whlGuild = await interaction.client.guilds.fetch(whlGuildId);
    } catch (error) {
      console.error('[logitest] Could not fetch WHL guild:', error);
      return interaction.reply({ content: 'The bot is not currently in the configured WHL guild.', ephemeral: true });
    }

    let forumChannel;
    try {
      forumChannel = whlGuild.channels.cache.get(whlForumId) ?? await whlGuild.channels.fetch(whlForumId);
    } catch (error) {
      console.error('[logitest] Could not fetch WHL forum channel:', error);
      return interaction.reply({ content: 'The configured WHL logistics forum channel could not be found.', ephemeral: true });
    }

    if (forumChannel.type !== ChannelType.GuildForum) {
      return interaction.reply({ content: 'The configured WHL logistics channel is not a Forum channel.', ephemeral: true });
    }

    const requiredPriorityTag = getPriorityLabel(priority);
    const requiredStatusTag = getStatusLabel('open');
    const requiredTypeTag = getTypeLabel(type);

    const missingTags = [];
    for (const tagName of [requiredPriorityTag, requiredStatusTag, requiredTypeTag]) {
      if (!(await resolveForumTagId(forumChannel, tagName))) missingTags.push(tagName);
    }

    if (missingTags.length) {
      return interaction.reply({
        content: `The WHL forum is missing required tags: ${missingTags.join(', ')}. Please create them before posting a test request.`,
        ephemeral: true,
      });
    }

    const taskId = randomUUID();
    const task = {
      id: taskId,
      title,
      description: notes || 'Dummy HUSS logistics test request.',
      priority,
      type,
      status: 'open',
      quantity: requestedItems,
      destination,
      storageType,
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
        reason: `Dummy logistics request created by ${interaction.user.tag}`,
      });

      task.forumPostId = thread.id;
      task.whlThreadId = thread.id;

      const starterMessage = await thread.fetchStarterMessage().catch(() => null);
      if (starterMessage) task.messageId = starterMessage.id;

      const hussThread = await createHussThread(interaction.client, task);
      if (hussThread) task.hussThreadId = hussThread.id;

      saveTask(task);

      await starterMessage?.edit({
        embeds: await buildTaskEmbeds(task),
        components: [buildTaskButtons(task)],
      }).catch(() => {});

      await updateForumTags(interaction.client, task);
      await refreshTaskForumPost(interaction.client, task);

      return interaction.reply({
        content: `✅ Dummy logistics request created in the WHL forum: ${thread}`,
        ephemeral: true,
      });
    } catch (error) {
      console.error('[logitest] Failed to create dummy forum post:', error);
      return interaction.reply({
        content: 'The bot could not create the dummy WHL forum post. Check channel permissions and forum tag setup.',
        ephemeral: true,
      });
    }
  },
};
