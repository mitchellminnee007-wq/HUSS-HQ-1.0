const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const file = path.join(__dirname, '..', 'data', 'logistics-inventory.json');
const units = ['crates', 'items', 'vehicles', 'shippable_crates'];
function key(item, unit) { return `${item.trim().toLowerCase()}|${unit}`; }
function read() { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { guilds: {} }; }
function transact(guildId, operation) {
  const store = read();
  const guild = store.guilds[guildId] ||= { stockpiles: {}, orders: {} };
  const result = operation(guild);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(store, null, 2));
  fs.renameSync(`${file}.tmp`, file);
  return result;
}
function quantity(value, zero = false) {
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1) || value > 1000000) throw new Error('Quantity must be a whole number between ' + (zero ? '0' : '1') + ' and 1,000,000.');
}
function pile(guild, id) {
  const value = guild.stockpiles[id];
  if (!value || value.archived) throw new Error('Stockpile not found or archived in this server.');
  return value;
}
function reserved(guild, id, itemKey) {
  return Object.values(guild.orders).filter(order => order.sourceId === id && order.itemKey === itemKey && !['cancelled', 'delivered'].includes(order.status))
    .reduce((sum, order) => sum + order.quantity - order.delivered - order.transit, 0);
}
function available(guild, id, itemKey) { return (pile(guild, id).inventory[itemKey]?.quantity || 0) - reserved(guild, id, itemKey); }
function createStockpile(guild, input) {
  if (!input.name?.trim() || !input.location?.trim()) throw new Error('Name and location are required.');
  if (Object.values(guild.stockpiles).some(value => !value.archived && value.name.toLowerCase() === input.name.trim().toLowerCase() && value.location.toLowerCase() === input.location.trim().toLowerCase())) throw new Error('A stockpile with this name and location already exists.');
  const id = randomUUID().slice(0, 8);
  if (guild.stockpiles[id]) throw new Error('ID collision; retry.');
  const value = { ...input, name: input.name.trim(), location: input.location.trim(), id, inventory: {}, createdAt: Date.now(), updatedAt: Date.now(), archived: false };
  guild.stockpiles[id] = value;
  return value;
}
function setInventory(guild, id, item, unit, amount) {
  quantity(amount, true);
  if (!units.includes(unit) || !item.trim()) throw new Error('Choose an item and supported unit.');
  const stockpile = pile(guild, id);
  const itemKey = key(item, unit);
  if (amount < reserved(guild, id, itemKey)) throw new Error('This count is below stock reserved by open orders. Cancel or adjust those orders first.');
  stockpile.inventory[itemKey] = { item: item.trim(), unit, quantity: amount };
  stockpile.updatedAt = Date.now();
  return stockpile;
}
function createOrder(guild, input) {
  quantity(input.quantity);
  if (!units.includes(input.unit) || !input.item?.trim() || !input.destination?.trim()) throw new Error('Item, unit and destination are required.');
  if (!['transport', 'frontline_supply', 'production'].includes(input.type)) throw new Error('Unsupported order type.');
  const itemKey = key(input.item, input.unit);
  if (input.type !== 'production' && !input.sourceId) throw new Error('Transport and frontline orders require a source stockpile.');
  if (input.type === 'production' && input.sourceId) throw new Error('Production orders create new goods; leave source empty.');
  if (input.sourceId && available(guild, input.sourceId, itemKey) < input.quantity) throw new Error('Insufficient unreserved stock. Update the counted inventory or reduce the order.');
  if (input.destinationId) {
    const destination = pile(guild, input.destinationId);
    if (input.sourceId && pile(guild, input.sourceId).war.trim().toLowerCase() !== destination.war.trim().toLowerCase()) throw new Error('Source and destination must belong to the same shard / war.');
    if (input.destinationId === input.sourceId) throw new Error('Source and destination stockpiles must differ.');
  }
  const id = randomUUID().slice(0, 8);
  if (guild.orders[id]) throw new Error('ID collision; retry.');
  const order = { ...input, id, itemKey, delivered: 0, transit: 0, status: 'open', workerId: null, createdAt: Date.now(), updates: [] };
  guild.orders[id] = order;
  return order;
}
function updateOrder(guild, id, action, actorId, officer, amount, note) {
  const order = guild.orders[id];
  if (!order) throw new Error('Order not found in this server.');
  if (['cancelled', 'delivered'].includes(order.status)) throw new Error('This order is already closed.');
  if (action === 'claim') {
    if (order.workerId && order.workerId !== actorId) throw new Error('Another member already claimed this order.');
    order.workerId = actorId; order.status = order.transit ? 'in_transit' : 'claimed';
  } else {
    if (!officer && order.workerId !== actorId) throw new Error('Only the assigned worker or an officer can update this order.');
    if (action === 'cancel') {
      if (order.transit) throw new Error('Goods are in transit. Record their delivery or return before cancelling.');
      if (!note?.trim()) throw new Error('A cancellation reason is required.');
      order.status = 'cancelled';
    } else {
      quantity(amount);
      if (action === 'pickup' || action === 'produce') {
        if ((action === 'produce') !== (order.type === 'production')) throw new Error('Use produce for production orders and pickup for transport orders.');
        if (amount > order.quantity - order.delivered - order.transit) throw new Error('Amount exceeds the remaining order quantity.');
        if (order.sourceId) {
          const source = pile(guild, order.sourceId);
          if ((source.inventory[order.itemKey]?.quantity || 0) < amount) throw new Error('Source stock is insufficient.');
          source.inventory[order.itemKey].quantity -= amount;
          source.updatedAt = Date.now();
        }
        order.transit += amount; order.status = 'in_transit';
      } else if (action === 'deliver') {
        if (amount > order.transit) throw new Error('You cannot deliver more than was picked up or produced.');
        if (!note?.trim()) throw new Error('Record delivery confirmation, such as destination and receiver or a screenshot link.');
        if (order.destinationId) {
          const destination = pile(guild, order.destinationId);
          const entry = destination.inventory[order.itemKey] ||= { item: order.item, unit: order.unit, quantity: 0 };
          entry.quantity += amount; destination.updatedAt = Date.now();
        }
        order.transit -= amount; order.delivered += amount;
        order.status = order.delivered === order.quantity ? 'delivered' : order.transit ? 'in_transit' : 'claimed';
        if (order.status === 'delivered') order.completedAt = Date.now();
      } else if (action === 'return') {
        if (!order.sourceId || amount > order.transit) throw new Error('Only goods in transit from a source stockpile can be returned.');
        const source = pile(guild, order.sourceId);
        source.inventory[order.itemKey].quantity += amount; source.updatedAt = Date.now();
        order.transit -= amount; order.status = order.transit ? 'in_transit' : 'claimed';
      } else throw new Error('Unknown order action.');
    }
  }
  order.updates.push({ action, actorId, amount, note, at: Date.now() });
  return order;
}
module.exports = { units, key, read, transact, pile, reserved, available, createStockpile, setInventory, createOrder, updateOrder };
