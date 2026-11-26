const fs = require('./data-fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
  TextInputBuilder, TextInputStyle, PermissionFlagsBits, ChannelType } = require('discord.js');
const { getConfig } = require('./config');

const STORE = path.join(__dirname, '..', 'data', 'verification-requests.json');
const locks = new Set();
const initializedClients = new WeakSet();
const types = { verify: 'Member verification', ally: 'Ally verification' };
const active = request => request.status === 'pending' || (request.status === 'awaiting' && (request.ticketChannelId || Date.now() - request.createdAt < 86400000));
function read() {
  if (!fs.existsSync(STORE)) return {};
  return JSON.parse(fs.readFileSync(STORE, 'utf8'));
}
function save(request) {
  const store = read();
  store[request.id] = request;
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(`${STORE}.tmp`, JSON.stringify(store, null, 2));
  fs.renameSync(`${STORE}.tmp`, STORE);
}
async function locked(key, fn, busy) {
  if (locks.has(key)) return busy?.();
  locks.add(key);
  try { return await fn(); } finally { locks.delete(key); }
}
function canReview(member) {
  const roleId = getConfig(member.guild.id, 'RECRUITMENT_OFFICER_ROLE_ID');
  return member.permissions.has(PermissionFlagsBits.ManageGuild)
    || (require('./ranks').isOfficer(member) || require('./ranks').hasConfiguredRole(member,'RECRUITMENT_OFFICER_ROLE_ID','Recruitment Officer'));
}
async function reviewChannel(guild, ticketChannelId) {
  const id = ticketChannelId || getConfig(guild.id, 'VERIFICATION_REVIEW_CHANNEL_ID') || getConfig(guild.id, 'OFFICER_CHANNEL_ID');
  const channel = id && await guild.channels.fetch(id);
  if (!channel || channel.type !== ChannelType.GuildText) throw new Error('Configure a private verification review channel with /config set-channel.');
  if (channel.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)) {
    throw new Error('The review channel must be private: deny View Channel for @everyone.');
  }
  const me = await guild.members.fetchMe();
  if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory])) {
    throw new Error('The bot needs View Channel, Send Messages, Embed Links, Attach Files and Read Message History in the review channel.');
  }
  return channel;
}
function reviewPayload(request) {
  const pending = request.status === 'pending';
  const embed = new EmbedBuilder().setColor(pending ? 0xF0B232 : request.status === 'accepted' ? 0x2ECC71 : 0xE74C3C)
    .setTitle(types[request.type])
    .setDescription(`Applicant: <@${request.userId}>\n**${pending ? 'Awaiting review' : request.status === 'accepted' ? 'Accepted' : 'Rejected'}**`)
    .addFields({ name: 'Submitted', value: `<t:${Math.floor(request.createdAt / 1000)}:f>` })
    .setImage('attachment://screenshot.png')
    .setFooter({ text: `HUSS • ${request.id}` });
  if (request.note) embed.addFields({ name: 'Applicant message', value: request.note.slice(0, 1024) });
  if (request.reviewedBy) embed.addFields({ name: 'Reviewed by', value: `<@${request.reviewedBy}>` });
  if (request.reason) embed.addFields({ name: 'Reason', value: request.reason });
  if (request.followupChannelId) embed.addFields({ name: 'Questions', value: `<#${request.followupChannelId}>` });
  return { embeds: [embed], allowedMentions: { parse: [] }, components: pending ? [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket_review_accept:${request.id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ticket_review_reject:${request.id}`).setLabel('Reject').setStyle(ButtonStyle.Danger),
  )] : [] };
}

async function start(interaction, type) {
  if (!interaction.guild || !types[type]) return;
  await interaction.deferReply({ ephemeral: true });
  return locked(`user:${interaction.user.id}`, async () => {
    const existing = Object.values(read()).find(r => r.guildId === interaction.guildId && r.userId === interaction.user.id && active(r));
    if (existing?.ticketChannelId) {
      const channel = await interaction.guild.channels.fetch(existing.ticketChannelId).catch(() => null);
      if (channel) return interaction.editReply({content: `Use your private ticket: <#${channel.id}>. Post your F1 screenshot there.`});
      existing.status = 'cancelled'; save(existing);
    } else if (existing?.status === 'pending') {
      return interaction.editReply({content:'Your previous screenshot is already awaiting officer review.'});
    }
    try {
      const channel = await require('../features/tickets').createVerificationTicket(interaction, type);
      await reviewChannel(interaction.guild, channel.id);
      const request = {id:randomUUID(),guildId:interaction.guildId,guildName:interaction.guild.name,
        ticketChannelId:channel.id,reviewChannelId:channel.id,userId:interaction.user.id,type,status:'awaiting',createdAt:Date.now()};
      save(request);
      if(existing?.status==='awaiting'){existing.status='cancelled';save(existing);}
      return interaction.editReply({content: `✅ Post your F1 screenshot in your private ticket: <#${channel.id}>.`});
    } catch(error) {
      console.error('[Verification] Start failed:',error);
      return interaction.editReply({content:'Could not prepare your verification ticket. Ask an officer to check the bot permissions and try again.'});
    }
  }, () => interaction.editReply({content:'Your request is being processed.'}));
}

async function onMessage(message) {
  if (message.author.bot) return;
  if (!message.guild) {
    const request=Object.values(read()).find(r=>r.userId===message.author.id&&active(r));
    if (!request) return;
    return message.reply(request.ticketChannelId
      ? `Verification screenshots now belong in your private server ticket: https://discord.com/channels/${request.guildId}/${request.ticketChannelId}`
      : request.status==='pending' ? 'Your screenshot is already awaiting officer review.' : 'Please open Verification or Ally Request from the server ticket panel. Screenshots must now be posted in that private ticket, not by DM.');
  }
  if (!message.attachments.size && message.content.trim().toLowerCase() !== 'cancel') return;
  return locked(`user:${message.author.id}`, async () => {
    const request = Object.values(read()).find(item => item.userId === message.author.id && item.guildId === message.guild.id && item.ticketChannelId === message.channelId && active(item));
    if (request) {
      const maintenance = require('./maintenance');
      const state = maintenance.active(request.guildId, 'ticketpanel');
      if (state) return message.reply(maintenance.notice(state));
    }
    if (!request) return;
    if (!message.attachments.size && message.content.trim().toLowerCase() !== 'cancel') return;
    if (request.status === 'pending') return message.reply('Your screenshot is awaiting review.');
    if (message.content.trim().toLowerCase() === 'cancel') {
      request.status = 'cancelled'; save(request);
      return message.reply('Request cancelled. You can start again from the server panel.');
    }
    const images = [...message.attachments.values()].filter(file => /^image\/(png|jpeg|webp)$/i.test(file.contentType || '') && file.size <= 8 * 1024 * 1024);
    if (images.length !== 1 || message.attachments.size !== 1) return message.reply('Attach exactly one PNG, JPG or WebP screenshot, max. 8 MB.');
    if (request.type === 'ally' && !message.content.trim()) return message.reply('Resend the screenshot with your clan/group name in the same message.');
    const guild = await message.client.guilds.fetch(request.guildId);
    await guild.members.fetch(request.userId);
    const channel = await reviewChannel(guild, request.ticketChannelId);
    const pending = { ...request, status: 'pending', note: message.content.slice(0, 1024), reviewChannelId: channel.id, sourceMessageId: message.id };
    const review = await channel.send({ ...reviewPayload(pending), files: [{ attachment: images[0].url, name: 'screenshot.png' }] });
    pending.reviewMessageId = review.id;
    try { save(pending); }
    catch (error) {
      await review.delete().catch(() => {});
      throw error;
    }
    await message.reply('✅ Screenshot submitted! An officer will review it and you’ll receive the result here.');
  }, () => message.reply('Your previous upload is still processing.'));
}

function roleByName(guild, name) {
  return guild.roles.cache.find(role => role.name.toLowerCase() === name.toLowerCase());
}
function configuredRole(guild, key, fallback) {
  const id = getConfig(guild.id, key);
  return id ? guild.roles.cache.get(id) : roleByName(guild, fallback);
}
async function grantRoles(guild, request) {
  await guild.roles.fetch();
  const member = await guild.members.fetch(request.userId);
  const me = await guild.members.fetchMe();
  const required = request.type === 'ally'
    ? [configuredRole(guild, 'ALLY_ROLE_ID', 'Ally')]
    : [configuredRole(guild, 'VERIFIED_MEMBER_ROLE_ID', 'Member'), configuredRole(guild, 'CADET_ROLE_ID', 'Cadet')];
  if (required.some(role => !role)) throw new Error('Configure the required Member + Cadet roles or Ally role first.');
  // Never demote an existing ranked member back to Cadet.
  const ranked = ['Private','Legionaire','Dragoon','Hussar','Officer','Commander'].includes(require('./ranks').getMemberRank(member));
  const additions = (request.type === 'verify' && ranked ? required.slice(0, 1) : required).filter(role => !member.roles.cache.has(role.id));
  const removals = [configuredRole(guild, 'UNVERIFIED_ROLE_ID', 'unverified')];
  if (request.type === 'verify') removals.push(configuredRole(guild, 'FORMER_MEMBER_ROLE_ID', 'Former Member'), roleByName(guild, 'Former collie'), configuredRole(guild, 'ALLY_ROLE_ID', 'Ally'));
  const remove = removals.filter(role => role && member.roles.cache.has(role.id) && !required.some(added => added.id === role.id));
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles) || [...additions, ...remove].some(role => role.managed || role.id === guild.id || me.roles.highest.comparePositionTo(role) <= 0)) {
    throw new Error('Give the bot Manage Roles and place its highest role above the roles it must add/remove.');
  }
  // Role-specific operations preserve unrelated roles. Retrying after a partial failure is safe.
  for (const role of additions) await member.roles.add(role, `HUSS verification ${request.id}`);
  for (const role of remove) await member.roles.remove(role, `HUSS verification ${request.id}`);
}

async function handleReview(interaction) {
  const [action, id] = interaction.customId.split(':');
  if (!interaction.guild) return interaction.reply({ content: 'Use the server review panel.', ephemeral: true });
  const reviewer = await interaction.guild.members.fetch(interaction.user.id);
  if (!canReview(reviewer)) return interaction.reply({ content: 'Only recruitment officers, Officers, Commanders or server managers can review requests.', ephemeral: true });
  const request = read()[id];
  if (!request || request.guildId !== interaction.guildId || request.reviewChannelId !== interaction.channelId || (interaction.isButton() && request.reviewMessageId !== interaction.message.id)) {
    return interaction.reply({ content: 'This review panel is no longer valid.', ephemeral: true });
  }
  if (request.userId === interaction.user.id) return interaction.reply({ content: 'Another officer must review your request.', ephemeral: true });
  if (request.status !== 'pending') return interaction.reply({ content: 'This request has already been reviewed.', ephemeral: true });
  if (action === 'ticket_review_reject') {
    return interaction.showModal(new ModalBuilder().setCustomId(`ticket_review_reason:${id}`).setTitle('Reject request').addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500))));
  }
  if (!['ticket_review_accept', 'ticket_review_reason'].includes(action)) return;
  await interaction.deferReply({ ephemeral: true });
  return locked(`request:${id}`, async () => {
    const current = read()[id];
    if (current.status !== 'pending') return interaction.editReply('This request has already been reviewed.');
    const accepted = action === 'ticket_review_accept';
    const reason = accepted ? null : interaction.fields.getTextInputValue('reason').trim();
    if (!accepted && !reason) return interaction.editReply('Please provide a reason.');
    try {
      if (accepted) {
        await grantRoles(interaction.guild, current);
        const channel = await require('../features/tickets').createFollowupTicket(interaction, current.userId, current.type === 'verify', current.ticketChannelId || null);
        current.followupChannelId = channel.id;
      }
    } catch (error) {
      console.error('[Verification] Role update failed:', error);
      return interaction.editReply(`Could not finish approval. Roles may already be updated, but the request remains pending until the welcome messages are ready in the applicant's ticket. Check bot permissions and retry Accept. ${error.message}`);
    }
    current.status = accepted ? 'accepted' : 'rejected';
    current.reviewedBy = interaction.user.id;
    current.reviewedAt = Date.now();
    current.reason = reason;
    save(current);
    let panelUpdated = true;
    try {
      const panel = await interaction.channel.messages.fetch(current.reviewMessageId);
      await panel.edit(reviewPayload(current));
    } catch (error) { panelUpdated = false; console.error('[Verification] Panel update failed:', error); }
    let notified = true;
    // Approval already posts the welcome, dashboard and onboarding in the ticket.
    // Only rejection needs this separate notification.
    if (!accepted) try {
      const notification = { content: `Your verification for **${current.guildName}** was rejected.\n\n**Reason:** ${reason}\n\nYou can submit a new request from the server panel.`,
        components: [],
        allowedMentions: { parse: [] } };
      if(current.ticketChannelId) await interaction.channel.send(notification);
      const sendDM=async()=>{const user=await interaction.client.users.fetch(current.userId);await user.send(notification);};
      if(current.ticketChannelId) await sendDM().catch(()=>{});
      else await sendDM();
    } catch { notified = false; }
    return interaction.editReply(`${accepted ? 'Accepted; roles updated.' : 'Rejected.'}${notified ? ' Applicant notified.' : ' Could not notify the applicant.'}${panelUpdated ? '' : ' The panel could not be refreshed; this decision is saved.'}`);
  }, () => interaction.editReply('Another officer is processing this request.'));
}

function init(client) {
  if (initializedClients.has(client)) return;
  initializedClients.add(client);
  client.on('messageCreate', message => {
    onMessage(message).catch(async error => {
      console.error('[Verification] Upload failed:', error);
      await message.reply('Could not process your screenshot. Try again, or contact an officer if this continues.').catch(() => {});
    });
  });
}

module.exports = { start, handleReview, init, onMessage, grantRoles, reviewPayload, canReview };
