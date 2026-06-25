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

// ── Vehicle name normalisation ────────────────────────────────────────────────
// Keys are lowercased/punctuation-stripped variants; values are canonical names.
const VEHICLE_ALIASES = {
  'bonecar':              'Bonecar',
  'outlaw':               'Outlaw',
  '68mm pushgun':         '68mm Pushgun',
  '68mm push gun':        '68mm Pushgun',
  'devitt':               'Devitt',
  'eat':                  'EAT',
  'brigand':              'Brigand',
  'widow':                'Widow',
  'at ht':                'AT HT',
  'aa lt':                'AA LT',
  '40mm pushgun':         '40mm Pushgun',
  '40mm push gun':        '40mm Pushgun',
  'silverhand':           'Silverhand',
  '150 artillery gun':    '150 Artillery Gun',
  '150mm artillery gun':  '150 Artillery Gun',
  'htd':                  'HTD',
  'lordscar':             'Lordscar',
  'heavy truck':          'Heavy Truck',
  'acv':                  'ACV',
  'halftrack':            'Halftrack',
  'medium ship':          'Medium Ship',
  'mg car':               'MG Car',
  'scout plane':          'Scout Plane',
  'aa mobile tank':       'AA Mobile Tank',
  'hatchet':              'Hatchet',
  'scout lt':             'Scout LT',
  'emplaced at':          'Emplaced AT',
  'aa gun':               'AA Gun',
  '120mm':                '120mm',
  'sht':                  'SHT',
  'talos':                 'Talos',
  'scout tank':              'Scout Tank',
};

/**
 * Normalise a raw vehicle name entered by a user.
 * Strips trailing punctuation (e.g. "halftrack?") and resolves aliases so that
 * "halftrack", "Halftrack", and "halftrack?" all become "Halftrack".
 */
function normalizeName(raw) {
  const stripped = raw.trim().replace(/[?!.,;:]+$/, '');
  return VEHICLE_ALIASES[stripped.toLowerCase()] ?? stripped;
}

// Unique canonical vehicle names derived from the alias map.
const CANONICAL_NAMES = [...new Set(Object.values(VEHICLE_ALIASES))];

/** Levenshtein distance between two strings (case-insensitive). */
function levenshtein(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

/**
 * Resolve a raw user input to a canonical vehicle name with fuzzy matching.
 * Returns { name, autoFixed, originalRaw, suggestion }
 *   - autoFixed:  true  → typo was silently corrected (distance ≤ 2)
 *   - suggestion: string → close match found but not auto-corrected (distance 3–4)
 *   - otherwise the name is returned as-is (unknown vehicle, stored verbatim)
 */
function resolveVehicleInput(raw) {
  const stripped = raw.trim().replace(/[?!.,;:]+$/, '');
  // Exact alias match (handles casing & trailing punctuation)
  const exact = VEHICLE_ALIASES[stripped.toLowerCase()];
  if (exact) return { name: exact, autoFixed: exact !== stripped, originalRaw: stripped, suggestion: null };

  // Fuzzy match against all canonical names
  let best = null, bestDist = Infinity;
  for (const canonical of CANONICAL_NAMES) {
    const d = levenshtein(stripped, canonical);
    if (d < bestDist) { bestDist = d; best = canonical; }
  }

  if (bestDist <= 2) {
    // Very close — auto-correct silently (with a note in the reply)
    return { name: best, autoFixed: true, originalRaw: stripped, suggestion: null };
  }
  if (bestDist <= 4) {
    // Somewhat close — reject and suggest
    return { name: stripped, autoFixed: false, originalRaw: stripped, suggestion: best };
  }
  // No close match — store verbatim
  return { name: stripped, autoFixed: false, originalRaw: stripped, suggestion: null };
}

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
  const war = readStore().guilds[guildId]?.active ?? null;
  if (war) {
    // Normalise any previously stored kill names (fixes old casing, trailing punctuation, etc.)
    war.kills = war.kills.map(e => ({ ...e, name: normalizeName(e.name) }));
  }
  return war;
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

// ── UI helpers ───────────────────────────────────────────────────────────────
/**
 * Renders a compact ASCII progress bar.
 * e.g. killBar(3, 5, 8) → '█████░░░'
 */
function killBar(count, max, width = 8) {
  if (max <= 0) return '░'.repeat(width);
  const filled = Math.round((count / max) * width);
  return '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, width - filled));
}

/** Format milliseconds as '1h 23m' or '45m'. */
function formatDuration(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  const hours   = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// ── Build kill count embed ────────────────────────────────────────────────────
/**
 * @param {object}  war    Active-war data object.
 * @param {boolean} ended  When true, renders the archived "Battle Report" variant.
 */
function buildEmbed(war, ended = false) {
  // Merge kills per vehicle for the leaderboard
  const merged = {};
  for (const e of war.kills) {
    const key = e.name.toLowerCase();
    if (!merged[key]) merged[key] = { name: e.name, count: 0 };
    merged[key].count += e.count;
  }
  const sorted     = Object.values(merged).sort((a, b) => b.count - a.count);
  const total      = war.kills.reduce((s, e) => s + e.count, 0);
  const maxKills   = sorted[0]?.count ?? 1;
  const combatants = sorted.length;

  // ── Leaderboard ─────────────────────────────────────────────────────────
  let board;
  if (sorted.length === 0) {
    board = '*No kills recorded yet.*';
  } else {
    board = sorted.map((e, i) => {
      const medal = MEDALS[i] ?? `\`${String(i + 1).padStart(2)}\``;
      const bar   = killBar(e.count, maxKills);
      return `${medal} **${e.name}**  \`${bar}\`  **${e.count}**`;
    }).join('\n');
  }

  // ── Recent submissions ───────────────────────────────────────────────────
  let submissions;
  if (war.kills.length === 0) {
    submissions = '*No submissions yet.*';
  } else {
    const recent = war.kills.slice(-12);
    submissions  = recent
      .map(e => `\`+${e.count}\` **${e.name}** ↳ *${e.reportedByName}*`)
      .join('\n');
    if (war.kills.length > 12)
      submissions = `*...${war.kills.length - 12} earlier entries hidden*\n` + submissions;
  }

  // ── Duration ─────────────────────────────────────────────────────────────
  const duration = formatDuration(Date.now() - war.startedAt);

  // ── Status description ───────────────────────────────────────────────────
  const statusLine = ended
    ? '> 🏁  This war has concluded — final results below.'
    : '> ⚔️  War is **active** — use the buttons below to log kills.';

  return new EmbedBuilder()
    .setColor(ended ? 0x2C3E50 : 0xC0392B)
    .setTitle(ended ? `📜 Battle Report — ${war.name}` : `⚔️  Kill Count — ${war.name}`)
    .setDescription(statusLine)
    .addFields(
      { name: '🏆 Leaderboard',         value: board                    },
      { name: '📋 Recent Submissions',  value: submissions              },
      { name: '💀 Total Kills',         value: `\`${total}\``,         inline: true },
      { name: '🪖 Combatants',          value: `\`${combatants}\``,    inline: true },
      { name: '⏱️ Duration',            value: `\`${duration}\``,      inline: true },
    )
    .setFooter({ text: `⚔️ HUSS Command  •  Started by ${war.startedByName}` })
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

      const resolved = resolveVehicleInput(interaction.options.getString('name', true));
      const amount   = interaction.options.getInteger('amount', true);

      if (resolved.suggestion) {
        return interaction.reply({
          content: `❌ Unknown vehicle **${resolved.originalRaw}**. Did you mean **${resolved.suggestion}**?`,
          ephemeral: true,
        });
      }

      const name = resolved.name;

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

      const note = resolved.autoFixed ? ` *(auto-corrected from '${resolved.originalRaw}')*` : '';
      return interaction.reply({
        content: `✅ Added **${amount}** kill${amount !== 1 ? 's' : ''} to **${name}** (total: ${total}).${note}`,
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

      const name   = normalizeName(interaction.options.getString('name', true));
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
          const finalEmbed = buildEmbed(war, true);
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
          const finalEmbed = buildEmbed(war, true);
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

      const resolved   = resolveVehicleInput(interaction.fields.getTextInputValue('name'));
      const amountStr = interaction.fields.getTextInputValue('amount').trim();
      const amount = parseInt(amountStr, 10);

      if (isNaN(amount) || amount < 1) {
        return interaction.reply({ content: '❌ Please enter a valid number of kills (minimum 1).', ephemeral: true });
      }

      if (resolved.suggestion) {
        return interaction.reply({
          content: `❌ Unknown vehicle **${resolved.originalRaw}**. Did you mean **${resolved.suggestion}**?`,
          ephemeral: true,
        });
      }

      const name = resolved.name;

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

      const note = resolved.autoFixed ? ` *(auto-corrected from '${resolved.originalRaw}')*` : '';
      return interaction.reply({
        content: `✅ Added **${amount}** kill${amount !== 1 ? 's' : ''} to **${name}** (total: ${total}).${note}`,
        ephemeral: true,
      });
    }
  },
};
