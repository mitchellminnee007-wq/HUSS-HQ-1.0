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
  ChannelType,
} = require('discord.js');
const { getConfig } = require('../utils/config');

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
        .setTitle(`🎟️  Ticket Opened`)
        .setDescription(
          `> Welcome, <@${user.id}>! An officer will be with you shortly.\n` +
          `> *Bienvenue ! Un officier vous rejoindra très bientot.*`
        )
        .setFooter({ text: '⚔️ HUSS Ticket System' })
        .setTimestamp(),
      buildTicketEmbed(ticket),
    ],
    components: [buildActionRow(channel.id)],
  };

  if ((type === 'verify' || type === 'ally')) {
    const screenshotPath = path.join(__dirname, '..', 'Supporting things', 'F1Screenshot.png');
    if (fs.existsSync(screenshotPath)) {
      messagePayload.files = [{ attachment: screenshotPath, name: 'F1Screenshot.png' }];
    }
  }

  await channel.send(messagePayload);

  // Send context-specific instructions
  if (type === 'verify') {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2ECC71)
          .setTitle('✅  Verification Instructions')
          .setDescription(
            '**EN:** Post a screenshot of your **F1 in-game stats** (shown above) in this ticket and an officer will verify you.\n\n' +
            '**FR:** Publiez une capture d\'écran de vos **statistiques F1 en jeu** (affichées ci-dessus) dans ce ticket et un officier vous vérifiera.'
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
            '**EN:** Please provide:\n' +
            '\u25b8 Your clan/group name\n' +
            '\u25b8 A short description of your group\n' +
            '\u25b8 The F1 screenshot shown above\n\n' +
            '**FR:** Veuillez fournir\u00a0:\n' +
            '\u25b8 Le nom de votre clan/groupe\n' +
            '\u25b8 Une courte description de votre groupe\n' +
            '\u25b8 La capture d\'écran F1 affichée ci-dessus'
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
      const type = TICKET_TYPES[ticket.type]   ?? { label: 'Unknown', emoji: '🎫' };
      const logEmbed = new EmbedBuilder()
        .setColor(0x95A5A6)
        .setTitle('🔒  Ticket Closed')
        .setDescription(`> **${type.emoji} ${type.label}** ticket from <@${ticket.userId}>`)
        .addFields(
          { name: '📁  Channel',    value: channel?.name ?? channelId,                                     inline: true },
          { name: '👤  Opened by',  value: `<@${ticket.userId}>`,                                           inline: true },
          { name: '🔖  Claimed by', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '*Unclaimed*',   inline: true },
          { name: '🔒  Closed by',  value: `<@${interaction.user.id}>`,                                    inline: true },
          { name: '📝  Reason',     value: reason ?? '*No reason provided*',                               inline: true },
        )
        .setFooter({ text: '⚔️ HUSS Ticket System' })
        .setTimestamp();

      const transcriptFilename = `ticket-${interaction.guildId}-${channelId}-${Date.now()}.html`;
      let htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ticket Transcript - ${channel?.name ?? channelId}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #36393f; color: #dcddde; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .container { max-width: 900px; margin: 0 auto; padding: 20px; }
    .header { background: #2f3136; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
    .header h1 { color: #fff; font-size: 24px; margin-bottom: 8px; }
    .header-info { font-size: 13px; color: #b9bbbe; line-height: 1.8; }
    .info-row { display: flex; gap: 20px; margin-top: 10px; }
    .info-item { display: flex; flex-direction: column; }
    .info-label { color: #72767d; font-size: 12px; text-transform: uppercase; }
    .info-value { color: #fff; font-size: 14px; margin-top: 4px; }
    .messages { background: #36393f; border-radius: 8px; padding: 20px; }
    .message { padding: 8px 0; border-bottom: 1px solid rgba(79, 84, 92, 0.4); }
    .message:last-child { border-bottom: none; }
    .message-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 4px; }
    .message-author { color: #fff; font-weight: 600; font-size: 15px; }
    .message-time { color: #72767d; font-size: 12px; }
    .message-content { color: #dcddde; margin-left: 36px; word-wrap: break-word; }
    .embed { background: rgba(79, 84, 92, 0.3); border-left: 4px solid #7289da; border-radius: 4px; padding: 8px 12px; margin-left: 36px; margin-top: 4px; font-size: 13px; }
    .embed-title { font-weight: 600; color: #fff; }
    .embed-desc { color: #b9bbbe; margin-top: 4px; }
    .attachments { margin-left: 36px; margin-top: 4px; }
    .attachment-link { color: #0096cf; text-decoration: none; font-size: 13px; display: inline-block; margin-right: 12px; }
    .attachment-link:hover { text-decoration: underline; }
    .divider { height: 1px; background: rgba(79, 84, 92, 0.5); margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1># ${channel?.name ?? channelId}</h1>
      <div class="header-info">
        <div class="info-row">
          <div class="info-item">
            <span class="info-label">Opened by</span>
            <span class="info-value">&lt;@${ticket.userId}&gt;</span>
          </div>
          <div class="info-item">
            <span class="info-label">Type</span>
            <span class="info-value">${type.emoji} ${type.label}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Closed by</span>
            <span class="info-value">${interaction.user.tag}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Reason</span>
            <span class="info-value">${reason ?? 'No reason provided'}</span>
          </div>
        </div>
      </div>
    </div>
    <div class="divider"></div>
    <div class="messages">`;

      if (channel) {
        const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
        if (messages) {
          const ordered = Array.from(messages.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
          for (const msg of ordered) {
            const author = msg.author?.tag ?? 'Unknown';
            const timestamp = new Date(msg.createdTimestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
            htmlContent += `<div class="message"><div class="message-header"><span class="message-author">${author}</span><span class="message-time">${timestamp}</span></div>`;
            if (msg.content) {
              htmlContent += `<div class="message-content">${msg.content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;
            }
            if (msg.embeds.length) {
              for (const embed of msg.embeds) {
                htmlContent += `<div class="embed"><div class="embed-title">${embed.title || 'Embed'}</div>`;
                if (embed.description) {
                  htmlContent += `<div class="embed-desc">${embed.description}</div>`;
                }
                htmlContent += `</div>`;
              }
            }
            if (msg.attachments.size) {
              htmlContent += `<div class="attachments">`;
              for (const attachment of msg.attachments.values()) {
                htmlContent += `<a class="attachment-link" href="${attachment.url}" target="_blank">${attachment.name}</a>`;
              }
              htmlContent += `</div>`;
            }
            htmlContent += `</div>`;
          }
        }
      }

      htmlContent += `
    </div>
  </div>
</body>
</html>`;

      writeTranscript(transcriptFilename, htmlContent);
      cleanupOldTranscripts();

      await logChannel.send({ embeds: [logEmbed], files: [{ attachment: path.join(TRANSCRIPT_DIR, transcriptFilename), name: transcriptFilename }] }).catch(() => {});
    }
  }

  deleteTicket(interaction.guildId, channelId);

  if (channel) {
    if (reason) {
      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x95A5A6)
            .setTitle('🔒  Ticket Closed')
            .setDescription(
              `> Closed by <@${interaction.user.id}>\n` +
              `> **Reason:** ${reason}`
            )
            .setFooter({ text: '⚔️ HUSS Ticket System' })
            .setTimestamp(),
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
      .setColor(0xE74C3C)
      .setTitle('🎟️  Support & Verification')
      .setDescription(
        '> Select a category below to open a **private ticket** with our officers.\n' +
        '> *Sélectionnez une catégorie ci-dessous pour ouvrir un **ticket privé** avec nos officiers.*'
      )
      .addFields(
        { name: '✅  Verification',     value: 'Become a verified HUSS member.\n*Devenez un membre vérifié de HUSS.*' },
        { name: '🤝  Ally Request',     value: 'Request a formal alliance with us.\n*Demandez une alliance formelle avec nous.*' },
        { name: '🎖️  Officer Question', value: 'Ask the officer team something privately.\n*Posez une question privée aux officiers.*' },
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
  async handleSelect(_interaction) {
    // No select menus remain after priority removal
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
