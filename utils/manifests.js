const { randomUUID } = require('node:crypto');
const { memberAccess, manager, canViewOrder } = require('./logistics-access');
const { isOfficer } = require('./ranks');
const closed = manifest => ['delivered', 'cancelled', 'completed_with_losses'].includes(manifest.status);
function visible(guild, member, manifest) {
  return Boolean(manifest && memberAccess(member) && (manifest.visibility !== 'officers' || isOfficer(member)) && manifest.orderIds.every(id => guild.orders[id] && canViewOrder(member, guild.orders[id], guild)));
}
function get(guild, member, id) {
  const manifest = guild.manifests?.[id];
  if (!visible(guild, member, manifest)) throw new Error('Manifest not found or not accessible.');
  return manifest;
}
function editable(member, actorId, manifest) {
  if (!manager(member) && manifest.leaderId !== actorId) throw new Error('Only the shipment leader or logistics staff can change this manifest.');
  if (closed(manifest)) throw new Error('This manifest is closed.');
}
function log(manifest, action, actorId, details = {}) {
  manifest.updatedAt = Date.now();
  manifest.history.push({action,actorId,at:manifest.updatedAt,...details});
  manifest.history = manifest.history.slice(-100);
}
function create(guild, member, actorId, input) {
  if (!manager(member)) throw new Error('Only officers and logistics staff can create manifests.');
  if (!input.name?.trim() || !input.route?.trim()) throw new Error('Shipment name and route are required.');
  if (!['truck','freighter','train','convoy'].includes(input.mode)) throw new Error('Choose a supported transport mode.');
  if (!['members','officers'].includes(input.visibility)) throw new Error('Choose a supported visibility.');
  if (input.visibility === 'officers' && !isOfficer(member)) throw new Error('Only officers can create officer-only manifests.');
  guild.manifests ||= {};
  const id = randomUUID().slice(0,8);
  if (guild.manifests[id]) throw new Error('ID collision; retry.');
  const manifest = {id,name:input.name.trim().slice(0,80),route:input.route.trim().slice(0,200),mode:input.mode,visibility:input.visibility,leaderId:actorId,crew:{[actorId]:'Leader'},orderIds:[],status:'preparing',createdAt:Date.now(),history:[]};
  log(manifest,'create',actorId);
  guild.manifests[id] = manifest;
  return manifest;
}
function change(guild, member, actorId, id, action, value, note) {
  const manifest = get(guild,member,id);
  if (['join','leave'].includes(action)) {
    if (closed(manifest)) throw new Error('This manifest is closed.');
    if (actorId === manifest.leaderId) throw new Error('You are already the shipment leader.');
    if (action === 'join') {
      if (!manifest.crew[actorId] && Object.keys(manifest.crew).length >= 20) throw new Error('This shipment already has 20 crew members.');
      if (!['Driver','Crew','Escort'].includes(value)) throw new Error('Choose a crew role.');
      manifest.crew[actorId] = value;
    } else delete manifest.crew[actorId];
  } else {
    editable(member,actorId,manifest);
    if (['link','unlink'].includes(action)) {
      if (manifest.status !== 'preparing') throw new Error('Cargo can only be changed before departure.');
      const order = guild.orders[value];
      if (!order || !canViewOrder(member,order,guild)) throw new Error('Order not found or not accessible.');
      if (action === 'link') {
        if (manifest.orderIds.length >= 10) throw new Error('A manifest can contain up to 10 orders.');
        if (['cancelled','delivered','completed_with_losses'].includes(order.status) || order.delivered || order.transit || order.lost) throw new Error('Choose an open order with no goods picked up, produced or delivered yet.');
        if (Object.values(guild.manifests).some(other => !closed(other) && other.orderIds.includes(value))) throw new Error('This order is already linked to an active manifest.');
        const refs = new Set([...manifest.orderIds,value].map(id=>guild.orders[id]?.warRef).filter(Boolean).map(ref=>ref.shard+':'+ref.id));
        if(refs.size>1)throw new Error('Orders belong to different wars or shards.');
        const wars = new Set([...manifest.orderIds,value].flatMap(orderId => {
          const cargo = guild.orders[orderId];
          return [cargo.sourceId,cargo.destinationId].filter(Boolean).map(pileId => (guild.stockpiles[pileId]?.warRef ? guild.stockpiles[pileId].warRef.shard+':'+guild.stockpiles[pileId].warRef.id : guild.stockpiles[pileId]?.war?.trim().toLowerCase())).filter(Boolean);
        }));
        if (wars.size > 1) throw new Error('All linked stockpiles must belong to the same shard / war.');
        manifest.orderIds.push(value);
      } else {
        if (!manifest.orderIds.includes(value)) throw new Error('This order is not on the manifest.');
        if (order.transit) throw new Error('Deliver or return goods in transit before removing this order.');
        manifest.orderIds = manifest.orderIds.filter(orderId => orderId !== value);
      }
    } else if (action === 'cancel') {
      if (!note?.trim()) throw new Error('A cancellation reason is required.');
      if (manifest.orderIds.some(orderId => guild.orders[orderId]?.transit)) throw new Error('Deliver or return all cargo in transit before cancelling the manifest.');
      manifest.status = 'cancelled'; manifest.reason = note.trim().slice(0,300);
    } else if (['depart','complete'].includes(action)) {
      const orders = manifest.orderIds.map(orderId => guild.orders[orderId]);
      if (!orders.length || orders.some(order => !order || order.status === 'cancelled')) throw new Error('The manifest needs linked orders with no cancelled or missing cargo.');
      if (action === 'depart') {
        if (manifest.status !== 'preparing') throw new Error('This shipment has already departed.');
        if (orders.some(order => order.transit + order.delivered + (order.lost || 0) !== order.quantity)) throw new Error('Record pickup or production of all cargo through the linked orders first.');
        manifest.status = 'in_transit'; manifest.departedAt = Date.now();
      } else {
        if (orders.some(order => !['delivered','completed_with_losses'].includes(order.status))) throw new Error('Record delivery or loss of every linked order before completing the manifest.');
        manifest.status = orders.some(order => order.lost) ? 'completed_with_losses' : 'delivered'; manifest.completedAt = Date.now();
      }
    } else throw new Error('Unknown manifest action.');
  }
  log(manifest,action,actorId,{value,note});
  return manifest;
}
module.exports = {create,change,get,visible,closed};
