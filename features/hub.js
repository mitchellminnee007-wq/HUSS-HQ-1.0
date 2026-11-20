const {SlashCommandBuilder,EmbedBuilder,PermissionFlagsBits:P}=require('discord.js');
const c=require('../utils/community'),{readData}=require('../utils/member-data'),access=require('../utils/logistics-access'),quals=require('../utils/qualifications');
const data=new SlashCommandBuilder().setName('hub').setDescription('War hub: find work, squads, events and your dashboard').setDMPermission(false)
 .addSubcommand(s=>s.setName('view').setDescription('Open your private war hub'))
 .addSubcommand(s=>s.setName('panel').setDescription('Post a shared entry panel (officers)'))
 .addSubcommand(s=>s.setName('reminders').setDescription('Choose how you receive operation reminders').addStringOption(o=>o.setName('delivery').setDescription('Reminder delivery').setRequired(true).addChoices({name:'Off',value:'off'},{name:'DM',value:'dm'},{name:'Operation channel',value:'channel'})));
const tabs=[['home','War overview'],['orders','Orders'],['stockpiles','Stockpiles'],['squads','Recruiting squads'],['events','Upcoming events'],['me','My dashboard'],['feedback','Report / feedback']];
function entry(){return {...c.safe,embeds:[new EmbedBuilder().setColor(0x8b2525).setTitle('HUSS • War hub').setDescription('Find your next task, squad or operation. Open the hub for a private view filtered to your current access.')],components:c.rows([c.button('hub','home','Open war hub'),c.button('feedback','new','Report a bug / feedback')])};}
async function view(i,tab='home',page=1){c.member(i);const held=require('../utils/maintenance');const nav=tabs.map(([key,label])=>c.button('hub',key,label));
 const target={orders:'order',stockpiles:'stockpile',squads:'squad',events:'operation',feedback:'feedback'}[tab];if(target&&held.active(i.guildId,target))return held.notice(held.active(i.guildId,target));
 if(tab==='me')return require('./me').payload(i);
 if(tab==='feedback')return {content:'Use the button below to submit feedback or report a bug. Only you and officers can read your report.',components:c.rows([c.button('feedback','new','Submit a report'),c.button('feedback','mine','My reports')])};
 const lines=[],g=readData('logistics-inventory').guilds?.[i.guildId]||{};
 if(tab==='orders')nav.push(c.button('hub','home','Browse and manage orders').setCustomId('ord_open'));
 if(tab==='stockpiles')nav.push(c.button('hub','home','Browse inventory').setCustomId('sp_open'));
 if(tab==='home'){const w=require('../utils/war-context').current(i.guildId);lines.push(`**${w?`Able • War ${w.number}`:'HUSS war hub'}**\nChoose a section below. Every view checks your permissions again.`,`**Reminders**\nOperation delivery: ${require('../utils/member-notifications').mode(i.guildId,i.user.id,'operations')}\nChange with /hub reminders.`,`**Temporary absence**\nUse /absence set to tell officers when you expect to return. You must still respond to activity checks.`);}
 if(tab==='orders')for(const o of Object.values(g.orders||{}).filter(o=>!['delivered','cancelled','completed_with_losses'].includes(o.status)&&access.canViewOrder(i.member,o,g)))lines.push(`**${o.item}** • ${o.status}\n${o.delivered}/${o.quantity} ${o.unit} delivered\n${o.destination}\nUse /order view and select this order.`);
 if(tab==='stockpiles')for(const p of Object.values(g.stockpiles||{}).filter(p=>!p.archived&&access.canViewStockpile(i.member,p)))lines.push(`**${p.name}** • ${p.region||''} ${p.location||''}\n${p.visibility==='officers'?'Officer access':'Member access'} • /stockpile view to open inventory.`);
 if(tab==='squads'){const s=require('../utils/squad-store');for(const v of Object.values(s.read().guilds[i.guildId]?.squads||{}).filter(v=>s.visible(i.member,v)&&v.status==='approved'&&v.recruiting))lines.push(`**${v.name}** • ${v.department}\n${v.goal.text}\nLeader <@${v.leaderId}> • ${v.members.length} members • /squad join`);}
 if(tab==='events')for(const kind of ['operations','trainings']){if(held.active(i.guildId,kind==='operations'?'operation':'training'))continue;for(const[id,e]of Object.entries(readData(kind).guilds?.[i.guildId]||{}).sort((a,b)=>a[1].time-b[1].time)){if(e.time>Date.now()&&await quals.canSee(i.member,e.channelId))lines.push(`**${e.title}** • <t:${Math.floor(e.time/1000)}:F>\n[Open signup](https://discord.com/channels/${i.guildId}/${e.channelId}/${id})`);}}
 return c.page('HUSS • '+(tabs.find(([k])=>k===tab)?.[1]||'War hub'),lines,'hub',tab,page,nav);
}
async function rsvp(i,guildId,eventId,action){
 if(!['confirm','late','withdraw'].includes(action))throw new Error('Unknown attendance action.');
 const guild=await i.client.guilds.fetch(guildId),member=await guild.members.fetch({user:i.user.id,force:true});
 const held=require('../utils/maintenance').active(guildId,'operation');if(held)throw new Error(held.reason);
 if(!access.memberAccess(member))throw new Error('Verified member access required.');
 const api=require('./operations'),event=api.getOp(guildId,eventId);
 if(!event||event.time+6*3600000<Date.now())throw new Error('This operation is no longer accepting attendance updates.');
 if(!await quals.canSee(member,event.channelId))throw new Error('You no longer have access to this operation.');
 // Re-read after asynchronous access checks to avoid overwriting concurrent RSVPs.
 const latest=api.getOp(guildId,eventId);if(!latest||latest.time!==event.time)throw new Error('This operation changed. Open its current signup panel.');
 if(!['accepted','tentative','declined'].some(k=>latest.attendees[k]?.some(v=>v.id===member.id)))throw new Error('Sign up on the operation panel first.');
 for(const k of ['accepted','tentative','declined'])latest.attendees[k]=latest.attendees[k].filter(v=>v.id!==member.id);
 latest.attendees[action==='withdraw'?'declined':'accepted'].push({id:member.id,name:member.displayName});
 latest.arrivals||={};latest.arrivals[member.id]={status:action,at:Date.now()};api.saveOp(guildId,eventId,latest);
 await api.refreshOpMessage({guild},latest,eventId);
 return {content:{confirm:'Attendance confirmed.',late:'Marked as running late; you remain on the accepted roster.',withdraw:'You have withdrawn from this operation.'}[action]};
}
async function execute(i){if(i.options.getSubcommand()==='panel'){c.officer(i);return i.reply(entry());}
 return c.run(i,async x=>{c.member(x);if(x.options.getSubcommand()==='reminders'){require('../utils/member-notifications').set(x.guildId,x.user.id,'operations',x.options.getString('delivery'));return {content:'Operation reminder preference saved.'};}return view(x);},'hub');}
async function handle(i){const[,action,a,b,d]=i.customId.split(':');if(action==='rsvp'){await i.deferReply({ephemeral:true});try{return i.editReply({...c.safe,...await rsvp(i,a,b,d)});}catch(e){return i.editReply({...c.safe,content:e.message});}}
 return c.run(i,x=>view(x,action,a),'hub');}
module.exports={data,execute,handle,view,entry,rsvp};
