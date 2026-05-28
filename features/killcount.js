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

const STORE_PATH               = path.join(__dirname, '..', 'data', 'killcount.json');
const DEFAULT_KILLCOUNT_CHANNEL = '1445348388324507688';
const OFFICER_RANKS            = ['Officer', 'Commander'];
const KILL_RANKS               = ['Officer', 'Commander', 'Member'];
const MEDALS                   = ['🥇', '🥈', '🥉'];

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

function getActive(guildId) {
  return readStore().guilds[guildId]?.active ?? null;
}

function saveActive(guildId, data) {
  const store = readStore();
  if (!store.guilds[guildId]) store.guilds[guildId] = {};
  store.guilds[guildId].active = data;
  writeStore(store);
}

function clearActive(guildId) {
  const store = readStore();
  if (store.guilds[guildId]) delete store.guilds[guildId].active;
  writeStore(store);
}

function isOfficer(member) {
  return member.roles.cache.some(r => OFFICER_RANKS.includes(r.name));
}

function canAddKills(member) {
  return member.roles.cache.some(r => KILL_RANKS.includes(r.name));
}

// ── Build kill count embed ────────────────────────────────────────────────────
function buildEmbed(war) {
  // Merge kills by player name for the leaderboard
  const merged = {};
  for (const e of war.kills) {
    const key = e.name.toLowerCase();
    if (!merged[key]) merged[key] = { name: e.name, count: 0 };
    merged[key].count += e.count;
  }
  const sorted = Object.values(merged).sort((a, b) => b.count - a.count);
  const total  = war.kills.reduce((s, e) => s + e.count, 0);

  let board = '';
  if (sorted.length === 0) {
    board = '*No kills recorded yet.*';
  } else {
    board = sorted
      .map((e, i) => `${MEDALS[i] ?? '▪️'} **${e.name}** — ${e.count} kill${e.count !== 1 ? 's' : ''}`)
      .join('\n');
  }

  // Individual submissions for reward attribution
  let submissions = '';
  if (war.kills.length === 0) {
    submissions = '*None yet.*';
  } else {
    submissions = war.kills
      .slice(-20) // show last 20 entries to avoid embed limits
      .map(e => `\`+${e.count}\` **${e.name}** — by ${e.reportedByName}`)
      .join('\n');
    if (war.kills.length > 20) submissions = `*...${war.kills.length - 20} earlier entries hidden*\n` + submissions;
  }

  return new EmbedBuilder()
    .setColor(0xE74C3C)
    .setTitle(`⚔️ Kill Count — ${war.name}`)
    .addFields(
      { name: '🏆 Leaderboard',   value: board       },
      { name: '📋 Submissions',   value: submissions  },
      { name: '📊 Total kills',   value: `${total}`, inline: true },
    )
    .setFooter({ text: `Started by ${war.startedByName} • Powered by Hypha` })
    .setTimestamp(war.startedAt);
}

// ── Panel action buttons ────────────────────────────────────────────────────
function buildPanelRow(msgId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`kc_add:${msgId}`)
      .setLabel('Add Kills')
      .setEmoji('➕')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`kc_reset:${msgId}`)
      .setLabel('Reset')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`kc_end:${msgId}`)
      .setLabel('End War')
      .setEmoji('📜')
      .setStyle(ButtonStyle.Danger),
  );
}

// ── Update the live panel message ─────────────────────────────────────────────────
async function refreshPanel(guild, war) {
  const channelId = war.channelId;
  const channel   = guild.channels.cache.get(channelId)
    ?? await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return;
  const msg = await channel.messages.fetch(war.messageId).catch(() => null);
  if (msg) await msg.edit({ embeds: [buildEmbed(war)], components: [buildPanelRow(war.messageId)] }).catch(() => {});
}

// ── Module export ─────────────────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName('killcount')
    .setDescription('Manage war kill counts.')
    .setDMPermission(false)

    // /killcount start
    .addSubcommand(sub =>
      sub.setName('start')
        .setDescription('Start a new war kill count panel. (Officers only)')
        .addStringOption(opt =>
          opt.setName('name')
            .setDescription('Name or number of the war (e.g. "War 7" or "vs Clan X")')
            .setRequired(true)
        )
    )

    // /killcount add
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Add kills for a player in the current war.')
        .addStringOption(opt =>
          opt.setName('name')
            .setDescription('Tank name')
            .setRequired(true)
        )
        .addIntegerOption(opt =>
          opt.setName('amount')
            .setDescription('Number of kills to add')
            .setRequired(true)
            .setMinValue(1)
        )
    )

    // /killcount remove
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a player from the kill count. (Officers only)')
        .addStringOption(opt =>
          opt.setName('name')
            .setDescription('Player name to remove')
            .setRequired(true)
        )
    )

    // /killcount reset
    .addSubcommand(sub =>
      sub.setName('reset')
        .setDescription('Reset all kills to 0 for the current war. (Officers only)')
    )

    // /killcount end
    .addSubcommand(sub =>
      sub.setName('end')
        .setDescription('End the current war and archive the panel. (Officers only)')
    ),

  async execute(interaction) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    // ── /killcount start ───────────────────────────────────────────────────
    if (sub === 'start') {
      if (!isOfficer(interaction.member)) {
        return interaction.reply({ content: 'Only Officers and Commanders can start a war.', ephemeral: true });
      }

      const name = interaction.options.getString('name', true);
      await interaction.deferReply({ ephemeral: true });

      const channelId = getConfig(guildId, 'KILLCOUNT_CHANNEL_ID') ?? DEFAULT_KILLCOUNT_CHANNEL;
      const channel   = interaction.guild.channels.cache.get(channelId)
        ?? await interaction.guild.channels.fetch(channelId).catch(() => null);

      if (!channel) {
        return interaction.editReply('❌ Kill count channel not found. Set it with `/config set-channel`.');
      }

      const war = {
        name,
        channelId,
        messageId:     null,
        kills:         [],
        startedAt:     Date.now(),
        startedBy:     interaction.user.id,
        startedByName: interaction.member.displayName,
      };

      const msg = await channel.send({ embeds: [buildEmbed(war)], components: [buildPanelRow('placeholder')] });
      war.messageId = msg.id;
      // Re-edit with correct message ID in button customIds
      await msg.edit({ embeds: [buildEmbed(war)], components: [buildPanelRow(msg.id)] });
      saveActive(guildId, war);

      return interaction.editReply(`✅ Kill count panel for **${name}** posted in ${channel}.`);
    }

    // ── /killcount add ─────────────────────────────────────────────────────
    if (sub === 'add') {
      if (!canAddKills(interaction.member)) {
        return interaction.reply({ content: 'Only Officers, Commanders and Members can add kills.', ephemeral: true });
      }

      const war = getActive(guildId);
      if (!war) {
        return interaction.reply({ content: 'No active war. An officer needs to run `/killcount start` first.', ephemeral: true });
      }

      const name   = interaction.options.getString('name', true).trim();
      const amount = interaction.options.getInteger('amount', true);

      // Each submission is stored individually for attribution
      war.kills.push({
        name,
        count:          amount,
        reportedBy:     interaction.user.id,
        reportedByName: interaction.member.displayName,
        addedAt:        Date.now(),
      });

      saveActive(guildId, war);
      await refreshPanel(interaction.guild, war);

      const total = war.kills
        .filter(e => e.name.toLowerCase() === name.toLowerCase())
        .reduce((s, e) => s + e.count, 0);

      return interaction.reply({
        content: `✅ Added **${amount}** kill${amount !== 1 ? 's' : ''} to **${name}** (total: ${total}).`,
        ephemeral: true,
      });
    }

    // ── /killcount remove ──────────────────────────────────────────────────
    if (sub === 'remove') {
      if (!isOfficer(interaction.member)) {
        return interaction.reply({ content: 'Only Officers and Commanders can remove players.', ephemeral: true });
      }

      const war = getActive(guildId);
      if (!war) return interaction.reply({ content: 'No active war.', ephemeral: true });

      const name   = interaction.options.getString('name', true).trim();
      const before = war.kills.length;
      war.kills    = war.kills.filter(e => e.name.toLowerCase() !== name.toLowerCase());

      if (war.kills.length === before) {
        return interaction.reply({ content: `❌ No entries found for **${name}**.`, ephemeral: true });
      }

      saveActive(guildId, war);
      await refreshPanel(interaction.guild, war);
      return interaction.reply({ content: `✅ Removed **${name}** from the kill count.`, ephemeral: true });
    }

    // ── /killcount reset ───────────────────────────────────────────────────
    if (sub === 'reset') {
      if (!isOfficer(interaction.member)) {
        return interaction.reply({ content: 'Only Officers and Commanders can reset the kill count.', ephemeral: true });
      }

      const war = getActive(guildId);
      if (!war) return interaction.reply({ content: 'No active war.', ephemeral: true });

      war.kills = [];
      saveActive(guildId, war);
      await refreshPanel(interaction.guild, war);
      return interaction.reply({ content: '✅ Kill count has been reset to 0.', ephemeral: true });
    }

    // ── /killcount end ─────────────────────────────────────────────────────
    if (sub === 'end') {
      if (!isOfficer(interaction.member)) {
        return interaction.reply({ content: 'Only Officers and Commanders can end a war.', ephemeral: true });
      }

      const war = getActive(guildId);
      if (!war) return interaction.reply({ content: 'No active war.', ephemeral: true });

      // Update panel with a final "War Ended" footer
      const channel = interaction.guild.channels.cache.get(war.channelId)
        ?? await interaction.guild.channels.fetch(war.channelId).catch(() => null);
      if (channel) {
        const msg = await channel.messages.fetch(war.messageId).catch(() => null);
        if (msg) {
          const finalEmbed = buildEmbed(war)
            .setColor(0x95A5A6)
            .setTitle(`📜 Kill Count — ${war.name} (Ended)`);
          await msg.edit({ embeds: [finalEmbed], components: [] }).catch(() => {});
        }
      }

      clearActive(guildId);
      return interaction.reply({ content: `✅ War **${war.name}** has been ended and the panel archived.`, ephemeral: true });
    }
  },

  // ── Button interactions ────────────────────────────────────────────────────────
  async handleButton(interaction) {
    const [action, msgId] = interaction.customId.split(':');
    const war = getActive(interaction.guildId);
    if (!war) return interaction.reply({ content: 'No active war.', ephemeral: true });

    if (action === 'kc_add') {
      if (!canAddKills(interaction.member)) {
        return interaction.reply({ content: 'Only Officers, Commanders and Members can add kills.', ephemeral: true });
      }
      const modal = new ModalBuilder()
        .setCustomId(`kc_add_modal:${msgId}`)
        .setTitle('Add Kills');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('name').setLabel('Tank name').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('amount').setLabel('Number of kills').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. 5')
        ),
      );
      return interaction.showModal(modal);
    }

    if (action === 'kc_reset') {
      if (!isOfficer(interaction.member)) {
        return interaction.reply({ content: 'Only Officers and Commanders can reset the kill count.', ephemeral: true });
      }
      war.kills = [];
      saveActive(interaction.guildId, war);
      await refreshPanel(interaction.guild, war);
      return interaction.reply({ content: '✅ Kill count has been reset to 0.', ephemeral: true });
    }

    if (action === 'kc_end') {
      if (!isOfficer(interaction.member)) {
        return interaction.reply({ content: 'Only Officers and Commanders can end a war.', ephemeral: true });
      }
      const channel = interaction.guild.channels.cache.get(war.channelId)
        ?? await interaction.guild.channels.fetch(war.channelId).catch(() => null);
      if (channel) {
        const msg = await channel.messages.fetch(war.messageId).catch(() => null);
        if (msg) {
          const finalEmbed = buildEmbed(war).setColor(0x95A5A6).setTitle(`📜 Kill Count — ${war.name} (Ended)`);
          await msg.edit({ embeds: [finalEmbed], components: [] }).catch(() => {});
        }
      }
      clearActive(interaction.guildId);
      return interaction.reply({ content: `✅ War **${war.name}** has been ended.`, ephemeral: true });
    }
  },

  // ── Modal submit interactions ──────────────────────────────────────────────────
  async handleModal(interaction) {
    const [action, msgId] = interaction.customId.split(':');

    if (action === 'kc_add_modal') {
      const war = getActive(interaction.guildId);
      if (!war) return interaction.reply({ content: 'No active war.', ephemeral: true });

      const name   = interaction.fields.getTextInputValue('name').trim();
      const amountStr = interaction.fields.getTextInputValue('amount').trim();
      const amount = parseInt(amountStr, 10);

      if (isNaN(amount) || amount < 1) {
        return interaction.reply({ content: '❌ Please enter a valid number of kills (minimum 1).', ephemeral: true });
      }

      war.kills.push({
        name,
        count:          amount,
        reportedBy:     interaction.user.id,
        reportedByName: interaction.member.displayName,
        addedAt:        Date.now(),
      });

      saveActive(interaction.guildId, war);
      await refreshPanel(interaction.guild, war);

      const total = war.kills
        .filter(e => e.name.toLowerCase() === name.toLowerCase())
        .reduce((s, e) => s + e.count, 0);

      return interaction.reply({
        content: `✅ Added **${amount}** kill${amount !== 1 ? 's' : ''} to **${name}** (total: ${total}).`,
        ephemeral: true,
      });
    }
  },
};
