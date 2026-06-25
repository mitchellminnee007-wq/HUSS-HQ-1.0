const fs   = require('node:fs');
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
const { getConfig, getAllConfig } = require('../utils/config');

const DEFAULT_PANEL_CHANNEL_ID = '1509618529274560733';
const OFFICER_RANKS    = ['Officer', 'Commander'];
const DEFAULT_WAR_ROLE_ID = '1424722021325082625';

function isOfficer(member) {
  return member.roles.cache.some(r => OFFICER_RANKS.includes(r.name));
}

function getWarRoleId(guildId) {
  return getConfig(guildId, 'ACTIVE_WAR_ROLE_ID') ?? DEFAULT_WAR_ROLE_ID;
}

// ── Kill count store (mirrors killcount.js) ───────────────────────────────────
const KC_STORE_PATH             = path.join(__dirname, '..', 'data', 'killcount.json');
const DEFAULT_KILLCOUNT_CHANNEL = '1445348388324507688';
const MEDALS                    = ['🥇', '🥈', '🥉'];

function readKCStore() {
  if (!fs.existsSync(KC_STORE_PATH)) return { guilds: {} };
  try { return JSON.parse(fs.readFileSync(KC_STORE_PATH, 'utf8')); }
  catch { return { guilds: {} }; }
}

function writeKCStore(data) {
  const dir = path.dirname(KC_STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(KC_STORE_PATH, JSON.stringify(data, null, 2));
}

function saveKCActive(guildId, data) {
  const store = readKCStore();
  if (!store.guilds[guildId]) store.guilds[guildId] = {};
  store.guilds[guildId].active = data;
  writeKCStore(store);
}

function buildKCEmbed(war) {
  const merged = {};
  for (const e of war.kills) {
    const key = e.name.toLowerCase();
    if (!merged[key]) merged[key] = { name: e.name, count: 0 };
    merged[key].count += e.count;
  }
  const sorted = Object.values(merged).sort((a, b) => b.count - a.count);
  const total  = war.kills.reduce((s, e) => s + e.count, 0);

  const board = sorted.length === 0
    ? '*No kills recorded yet.*'
    : sorted.map((e, i) => `${MEDALS[i] ?? '▪️'} **${e.name}** — ${e.count} kill${e.count !== 1 ? 's' : ''}`).join('\n');

  const submissions = war.kills.length === 0
    ? '*None yet.*'
    : war.kills.slice(-20).map(e => `\`+${e.count}\` **${e.name}** — by ${e.reportedByName}`).join('\n');

  return new EmbedBuilder()
    .setColor(0xE74C3C)
    .setTitle(`⚔️ Kill Count — ${war.name}`)
    .addFields(
      { name: '🏆 Leaderboard', value: board        },
      { name: '📋 Submissions', value: submissions  },
      { name: '📊 Total kills', value: `${total}`, inline: true },
    )
    .setFooter({ text: `Started by ${war.startedByName} • Powered by Hypha` })
    .setTimestamp(war.startedAt);
}

function buildKCPanelRow(msgId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`kc_add:${msgId}`  ).setLabel('Add Kills').setEmoji('➕').setStyle(ButtonStyle.Success  ),
    new ButtonBuilder().setCustomId(`kc_reset:${msgId}`).setLabel('Reset'    ).setEmoji('🔄').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`kc_end:${msgId}`  ).setLabel('End War'  ).setEmoji('📜').setStyle(ButtonStyle.Danger   ),
  );
}

// ── Rollover store (mirrors rollover.js) ──────────────────────────────────────
const ROLLOVER_STORE_PATH = path.join(__dirname, '..', 'data', 'rollover.json');
const ROLLOVER_DAYS       = 4;
const ROLLOVER_MS         = ROLLOVER_DAYS * 24 * 60 * 60 * 1000;
const COLLIE_ROLE_ID      = '1386230860587733123';
const UNVERIFIED_ROLE_ID  = '1386229683963826346';
const FORMER_MEMBER_ROLE_ID = '1426128855202271242';

function readRolloverStore() {
  if (!fs.existsSync(ROLLOVER_STORE_PATH)) return { guilds: {} };
  try { return JSON.parse(fs.readFileSync(ROLLOVER_STORE_PATH, 'utf8')); }
  catch { return { guilds: {} }; }
}

function writeRolloverStore(data) {
  const dir = path.dirname(ROLLOVER_STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ROLLOVER_STORE_PATH, JSON.stringify(data, null, 2));
}

// ── Ticket panel embed + row (mirrors tickets.js) ─────────────────────────────
function buildTicketPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🎫 Support Tickets')
    .setDescription('Choose a category below to open a ticket.\nOur officers will assist you as soon as possible.\nChoisissez une catégorie ci-dessous pour ouvrir un ticket. Nos officiers vous aideront dès que possible.')
    .addFields(
      { name: '✅ Verification',     value: 'Get verified as a member of the guild. / Obtenez votre vérification en tant que membre du clan.' },
      { name: '🤝 Ally Request',     value: 'Request an alliance with our group. / Demandez une alliance avec notre groupe.' },
      { name: '🎖️ Officer Question', value: 'Ask the officer team a private question. / Posez une question privée à l’équipe des officiers.' },
    )
    .setFooter({ text: 'Powered by Hypha' });
}

function buildTicketPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_open:verify' ).setLabel('Verification'    ).setEmoji('✅' ).setStyle(ButtonStyle.Success  ),
    new ButtonBuilder().setCustomId('ticket_open:ally'   ).setLabel('Ally Request'    ).setEmoji('🤝' ).setStyle(ButtonStyle.Primary  ),
    new ButtonBuilder().setCustomId('ticket_open:officer').setLabel('Officer Question').setEmoji('🎖️').setStyle(ButtonStyle.Secondary),
  );
}

// ── War sign-up embed + row (mirrors activemember.js) ─────────────────────────
function buildSignupEmbed(guild) {
  const role     = guild.roles.cache.get(getWarRoleId(guild.id));
  const roleName = role ? role.name : 'Activity Check';
  return new EmbedBuilder()
    .setColor(0xE74C3C)
    .setTitle('Activity Check')
    .setDescription(`We are preparing for a new war and need to know who is ready to ride.\n\nClick **Mark Active** below to add yourself to the **${roleName}** roster.\nClick again to remove yourself.`)
    .setFooter({ text: 'Powered by Hypha' })
    .setTimestamp();
}

function buildSignupRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('activitycheck_join')
      .setLabel('Mark Active')
      .setStyle(ButtonStyle.Danger),
  );
}

// ── Operation create modal (same customId + field IDs as operations.js) ────────
function buildOperationModal() {
  const modal = new ModalBuilder()
    .setCustomId('op_create_modal')
    .setTitle('Create Operation');

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

  return modal;
}

// ── Training create modal (same field IDs as training.js) ────────────────────
function buildTrainingModal() {
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

  return modal;
}

// ── Kill count start modal ────────────────────────────────────────────────────
function buildKCStartModal() {
  return new ModalBuilder()
    .setCustomId('bp_kc_start_modal')
    .setTitle('Start Kill Count')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('kc_war_name')
          .setLabel('War name (e.g. "War 7" or "vs Clan X")')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100),
      ),
    );
}

// ── War sign-up channel modal ─────────────────────────────────────────────────
function buildSignupChannelModal() {
  return new ModalBuilder()
    .setCustomId('bp_activemember_modal')
    .setTitle('Post Activity Check')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('signup_channel')
          .setLabel('Channel ID or #mention to post sign-up in')
          .setPlaceholder('e.g. 1234567890123456789 or #general')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100),
      ),
    );
}

// ── Main panel embed & rows ───────────────────────────────────────────────────
function buildPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0x2C3E50)
    .setTitle('⚙️ Officer Control Panel')
    .setDescription('Quick access to all officer actions. All buttons are officer-only.')
    .addFields(
      { name: '\u2694\ufe0f Operations & Wars', value: '\ud83d\udccb Create an operation event\n\ud83c\udf93 Create a training event\n\ud83c\udfaf Start a kill count tracker\n\u2694\ufe0f Post the activity check panel — **auto-schedules the 4-day rollover**' },
      { name: '🎫 Tickets',           value: '🎫 Post the ticket panel in the verification channel' },
      { name: '🔄 Rollover',          value: '⏳ Manually schedule the 4-day rollover\n✋ Cancel a pending rollover' },
      { name: '⚙️ Config',            value: '⚙️ View current bot configuration for this server' },
    )
    .setFooter({ text: 'Powered by Hypha' });
}

function buildPanelRows() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bp_operation'    ).setLabel('Create Operation').setEmoji('📋').setStyle(ButtonStyle.Primary  ),
    new ButtonBuilder().setCustomId('bp_training'     ).setLabel('Create Training' ).setEmoji('🎓').setStyle(ButtonStyle.Primary  ),
    new ButtonBuilder().setCustomId('bp_killcount'    ).setLabel('Start Kill Count').setEmoji('🎯').setStyle(ButtonStyle.Primary  ),
    new ButtonBuilder().setCustomId('bp_activemember' ).setLabel('Activity Check'  ).setEmoji('⚔️').setStyle(ButtonStyle.Success  ),
    new ButtonBuilder().setCustomId('bp_ticketpanel'  ).setLabel('Ticket Panel'    ).setEmoji('🎫').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bp_rollover_start' ).setLabel('Schedule Rollover').setEmoji('⏳').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('bp_rollover_cancel').setLabel('Cancel Rollover'  ).setEmoji('✋').setStyle(ButtonStyle.Danger   ),
    new ButtonBuilder().setCustomId('bp_config_view'   ).setLabel('View Config'      ).setEmoji('⚙️').setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2];
}

// ── Module export ─────────────────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName('botpanel')
    .setDescription('Post the officer control panel in the panel channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    if (!isOfficer(interaction.member)) {
      return interaction.reply({ content: 'Only Officers and Commanders can post the bot panel.', ephemeral: true });
    }

    if (interaction.channelId !== DEFAULT_PANEL_CHANNEL_ID) {
      return interaction.reply({ content: `❌ This command can only be used in <#${DEFAULT_PANEL_CHANNEL_ID}>.`, ephemeral: true });
    }

    await interaction.channel.send({ embeds: [buildPanelEmbed()], components: buildPanelRows() });
    return interaction.reply({ content: '✅ Officer control panel posted.', ephemeral: true });
  },

  // ── Button handler ──────────────────────────────────────────────────────────
  async handleButton(interaction) {
    if (!isOfficer(interaction.member)) {
      return interaction.reply({ content: '🚫 Only Officers and Commanders can use this panel.', ephemeral: true });
    }

    const action = interaction.customId;

    // ── Create Operation ────────────────────────────────────────────────────
    if (action === 'bp_operation') {
      return interaction.showModal(buildOperationModal());
    }

    // ── Create Training ─────────────────────────────────────────────────────
    if (action === 'bp_training') {
      return interaction.showModal(buildTrainingModal());
    }

    // ── Start Kill Count ────────────────────────────────────────────────────
    if (action === 'bp_killcount') {
      return interaction.showModal(buildKCStartModal());
    }

    // ── Post War Sign-Up ────────────────────────────────────────────────────
    if (action === 'bp_activemember') {
      return interaction.showModal(buildSignupChannelModal());
    }

    // ── Post Ticket Panel ────────────────────────────────────────────────────
    if (action === 'bp_ticketpanel') {
      await interaction.deferReply({ ephemeral: true });

      const verificationChannelId = getConfig(interaction.guildId, 'VERIFICATION_CHANNEL_ID');
      const targetChannel = verificationChannelId
        ? await interaction.guild.channels.fetch(verificationChannelId).catch(() => null)
        : null;

      if (targetChannel) {
        await targetChannel.send({ embeds: [buildTicketPanelEmbed()], components: [buildTicketPanelRow()] });
        return interaction.editReply({ content: `✅ Ticket panel posted in ${targetChannel}.` });
      }

      return interaction.editReply({ content: '❌ No verification channel configured. Set it with `/config set-channel`.' });
    }

    // ── Schedule Rollover ───────────────────────────────────────────────────
    if (action === 'bp_rollover_start') {
      const store = readRolloverStore();
      if (store.guilds[interaction.guildId]) {
        const existing  = store.guilds[interaction.guildId];
        const remaining = Math.ceil((existing.executeAt - Date.now()) / (1000 * 60 * 60));
        return interaction.reply({
          content: `⚠️ A rollover is already scheduled in approximately **${remaining} hour(s)**. Use **Cancel Rollover** first to reschedule.`,
          ephemeral: true,
        });
      }

      const executeAt = Date.now() + ROLLOVER_MS;
      store.guilds[interaction.guildId] = {
        executeAt,
        notifyChannelId: interaction.channelId,
        startedBy:       interaction.user.id,
      };
      writeRolloverStore(store);

      const timestamp = Math.floor(executeAt / 1000);
      const embed = new EmbedBuilder()
        .setColor(0xF39C12)
        .setTitle('⏳ Rollover Scheduled')
        .setDescription(`In **${ROLLOVER_DAYS} days**, all members with <@&${COLLIE_ROLE_ID}> will automatically be moved to <@&${UNVERIFIED_ROLE_ID}> and <@&${FORMER_MEMBER_ROLE_ID}>.`)
        .addFields({ name: 'Executes at', value: `<t:${timestamp}:F> (<t:${timestamp}:R>)` })
        .setFooter({ text: `Scheduled by ${interaction.user.tag} • Powered by Hypha` })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ── Cancel Rollover ─────────────────────────────────────────────────────
    if (action === 'bp_rollover_cancel') {
      const store = readRolloverStore();
      if (!store.guilds[interaction.guildId]) {
        return interaction.reply({ content: '⚠️ There is no rollover scheduled for this server.', ephemeral: true });
      }

      delete store.guilds[interaction.guildId];
      writeRolloverStore(store);

      return interaction.reply({ content: '✅ Scheduled rollover has been **cancelled**.', ephemeral: true });
    }

    // ── View Config ─────────────────────────────────────────────────────────
    if (action === 'bp_config_view') {
      const cfg = getAllConfig(interaction.guildId);
      const keys = [
        ['Welcome Channel',       'WELCOME_CHANNEL_ID'      ],
        ['Verification Channel',  'VERIFICATION_CHANNEL_ID' ],
        ['Rules Channel',         'RULES_CHANNEL_ID'        ],
        ['Leave Log Channel',     'LOG_CHANNEL_ID'          ],
        ['Officer Channel',       'OFFICER_CHANNEL_ID'      ],
        ['Ticket Category',       'TICKET_CATEGORY_ID'      ],
        ['Ticket Log Channel',    'TICKET_LOG_CHANNEL_ID'   ],
        ['Operations Channel',    'OPERATIONS_CHANNEL_ID'   ],
        ['Trainings Channel',     'TRAININGS_CHANNEL_ID'    ],
        ['Kill Count Channel',    'KILLCOUNT_CHANNEL_ID'    ],
        ['Welcome Image URL',     'WELCOME_IMAGE_URL'       ],
      ];

      const fields = keys.map(([label, key]) => {
        const val = cfg[key];
        const display = val
          ? (key.endsWith('_CHANNEL_ID') || key.endsWith('_CATEGORY_ID') ? `<#${val}>` : val)
          : '*Not set*';
        return { name: label, value: display, inline: true };
      });

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`⚙️ Bot Config — ${interaction.guild.name}`)
        .addFields(fields)
        .setFooter({ text: 'Use /config set-channel to update • Powered by Hypha' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },

  // ── Modal submit handler ────────────────────────────────────────────────────
  async handleModal(interaction) {
    const [prefix] = interaction.customId.split(':');

    // ── Kill count start ────────────────────────────────────────────────────
    if (interaction.customId === 'bp_kc_start_modal') {
      if (!isOfficer(interaction.member)) {
        return interaction.reply({ content: '🚫 Only Officers and Commanders can start a war.', ephemeral: true });
      }

      const name = interaction.fields.getTextInputValue('kc_war_name').trim();
      await interaction.deferReply({ ephemeral: true });

      const channelId = getConfig(interaction.guildId, 'KILLCOUNT_CHANNEL_ID') ?? DEFAULT_KILLCOUNT_CHANNEL;
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

      const msg = await channel.send({ embeds: [buildKCEmbed(war)], components: [buildKCPanelRow('placeholder')] });
      war.messageId = msg.id;
      await msg.edit({ embeds: [buildKCEmbed(war)], components: [buildKCPanelRow(msg.id)] });
      saveKCActive(interaction.guildId, war);

      return interaction.editReply(`✅ Kill count panel for **${name}** posted in ${channel}.`);
    }

    // ── War sign-up (+ auto-schedule rollover) ─────────────────────────────
    if (interaction.customId === 'bp_activemember_modal') {
      if (!isOfficer(interaction.member)) {
        return interaction.reply({ content: 'Only Officers and Commanders can post an activity check.', ephemeral: true });
      }

      const raw = interaction.fields.getTextInputValue('signup_channel').trim();
      // Accept raw ID, <#ID>, or #name (we'll try to parse the ID)
      const channelId = raw.replace(/[<#>]/g, '').trim();

      await interaction.deferReply({ ephemeral: true });

      const channel = interaction.guild.channels.cache.get(channelId)
        ?? await interaction.guild.channels.fetch(channelId).catch(() => null);

      if (!channel) {
        return interaction.editReply('❌ Could not find that channel. Please use the channel ID (numbers only) or copy the mention from Discord.');
      }

      await channel.send({ embeds: [buildSignupEmbed(interaction.guild)], components: [buildSignupRow()] });

      // Automatically schedule the rollover whenever a war sign-up is posted
      const rolloverStore = readRolloverStore();
      const executeAt     = Date.now() + ROLLOVER_MS;
      rolloverStore.guilds[interaction.guildId] = {
        executeAt,
        notifyChannelId: interaction.channelId,
        startedBy:       interaction.user.id,
      };
      writeRolloverStore(rolloverStore);

      const timestamp = Math.floor(executeAt / 1000);
      return interaction.editReply(
        `✅ Activity check posted in ${channel}.
⏳ Rollover automatically scheduled — executes <t:${timestamp}:R> (<t:${timestamp}:F>).`
      );
    }
  },
};
