const {EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder} = require('discord.js');
const store = require('./logistics-store');
const manifests = require('./manifests');
const {memberAccess,manager} = require('./logistics-access');
const row = (...items) => new ActionRowBuilder().addComponents(...items);
const button = (id,label) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Secondary);
const safe = {allowedMentions:{parse:[]}};
function data(i) {
  if (!i.guildId || !memberAccess(i.member)) throw new Error('Manifests are restricted to verified members and logistics staff.');
  return store.read().guilds[i.guildId] || {stockpiles:{},orders:{},manifests:{}};
}
function shared() {
  return {...safe,embeds:[new EmbedBuilder().setTitle('🚢 Shipping manifests').setColor(0x3498DB).setDescription('Group orders into a shipment, join a crew and follow cargo progress.\n\nOpen your private browser to see shipments available to your role.\nStaff: use /manifest create, then /manifest link to add orders.')],components:[row(button('mf_open','Open manifests'))]};
}
function list(guild,i,page=1,filter='active') {
  const entries = Object.values(guild.manifests || {}).filter(m => manifests.visible(guild,i.member,m) && manifests.closed(m)===(filter==='closed')).sort((a,b)=>b.createdAt-a.createdAt);
  const pages=Math.max(1,Math.ceil(entries.length/10));page=Math.max(1,Math.min(pages,Number(page)||1));
  const shown=entries.slice((page-1)*10,page*10);
  const embed=new EmbedBuilder().setTitle('🚢 Shipping manifests').setColor(0x3498DB).setDescription(shown.length ? shown.map(m=>`**${m.name}** • ${m.mode} • ${m.status.replaceAll('_',' ')}\n${m.orderIds.length} orders • ${m.route}`).join('\n\n') : 'No matching shipments. Staff can create one with /manifest create.').setFooter({text:`${filter} • Page ${page}/${pages}`});
  const components=[];
  if(shown.length) components.push(row(new StringSelectMenuBuilder().setCustomId('mf_choose').setPlaceholder('Choose a shipment').addOptions(shown.map(m=>({label:m.name.slice(0,100),value:m.id,description:`${m.mode} • ${m.route}`.slice(0,100)})))));
  components.push(row(button(`mf_list:${filter}:${page-1}`,'Previous').setDisabled(page<=1),button(`mf_list:${filter}:${page+1}`,'Next').setDisabled(page>=pages),button(`mf_list:${filter}:${page}`,'Refresh'),button(`mf_list:${filter==='active'?'closed':'active'}:1`,filter==='active'?'History':'Active shipments')));
  return {...safe,embeds:[embed],components};
}
function detail(guild,i,id) {
  const m=manifests.get(guild,i.member,id), editable=(manager(i.member)||m.leaderId===i.user.id)&&!manifests.closed(m);
  const orders=m.orderIds.map(orderId=>guild.orders[orderId]);
  const embed=new EmbedBuilder().setTitle(`🚢 ${m.name}`).setColor(m.status==='completed_with_losses'?0xE67E22:m.status==='delivered'?0x2ECC71:0x3498DB)
    .setDescription(`**${m.mode} • ${m.status.replaceAll('_',' ')}**\n${m.route}`)
    .addFields({name:'Crew',value:Object.entries(m.crew).map(([user,role])=>`<@${user}> — ${role}`).join('\n')||'No crew'},
      ...(orders.length ? orders.map(o=>({name:`${o.lost?'⚠️':o.status==='delivered'?'✅':o.status==='cancelled'?'❌':o.transit+o.delivered===o.quantity?'🚚':'📦'} ${o.item}`.slice(0,256),value:`${o.quantity} ${o.unit} • ${o.transit} in transit • ${o.delivered} delivered • ${o.lost||0} lost\nDestination: ${o.destination}`})) : [{name:'Cargo checklist',value:'No cargo yet. Use /manifest link to select an order.'}]),
      {name:'How to update cargo',value:'Select an order below to claim it and record pickup/production, delivery, return or cargo loss. Completing this manifest never changes inventory again.'})
    .setFooter({text:'Live order totals • Access follows all linked stockpiles • Refresh to update'}).setTimestamp(m.updatedAt);
  if(m.reason)embed.addFields({name:'Cancellation reason',value:m.reason});
  const components=[row(button(`mf_view:${id}`,'Refresh'),button('mf_list:active:1','Back'))];
  if(!manifests.closed(m)) components.push(row(button(`mf_join:${id}`,'Join crew').setDisabled(Boolean(m.crew[i.user.id])),button(`mf_leave:${id}`,'Leave crew').setDisabled(!m.crew[i.user.id]||m.leaderId===i.user.id),button(`mf_depart:${id}`,'Depart').setDisabled(!editable||m.status!=='preparing'),button(`mf_complete:${id}`,'Complete').setDisabled(!editable)));
  if(orders.length) components.push(row(new StringSelectMenuBuilder().setCustomId(`mf_cargo:${id}`).setPlaceholder('Open an order to update cargo').addOptions(orders.map(o=>({label:`${o.item} • ${o.quantity} ${o.unit}`.slice(0,100),value:o.id,description:`${o.destination} • ${o.status}`.slice(0,100)})))));
  return {...safe,embeds:[embed],components};
}
async function handle(i) {
  try {
    const guild=data(i),[action,id,value]=i.customId.split(':');
    if(action==='mf_open')return await i.reply({...list(guild,i),ephemeral:true});
    if(action==='mf_list')return await i.update(list(guild,i,value,id));
    if(action==='mf_choose')return await i.update(detail(guild,i,i.values[0]));
    if(action==='mf_view')return await i.update(detail(guild,i,id));
    if(action==='mf_cargo') {
      const m=manifests.get(guild,i.member,id);
      if(!m.orderIds.includes(i.values[0]))throw new Error('Order is no longer linked. Refresh this manifest.');
      const maintenance=require('./maintenance').active(i.guildId,'order');
      if(maintenance)return await i.reply({...require('./maintenance').notice(maintenance),ephemeral:true});
      return await i.reply({...require('./order-panel').detailPayload(guild,i,i.values[0]),ephemeral:true});
    }
    const actions={mf_join:'join',mf_leave:'leave',mf_depart:'depart',mf_complete:'complete'};
    if(!actions[action])throw new Error('Unknown manifest action.');
    const payload=store.transact(i.guildId,current=>{manifests.change(current,i.member,i.user.id,id,actions[action],'Crew');return detail(current,i,id);});
    require('./audit').record(i,`manifest.${actions[action]}`,id);
    return await i.update(payload);
  } catch(error) { return i.reply({content:error.message,ephemeral:true,...safe}); }
}
const originalList=list,originalDetail=detail;
list=(g,i,page=1,filter='active')=>require('./live-panels').tagged(originalList(g,i,page,filter),{kind:'manifest',page,filter});
detail=(g,i,id)=>require('./live-panels').tagged(originalDetail(g,i,id),{kind:'manifest',id});
module.exports={data,shared,list,detail,handle};
