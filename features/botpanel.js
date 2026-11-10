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
const adminPanel = require('../utils/admin-panel');

const OFFICER_RANKS = ['Officer', 'Commander'];
const DEFAULT_WAR_ROLE_ID = '1424722021325082625';
const DEFAULT_ACTIVITY_TIMER_MINUTES = 5760;

function isOfficer(member) {
  return member.roles.cache.some(r => OFFICER_RANKS.includes(r.name));
}

function getWarRoleId(guildId) {
  return getConfig(guildId, 'ACTIVE_WAR_ROLE_ID') ?? DEFAULT_WAR_ROLE_ID;
}

// ── Kill count store ──────────────────────────────────────────────────────────
const KC_STORE_PATH = path.join(__dirname, '..', 'data', 'killcount.json');
const DEFAULT_KILLCOUNT_CHANNEL = '1445348388324507688';
const MEDALS = ['🥇', '🥈', '🥉'];

function readKCStore() {
  if (!fs.existsSync(KC_STORE_PATH)) return { guilds: {} };

  try {
    return JSON.parse(fs.readFileSync(KC_STORE_PATH, 'utf8'));
  } catch {
    return { guilds: {} };
  }
}

function writeKCStore(data) {
  const dir = path.dirname(KC_STORE_PATH);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(KC_STORE_PATH, JSON.stringify(data, null, 2));
}

function saveKCActive(guildId, data) {
  const store = readKCStore();

  if (!store.guilds[guildId]) {
    store.guilds[guildId] = {};
  }

  store.guilds[guildId].active = data;
  writeKCStore(store);
}

function buildKCEmbed(war) {
  const merged = {};

  for (const e of war.kills) {
    const key = e.name.toLowerCase();

    if (!merged[key]) {
      merged[key] = { name: e.name, count: 0 };
    }

    merged[key].count += e.count;
  }

  const sorted = Object.values(merged).sort((a, b) => b.count - a.count);
  const total = war.kills.reduce((s, e) => s + e.count, 0);

  const board = sorted.length === 0
    ? '*No kills recorded yet.*'
    : sorted
        .map((e, i) => `${MEDALS[i] ?? '▪️'} **${e.name}** — ${e.count} kill${e.count !== 1 ? 's' : ''}`)
        .join('\n');

  const submissions = war.kills.length === 0
    ? '*None yet.*'
    : war.kills
        .slice(-20)
        .map(e => `\`+${e.count}\` **${e.name}** — by ${e.reportedByName}`)
        .join('\n');

  return new EmbedBuilder()
    .setColor(0xE74C3C)
    .setTitle(`⚔️ Kill Count — ${war.name}`)
    .addFields(
      { name: '🏆 Leaderboard', value: board },
      { name: '📋 Submissions', value: submissions },
      { name: '📊 Total kills', value: `${total}`, inline: true },
    )
    .setFooter({ text: `Started by ${war.startedByName} • Powered by Hypha` })
    .setTimestamp(war.startedAt);
}

function buildKCPanelRow(msgId) {
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

// ── Rollover store ────────────────────────────────────────────────────────────
const ROLLOVER_STORE_PATH = path.join(__dirname, '..', 'data', 'rollover.json');
const ROLLOVER_DAYS = 4;
const ROLLOVER_MS = ROLLOVER_DAYS * 24 * 60 * 60 * 1000;
const UNVERIFIED_ROLE_ID = '1386229683963826346';
const FORMER_MEMBER_ROLE_ID = '1426128855202271242';

function readRolloverStore() {
  if (!fs.existsSync(ROLLOVER_STORE_PATH)) return { guilds: {} };

  try {
    return JSON.parse(fs.readFileSync(ROLLOVER_STORE_PATH, 'utf8'));
  } catch {
    return { guilds: {} };
  }
}

function writeRolloverStore(data) {
  const dir = path.dirname(ROLLOVER_STORE_PATH);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(ROLLOVER_STORE_PATH, JSON.stringify(data, null, 2));
}

// ── Ticket panel embed + row ──────────────────────────────────────────────────
function buildTicketPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🎫 Support Tickets')
    .setDescription(
      '**Verification & allies:** send your F1 screenshot by DM after clicking below. An officer reviews it on the server and sends you the result.\n' +
      '**Vérification et alliés :** envoyez votre capture F1 en MP après avoir cliqué ci-dessous. Un officier examine votre demande et vous communique le résultat.\n\n' +
      'Officer questions open a private server ticket. / Les questions ouvrent un ticket privé sur le serveur.'
    )
    .addFields(
      {
        name: '✅ Verification',
        value: 'Get verified as a member of the guild. / Obtenez votre vérification en tant que membre du clan.',
      },
      {
        name: '🤝 Ally Request',
        value: 'Send your F1 screenshot and clan name by DM. / Envoyez votre capture F1 et le nom de votre clan en MP.',
      },
      {
        name: '🎖️ Officer Question',
        value: 'Ask the officer team a private question. / Posez une question privée à l’équipe des officiers.',
      },
    )
    .setFooter({ text: 'Powered by Hypha' });
}

function buildTicketPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_open:verify')
      .setLabel('Verification')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId('ticket_open:ally')
      .setLabel('Ally Request')
      .setEmoji('🤝')
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId('ticket_open:officer')
      .setLabel('Officer Question')
      .setEmoji('🎖️')
      .setStyle(ButtonStyle.Secondary),
  );
}

// ── Activity Check embed + row ────────────────────────────────────────────────
function buildSignupEmbed(guild, endUnix, closed = false) {
  const role = guild.roles.cache.get(getWarRoleId(guild.id));
  const roleName = role ? role.name : 'Activity Check';

  const description = closed
    ? `This activity check is now closed.\n\n` +
      `The **${roleName}** roster is locked for this check.\n\n` +
      `✅ **Closed:** <t:${endUnix}:F>`
    : `We are preparing for a new war and need to know who is ready to ride.\n\n` +
      `Click **Mark Active** below to add yourself to the **${roleName}** roster.\n` +
      `Click again to remove yourself.\n\n` +
      `⏳ **Closes:** <t:${endUnix}:R>\n` +
      `🕒 **Exact time:** <t:${endUnix}:F>`;

  return new EmbedBuilder()
    .setColor(closed ? 0x7F8C8D : 0xE74C3C)
    .setTitle(closed ? 'Activity Check Closed' : 'Activity Check')
    .setDescription(description)
    .setFooter({ text: 'Powered by Hypha' })
    .setTimestamp();
}

function buildSignupRow(endUnix, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`activitycheck_join_${endUnix}`)
      .setLabel(disabled ? 'Activity Check Closed' : 'Mark Active')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`activitycheck_cancel_${endUnix}`)
      .setLabel(disabled ? 'Activity Check Closed' : 'Cancel Activity Check')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

// ── Operation create modal ────────────────────────────────────────────────────
function buildOperationModal() {
  const modal = new ModalBuilder()
    .setCustomId('op_create_modal')
    .setTitle('Create Operation');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('title')
        .setLabel('Title')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100),
    ),

    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Description')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000),
    ),

    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('time')
        .setLabel('Date & Time (DD/MM/YYYY HH:MM)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('28/05/2026 19:00'),
    ),
  );

  return modal;
}

// ── Training create modal ─────────────────────────────────────────────────────
function buildTrainingModal() {
  const modal = new ModalBuilder()
    .setCustomId('tr_create_modal')
    .setTitle('Create Training');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('title')
        .setLabel('Title')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100),
    ),

    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Description')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000),
    ),

    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('time')
        .setLabel('Date & Time (DD/MM/YYYY HH:MM)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('28/05/2026 19:00'),
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

// ── Activity Check modal ──────────────────────────────────────────────────────
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

      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('signup_minutes')
          .setLabel('Timer in minutes')
          .setPlaceholder('e.g. 30, 60, 1440, 5760')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(10),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('signup_rollover')
          .setLabel('Schedule 4-day rollover? Type YES to enable')
          .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(3)
          .setPlaceholder('NO — activity check only'),
      ),
    );
}

// ── Module export ─────────────────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName('botpanel')
    .setDescription('Post the HUSS admin dashboard in a private channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    if (!isOfficer(interaction.member)) {
      return interaction.reply({
        content: 'Only Officers and Commanders can post the bot panel.',
        ephemeral: true,
      });
    }

    const panelChannelId = getConfig(interaction.guildId, 'ADMIN_PANEL_CHANNEL_ID');
    if (panelChannelId && interaction.channelId !== panelChannelId) {
      return interaction.reply({
        content: `Post the admin dashboard in <#${panelChannelId}> or change Admin Panel Channel with /config.`,
        ephemeral: true,
      });
    }

    if (interaction.channel.permissionsFor(interaction.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)) {
      return interaction.reply({ content: 'Post this dashboard in a private officer channel. Deny View Channel for @everyone first.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    await interaction.channel.send(adminPanel.buildPage(interaction.guild));

    return interaction.editReply({
      content: '✅ HUSS admin dashboard posted.',
    });
  },

  // ── Button handler ──────────────────────────────────────────────────────────
  async handleButton(interaction) {
    if (!isOfficer(interaction.member)) {
      return interaction.reply({
        content: '🚫 Only Officers and Commanders can use this panel.',
        ephemeral: true,
      });
    }

    const action = interaction.customId;

    if (action.startsWith('bp_page:') || action === 'bp_config_view') {
      const [, page, offset] = action.split(':');
      const payload = adminPanel.buildPage(interaction.guild, action === 'bp_config_view' ? 'settings' : page, Number(offset || 0));
      if (interaction.message.flags?.has(64)) return interaction.update({ content: null, ...payload });
      return interaction.reply({ ...payload, ephemeral: true });
    }
    if (action.startsWith('bp_setup:')) {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'Manage Server permission is required to edit settings.', ephemeral: true });
      const modal = adminPanel.buildSettingsModal(interaction.guildId, action.split(':')[1]);
      if (!modal) return interaction.reply({ content: 'Unknown settings form.', ephemeral: true });
      return interaction.showModal(modal);
    }

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

    // ── Post Activity Check ─────────────────────────────────────────────────
    if (action === 'bp_activemember') {
      return interaction.showModal(buildSignupChannelModal());
    }

    // ── Post Ticket Panel ───────────────────────────────────────────────────
    if (action === 'bp_ticketpanel') {
      await interaction.deferReply({ ephemeral: true });

      const verificationChannelId = getConfig(interaction.guildId, 'VERIFICATION_CHANNEL_ID');

      const targetChannel = verificationChannelId
        ? await interaction.guild.channels.fetch(verificationChannelId).catch(() => null)
        : null;

      if (targetChannel) {
        await targetChannel.send({
          embeds: [buildTicketPanelEmbed()],
          components: [buildTicketPanelRow()],
        });

        return interaction.editReply({
          content: `✅ Ticket panel posted in ${targetChannel}.`,
        });
      }

      return interaction.editReply({
        content: '❌ No verification channel configured. Set it with `/config set-channel`.',
      });
    }

    // ── Schedule Rollover ───────────────────────────────────────────────────
    if (action === 'bp_rollover_start') {
      return interaction.reply({
        content: 'Schedule the rollover for four days from now? The rollover resets non-active members: eligible roles are removed and Unverified + Former Member are assigned. The rollover service applies its existing exemptions. Confirm only when the activity roster is ready.',
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('bp_rollover_confirm').setLabel('Confirm 4-day rollover').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('bp_page:war').setLabel('Back to war management').setStyle(ButtonStyle.Secondary),
        )], ephemeral: true,
      });
    }
    if (action === 'bp_rollover_confirm') {
      const store = readRolloverStore();

      if (store.guilds[interaction.guildId]) {
        const existing = store.guilds[interaction.guildId];
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
        startedBy: interaction.user.id,
      };

      writeRolloverStore(store);

      const timestamp = Math.floor(executeAt / 1000);

      const embed = new EmbedBuilder()
        .setColor(0xF39C12)
        .setTitle('⏳ Rollover Scheduled')
        .setDescription(
          `In **${ROLLOVER_DAYS} days**, the rollover service resets non-active members, applying its existing exemptions, and assigns <@&${UNVERIFIED_ROLE_ID}> and <@&${FORMER_MEMBER_ROLE_ID}>.`
        )
        .addFields({
          name: 'Executes at',
          value: `<t:${timestamp}:F> (<t:${timestamp}:R>)`,
        })
        .setFooter({
          text: `Scheduled by ${interaction.user.tag} • Powered by Hypha`,
        })
        .setTimestamp();

      return interaction.reply({
        embeds: [embed],
        ephemeral: true,
      });
    }

    // ── Cancel Rollover ─────────────────────────────────────────────────────
    if (action === 'bp_rollover_cancel') {
      const store = readRolloverStore();

      if (!store.guilds[interaction.guildId]) {
        return interaction.reply({
          content: '⚠️ There is no rollover scheduled for this server.',
          ephemeral: true,
        });
      }

      delete store.guilds[interaction.guildId];
      writeRolloverStore(store);

      return interaction.reply({
        content: '✅ Scheduled rollover has been **cancelled**.',
        ephemeral: true,
      });
    }

  },

  // ── Modal submit handler ────────────────────────────────────────────────────
  async handleModal(interaction) {
    if (!isOfficer(interaction.member)) return interaction.reply({ content: 'Only Officers and Commanders can use this panel.', ephemeral: true });
    if (interaction.customId.startsWith('bp_setup_modal:')) return adminPanel.saveSettings(interaction, interaction.customId.split(':')[1]);
    // ── Kill count start ────────────────────────────────────────────────────
    if (interaction.customId === 'bp_kc_start_modal') {
      if (!isOfficer(interaction.member)) {
        return interaction.reply({
          content: '🚫 Only Officers and Commanders can start a war.',
          ephemeral: true,
        });
      }

      const name = interaction.fields.getTextInputValue('kc_war_name').trim();

      await interaction.deferReply({ ephemeral: true });

      if (readKCStore().guilds[interaction.guildId]?.active) {
        return interaction.editReply('A kill count tracker is already active. End it from its existing panel before starting another.');
      }

      const channelId = getConfig(interaction.guildId, 'KILLCOUNT_CHANNEL_ID') ?? DEFAULT_KILLCOUNT_CHANNEL;

      const channel = interaction.guild.channels.cache.get(channelId)
        ?? await interaction.guild.channels.fetch(channelId).catch(() => null);

      if (!channel) {
        return interaction.editReply(
          '❌ Kill count channel not found. Set it with `/config set-channel`.'
        );
      }

      const war = {
        name,
        channelId,
        messageId: null,
        kills: [],
        startedAt: Date.now(),
        startedBy: interaction.user.id,
        startedByName: interaction.member.displayName,
      };

      const msg = await channel.send({
        embeds: [buildKCEmbed(war)],
        components: [buildKCPanelRow('placeholder')],
      });

      war.messageId = msg.id;

      await msg.edit({
        embeds: [buildKCEmbed(war)],
        components: [buildKCPanelRow(msg.id)],
      });

      saveKCActive(interaction.guildId, war);

      return interaction.editReply(
        `✅ Kill count panel for **${name}** posted in ${channel}.`
      );
    }

    // ── Activity Check + auto-schedule rollover ─────────────────────────────
    if (interaction.customId === 'bp_activemember_modal') {
      if (!isOfficer(interaction.member)) {
        return interaction.reply({
          content: 'Only Officers and Commanders can post an activity check.',
          ephemeral: true,
        });
      }

      const raw = interaction.fields.getTextInputValue('signup_channel').trim();
      const channelId = raw.replace(/[<#>]/g, '').trim();

      const minutesRaw = interaction.fields.getTextInputValue('signup_minutes').trim();
      // Older forms opened before a restart may not include this optional field.
      const rolloverInput = interaction.fields.fields.get('signup_rollover')?.value?.trim().toUpperCase() || 'NO';
      if (!['YES', 'NO'].includes(rolloverInput)) return interaction.reply({ content: 'Enter YES or NO for rollover scheduling.', ephemeral: true });
      const scheduleRollover = rolloverInput === 'YES';
      let minutes = Number(minutesRaw);

      if (!minutesRaw) {
        minutes = DEFAULT_ACTIVITY_TIMER_MINUTES;
      }
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > DEFAULT_ACTIVITY_TIMER_MINUTES) return interaction.reply({ content: `Timer must be a whole number from 1 to ${DEFAULT_ACTIVITY_TIMER_MINUTES} minutes.`, ephemeral: true });

      await interaction.deferReply({ ephemeral: true });

      const channel = interaction.guild.channels.cache.get(channelId)
        ?? await interaction.guild.channels.fetch(channelId).catch(() => null);

      if (!channel) {
        return interaction.editReply(
          '❌ Could not find that channel. Please use the channel ID (numbers only) or copy the mention from Discord.'
        );
      }

      const endUnix = Math.floor((Date.now() + minutes * 60 * 1000) / 1000);

      const activityMessage = await channel.send({
        embeds: [buildSignupEmbed(interaction.guild, endUnix)],
        components: [buildSignupRow(endUnix)],
      });
      require('../utils/activity-store').register(activityMessage, interaction.guildId, endUnix);

      setTimeout(async () => {
        try {
          const currentMessage = await activityMessage.channel.messages.fetch(activityMessage.id).catch(() => null);

          if (!currentMessage || currentMessage.embeds[0]?.title !== 'Activity Check') {
            return;
          }

          await activityMessage.edit({
            embeds: [buildSignupEmbed(interaction.guild, endUnix, true)],
            components: [buildSignupRow(endUnix, true)],
          });
        } catch (error) {
          console.error('Could not close activity check from bot panel:', error);
        }
      }, minutes * 60 * 1000);

      // Opt in explicitly; never replace an existing scheduled rollover.
      const rolloverStore = readRolloverStore();
      const executeAt = Date.now() + ROLLOVER_MS;

      const existingRollover = rolloverStore.guilds[interaction.guildId];
      if (scheduleRollover && !existingRollover) {
        rolloverStore.guilds[interaction.guildId] = {
        executeAt,
        notifyChannelId: interaction.channelId,
        startedBy: interaction.user.id,
        };
        writeRolloverStore(rolloverStore);
      }

      const timestamp = Math.floor(executeAt / 1000);

      return interaction.editReply(
        `✅ Activity check posted in ${channel}.\n` +
        `⏳ Activity check closes <t:${endUnix}:R> (<t:${endUnix}:F>).\n` +
        (existingRollover ? 'Existing rollover schedule preserved.' : scheduleRollover ? `⏳ Rollover scheduled — executes <t:${timestamp}:R> (<t:${timestamp}:F>).` : 'No rollover scheduled by this activity check.')
      );
    }
  },
};
