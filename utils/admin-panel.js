const fs = require('./data-fs');
const path = require('node:path');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
  TextInputBuilder, TextInputStyle, PermissionFlagsBits, ChannelType } = require('discord.js');
const { getConfig, setConfig } = require('./config');

const pages = { home: 'Overview', review: 'Verifications', events: 'Events', war: 'War management', settings: 'Settings', logistics: 'Logistics' };
const settings = {
  channels: [ ['ADMIN_PANEL_CHANNEL_ID', 'Admin panel channel'], ['VERIFICATION_CHANNEL_ID', 'Public verification channel'],
    ['VERIFICATION_REVIEW_CHANNEL_ID', 'Private review channel'], ['OPERATIONS_CHANNEL_ID', 'Operations channel'], ['TRAININGS_CHANNEL_ID', 'Trainings channel'] ],
  roles: [ ['RECRUITMENT_OFFICER_ROLE_ID', 'Recruitment officer role'], ['VERIFIED_MEMBER_ROLE_ID', 'Member role'],
    ['CADET_ROLE_ID', 'Cadet role'], ['ALLY_ROLE_ID', 'Ally role'], ['UNVERIFIED_ROLE_ID', 'Unverified role'] ],
};
function button(id, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
}
function row(...buttons) { return new ActionRowBuilder().addComponents(...buttons); }
function readData(name, warnings) {
  const file = path.join(__dirname, '..', 'data', `${name}.json`);
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { warnings.push(`${name}: saved data could not be read`); return {}; }
}
function buildPage(guild, page = 'home', offset = 0) {
  if (!pages[page]) page = 'home';
  const warnings = [];
  const requests = Object.values(readData('verification-requests', warnings)).filter(r => r.guildId === guild.id);
  const pending = requests.filter(r => r.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
  const rollover = readData('rollover', warnings).guilds?.[guild.id];
  const war = readData('killcount', warnings).guilds?.[guild.id]?.active;
  const tickets = Object.keys(readData('tickets', warnings).guilds?.[guild.id] || {}).length;
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`HUSS Admin • ${pages[page]}`)
    .setFooter({ text: `${guild.name} • Status refreshed when you open a page` }).setTimestamp();
  const navigation = Object.entries(pages).map(([key, label]) => button(`bp_page:${key}`, label, key === page ? ButtonStyle.Primary : ButtonStyle.Secondary));
  const components = [row(...navigation.slice(0, 5)), row(...navigation.slice(5))];
  const channel = key => getConfig(guild.id, key) ? `<#${getConfig(guild.id, key)}>` : '*Not configured*';
  if (page === 'home') {
    embed.setDescription('Manage recruitment, events and the current war. Choose a section below. Your navigation is private.')
      .addFields(
        { name: 'Awaiting review', value: String(pending.length), inline: true },
        { name: 'Awaiting screenshot', value: String(requests.filter(r => r.status === 'awaiting' && Date.now() - r.createdAt < 86400000).length), inline: true },
        { name: 'Open server tickets', value: String(tickets), inline: true },
        { name: 'Kill count', value: war ? String(war.name).slice(0, 100) : 'No active tracker', inline: true },
        { name: 'Rollover', value: rollover ? `<t:${Math.floor(rollover.executeAt / 1000)}:F>` : 'Not scheduled', inline: true },
        { name: 'Review channel', value: channel('VERIFICATION_REVIEW_CHANNEL_ID') === '*Not configured*' ? channel('OFFICER_CHANNEL_ID') : channel('VERIFICATION_REVIEW_CHANNEL_ID'), inline: true },
      );
    components.push(row(button('bp_page:home:0', 'Refresh overview'), button('bp_ticketpanel', 'Post verification panel')));
  } else if (page === 'review') {
    const pageCount = Math.max(1, Math.ceil(pending.length / 5));
    offset = Math.max(0, Math.min(Number.isInteger(offset) ? offset : 0, pageCount - 1));
    embed.setDescription(`**${pending.length}** requests awaiting review • Page ${offset + 1}/${pageCount}\nApplicants submit screenshots by DM. Open a review to accept or reject it.`);
    for (const request of pending.slice(offset * 5, offset * 5 + 5)) {
      const link = request.reviewChannelId && request.reviewMessageId
        ? `[Open review](https://discord.com/channels/${guild.id}/${request.reviewChannelId}/${request.reviewMessageId})` : 'Review message unavailable';
      embed.addFields({ name: request.type === 'ally' ? 'Ally request' : 'Member verification', value: `<@${request.userId}> • <t:${Math.floor(request.createdAt / 1000)}:R>\n${link}` });
    }
    if (!pending.length) embed.addFields({ name: 'Queue clear', value: 'No applicants are waiting for a decision.' });
    components.push(row(button(`bp_page:review:${offset - 1}`, 'Previous').setDisabled(offset === 0), button(`bp_page:review:${offset}`, 'Refresh queue'), button(`bp_page:review:${offset + 1}`, 'Next').setDisabled(offset >= pageCount - 1)));
    components.push(row(button('bp_ticketpanel', 'Post verification panel', ButtonStyle.Success)));
  } else if (page === 'events') {
    embed.setDescription('Create an operation or training using a short form. Existing event panels handle attendance and follow-up.')
      .addFields({ name: 'Operations', value: channel('OPERATIONS_CHANNEL_ID'), inline: true }, { name: 'Trainings', value: channel('TRAININGS_CHANNEL_ID'), inline: true });
    components.push(row(button('bp_operation', 'Create operation', ButtonStyle.Primary), button('bp_training', 'Create training', ButtonStyle.Primary)));
  } else if (page === 'war') {
    embed.setDescription('Manage activity, kill counts and the four-day rollover. Activity checks only schedule a rollover when you explicitly opt in.')
      .addFields({ name: 'Kill count', value: war ? String(war.name).slice(0, 100) : 'No active tracker' },
        { name: 'Rollover', value: rollover ? `<t:${Math.floor(rollover.executeAt / 1000)}:F> • Scheduled by <@${rollover.startedBy}>` : 'Not scheduled' });
    components.push(row(button('bp_killcount', 'Start kill count', ButtonStyle.Primary).setDisabled(Boolean(war)), button('bp_activemember', 'Post activity check', ButtonStyle.Success)));
    components.push(row(button('bp_rollover_start', 'Schedule rollover').setDisabled(Boolean(rollover)), button('bp_rollover_cancel', 'Cancel rollover', ButtonStyle.Danger).setDisabled(!rollover)));
  } else if (page === 'logistics') {
    const inventory = readData('logistics-inventory', warnings).guilds?.[guild.id] || { stockpiles: {}, orders: {} };
    const stockpiles = Object.values(inventory.stockpiles).filter(value => !value.archived);
    const orders = Object.values(inventory.orders).filter(value => !['cancelled', 'delivered', 'completed_with_losses'].includes(value.status));
    embed.setDescription('Track counted stock, reserved quantities, production and deliveries. Counts are manually reported; the bot does not read or control your Foxhole inventory.')
      .addFields({ name: 'Stockpiles', value: String(stockpiles.length), inline: true }, { name: 'Active orders', value: String(orders.length), inline: true },
        { name: 'Timers needing attention', value: String(stockpiles.filter(value => value.expiresAt && value.expiresAt - Date.now() < 6 * 3600000).length), inline: true },
        { name: 'Stock commands', value: '/stockpile create • list • view • count • refresh\nReserve codes are restricted to logistics staff.' },
        { name: 'Order commands', value: '/order create • list • view • claim • update\nRecord pickup/production before delivery; partial deliveries are supported.' });
  } else {
    embed.setDescription('Configure channels and recruitment roles here. Editing requires **Manage Server** as well as panel access. Leave a field blank to keep its current value.\nUse `/setup-check` to validate setup, `/config` for trainer/logistics/qualification roles, `/memberinfo` for profiles, `/certify` for assessments, `/auditlog` for history and `/warreport` for reports.');
    for (const [group, entries] of Object.entries(settings)) {
      embed.addFields({ name: group === 'channels' ? 'Channels' : 'Recruitment roles', value: entries.map(([key, label]) => {
        const value = getConfig(guild.id, key);
        return `**${label}:** ${value ? group === 'channels' ? `<#${value}>` : `<@&${value}>` : 'Not configured'}`;
      }).join('\n') });
    }
    embed.addFields({ name: 'Role defaults', value: 'Unset recruitment roles use Member, Cadet, Ally and unverified by name. The review channel falls back to Officer Channel.' });
    components.push(row(button('bp_setup:channels', 'Edit channels'), button('bp_setup:roles', 'Edit roles')));
  }
  if (warnings.length) embed.addFields({ name: 'Data needs attention', value: warnings.join('\n').slice(0, 1024) });
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}
function buildSettingsModal(guildId, group) {
  if (!settings[group]) return null;
  return new ModalBuilder().setCustomId(`bp_setup_modal:${group}`).setTitle(group === 'channels' ? 'Configure channels' : 'Configure recruitment roles')
    .addComponents(...settings[group].map(([key, label]) => {
      const input = new TextInputBuilder().setCustomId(key).setLabel(label).setStyle(TextInputStyle.Short)
        .setRequired(false).setMaxLength(25).setPlaceholder('Paste ID or mention; blank keeps current');
      const value = getConfig(guildId, key);
      if (value) input.setValue(value);
      return new ActionRowBuilder().addComponents(input);
    }));
}
async function saveSettings(interaction, group) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'Manage Server permission is required to edit settings.', ephemeral: true });
  if (!settings[group]) return interaction.reply({ content: 'Unknown settings form.', ephemeral: true });
  await interaction.deferReply({ ephemeral: true });
  const changes = [];
  for (const [key, label] of settings[group]) {
    const raw = interaction.fields.getTextInputValue(key).trim();
    if (!raw) continue;
    const id = raw.replace(/^<[@#]&?([0-9]+)>$/, '$1');
    if (!/^\d{17,20}$/.test(id)) return interaction.editReply(`Invalid ID for ${label}. No settings were changed.`);
    const entity = group === 'channels' ? await interaction.guild.channels.fetch(id).catch(() => null) : await interaction.guild.roles.fetch(id).catch(() => null);
    if (!entity || (group === 'channels' && entity.type !== ChannelType.GuildText)) return interaction.editReply(`${label} must be a valid ${group === 'channels' ? 'text channel' : 'role'} in this server. No settings were changed.`);
    if (group === 'channels' && ['ADMIN_PANEL_CHANNEL_ID', 'VERIFICATION_REVIEW_CHANNEL_ID'].includes(key)
      && entity.permissionsFor(interaction.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)) {
      return interaction.editReply(`${label} must be private: deny View Channel for @everyone. No settings were changed.`);
    }
    if (group === 'roles' && (entity.managed || entity.id === interaction.guildId)) return interaction.editReply(`${label} cannot be a managed role or @everyone. No settings were changed.`);
    changes.push([key, id]);
  }
  for (const [key, value] of changes) setConfig(interaction.guildId, key, value);
  return interaction.editReply({ content: changes.length ? 'Settings saved.' : 'No settings changed.', ...buildPage(interaction.guild, 'settings') });
}
module.exports = { buildPage, buildSettingsModal, saveSettings };
