const fs = require('node:fs');
const path = require('node:path');
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const { getConfig } = require('../utils/config');

const STORE_PATH   = path.join(__dirname, '..', 'data', 'tickets.json');
const OFFICER_RANKS = ['Officer', 'Commander'];

const PRIORITIES = {
  low:    { label: '🟢 Low',    color: 0x2ECC71 },
  medium: { label: '🟡 Medium', color: 0xF39C12 },
  high:   { label: '🔴 High',   color: 0xE74C3C },
};

const TICKET_TYPES = {
  verify:  { label: 'Verification',     emoji: '✅' },
  ally:    { label: 'Ally Request',     emoji: '🤝' },
  officer: { label: 'Officer Question', emoji: '🎖️' },
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

function isRecruitmentOfficer(member) {
  const recruitmentRoleId = getConfig(member.guild.id, 'RECRUITMENT_OFFICER_ROLE_ID');
  if (recruitmentRoleId) {
    return member.roles.cache.has(recruitmentRoleId);
  }
  return member.roles.cache.some(r => OFFICER_RANKS.includes(r.name));
}

function sanitizeName(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 25);
}

// ── Ticket embed ──────────────────────────────────────────────────────────────
function buildTicketEmbed(ticket) {
  const prio = PRIORITIES[ticket.priority];
  const type = TICKET_TYPES[ticket.type];
  return new EmbedBuilder()
    .setColor(prio.color)
    .setTitle(`${type.emoji} ${type.label} Ticket`)
    .addFields(
      { name: 'Opened by',  value: `<@${ticket.userId}>`,                                      inline: true },
      { name: 'Priority',   value: prio.label,                                                  inline: true },
      { name: 'Claimed by', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '*Unclaimed*', inline: true },
    )
    .setFooter({ text: 'Powered by Hypha' })
    .setTimestamp(ticket.createdAt);
}

// ── Action buttons (inside ticket) ───────────────────────────────────────────
function buildActionRow(channelId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_priority:${channelId}`)
      .setLabel('Change Priority')
      .setEmoji('🎯')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`ticket_claim:${channelId}`)
      .setLabel('Claim')
      .setEmoji('👤')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`ticket_close:${channelId}`)
      .setLabel('Close')
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
async function openTicket(interaction, type) {
  await interaction.deferReply({ ephemeral: true });

  const guild   = interaction.guild;
  const user    = interaction.user;
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
      return interaction.editReply({ content: `You already have an open **${TICKET_TYPES[type].label}** ticket: <#${existingChannelId}>. Please use that one or ask a recruitment officer to close it first.` });
    }
  }

  const priority    = 'low';
  const safeName    = sanitizeName(user.username);
  const channelName = `ticket-${safeName}-${priority}`;

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
      ],
    },
    {
      id: user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
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
  } else {
    for (const rank of OFFICER_RANKS) {
      const role = guild.roles.cache.find(r => r.name === rank);
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
      }
    }
  }

  const channelOptions = {
    name: channelName,
    type: ChannelType.GuildText,
    topic: `${TICKET_TYPES[type].label} | ${user.tag} | Priority: Low`,
    permissionOverwrites: overwrites,
  };
  if (categoryId) channelOptions.parent = categoryId;

  const channel = await guild.channels.create(channelOptions);

  const ticket = {
    userId:    user.id,
    username:  user.username,
    type,
    priority,
    claimedBy: null,
    createdAt: Date.now(),
  };
  saveTicket(guildId, channel.id, ticket);

  // Send the ticket info + action buttons inside the ticket channel
  await channel.send({
    content: `<@${user.id}> Your ticket has been created. A recruitment officer will be with you shortly.\nVotre ticket a été créé. Un officier de recrutement s'occupera de vous bientôt.`,
    embeds:     [buildTicketEmbed(ticket)],
    components: [buildActionRow(channel.id)],
  });

  // Notify the officer channel so recruitment officers see the new ticket
  const officerChannelId = getConfig(guildId, 'OFFICER_CHANNEL_ID');
  if (officerChannelId) {
    const officerChannel = guild.channels.cache.get(officerChannelId)
      ?? await guild.channels.fetch(officerChannelId).catch(() => null);
    if (officerChannel) {
      const type_   = TICKET_TYPES[ticket.type];
      const notifyEmbed = new EmbedBuilder()
        .setColor(PRIORITIES[ticket.priority].color)
        .setTitle(`${type_.emoji} New Ticket — ${type_.label}`)
        .addFields(
          { name: 'Opened by', value: `<@${user.id}>`,         inline: true },
          { name: 'Priority',  value: PRIORITIES.low.label,    inline: true },
          { name: 'Channel',   value: `${channel}`,            inline: true },
        )
        .setFooter({ text: 'Powered by Hypha' })
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

  await interaction.editReply({ content: `✅ Ticket created: ${channel}` });
}

// ── Close a ticket ────────────────────────────────────────────────────────────
async function closeTicket(interaction, channelId, reason) {
  const ticket  = getTicket(interaction.guildId, channelId);
  const channel = interaction.guild.channels.cache.get(channelId);

  // Log the closure
  const logChannelId = getConfig(interaction.guildId, 'TICKET_LOG_CHANNEL_ID');
  if (logChannelId) {
    const logChannel = interaction.guild.channels.cache.get(logChannelId);
    if (logChannel && ticket) {
      const prio = PRIORITIES[ticket.priority] ?? PRIORITIES.low;
      const type = TICKET_TYPES[ticket.type]   ?? { label: 'Unknown', emoji: '🎫' };
      const logEmbed = new EmbedBuilder()
        .setColor(0x95A5A6)
        .setTitle('🔒 Ticket Closed')
        .addFields(
          { name: 'Channel',    value: channel?.name ?? channelId,                                    inline: true },
          { name: 'Type',       value: `${type.emoji} ${type.label}`,                                 inline: true },
          { name: 'Opened by',  value: `<@${ticket.userId}>`,                                         inline: true },
          { name: 'Priority',   value: prio.label,                                                    inline: true },
          { name: 'Claimed by', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Unclaimed',     inline: true },
          { name: 'Closed by',  value: `<@${interaction.user.id}>`,                                   inline: true },
          { name: 'Reason',     value: reason ?? 'No reason provided' },
        )
        .setFooter({ text: 'Powered by Hypha' })
        .setTimestamp();
      await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }
  }

  deleteTicket(interaction.guildId, channelId);

  if (channel) {
    if (reason) {
      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x95A5A6)
            .setDescription(`🔒 Ticket closed by <@${interaction.user.id}>\n**Reason:** ${reason}`),
        ],
      }).catch(() => {});
      await new Promise(r => setTimeout(r, 3000));
    }
    await channel.delete().catch(() => {});
  }
}

// ── Module export ─────────────────────────────────────────────────────────────
module.exports = {
  // /ticketpanel — posts the public sign-up panel
  data: new SlashCommandBuilder()
    .setName('ticketpanel')
    .setDescription('Post the ticket creation panel in this channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🎫 Support Tickets')
      .setDescription('Choose a category below to open a ticket.\nOur recruitment officers will assist you as soon as possible.\nChoisissez une catégorie ci-dessous pour ouvrir un ticket. Nos officiers de recrutement vous aideront dès que possible.')
      .addFields(
        { name: '✅ Verification',     value: 'Get verified as a member of the guild. / Obtenez votre vérification en tant que membre du clan.' },
        { name: '🤝 Ally Request',     value: 'Request an alliance with our group. / Demandez une alliance avec notre groupe.' },
        { name: '🎖️ Officer Question', value: 'Ask the officer team a private question. / Posez une question privée aux officiers.' },
      )
      .setFooter({ text: 'Powered by Hypha' });

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

    // Panel buttons — open a new ticket
    if (action === 'ticket_open') {
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
      ticket.claimedBy = interaction.user.id;
      saveTicket(interaction.guildId, channelId, ticket);

      const ch = interaction.guild.channels.cache.get(channelId);
      if (ch) {
        const msgs   = await ch.messages.fetch({ limit: 15 });
        const botMsg = msgs.find(m => m.author.id === interaction.client.user.id && m.embeds.length && m.components.length);
        if (botMsg) await botMsg.edit({ embeds: [buildTicketEmbed(ticket)], components: [buildActionRow(channelId)] }).catch(() => {});
      }
      return interaction.reply({ content: `✅ You have claimed this ticket.`, ephemeral: true });
    }

    // Change Priority — send ephemeral select menu
    if (action === 'ticket_priority') {
      if (!isRecruitmentOfficer(interaction.member)) {
        return interaction.reply({ content: 'Only recruitment officers can change ticket priority.', ephemeral: true });
      }
      const select = new StringSelectMenuBuilder()
        .setCustomId(`ticket_priority_select:${channelId}`)
        .setPlaceholder('Select a new priority')
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel('🟢 Low'   ).setValue('low'   ).setDefault(ticket.priority === 'low'   ),
          new StringSelectMenuOptionBuilder().setLabel('🟡 Medium').setValue('medium').setDefault(ticket.priority === 'medium'),
          new StringSelectMenuOptionBuilder().setLabel('🔴 High'  ).setValue('high'  ).setDefault(ticket.priority === 'high'  ),
        );
      return interaction.reply({ content: 'Select the new priority:', components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    }

    // Close
    if (action === 'ticket_close') {
      await interaction.reply({ content: '🔒 Closing ticket...', ephemeral: true });
      return closeTicket(interaction, channelId);
    }

    // Close with Reason — open modal
    if (action === 'ticket_closereason') {
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
  async handleSelect(interaction) {
    const [action, channelId] = interaction.customId.split(':');

    if (action === 'ticket_priority_select') {
      const newPriority = interaction.values[0];
      const ticket      = getTicket(interaction.guildId, channelId);
      if (!ticket) return interaction.update({ content: 'Ticket not found.', components: [] });

      ticket.priority = newPriority;
      saveTicket(interaction.guildId, channelId, ticket);

      const ch = interaction.guild.channels.cache.get(channelId);
      if (ch) {
        const safeName = sanitizeName(ticket.username);
        await ch.setName(`ticket-${safeName}-${newPriority}`).catch(() => {});
        const msgs   = await ch.messages.fetch({ limit: 15 });
        const botMsg = msgs.find(m => m.author.id === interaction.client.user.id && m.embeds.length && m.components.length);
        if (botMsg) await botMsg.edit({ embeds: [buildTicketEmbed(ticket)], components: [buildActionRow(channelId)] }).catch(() => {});
      }

      // Update the officer channel notification embed
      if (ticket.officerChannelId && ticket.officerMsgId) {
        const officerCh = interaction.guild.channels.cache.get(ticket.officerChannelId)
          ?? await interaction.guild.channels.fetch(ticket.officerChannelId).catch(() => null);
        if (officerCh) {
          const officerMsg = await officerCh.messages.fetch(ticket.officerMsgId).catch(() => null);
          if (officerMsg) {
            const type_ = TICKET_TYPES[ticket.type];
            const updatedEmbed = new EmbedBuilder()
              .setColor(PRIORITIES[newPriority].color)
              .setTitle(`${type_.emoji} New Ticket — ${type_.label}`)
              .addFields(
                { name: 'Opened by', value: `<@${ticket.userId}>`,           inline: true },
                { name: 'Priority',  value: PRIORITIES[newPriority].label,   inline: true },
                { name: 'Channel',   value: `<#${channelId}>`,               inline: true },
              )
              .setFooter({ text: `Priority updated by ${interaction.user.tag} • Powered by Hypha` })
              .setTimestamp();
            await officerMsg.edit({ embeds: [updatedEmbed], components: officerMsg.components }).catch(() => {});
          }
        }
      }

      return interaction.update({ content: `✅ Priority updated to **${PRIORITIES[newPriority].label}**.`, components: [] });
    }
  },

  // ── Modal submit interactions ───────────────────────────────────────────────
  async handleModal(interaction) {
    const [action, channelId] = interaction.customId.split(':');

    if (action === 'ticket_close_modal') {
      const reason = interaction.fields.getTextInputValue('reason');
      await interaction.reply({ content: `🔒 Closing ticket with reason: **${reason}**`, ephemeral: true });
      return closeTicket(interaction, channelId, reason);
    }
  },
};
