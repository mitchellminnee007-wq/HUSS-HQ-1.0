const { SlashCommandBuilder } = require('discord.js');
const store = require('../utils/logistics-store');
const { manager, memberAccess, canViewStockpile, canViewOrder } = require('../utils/logistics-access');
const { findFoxholeItem } = require('../utils/foxhole-icons');
const audit = require('../utils/audit');
const panel = require('../utils/order-panel');
const idOption = (sub, required = true) => sub.addStringOption(option => option.setName('id').setDescription('Choose an order by item or destination').setAutocomplete(true).setRequired(required));
module.exports = {
  data: new SlashCommandBuilder().setName('order').setDescription('Track production and transport orders with stock reservations.').setDMPermission(false)
    .addSubcommand(sub => sub.setName('panel').setDescription('Post a shared order browser in this channel'))
    .addSubcommand(sub => sub.setName('create').setDescription('Create a production or transport order')
      .addStringOption(option => option.setName('type').setDescription('Order type').setRequired(true).addChoices(...['transport', 'frontline_supply', 'production'].map(value => ({ name: value, value }))))
      .addStringOption(option => option.setName('item').setDescription('Search and select a Foxhole item').setAutocomplete(true).setRequired(true).setMaxLength(100))
      .addStringOption(option => option.setName('unit').setDescription('Unit, matching inventory').setRequired(true).addChoices(...store.units.map(value => ({ name: value, value }))))
      .addIntegerOption(option => option.setName('quantity').setDescription('Total requested').setRequired(true).setMinValue(1).setMaxValue(1000000))
      .addStringOption(option => option.setName('destination').setDescription('Delivery location / receiver').setRequired(true).setMaxLength(120))
      .addStringOption(option => option.setName('source').setDescription('Choose source stockpile by name; required except for production').setAutocomplete(true).setMaxLength(100))
      .addStringOption(option => option.setName('destination-stockpile').setDescription('Choose destination stockpile by name').setAutocomplete(true).setMaxLength(100))
      .addStringOption(option => option.setName('priority').setDescription('Priority').addChoices(...['low', 'normal', 'critical'].map(value => ({ name: value, value }))))
      .addStringOption(option => option.setName('notes').setDescription('Instructions, timing or linked logistics task').setMaxLength(500)))
    .addSubcommand(sub => sub.setName('list').setDescription('List open orders or completed orders')
      .addStringOption(option => option.setName('status').setDescription('Filter').addChoices({ name: 'Open / active', value: 'active' }, { name: 'Completed / cancelled', value: 'closed' }))
      .addIntegerOption(option => option.setName('page').setDescription('Page').setMinValue(1)))
    .addSubcommand(sub => idOption(sub.setName('view').setDescription('Browse orders or view a selected order'), false))
    .addSubcommand(sub => idOption(sub.setName('claim').setDescription('Assign yourself to an unclaimed order')))
    .addSubcommand(sub => idOption(sub.setName('update').setDescription('Record a pickup, production, delivery, return, cargo loss or cancellation'))
      .addStringOption(option => option.setName('action').setDescription('What happened in game').setRequired(true).addChoices(...['pickup', 'produce', 'deliver', 'return', 'loss', 'cancel'].map(value => ({ name: value, value }))))
      .addIntegerOption(option => option.setName('quantity').setDescription('Quantity moved; omit for cancellation').setMinValue(1).setMaxValue(1000000))
      .addStringOption(option => option.setName('note').setDescription('Delivery confirmation / loss or cancellation reason / evidence link').setMaxLength(500))),
  autocomplete: panel.autocomplete,
  handleButton: panel.handleButton,
  handleSelect: panel.handleSelect,
  handleModal: panel.handleModal,
  async execute(interaction) {
    if (!memberAccess(interaction.member)) return interaction.reply({ content: 'Orders are restricted to verified members and logistics staff.', ephemeral: true });
    const sub = interaction.options.getSubcommand();
    const staff = manager(interaction.member);
    if (['create','panel'].includes(sub) && !staff) return interaction.reply({ content: 'Only officers and the configured Logistics role can create orders.', ephemeral: true });
    if (sub === 'panel') return interaction.reply(panel.sharedPayload());
    const id = interaction.options.getString('id');
    try {
      if (sub === 'list' || sub === 'view') {
        const guild = store.read().guilds[interaction.guildId] || { stockpiles: {}, orders: {} };
        const payload = sub === 'view' && id ? panel.detailPayload(guild, interaction, id)
          : panel.listPayload(guild, interaction, interaction.options.getString('status') || 'active', interaction.options.getInteger('page') || 1);
        return interaction.reply({ ...payload, ephemeral: true });
      }
      const result = store.transact(interaction.guildId, guild => {
        let order;
        if (sub === 'create') {
          for (const key of ['source', 'destination-stockpile']) {
            const pileId = interaction.options.getString(key);
            if (pileId && !canViewStockpile(interaction.member, guild.stockpiles[pileId])) throw new Error('Stockpile not found or not accessible.');
          }
          const input = interaction.options.getString('item');
          order = store.createOrder(guild, { type: interaction.options.getString('type'), item: findFoxholeItem(input)?.name || input,
            unit: interaction.options.getString('unit'), quantity: interaction.options.getInteger('quantity'), sourceId: interaction.options.getString('source'),
            destinationId: interaction.options.getString('destination-stockpile'), destination: interaction.options.getString('destination'),
            priority: interaction.options.getString('priority') || 'normal', notes: interaction.options.getString('notes'), requestedBy: interaction.user.id });
        } else {
          if (!guild.orders[id] || !canViewOrder(interaction.member, guild.orders[id], guild)) throw new Error('Order not found or not accessible.');
          order = store.updateOrder(guild, id, sub === 'claim' ? 'claim' : interaction.options.getString('action'), interaction.user.id, staff, interaction.options.getInteger('quantity'), interaction.options.getString('note'));
        }
        return { order, payload: panel.detailPayload(guild, interaction, order.id) };
      });
      audit.record(interaction, `order.${sub === 'update' ? interaction.options.getString('action') : sub}`, result.order.id, { quantity: interaction.options.getInteger('quantity'), reason: interaction.options.getString('note') });
      return interaction.reply({ ...result.payload, ephemeral: true });
    } catch (error) { return interaction.reply({ content: error.message, ephemeral: true, allowedMentions: { parse: [] } }); }
  },
};
