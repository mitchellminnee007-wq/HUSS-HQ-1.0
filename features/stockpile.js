const { SlashCommandBuilder } = require('discord.js');
const store = require('../utils/logistics-store');
const { manager, memberAccess, canViewStockpile } = require('../utils/logistics-access');
const { findFoxholeItem } = require('../utils/foxhole-icons');
const audit = require('../utils/audit');
const panel = require('../utils/stockpile-panel');
const { isOfficer } = require('../utils/ranks');
const idOption = (sub, required = true) => sub.addStringOption(option => option.setName('stockpile').setDescription('Choose a stockpile by name').setAutocomplete(true).setRequired(required));
module.exports = {
  data: new SlashCommandBuilder().setName('stockpile').setDescription('Manage manually recorded Foxhole stockpiles.').setDMPermission(false)
    .addSubcommand(sub => sub.setName('panel').setDescription('Post a shared stockpile browser for members in this channel'))
    .addSubcommand(sub => sub.setName('create').setDescription('Register a depot, seaport or aircraft stockpile')
      .addStringOption(option => option.setName('name').setDescription('In-game stockpile name').setRequired(true).setMaxLength(60))
      .addStringOption(option => option.setName('location').setDescription('Hex, town and building').setRequired(true).setMaxLength(120))
      .addStringOption(option => option.setName('type').setDescription('Building').setRequired(true).addChoices(...['depot', 'seaport', 'aircraft_depot'].map(value => ({ name: value, value }))))
      .addStringOption(option => option.setName('access').setDescription('Stockpile type').setRequired(true).addChoices({ name: 'Reserve', value: 'reserve' }, { name: 'Public', value: 'public' }))
      .addStringOption(option => option.setName('war').setDescription('Shard / war label, for example Able / War 140').setRequired(true).setMaxLength(60))
      .addStringOption(option => option.setName('visibility').setDescription('Who can view this stockpile').setRequired(true).addChoices({ name: 'Members', value: 'members' }, { name: 'Officers only', value: 'officers' }))
      .addStringOption(option => option.setName('code').setDescription('Required for reserve stockpiles; not used for public stockpiles').setMaxLength(30)))
    .addSubcommand(sub => idOption(sub.setName('visibility').setDescription('Change who can view this stockpile'))
      .addStringOption(option => option.setName('access').setDescription('Who can view this stockpile').setRequired(true).addChoices({ name: 'Members', value: 'members' }, { name: 'Officers only', value: 'officers' })))
    .addSubcommand(sub => sub.setName('list').setDescription('List registered stockpiles').addIntegerOption(option => option.setName('page').setDescription('Page').setMinValue(1)))
    .addSubcommand(sub => idOption(sub.setName('view').setDescription('Open your stockpile browser or select a stockpile'), false).addIntegerOption(option => option.setName('page').setDescription('Inventory page').setMinValue(1)))
    .addSubcommand(sub => idOption(sub.setName('count').setDescription('Set the observed in-game inventory count'))
      .addStringOption(option => option.setName('item').setDescription('Search and select a Foxhole item').setAutocomplete(true).setRequired(true).setMaxLength(100))
      .addStringOption(option => option.setName('unit').setDescription('Never mix crates and loose items').setRequired(true).addChoices(...store.units.map(value => ({ name: value, value }))))
      .addIntegerOption(option => option.setName('quantity').setDescription('Total physically counted, including reserved stock').setRequired(true).setMinValue(0).setMaxValue(1000000)))
    .addSubcommand(sub => idOption(sub.setName('refresh').setDescription('Record the remaining timer observed in game; does not refresh the game'))
      .addNumberOption(option => option.setName('hours').setDescription('Remaining hours shown in game').setRequired(true).setMinValue(0).setMaxValue(168)))
    .addSubcommand(sub => idOption(sub.setName('set-code').setDescription('Store or replace a reserve access code; restricted to logistics staff'))
      .addStringOption(option => option.setName('code').setDescription('Access code').setRequired(true).setMaxLength(30)))
    .addSubcommand(sub => idOption(sub.setName('code').setDescription('Privately view the reserve code; logistics staff only')))
    .addSubcommand(sub => idOption(sub.setName('archive').setDescription('Archive a stockpile without deleting its history'))
      .addBooleanOption(option => option.setName('confirm').setDescription('Confirm archiving').setRequired(true))),
  autocomplete: panel.autocomplete,
  handleButton: panel.handleButton,
  handleSelect: panel.handleSelect,
  handleModal: panel.handleModal,
  async execute(interaction) {
    if (!memberAccess(interaction.member)) return interaction.reply({ content: 'Stockpile information is restricted to verified members and logistics staff.', ephemeral: true });
    const sub = interaction.options.getSubcommand();
    const canManage = manager(interaction.member);
    if (!['list', 'view'].includes(sub) && !canManage) return interaction.reply({ content: 'Only Officers, Commanders and the configured Logistics role can manage stockpiles or access codes.', ephemeral: true });
    if (sub === 'panel') return interaction.reply(panel.sharedPayload());
    const id = interaction.options.getString('stockpile') || interaction.options.getString('id');
    try {
      if (sub === 'list' || sub === 'view' || sub === 'code') {
        const guild = store.read().guilds[interaction.guildId] || { stockpiles: {}, orders: {} };
        if (sub === 'code') {
          if (!canViewStockpile(interaction.member, store.pile(guild, id))) throw new Error('Stockpile not found or not accessible.');
          return interaction.reply({ content: `Reserve code: ${store.pile(guild, id).code || 'Not recorded'}`, ephemeral: true, allowedMentions: { parse: [] } });
        }
        const page = interaction.options.getInteger('page') || 1;
        let selected = id;
        if (sub === 'view' && !selected) {
          const visible = panel.visible(guild, interaction.member);
          if (visible.length === 1) selected = visible[0].id;
        }
        const payload = sub === 'list' || !selected ? panel.listPayload(guild, interaction.member, page) : panel.detailPayload(guild, interaction.member, selected, page);
        return interaction.reply({ ...payload, ephemeral: true });
      }
      const result = store.transact(interaction.guildId, guild => {
        if (sub === 'create') {
          const access = interaction.options.getString('access'), visibility = interaction.options.getString('visibility');
          const code = interaction.options.getString('code')?.trim();
          if (!['members', 'officers'].includes(visibility)) throw new Error('Choose Members or Officers only in the visibility option. Refresh Discord if the option is missing.');
          if (access === 'reserve' && !code) throw new Error('Reserve stockpiles require an access code. Fill in the code option.');
          if (visibility === 'officers' && !isOfficer(interaction.member)) throw new Error('Only Officers and Commanders can create officer-only stockpiles.');
          return store.createStockpile(guild, { name: interaction.options.getString('name'), location: interaction.options.getString('location'), type: interaction.options.getString('type'), access, visibility, code: access === 'reserve' ? code : undefined, war: interaction.options.getString('war'), ownerId: interaction.user.id });
        }
        const value = store.pile(guild, id);
        if (!canViewStockpile(interaction.member, value)) throw new Error('Stockpile not found or not accessible.');
        if (sub === 'visibility') {
          if (!isOfficer(interaction.member)) throw new Error('Only Officers and Commanders can change stockpile visibility.');
          value.visibility = interaction.options.getString('access');
        }
        if (sub === 'count') {
          const input = interaction.options.getString('item');
          return store.setInventory(guild, id, findFoxholeItem(input)?.name || input, interaction.options.getString('unit'), interaction.options.getInteger('quantity'));
        }
        if (sub === 'refresh') {
          if (value.access !== 'reserve') throw new Error('Public stockpiles do not use a reserve expiry timer.');
          value.expiresAt = Date.now() + interaction.options.getNumber('hours') * 3600000;
          value.timerCheckedAt = Date.now();
        } else if (sub === 'set-code') {
          if (value.access !== 'reserve') throw new Error('Only reserve stockpiles have access codes.');
          value.code = interaction.options.getString('code').trim();
        } else if (sub === 'archive') {
          if (!interaction.options.getBoolean('confirm')) throw new Error('Archive cancelled.');
          if (Object.values(guild.orders).some(order => [order.sourceId, order.destinationId].includes(id) && !['cancelled', 'delivered'].includes(order.status))) throw new Error('Finish or cancel linked orders before archiving.');
          value.archived = true;
        }
        return value;
      });
      audit.record(interaction, `stockpile.${sub}`, result.id);
      const guild = store.read().guilds[interaction.guildId];
      const payload = guild ? (result.archived ? panel.listPayload(guild, interaction.member) : panel.detailPayload(guild, interaction.member, result.id)) : {};
      return interaction.reply({ content: `Stockpile **${result.name}** saved.${sub === 'refresh' ? ' Only the recorded timer changed; refresh the stockpile in Foxhole itself.' : ''}`, ...payload, ephemeral: true, allowedMentions: { parse: [] } });
    } catch (error) { return interaction.reply({ content: error.message, ephemeral: true, allowedMentions: { parse: [] } }); }
  },
};
