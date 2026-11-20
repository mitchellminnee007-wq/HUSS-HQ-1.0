const {SlashCommandBuilder} = require('discord.js');
const store=require('../utils/logistics-store');
const manifests=require('../utils/manifests');
const panel=require('../utils/manifest-panel');
const {manager,canViewOrder}=require('../utils/logistics-access');
const idOption=sub=>sub.addStringOption(o=>o.setName('shipment').setDescription('Search shipments by name or route').setRequired(true).setAutocomplete(true));
const orderOption=sub=>sub.addStringOption(o=>o.setName('order').setDescription('Choose an order by item or destination').setRequired(true).setAutocomplete(true));
module.exports={
  data:new SlashCommandBuilder().setName('manifest').setDescription('Plan shipments containing multiple logistics orders.').setDMPermission(false)
    .addSubcommand(s=>s.setName('panel').setDescription('Post a shared shipping manifest browser'))
    .addSubcommand(s=>s.setName('list').setDescription('Browse shipments available to you'))
    .addSubcommand(s=>idOption(s.setName('view').setDescription('Open a shipment')))
    .addSubcommand(s=>s.setName('create').setDescription('Create a shipment (logistics staff)')
      .addStringOption(o=>o.setName('name').setDescription('Shipment name').setRequired(true).setMaxLength(80))
      .addStringOption(o=>o.setName('route').setDescription('Origin, stops and destination').setRequired(true).setMaxLength(200))
      .addStringOption(o=>o.setName('mode').setDescription('Transport type').setRequired(true).addChoices(...['truck','freighter','train','convoy'].map(value=>({name:value,value}))))
      .addStringOption(o=>o.setName('visibility').setDescription('Who can see this shipment; linked orders also control access').addChoices({name:'Members',value:'members'},{name:'Officers',value:'officers'})))
    .addSubcommand(s=>orderOption(idOption(s.setName('link').setDescription('Add an unstarted order to a shipment'))))
    .addSubcommand(s=>orderOption(idOption(s.setName('unlink').setDescription('Remove an order before departure'))))
    .addSubcommand(s=>idOption(s.setName('crew').setDescription('Join or leave a shipment crew'))
      .addStringOption(o=>o.setName('role').setDescription('Your role or leave the crew').setRequired(true).addChoices(...['Driver','Crew','Escort','Leave'].map(value=>({name:value,value})))))
    .addSubcommand(s=>idOption(s.setName('depart').setDescription('Mark departure after cargo has been picked up')))
    .addSubcommand(s=>idOption(s.setName('complete').setDescription('Complete a shipment once all cargo is delivered or reported lost')))
    .addSubcommand(s=>idOption(s.setName('cancel').setDescription('Cancel a shipment without cancelling its orders'))
      .addStringOption(o=>o.setName('reason').setDescription('Cancellation reason').setRequired(true).setMaxLength(300))),
  handleButton:panel.handle,
  handleSelect:panel.handle,
  async autocomplete(i) {
    try {
      const guild=panel.data(i),focused=i.options.getFocused(true),query=focused.value.toLowerCase(),sub=i.options.getSubcommand();
      let choices;
      if(focused.name==='order') {
        const m=manifests.get(guild,i.member,i.options.getString('shipment'));
        choices=Object.values(guild.orders).filter(o=>canViewOrder(i.member,o,guild) && (sub==='unlink'?m.orderIds.includes(o.id):!['cancelled','delivered','completed_with_losses'].includes(o.status)&&!o.transit&&!o.delivered&&!o.lost&&!Object.values(guild.manifests||{}).some(other=>!manifests.closed(other)&&other.orderIds.includes(o.id))))
          .map(o=>({name:`${o.item} • ${o.quantity} ${o.unit} • ${o.destination} • ${o.id}`.slice(0,100),value:o.id}));
      } else choices=Object.values(guild.manifests||{}).filter(m=>manifests.visible(guild,i.member,m)&&(sub==='view'||!manifests.closed(m))).map(m=>({name:`${m.name} • ${m.route} • ${m.id}`.slice(0,100),value:m.id}));
      return await i.respond(choices.filter(c=>c.name.toLowerCase().includes(query)).slice(0,25));
    }catch{return i.respond([]);}
  },
  async execute(i) {
    try {
      const guild=panel.data(i),sub=i.options.getSubcommand(),id=i.options.getString('shipment');
      if(sub==='panel') {
        if(!manager(i.member))throw new Error('Only logistics staff can post a manifest panel.');
        return await i.reply(panel.shared());
      }
      if(sub==='list')return await i.reply({...panel.list(guild,i),ephemeral:true});
      if(sub==='view')return await i.reply({...panel.detail(guild,i,id),ephemeral:true});
      const role=i.options.getString('role'),action=sub==='crew'?(role==='Leave'?'leave':'join'):sub;
      const result=store.transact(i.guildId,current=>{
        const m=sub==='create'?manifests.create(current,i.member,i.user.id,{name:i.options.getString('name'),route:i.options.getString('route'),mode:i.options.getString('mode'),visibility:i.options.getString('visibility')||'members'}):manifests.change(current,i.member,i.user.id,id,action,sub==='crew'?role:i.options.getString('order'),i.options.getString('reason'));
        return {id:m.id,payload:panel.detail(current,i,m.id)};
      });
      require('../utils/audit').record(i,`manifest.${action}`,result.id,{orderId:i.options.getString('order'),reason:i.options.getString('reason')});
      return await i.reply({...result.payload,ephemeral:true});
    }catch(error){return i.reply({content:error.message,ephemeral:true,allowedMentions:{parse:[]}});}
  },
};
