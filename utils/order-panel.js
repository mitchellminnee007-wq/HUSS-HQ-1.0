const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const store = require('./logistics-store');
const { memberAccess, manager, canViewOrder } = require('./logistics-access');
const audit = require('./audit');
const row = (...items) => new ActionRowBuilder().addComponents(...items);
const button = (id, text, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(text).setStyle(style);
const closed = order => ['delivered', 'cancelled', 'completed_with_losses'].includes(order.status);
function guildData(i) {
  if (!i.guildId || !memberAccess(i.member)) throw new Error('Orders are restricted to verified members and logistics staff.');
  return store.read().guilds[i.guildId] || { stockpiles: {}, orders: {} };
}
function accessible(guild, i, id) {
  const order = guild.orders[id];
  if (!order || !canViewOrder(i.member, order, guild)) throw new Error('Order not found or not accessible.');
  return order;
}
function sharedPayload() {
  return { embeds: [new EmbedBuilder().setColor(0x4F8B73).setTitle('🚚 Logistics orders').setDescription('Find a delivery, claim an order and record your progress.\n\nClick **Open orders** to see the work available to your role.').setFooter({ text: 'Your order browser opens privately • Record actual in-game movements' })], components: [row(button('ord_open', 'Open orders', ButtonStyle.Primary))], allowedMentions: { parse: [] } };
}
function listPayload(guild, i, filter = 'active', requestedPage = 1) {
  if (!['active','mine','closed'].includes(filter)) filter = 'active';
  const orders = Object.values(guild.orders).filter(order => canViewOrder(i.member, order, guild) && (filter === 'closed' ? closed(order) : !closed(order) && (filter !== 'mine' || order.workerId === i.user.id)))
    .sort((a,b) => ({critical:0,normal:1,low:2}[a.priority] - {critical:0,normal:1,low:2}[b.priority]) || b.createdAt - a.createdAt);
  const pages = Math.max(1, Math.ceil(orders.length / 8)), page = Math.min(pages, Math.max(1, Number(requestedPage) || 1));
  const shown = orders.slice((page - 1) * 8, page * 8);
  const embed = new EmbedBuilder().setColor(0x4F8B73).setTitle('🚚 Order overview').setDescription(`**${orders.length} ${filter === 'mine' ? 'assigned to you' : filter} orders**\n${orders.length ? 'Choose an order below to view details and available actions.' : 'No matching orders right now.'}`).setFooter({ text: `Page ${page}/${pages} • Quantities are manually reported` });
  for (const order of shown) embed.addFields({ name: `${order.priority === 'critical' ? '🔴' : '📦'} ${order.item}`, value: `${order.delivered}/${order.quantity} ${order.unit.replaceAll('_',' ')} delivered • ${order.lost||0} lost · **${order.status.replaceAll('_',' ')}**\n${order.destination}\n${order.workerId ? `Assigned to <@${order.workerId}>` : 'Available to claim'}` });
  const components = [row(new StringSelectMenuBuilder().setCustomId('ord_filter').setPlaceholder('Filter orders').addOptions([{label:'Active orders',value:'active'},{label:'My orders',value:'mine'},{label:'Completed / cancelled',value:'closed'}].map(option => ({...option, default:option.value===filter}))))];
  if (shown.length) components.push(row(new StringSelectMenuBuilder().setCustomId('ord_choose').setPlaceholder('Choose an order…').addOptions(shown.map(order => ({label:`${order.item} · ${order.quantity} ${order.unit}`.slice(0,100),value:order.id,description:`${order.destination} • ${order.status} • ${order.id}`.slice(0,100)})))));
  components.push(row(button(`ord_list:${filter}:${page-1}`,'Previous').setDisabled(page<=1),button(`ord_list:${filter}:${page+1}`,'Next').setDisabled(page>=pages),button(`ord_list:${filter}:${page}`,'Refresh')));
  return {embeds:[embed],components,allowedMentions:{parse:[]}};
}
function detailPayload(guild, i, id) {
  const order=accessible(guild,i,id), staff=manager(i.member), assigned=order.workerId===i.user.id;
  const embed=new EmbedBuilder().setColor(closed(order)?0x95A5A6:0x4F8B73).setTitle(`📦 ${order.item}`).setDescription(`**${order.type.replaceAll('_',' ')} · ${order.priority} priority · ${order.status.replaceAll('_',' ')}**\n${order.sourceId ? guild.stockpiles[order.sourceId]?.name || 'Source stockpile' : 'Production'} → **${order.destination}**`)
    .addFields({name:'Requested',value:`${order.quantity} ${order.unit.replaceAll('_',' ')}`,inline:true},{name:'In transit / produced',value:String(order.transit),inline:true},{name:'Delivered',value:String(order.delivered),inline:true},{name:'Lost',value:String(order.lost||0),inline:true},{name:'Assigned to',value:order.workerId?`<@${order.workerId}>`:'Unclaimed',inline:true},{name:'Created',value:`<t:${Math.floor(order.createdAt/1000)}:R>`,inline:true},{name:'Instructions',value:order.notes||'No additional instructions.'},{name:'Last update',value:String(order.updates?.at(-1)?.note||'No update notes.').slice(0,1024)})
    .setFooter({text:'Lost cargo is not delivered • Request replacements with a new order'});
  if(order.externalTaskId)embed.addFields({name:'External logistics task',value:'Linked • Use /tasklink view to check task progress. Inventory updates still require delivery confirmation.'});
  const components=[row(button('ord_list:active:1','All orders'),button(`ord_view:${id}`,'Refresh'))];
  if (!closed(order)) {
    if (!order.workerId) components.push(row(button(`ord_claim:${id}`,'Claim order',ButtonStyle.Success)));
    if(staff||assigned) {
      const actions=[];
      if(order.quantity-order.delivered-order.transit-(order.lost||0)>0) actions.push(button(`ord_action:${id}:${order.type==='production'?'produce':'pickup'}`,order.type==='production'?'Record production':'Record pickup',ButtonStyle.Primary));
      if(order.transit>0) { actions.push(button(`ord_action:${id}:deliver`,'Record delivery',ButtonStyle.Success)); if(order.sourceId) actions.push(button(`ord_action:${id}:return`,'Return goods')); actions.push(button(`ord_action:${id}:loss`,'Report cargo loss',ButtonStyle.Danger)); }
      if(!order.transit) actions.push(button(`ord_action:${id}:cancel`,'Cancel order',ButtonStyle.Danger));
      if(actions.length) components.push(row(...actions));
    }
  }
  return {embeds:[embed],components,allowedMentions:{parse:[]}};
}
function assertUpdate(i, order) {
  if(closed(order)) throw new Error('This order is already closed. Refresh the panel.');
  if(!manager(i.member)&&order.workerId!==i.user.id) throw new Error('Only the assigned worker or logistics staff can update this order.');
}
async function handleButton(i) {
  try {
    const [action,id,value]=i.customId.split(':'), guild=guildData(i);
    if(action==='ord_open') return await i.reply({...listPayload(guild,i),ephemeral:true});
    if(action==='ord_list') return await i.update(listPayload(guild,i,id,value));
    const order=accessible(guild,i,id);
    if(action==='ord_view') return await i.update(detailPayload(guild,i,id));
    if(action==='ord_claim') {
      const payload=store.transact(i.guildId,current=>{accessible(current,i,id);store.updateOrder(current,id,'claim',i.user.id,manager(i.member));return detailPayload(current,i,id);});
      audit.record(i,'order.claim',id);
      return await i.update(payload);
    }
    if(action!=='ord_action'||!['pickup','produce','deliver','return','loss','cancel'].includes(value)) throw new Error('Unknown order action.');
    assertUpdate(i,order);
    const modal=new ModalBuilder().setCustomId(`ord_update:${id}:${value}:${order.updates.length}`).setTitle(value==='cancel'?'Cancel order':`Record ${value}`);
    if(value!=='cancel') modal.addComponents(row(new TextInputBuilder().setCustomId('quantity').setLabel(`Quantity (${order.unit.replaceAll('_',' ')})`).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(7)));
    modal.addComponents(row(new TextInputBuilder().setCustomId('note').setLabel(value==='cancel'?'Cancellation reason':value==='loss'?'Loss reason / location / evidence':'Note / delivery confirmation').setStyle(TextInputStyle.Paragraph).setRequired(['cancel','deliver','loss'].includes(value)).setMaxLength(500)));
    return await i.showModal(modal);
  } catch(error){return i.reply({content:error.message,ephemeral:true,allowedMentions:{parse:[]}});}
}
async function handleSelect(i) {
  try {const guild=guildData(i);return await i.update(i.customId==='ord_filter'?listPayload(guild,i,i.values[0]):detailPayload(guild,i,i.values[0]));}
  catch(error){return i.reply({content:error.message,ephemeral:true});}
}
async function handleModal(i) {
  try {
    guildData(i);
    const [,id,action,revision]=i.customId.split(':');
    if(!['pickup','produce','deliver','return','loss','cancel'].includes(action)) throw new Error('Unknown order action.');
    const raw=action==='cancel'?null:i.fields.getTextInputValue('quantity').trim();
    if(raw!==null&&!/^\d+$/.test(raw)) throw new Error('Enter a positive whole number.');
    const amount=raw===null?undefined:Number(raw), note=i.fields.getTextInputValue('note').trim();
    const payload=store.transact(i.guildId,guild=>{
      const order=accessible(guild,i,id);assertUpdate(i,order);
      if(String(order.updates.length)!==revision) throw new Error('This order changed while the form was open. Refresh the panel and try again.');
      store.updateOrder(guild,id,action,i.user.id,manager(i.member),amount,note);
      return detailPayload(guild,i,id);
    });
    audit.record(i,`order.${action}`,id,{quantity:amount,reason:note});
    return await i.reply({content:'Order updated.',...payload,ephemeral:true});
  }catch(error){return i.reply({content:error.message,ephemeral:true,allowedMentions:{parse:[]}});}
}
async function autocomplete(i) {
  if(i.options.getFocused(true).name==='item') return require('./item-autocomplete').autocomplete(i);
  if(['source','destination-stockpile'].includes(i.options.getFocused(true).name)) return require('./stockpile-panel').autocomplete(i);
  try {
    const guild=guildData(i),search=String(i.options.getFocused()).toLowerCase();
    return await i.respond(Object.values(guild.orders).filter(order=>canViewOrder(i.member,order,guild)&&`${order.item} ${order.destination} ${order.id}`.toLowerCase().includes(search)).slice(0,25).map(order=>({name:`${order.item} → ${order.destination} · ${order.status} · ${order.id}`.slice(0,100),value:order.id})));
  }catch{return i.respond([]);}
}
const originalList=listPayload,originalDetail=detailPayload;
listPayload=(g,i,filter='active',page=1)=>require('./live-panels').tagged(originalList(g,i,filter,page),{kind:'order',filter,page});
detailPayload=(g,i,id)=>require('./live-panels').tagged(originalDetail(g,i,id),{kind:'order',id});
module.exports={sharedPayload,listPayload,detailPayload,handleButton,handleSelect,handleModal,autocomplete};
