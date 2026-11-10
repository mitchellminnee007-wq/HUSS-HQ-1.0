const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
  TextInputBuilder, TextInputStyle, PermissionFlagsBits, ChannelType } = require('discord.js');
const { getConfig } = require('./config');

const STORE = path.join(__dirname, '..', 'data', 'verification-requests.json');
const locks = new Set();
const initializedClients = new WeakSet();
const types = { verify: 'Member verification / Vérification membre', ally: 'Ally verification / Vérification allié' };
const active = request => request.status === 'pending' || (request.status === 'awaiting' && Date.now() - request.createdAt < 86400000);
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
    || member.roles.cache.some(role => ['Officer', 'Commander'].includes(role.name) || (roleId ? role.id === roleId : role.name === 'Recruitment Officer'));
}
async function reviewChannel(guild) {
  const id = getConfig(guild.id, 'VERIFICATION_REVIEW_CHANNEL_ID') || getConfig(guild.id, 'OFFICER_CHANNEL_ID');
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
    .setDescription(`Applicant / Candidat: <@${request.userId}>\n**${pending ? 'Awaiting review / En attente' : request.status === 'accepted' ? 'Accepted / Accepté' : 'Rejected / Refusé'}**`)
    .addFields({ name: 'Submitted / Envoyé', value: `<t:${Math.floor(request.createdAt / 1000)}:f>` })
    .setImage('attachment://screenshot.png')
    .setFooter({ text: `HUSS • ${request.id}` });
  if (request.note) embed.addFields({ name: 'Applicant message / Message du candidat', value: request.note.slice(0, 1024) });
  if (request.reviewedBy) embed.addFields({ name: 'Reviewed by / Évalué par', value: `<@${request.reviewedBy}>` });
  if (request.reason) embed.addFields({ name: 'Reason / Motif', value: request.reason });
  if (request.followupChannelId) embed.addFields({ name: 'Questions / Questions supplémentaires', value: `<#${request.followupChannelId}>` });
  return { embeds: [embed], allowedMentions: { parse: [] }, components: pending ? [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket_review_accept:${request.id}`).setLabel('Accept / Accepter').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ticket_review_reject:${request.id}`).setLabel('Reject / Refuser').setStyle(ButtonStyle.Danger),
  )] : [] };
}

async function start(interaction, type) {
  if (!interaction.guild || !types[type]) return;
  await interaction.deferReply({ ephemeral: true });
  return locked(`user:${interaction.user.id}`, async () => {
    const existing = Object.values(read()).find(request => request.userId === interaction.user.id && active(request));
    if (existing) {
      return interaction.editReply({ content: existing.status === 'pending'
        ? 'Your screenshot is awaiting officer review. / Votre capture attend la décision d’un officier.'
        : `You already have a DM request for **${existing.guildName}**. Send your screenshot to the bot, or type **cancel** in DM to restart. / Envoyez votre capture au bot ou écrivez **cancel** en MP.` });
    }
    try {
      const channel = await reviewChannel(interaction.guild);
      const request = { id: randomUUID(), guildId: interaction.guildId, guildName: interaction.guild.name,
        reviewChannelId: channel.id, userId: interaction.user.id, type, status: 'awaiting', createdAt: Date.now() };
      const screenshot = path.join(__dirname, '..', 'Supporting things', 'F1Screenshot.png');
      const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(types[type])
        .setDescription(`**${interaction.guild.name}**\nSend one screenshot of your **F1 in-game stats** here as an image attachment (PNG, JPG or WebP, max. 8 MB).${type === 'ally' ? ' Include your clan/group name in the same message.' : ''}\n\nEnvoyez ici une capture de vos **statistiques F1 en jeu** en pièce jointe (PNG, JPG ou WebP, max. 8 Mo).${type === 'ally' ? ' Ajoutez le nom de votre clan/groupe dans le même message.' : ''}\n\nAn officer will review it privately on the server. / Un officier examinera votre demande sur le serveur.\n\nType **cancel** to cancel. This upload session expires after 24 hours.\nÉcrivez **cancel** pour annuler. Cette session expire après 24 heures.`);
      const payload = { embeds: [embed], allowedMentions: { parse: [] } };
      if (fs.existsSync(screenshot)) {
        embed.setImage('attachment://F1Screenshot.png');
        payload.files = [{ attachment: screenshot, name: 'F1Screenshot.png' }];
      }
      // Store before sending so an immediate DM reply can always find the request.
      save(request);
      try { await interaction.user.send(payload); }
      catch (error) {
        request.status = 'cancelled'; save(request);
        if (error.code === 50007) return interaction.editReply({ content: 'Enable direct messages from server members in your Discord privacy settings, then try again. / Activez les messages privés des membres du serveur, puis réessayez.' });
        throw error;
      }
      return interaction.editReply({ content: '📩 Check your DMs! Send your F1 screenshot there to submit your request. / Consultez vos MP et envoyez votre capture F1 au bot.' });
    } catch (error) {
      console.error('[Verification] Start failed:', error);
      return interaction.editReply({ content: 'Could not start verification. Ask an officer to check the review channel and bot permissions. / Impossible de démarrer la vérification. Contactez un officier.' });
    }
  }, () => interaction.editReply({ content: 'Your request is being processed. / Votre demande est en cours.' }));
}

async function onMessage(message) {
  if (message.guild || message.author.bot) return;
  return locked(`user:${message.author.id}`, async () => {
    const request = Object.values(read()).find(item => item.userId === message.author.id && active(item));
    if (!request) return message.reply('Start verification using the server’s ticket panel first. / Commencez via le panneau de vérification du serveur.');
    if (request.status === 'pending') return message.reply('Your screenshot is awaiting review. / Votre capture attend la décision d’un officier.');
    if (message.content.trim().toLowerCase() === 'cancel') {
      request.status = 'cancelled'; save(request);
      return message.reply('Request cancelled. You can start again from the server panel. / Demande annulée. Vous pouvez recommencer depuis le panneau du serveur.');
    }
    const images = [...message.attachments.values()].filter(file => /^image\/(png|jpeg|webp)$/i.test(file.contentType || '') && file.size <= 8 * 1024 * 1024);
    if (images.length !== 1 || message.attachments.size !== 1) return message.reply('Attach exactly one PNG, JPG or WebP screenshot, max. 8 MB. / Joignez une seule capture PNG, JPG ou WebP, max. 8 Mo.');
    if (request.type === 'ally' && !message.content.trim()) return message.reply('Resend the screenshot with your clan/group name in the same message. / Renvoyez la capture avec le nom de votre clan/groupe dans le même message.');
    const guild = await message.client.guilds.fetch(request.guildId);
    await guild.members.fetch(request.userId);
    const channel = await reviewChannel(guild);
    const pending = { ...request, status: 'pending', note: message.content.slice(0, 1024), reviewChannelId: channel.id, sourceMessageId: message.id };
    const review = await channel.send({ ...reviewPayload(pending), files: [{ attachment: images[0].url, name: 'screenshot.png' }] });
    pending.reviewMessageId = review.id;
    try { save(pending); }
    catch (error) {
      await review.delete().catch(() => {});
      throw error;
    }
    await message.reply('✅ Screenshot submitted! An officer will review it and you’ll receive the result here. / Capture envoyée ! Un officier examinera votre demande et vous recevrez le résultat ici.');
  }, () => message.reply('Your previous upload is still processing. / Votre envoi précédent est en cours.'));
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
  const ranked = member.roles.cache.some(role => ['Private', 'Legionaire', 'Dragoon', 'Hussar', 'Hussars', 'Officer', 'Commander'].includes(role.name));
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
    return interaction.showModal(new ModalBuilder().setCustomId(`ticket_review_reason:${id}`).setTitle('Reject request / Refuser').addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason / Motif').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500))));
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
        const channel = await require('../features/tickets').createFollowupTicket(interaction, current.userId);
        current.followupChannelId = channel.id;
      }
    } catch (error) {
      console.error('[Verification] Role update failed:', error);
      return interaction.editReply(`Could not finish approval. Roles may already be updated, but the request remains pending until its question ticket is ready. Check bot permissions and retry Accept. ${error.message}`);
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
    try {
      const user = await interaction.client.users.fetch(current.userId);
      await user.send({ content: accepted
        ? `✅ Your ${current.type === 'ally' ? 'ally' : 'member'} verification for **${current.guildName}** was accepted. Your roles have been updated.\nVotre vérification a été acceptée. Vos rôles ont été mis à jour.\n\nAdditional questions? Your private ticket / Questions supplémentaires ? Votre ticket privé :\nhttps://discord.com/channels/${current.guildId}/${current.followupChannelId}`
        : `Your verification for **${current.guildName}** was rejected. / Votre vérification a été refusée.\n\n**Reason / Motif:** ${reason}\n\nYou can submit a new request from the server panel. / Vous pouvez refaire une demande depuis le panneau du serveur.`, allowedMentions: { parse: [] } });
    } catch { notified = false; }
    return interaction.editReply(`${accepted ? 'Accepted; roles updated.' : 'Rejected.'}${notified ? ' Applicant notified by DM.' : ' Could not DM the applicant.'}${panelUpdated ? '' : ' The panel could not be refreshed; this decision is saved.'}`);
  }, () => interaction.editReply('Another officer is processing this request.'));
}

function init(client) {
  if (initializedClients.has(client)) return;
  initializedClients.add(client);
  client.on('messageCreate', message => {
    onMessage(message).catch(async error => {
      console.error('[Verification] DM failed:', error);
      await message.reply('Could not process your screenshot. Try again, or contact an officer if this continues. / Impossible de traiter votre capture. Réessayez ou contactez un officier.').catch(() => {});
    });
  });
}

module.exports = { start, handleReview, init, onMessage, grantRoles, reviewPayload, canReview };
