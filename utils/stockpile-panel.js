const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const store = require('./logistics-store');
const { memberAccess, manager, canViewStockpile } = require('./logistics-access');
const imports = require('./stockpile-import-ui');
const audit = require('./audit');
const units = { all: 'All inventory', crates: 'Item crates', vehicles: 'Vehicles', shippable_crates: 'Shippable crates', items: 'Loose items / shippables' };
const button = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const clamp = (value, count, size) => Math.min(Math.max(1, Number(value) || 1), Math.max(1, Math.ceil(count / size)));
function guildData(interaction) {
  if (!interaction.guildId || !memberAccess(interaction.member)) throw new Error('Stockpiles are restricted to verified members and logistics staff.');
  return store.read().guilds[interaction.guildId] || { stockpiles: {}, orders: {} };
}
function visible(guild, member) {
  return Object.values(guild.stockpiles).filter(pile => !pile.archived && canViewStockpile(member, pile)).sort((a, b) => a.name.localeCompare(b.name) || a.location.localeCompare(b.location));
}
function accessible(guild, member, id) {
  const pile = guild.stockpiles[id];
  if (!pile || pile.archived || !canViewStockpile(member, pile)) throw new Error('Stockpile not found or not accessible.');
  return pile;
}
function timer(pile) {
  if (pile.access !== 'reserve') return 'Public stockpile';
  if (!pile.expiresAt) return 'No timer recorded';
  return `${pile.expiresAt <= Date.now() ? '⚠️ Reported timer expired' : 'Reported expiry'} <t:${Math.floor(pile.expiresAt / 1000)}:R>`;
}
function sharedPayload() {
  return { embeds: [new EmbedBuilder().setColor(0x4F8B73).setTitle('📦 Regiment stockpiles')
    .setDescription('Find supplies, check available inventory and plan your next delivery.\n\nClick **Open stockpiles** to browse the stockpiles available to your role.')
    .setFooter({ text: 'Your inventory browser opens privately • Manually reported stock' })],
    components: [row(button('sp_open', 'Open stockpiles', ButtonStyle.Primary))], allowedMentions: { parse: [] } };
}
function listPayload(guild, member, requestedPage = 1) {
  const piles = visible(guild, member), page = clamp(requestedPage, piles.length, 8);
  const shown = piles.slice((page - 1) * 8, page * 8);
  const embed = new EmbedBuilder().setColor(0x4F8B73).setTitle('📦 Stockpile overview')
    .setDescription(piles.length ? `**${piles.length} accessible stockpile${piles.length === 1 ? '' : 's'}**\nChoose a stockpile below to open its inventory.` : 'No stockpiles available to you yet.')
    .setFooter({ text: `Page ${page}/${Math.max(1, Math.ceil(piles.length / 8))} • Manually reported stock` });
  for (const pile of shown) {
    const stocked = Object.values(pile.inventory).filter(entry => entry.quantity > 0).length;
    embed.addFields({ name: `${pile.visibility === 'officers' ? '🔒' : '📦'} ${pile.name}`, value: `**${pile.location}**\n${pile.war} · ${stocked} stocked item types\n${timer(pile)}` });
  }
  const components = [];
  if (shown.length) components.push(row(new StringSelectMenuBuilder().setCustomId('sp_choose').setPlaceholder('Choose a stockpile…').addOptions(shown.map(pile => ({
    label: pile.name.slice(0, 100), value: pile.id, description: `${pile.location} • ${pile.war}`.slice(0, 100), emoji: pile.visibility === 'officers' ? '🔒' : '📦',
  })))));
  components.push(row(button(`sp_list:${page - 1}`, 'Previous').setDisabled(page <= 1), button(`sp_list:${page + 1}`, 'Next').setDisabled(page * 8 >= piles.length), button(`sp_list:${page}`, 'Refresh')));
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}
function detailPayload(guild, member, id, requestedPage = 1, filter = 'all') {
  const pile = accessible(guild, member, id);
  if (!units[filter]) filter = 'all';
  const entries = Object.entries(pile.inventory).filter(([, entry]) => entry.quantity > 0 && (filter === 'all' || entry.unit === filter)).sort((a, b) => a[1].item.localeCompare(b[1].item));
  const page = clamp(requestedPage, entries.length, 8);
  const embed = new EmbedBuilder().setColor(0x4F8B73).setTitle(`📦 ${pile.name}`)
    .setDescription(`**${pile.location}**\n${pile.war} · ${(pile.type || 'depot').replaceAll('_', ' ')} · ${pile.access}\n${pile.visibility === 'officers' ? '🔒 Officers only' : '👥 Members'}`)
    .addFields({ name: 'Stock status', value: `${timer(pile)}\nLast recorded change <t:${Math.floor(pile.updatedAt / 1000)}:R>` })
    .setFooter({ text: `${units[filter]} • Page ${page}/${Math.max(1, Math.ceil(entries.length / 8))} • Manual counts; zero stock hidden` });
  for (const [key, entry] of entries.slice((page - 1) * 8, page * 8)) {
    const reserved = store.reserved(guild, id, key);
    embed.addFields({ name: entry.item, value: `**${entry.quantity - reserved} available** · ${entry.quantity} counted · ${reserved} reserved\n${units[entry.unit] || entry.unit}`, inline: true });
  }
  if (!entries.length) embed.addFields({ name: 'Inventory', value: filter === 'all' ? 'No non-zero stock recorded. Logistics staff can use **Import contents** below to load an export.' : 'No stocked items in this category. Choose another filter.' });
  const components = [row(new StringSelectMenuBuilder().setCustomId(`sp_filter:${id}`).setPlaceholder('Filter inventory').addOptions(Object.entries(units).map(([value, label]) => ({ label, value, default: value === filter })))),
    row(button('sp_list:1', 'All stockpiles'), button(`sp_view:${id}:${page - 1}:${filter}`, 'Previous').setDisabled(page <= 1), button(`sp_view:${id}:${page + 1}:${filter}`, 'Next').setDisabled(page * 8 >= entries.length), button(`sp_view:${id}:${page}:${filter}`, 'Refresh'))];
  if (manager(member)) {
    const actions = [imports.importRow(id).components[0]];
    if (pile.access === 'reserve') actions.push(button(`sp_code:${id}`, 'View code'), button(`sp_editcode:${id}`, 'Set code'), button(`sp_timer:${id}`, 'Update timer'));
    components.push(row(...actions));
  }
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}
async function autocomplete(interaction) {
  if (interaction.options.getFocused(true)?.name === 'item') return require('./item-autocomplete').autocomplete(interaction);
  try {
    const guild = guildData(interaction), search = String(interaction.options.getFocused()).toLowerCase();
    await interaction.respond(visible(guild, interaction.member).filter(pile => `${pile.name} ${pile.location} ${pile.war}`.toLowerCase().includes(search)).slice(0, 25).map(pile => ({ name: `${pile.name} — ${pile.location} · ${pile.war}`.slice(0, 100), value: pile.id })));
  } catch { await interaction.respond([]); }
}
async function handleButton(interaction) {
  if (/^sp_(import|confirm|cancel):/.test(interaction.customId)) return imports.handleButton(interaction);
  try {
    const [action, id, page, filter] = interaction.customId.split(':');
    const guild = guildData(interaction);
    if (action === 'sp_open') return await interaction.reply({ ...listPayload(guild, interaction.member), ephemeral: true });
    if (action === 'sp_list') return await interaction.update(listPayload(guild, interaction.member, id));
    const pile = accessible(guild, interaction.member, id);
    if (action === 'sp_view') return await interaction.update(detailPayload(guild, interaction.member, id, page, filter));
    if (!manager(interaction.member)) throw new Error('Only logistics staff can manage inventory or reserve codes.');
    if (pile.access !== 'reserve') throw new Error('This action is only available for reserve stockpiles.');
    if (action === 'sp_code') return await interaction.reply({ content: `Reserve code: ${pile.code || 'Not recorded'}`, ephemeral: true, allowedMentions: { parse: [] } });
    if (!['sp_editcode', 'sp_timer'].includes(action)) throw new Error('Unknown stockpile action.');
    const isCode = action === 'sp_editcode';
    return await interaction.showModal(new ModalBuilder().setCustomId(`sp_manage:${id}:${isCode ? 'code' : 'timer'}`).setTitle(isCode ? 'Set reserve code' : 'Record remaining timer').addComponents(row(
      new TextInputBuilder().setCustomId('value').setLabel(isCode ? 'Reserve access code' : 'Hours remaining in game (0–168)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(isCode ? 30 : 8)
    )));
  } catch (error) { return interaction.reply({ content: error.message, ephemeral: true, allowedMentions: { parse: [] } }); }
}
async function handleSelect(interaction) {
  try {
    const [action, id] = interaction.customId.split(':');
    const guild = guildData(interaction);
    if (action === 'sp_choose') return await interaction.update(detailPayload(guild, interaction.member, interaction.values[0]));
    if (action === 'sp_filter') return await interaction.update(detailPayload(guild, interaction.member, id, 1, interaction.values[0]));
    throw new Error('Unknown stockpile selection.');
  } catch (error) { return interaction.reply({ content: error.message, ephemeral: true }); }
}
async function handleModal(interaction) {
  if (interaction.customId.startsWith('sp_import_modal:')) return imports.handleModal(interaction);
  try {
    const [, id, action] = interaction.customId.split(':');
    if (!manager(interaction.member)) throw new Error('Only logistics staff can manage this stockpile.');
    const value = interaction.fields.getTextInputValue('value').trim();
    if (action === 'code' && !value) throw new Error('Enter a reserve code.');
    const hours = Number(value.replace(',', '.'));
    if (action === 'timer' && (!value || !Number.isFinite(hours) || hours < 0 || hours > 168)) throw new Error('Enter a number of hours between 0 and 168.');
    const payload = store.transact(interaction.guildId, guild => {
      const pile = accessible(guild, interaction.member, id);
      if (pile.access !== 'reserve') throw new Error('This stockpile is public.');
      if (action === 'code') pile.code = value;
      else if (action === 'timer') { pile.expiresAt = Date.now() + hours * 3600000; pile.timerCheckedAt = Date.now(); }
      else throw new Error('Unknown stockpile action.');
      return detailPayload(guild, interaction.member, id);
    });
    audit.record(interaction, `stockpile.${action === 'code' ? 'set-code' : 'refresh'}`, id);
    return await interaction.reply({ content: action === 'code' ? 'Reserve code saved.' : 'Reported timer saved. This does not refresh the stockpile in Foxhole.', ...payload, ephemeral: true });
  } catch (error) { return interaction.reply({ content: error.message, ephemeral: true, allowedMentions: { parse: [] } }); }
}
const originalList=listPayload,originalDetail=detailPayload;
listPayload=(g,m,page=1)=>require('./live-panels').tagged(originalList(g,m,page),{kind:'stockpile',page});
detailPayload=(g,m,id,page=1,filter='all')=>require('./live-panels').tagged(originalDetail(g,m,id,page,filter),{kind:'stockpile',id,page,filter});
module.exports = { sharedPayload, listPayload, detailPayload, guildData, visible, autocomplete, handleButton, handleSelect, handleModal };
