const fs = require('../utils/data-fs');
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
  ChannelType,
} = require('discord.js');
const { getConfig } = require('../utils/config');
const verification = require('../utils/verification');

const STORE_PATH   = path.join(__dirname, '..', 'data', 'tickets.json');
const OFFICER_RANKS = ['Officer', 'Commander'];
const TICKET_COLOR  = 0x5865F2;

const TICKET_TYPES = {
  verify:  { label: 'Verification',     emoji: '✅' },
  ally:    { label: 'Ally Request',     emoji: '🤝' },
  officer: { label: 'Officer Question', emoji: '🎖️' },
};

// ── Store helpers ─────────────────────────────────────────────────────────────
function readStore() {
  if (!fs.existsSync(STORE_PATH)) return { guilds: {} };
  return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
}

function writeStore(data) {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

function saveTicket(guildId, channelId, data) {
  const store = readStore();
  if (!store.guilds[guildId]) store.guilds[guildId] = {};
  store.guilds[guildId][channelId] = data;
  writeStore(store);
}

function getTicket(guildId, channelId) {
  return readStore().guilds[guildId]?.[channelId] || null;
}

function deleteTicket(guildId, channelId) {
  const store = readStore();
  if (store.guilds[guildId]) {
    delete store.guilds[guildId][channelId];
    writeStore(store);
  }
}

const TRANSCRIPT_DIR = path.join(__dirname, '..', 'data', 'ticket-transcripts');

function ensureTranscriptDir() {
  if (!fs.existsSync(TRANSCRIPT_DIR)) fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });
}

function writeTranscript(filename, content) {
  ensureTranscriptDir();
  fs.writeFileSync(path.join(TRANSCRIPT_DIR, filename), content, 'utf8');
}

function cleanupOldTranscripts(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  ensureTranscriptDir();
  const files = fs.readdirSync(TRANSCRIPT_DIR);
  const now = Date.now();
  for (const file of files) {
    const filePath = path.join(TRANSCRIPT_DIR, file);
    try {
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs > maxAgeMs) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // ignore cleanup failures
    }
  }
}

function isRecruitmentOfficer(member) {
  if (require('../utils/ranks').isOfficer(member)) return true;
  const recruitmentRoleId = getConfig(member.guild.id, 'RECRUITMENT_OFFICER_ROLE_ID');
  if (recruitmentRoleId) {
    return member.roles.cache.has(recruitmentRoleId);
  }
  return require('../utils/ranks').isOfficer(member);
}

function sanitizeName(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 25);
}

// ── Ticket embed ──────────────────────────────────────────────────────────────
function buildTicketEmbed(ticket) {
  const type = TICKET_TYPES[ticket.type];
  const statusLine = ticket.claimedBy
    ? `> 👤  Claimed by <@${ticket.claimedBy}>`
    : '> ⏳  Awaiting an officer to claim this ticket.';
  const embed = new EmbedBuilder()
    .setColor(TICKET_COLOR)
    .setTitle(`${type.emoji}  ${type.label}`)
    .setDescription(statusLine)
    .addFields(
      { name: '👤  Opened by',  value: `<@${ticket.userId}>`,                                       inline: true },
      { name: '🔖  Claimed by', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '*Unclaimed*', inline: true },
    )
    .setFooter({ text: '⚔️ HUSS Ticket System' })
    .setTimestamp(ticket.createdAt);

  if ((ticket.type === 'verify' || ticket.type === 'ally') && fs.existsSync(path.join(__dirname, '..', 'Supporting things', 'F1Screenshot.png'))) {
    embed.setImage('attachment://F1Screenshot.png');
  }

  return embed;
}

// ── Action buttons (inside ticket) ───────────────────────────────────────────
function buildActionRow(channelId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_claim:${channelId}`)
      .setLabel('Claim Ticket')
      .setEmoji('👤')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`ticket_close:${channelId}`)
      .setLabel('Close Ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`ticket_closereason:${channelId}`)
      .setLabel('Close with Reason')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Danger),
  );
}

// ── Open a new ticket ─────────────────────────────────────────────────────────
const openingTickets = new Set();
async function openTicket(interaction, type, options = {}) {
  const key = `${interaction.guildId}:${options.user?.id || interaction.user.id}:${type}`;
  if (openingTickets.has(key)) {
    if (options.followup || options.returnChannel) throw new Error('A question ticket is already being created. Retry approval shortly.');
    return interaction.reply({ content: 'Your ticket is already being created. Please wait.', ephemeral: true });
  }
  openingTickets.add(key);
  try { return await openTicketUnlocked(interaction, type, options); }
  finally { openingTickets.delete(key); }
}
async function openTicketUnlocked(interaction, type, { user = interaction.user, followup = false, returnChannel = false } = {}) {
  if (!followup && !returnChannel) await interaction.deferReply({ ephemeral: true });

  const guild   = interaction.guild;
  const guildId = guild.id;

  // Prevent duplicate open tickets of the same type, but remove stale records for deleted channels
  const store = readStore();
  const existing = Object.entries(store.guilds[guildId] || {})
    .find(([, t]) => t.userId === user.id && t.type === type);
  if (existing) {
    const [existingChannelId] = existing;
    const existingChannel = guild.channels.cache.get(existingChannelId)
      || await guild.channels.fetch(existingChannelId).catch(() => null);
    if (!existingChannel) {
      deleteTicket(guildId, existingChannelId);
    } else {
      if (followup || returnChannel) return existingChannel;
      return interaction.editReply({ content: `You already have an open **${TICKET_TYPES[type].label}** ticket: <#${existingChannelId}>. Please use that one or ask a recruitment officer to close it first.` });
    }
  }

  const safeName    = sanitizeName(user.username);
  const channelName = `ticket-${safeName}`;

  // Resolve category — validate it's actually a category channel
  const DEFAULT_CATEGORY_ID = '1394640780685217896';
  const configCategoryId    = getConfig(guildId, 'TICKET_CATEGORY_ID');
  const resolvedCategoryId  = configCategoryId ?? DEFAULT_CATEGORY_ID;

  let categoryId = null;
  if (resolvedCategoryId) {
    const cat = guild.channels.cache.get(resolvedCategoryId)
      ?? await guild.channels.fetch(resolvedCategoryId).catch(() => null);
    if (cat && cat.type === ChannelType.GuildCategory) {
      categoryId = resolvedCategoryId;
    } else {
      console.warn(`[Tickets] Configured category ID ${resolvedCategoryId} is not a category — falling back to default.`);
      const defaultCat = guild.channels.cache.get(DEFAULT_CATEGORY_ID)
        ?? await guild.channels.fetch(DEFAULT_CATEGORY_ID).catch(() => null);
      if (defaultCat && defaultCat.type === ChannelType.GuildCategory) categoryId = DEFAULT_CATEGORY_ID;
    }
  }

  // Permission overwrites — only ticket creator + recruitment officers + the bot itself can see
  const overwrites = [
    { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
      ],
    },
    {
      id: user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles],
    },
  ];

  const recruitmentRoleId = getConfig(guildId, 'RECRUITMENT_OFFICER_ROLE_ID');
  if (recruitmentRoleId) {
    const role = guild.roles.cache.get(recruitmentRoleId) || await guild.roles.fetch(recruitmentRoleId).catch(() => null);
    if (role) {
      overwrites.push({
        id: role.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages,
        ],
      });
    } else {
      console.warn(`[Tickets] Recruitment officer role ID ${recruitmentRoleId} not found in guild ${guildId}. Ticket access may be restricted.`);
    }
  }
  {
    for (const rank of OFFICER_RANKS) {
      const role = require('../utils/ranks').getRankRole(guild,rank);
      if (role && !overwrites.some(o => o.id === role.id)) {
        overwrites.push({
          id: role.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages,
          ],
        });
      }
    }
  }

  const channelOptions = {
    name: channelName,
    type: ChannelType.GuildText,
    topic: `${TICKET_TYPES[type].label} | ${user.tag}`,
    permissionOverwrites: overwrites,
  };
  if (categoryId) channelOptions.parent = categoryId;

  const channel = await guild.channels.create(channelOptions);

  const ticket = {
    userId:    user.id,
    username:  user.username,
    type,
    claimedBy: null,
    createdAt: Date.now(),
  };
  saveTicket(guildId, channel.id, ticket);

  // Send the ticket info + action buttons inside the ticket channel
  const messagePayload = {
    content: `<@${user.id}>`,
    embeds: [
      new EmbedBuilder()
        .setColor(TICKET_COLOR)
        .setTitle(followup ? '✅ Verification complete • Questions?' : '🎟️  Ticket Opened')
        .setDescription(
          followup
            ? `Welcome, <@${user.id}>! Your request was accepted. Use this private ticket for any additional questions.`
            : `Welcome, <@${user.id}>! An officer will be with you shortly.`
        )
        .setFooter({ text: '⚔️ HUSS Ticket System' })
        .setTimestamp(),
      buildTicketEmbed(ticket),
    ],
    components: [buildActionRow(channel.id), ...(followup ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('me_overview:1').setLabel('My dashboard').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('me_squads:1').setLabel('Recruiting squads').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('me_training:1').setLabel('Training').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('me_orders:1').setLabel('Available tasks').setStyle(ButtonStyle.Secondary))] : [])],
  };

  if ((type === 'verify' || type === 'ally')) {
    const screenshotPath = path.join(__dirname, '..', 'Supporting things', 'F1Screenshot.png');
    if (fs.existsSync(screenshotPath)) {
      messagePayload.files = [{ attachment: screenshotPath, name: 'F1Screenshot.png' }];
    }
  }

  try {
    await channel.send(messagePayload);
  } catch (error) {
    // Roll back an incomplete ticket so a retry can create a usable one.
    await channel.delete();
    deleteTicket(guildId, channel.id);
    throw error;
  }

  // Send context-specific instructions
  if (type === 'verify') {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2ECC71)
          .setTitle('✅  Verification Instructions')
          .setDescription(
            'Post exactly one PNG, JPG or WebP screenshot (max. 8 MB) of your **F1 in-game stats** in this ticket and an officer will verify you.'
          )
          .setFooter({ text: '⚔️ HUSS Ticket System  •  Thank you for joining us!' })
      ]
    });
  } else if (type === 'ally') {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x3498DB)
          .setTitle('🤝  Ally Request Instructions')
          .setDescription(
            'Please provide:\n' +
            '\u25b8 Your clan/group name in the same message as the screenshot\n' +
            '\u25b8 A short description of your group\n' +
            '\u25b8 The F1 screenshot shown above'
          )
          .setFooter({ text: '⚔️ HUSS Ticket System  •  We look forward to collaborating!' })
      ]
    });
  }

  // Notify the officer channel so recruitment officers see the new ticket
  const officerChannelId = getConfig(guildId, 'OFFICER_CHANNEL_ID');
  if (officerChannelId) {
    const officerChannel = guild.channels.cache.get(officerChannelId)
      ?? await guild.channels.fetch(officerChannelId).catch(() => null);
    if (officerChannel) {
      const type_   = TICKET_TYPES[ticket.type];
      const notifyEmbed = new EmbedBuilder()
        .setColor(TICKET_COLOR)
        .setTitle(`${type_.emoji}  New Ticket — ${type_.label}`)
        .setDescription(`> Opened by <@${user.id}> — awaiting an officer to claim.`)
        .addFields(
          { name: '👤  User',    value: `<@${user.id}>`,  inline: true },
          { name: '📌  Channel', value: `${channel}`,    inline: true },
        )
        .setFooter({ text: '⚔️ HUSS Ticket System' })
        .setTimestamp();

      const jumpRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Open Ticket')
          .setEmoji('🎫')
          .setStyle(ButtonStyle.Link)
          .setURL(`https://discord.com/channels/${guild.id}/${channel.id}`),
      );

      const sentMsg = await officerChannel.send({ embeds: [notifyEmbed], components: [jumpRow] }).catch(() => null);
      if (sentMsg) {
        ticket.officerChannelId = officerChannel.id;
        ticket.officerMsgId    = sentMsg.id;
        saveTicket(guildId, channel.id, ticket);
      }
    }
  }

  if (followup || returnChannel) return channel;
  await interaction.editReply({ content: `✅ Ticket created: ${channel}` });
}

// ── Close a ticket ────────────────────────────────────────────────────────────
const closingTickets = new Set();
async function closeTicket(interaction, channelId, reason) {
  if (closingTickets.has(channelId)) return;
  closingTickets.add(channelId);
  try {
    const ticket = getTicket(interaction.guildId, channelId);
    if (!ticket) throw new Error('This ticket no longer exists.');
    if (interaction.user.id !== ticket.userId && !isRecruitmentOfficer(interaction.member)) throw new Error('Only the ticket owner or officers can close it.');
    const channel = await interaction.guild.channels.fetch(channelId);
    const html = await require('../utils/ticket-transcript').buildTranscript(channel, ticket, interaction.user.tag, reason);
    const filename = 'ticket-' + interaction.guildId + '-' + channelId + '-' + Date.now() + '.html';
    writeTranscript(filename, html);
    const logId = getConfig(interaction.guildId, 'TICKET_LOG_CHANNEL_ID');
    if (logId) {
      const log = await interaction.guild.channels.fetch(logId);
      await log.send({ content: 'Ticket closed: ' + channel.name + '. Reason: ' + (reason || 'Not provided'), files: [{ attachment: path.join(TRANSCRIPT_DIR, filename), name: filename }], allowedMentions: { parse: [] } });
    }
    await channel.delete('Ticket closed by ' + interaction.user.id);
    deleteTicket(interaction.guildId, channelId);
    require('../utils/audit').record(interaction, 'ticket.closed', ticket.userId, { reason, channelId });
    cleanupOldTranscripts();
  } finally { closingTickets.delete(channelId); }
}

// ── Module export ─────────────────────────────────────────────────────────────
module.exports = {
  init: verification.init,
  createVerificationTicket(interaction, type) {
    if (!['verify','ally'].includes(type)) throw new Error('Invalid verification type.');
    return openTicket(interaction,type,{returnChannel:true});
  },
  async createFollowupTicket(interaction, userId, onboarding = false, existingChannelId = null) {
    let channel;
    if (existingChannelId) {
      const existing = getTicket(interaction.guildId, existingChannelId);
      if (!existing || existing.userId !== userId || !['verify','ally'].includes(existing.type)) {
        throw new Error('The original verification ticket is no longer available for this applicant.');
      }
      channel = await interaction.guild.channels.fetch(existingChannelId);
      if (!channel) throw new Error('The original verification ticket could not be opened.');
      if (!existing.verificationWelcomeMessageId) {
        const message = await channel.send({
          content: `✅ Welcome, <@${userId}>! Your verification is complete. Keep using this ticket for any questions.`,
          allowedMentions: { parse: [] },
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('me_overview:1').setLabel('My dashboard').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('me_squads:1').setLabel('Recruiting squads').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('me_training:1').setLabel('Training').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('me_orders:1').setLabel('Available tasks').setStyle(ButtonStyle.Secondary))]
        });
        existing.verificationWelcomeMessageId = message.id;
        saveTicket(interaction.guildId, channel.id, existing);
      }
    } else {
      // Legacy DM applications have no applicant-owned verification ticket.
      const user = await interaction.client.users.fetch(userId);
      channel = await openTicket(interaction, 'officer', { user, followup: true });
    }
    const ticket = getTicket(interaction.guildId, channel.id);
    if (onboarding && ticket && !ticket.onboardingMessageId) {
      try {
        const message = await channel.send({content:'Welcome to HUSS! Open your personal onboarding checklist to choose interests, find a squad, explore training and join your first operation.',allowedMentions:{parse:[]},components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`cx_onboarding:open:${interaction.guildId}:${userId}`).setLabel('Open onboarding').setStyle(ButtonStyle.Success))]});
        ticket.onboardingMessageId = message.id;
        saveTicket(interaction.guildId, channel.id, ticket);
      } catch (error) {
        if (existingChannelId) throw error;
        console.warn('[Onboarding] Could not post the private ticket prompt; the approval DM and /onboarding remain available.');
      }
    }
    return channel;
  },
  // /ticketpanel — posts the public sign-up panel
  data: new SlashCommandBuilder()
    .setName('ticketpanel')
    .setDescription('Post the ticket creation panel in this channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0xE74C3C)
      .setTitle('🎟️  Support & Verification')
      .setDescription(
        '**Verification & allies:** start here, post your F1 screenshot in your **private ticket**, then receive an officer’s decision.\n' +
        '**Officer questions** open a private server ticket.'
      )
      .addFields(
        { name: '✅  Verification',     value: 'Post your F1 screenshot in your private ticket to join HUSS.' },
        { name: '🤝  Ally Request',     value: 'Post your F1 screenshot and clan name in your private ticket.' },
        { name: '🎖️  Officer Question', value: 'Ask the officer team something privately.' },
      )
      .setFooter({ text: '⚔️ HUSS Command' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_open:verify' ).setLabel('Verification'    ).setEmoji('✅' ).setStyle(ButtonStyle.Success  ),
      new ButtonBuilder().setCustomId('ticket_open:ally'   ).setLabel('Ally Request'    ).setEmoji('🤝' ).setStyle(ButtonStyle.Primary  ),
      new ButtonBuilder().setCustomId('ticket_open:officer').setLabel('Officer Question').setEmoji('🎖️').setStyle(ButtonStyle.Secondary),
    );

    const verificationChannelId = getConfig(interaction.guildId, 'VERIFICATION_CHANNEL_ID');
    const targetChannel = verificationChannelId
      ? await interaction.guild.channels.fetch(verificationChannelId).catch(() => null)
      : null;

    if (targetChannel) {
      await targetChannel.send({ embeds: [embed], components: [row] });
      return interaction.reply({ content: `✅ Ticket panel posted in ${targetChannel}.`, ephemeral: true });
    }

    // Fallback: post in the current channel
    await interaction.reply({ embeds: [embed], components: [row] });
  },

  // ── Button interactions ─────────────────────────────────────────────────────
  async handleButton(interaction) {
    const [action, param] = interaction.customId.split(':');

    if (action.startsWith('ticket_review_')) return verification.handleReview(interaction);

    // Panel buttons — open a new ticket
    if (action === 'ticket_open') {
      if (param === 'verify' || param === 'ally') return verification.start(interaction, param);
      if (!TICKET_TYPES[param]) return interaction.reply({ content: 'Unknown ticket type.', ephemeral: true });
      return openTicket(interaction, param);
    }

    const channelId = param;
    const ticket    = getTicket(interaction.guildId, channelId);
    if (!ticket) {
      return interaction.reply({ content: 'This ticket no longer exists.', ephemeral: true });
    }

    // Claim
    if (action === 'ticket_claim') {
      if (!isRecruitmentOfficer(interaction.member)) {
        return interaction.reply({ content: 'Only recruitment officers can claim tickets.', ephemeral: true });
      }
      if (ticket.claimedBy && ticket.claimedBy !== interaction.user.id) return interaction.reply({ content: `This ticket is already claimed by <@${ticket.claimedBy}>.`, ephemeral: true });
      ticket.claimedBy = interaction.user.id;
      saveTicket(interaction.guildId, channelId, ticket);

      const ch = interaction.guild.channels.cache.get(channelId);
      if (ch) {
        const msgs   = await ch.messages.fetch({ limit: 15 });
        const botMsg = msgs.find(m => m.author.id === interaction.client.user.id && m.embeds.length && m.components.some(row => row.components.some(c => c.customId === `ticket_claim:${channelId}`)));
        if (botMsg) await botMsg.edit({ embeds: [buildTicketEmbed(ticket)], components: [buildActionRow(channelId)] }).catch(() => {});
      }
      return interaction.reply({ content: `✅ You have claimed this ticket.`, ephemeral: true });
    }

    // Close
    if (action === 'ticket_close') {
      if (interaction.user.id !== ticket.userId && !isRecruitmentOfficer(interaction.member)) return interaction.reply({ content: 'Only the owner or officers can close this ticket.', ephemeral: true });
      return interaction.reply({ content: 'Close this ticket? A transcript will be saved before the channel is deleted.', components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket_confirm_close:${channelId}`).setLabel('Confirm close').setStyle(ButtonStyle.Danger))], ephemeral: true });
    }
    if (action === 'ticket_confirm_close') {
      await interaction.reply({ content: 'Saving transcript and closing ticket…', ephemeral: true });
      return closeTicket(interaction, channelId);
    }

    // Close with Reason — open modal
    if (action === 'ticket_closereason') {
      if (interaction.user.id !== ticket.userId && !isRecruitmentOfficer(interaction.member)) return interaction.reply({ content: 'Only the owner or officers can close this ticket.', ephemeral: true });
      const modal = new ModalBuilder()
        .setCustomId(`ticket_close_modal:${channelId}`)
        .setTitle('Close Ticket with Reason');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('reason')
            .setLabel('Reason for closing this ticket')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(500),
        )
      );
      return interaction.showModal(modal);
    }
  },

  // ── Select menu interactions ────────────────────────────────────────────────
  async handleSelect(_interaction) {
    // No select menus remain after priority removal
  },
  // ── Modal submit interactions ───────────────────────────────────────────────
  async handleModal(interaction) {
    const [action, channelId] = interaction.customId.split(':');

    if (action.startsWith('ticket_review_')) return verification.handleReview(interaction);

    if (action === 'ticket_close_modal') {
      const reason = interaction.fields.getTextInputValue('reason');
      await interaction.reply({ content: `🔒 Closing ticket with reason: **${reason}**`, ephemeral: true });
      return closeTicket(interaction, channelId, reason);
    }
  },
};
