const {SlashCommandBuilder,EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle}=require('discord.js');
const {readData}=require('../utils/member-data'),access=require('../utils/logistics-access'),squads=require('../utils/squad-store'),quals=require('../utils/qualifications');
const tabs={overview:'My dashboard',squads:'Recruiting squads',orders:'Orders & shipments',events:'My events',training:'Training & qualifications',requests:'My requests'};
const nav=()=>[new ActionRowBuilder().addComponents(...Object.entries(tabs).slice(0,3).map(([key,label])=>new ButtonBuilder().setCustomId(`me_tab:${key}`).setLabel(label).setStyle(ButtonStyle.Secondary))),new ActionRowBuilder().addComponents(...Object.entries(tabs).slice(3).map(([key,label])=>new ButtonBuilder().setCustomId(`me_tab:${key}`).setLabel(label).setStyle(ButtonStyle.Secondary)))];
const link=(g,c,m)=>`https://discord.com/channels/${g}/${c}/${m}`;
async function payload(i,tab='overview',page=1){
 if(!tabs[tab])tab='overview';const member=i.member,guildId=i.guildId,userId=i.user.id,eligible=access.memberAccess(member);const maintenance=require('../utils/maintenance');
 const target={squads:'squad',orders:'order',events:'operation',training:'training'}[tab];if(target&&maintenance.active(guildId,target))return {...maintenance.notice(maintenance.active(guildId,target)),embeds:[],components:nav()};
 if(!eligible&&!['overview','requests'].includes(tab))throw new Error('These regiment activities are available after member verification. Your verification status is in My requests.');
 const allSquads=eligible?Object.values(squads.read().guilds[guildId]?.squads||{}).filter(s=>squads.visible(member,s)):[],mine=allSquads.filter(s=>s.members.includes(userId));
 const logistics=eligible?(readData('logistics-inventory').guilds?.[guildId]||{stockpiles:{},orders:{}}):{orders:{},stockpiles:{}};
 const orders=Object.values(logistics.orders||{}).filter(o=>!['delivered','cancelled','completed_with_losses'].includes(o.status)&&access.canViewOrder(member,o,logistics));
 const rows=[];
 if(tab==='overview'){
  rows.push(`**Squads:** ${mine.length}\n**Your active orders:** ${maintenance.active(guildId,'order')?'Maintenance':orders.filter(o=>o.workerId===userId).length}\n**Qualifications:** ${quals.list(member).join(', ')||'None recorded'}\n\nUse the buttons below to find your work, requests and upcoming activities.\n/hub: war hub • /absence: return date • /feedback: reports\n/onboarding: your membership checklist\nNext war: /notifications • /wararchive\nYour orders: /order list • Shipment details: /manifest list • Squad management: /squad list`);
 }
 if(tab==='squads')for(const s of allSquads.filter(s=>s.status==='approved'&&(s.recruiting||s.members.includes(userId)||s.invites[userId])))rows.push(`**${s.name}** • ${s.department}${s.branch?' / '+s.branch:''}\n${s.members.includes(userId)?'Your squad':s.invites[userId]?'Invitation waiting':'Recruiting'} • Leader <@${s.leaderId}>\n${s.goal.text.slice(0,180)}\nUse /squad join and select this squad.`);
 if(tab==='orders'){
  for(const o of orders.filter(o=>!o.workerId||o.workerId===userId).sort((a,b)=>Number(b.workerId===userId)-Number(a.workerId===userId)))rows.push(`**${o.item}** • ${o.workerId===userId?'Assigned to you':'Available'}\n${o.delivered}/${o.quantity} ${o.unit} delivered • ${o.lost||0} lost\n${o.destination}\nOpen /order view to claim or update.`);
  if(!maintenance.active(guildId,'manifest'))for(const m of Object.values(logistics.manifests||{}).filter(m=>m.crew[userId]&&!require('../utils/manifests').closed(m)&&require('../utils/manifests').visible(logistics,member,m)))rows.push(`**Shipment: ${m.name}** • ${m.crew[userId]}\n${m.route} • ${m.status}\nOpen /manifest view.`);
 }
 if(tab==='events'||tab==='training'){
  const source=tab==='training'?['trainings']:['operations','trainings'];
  if(tab==='training')rows.push(`**Your qualifications**\n${quals.list(member).join('\n')||'None recorded'}\nTraining attendance or a signup does not award a qualification. A trainer must assess you.`);
  for(const name of source){if(maintenance.active(guildId,name==='operations'?'operation':'training'))continue;for(const[id,event]of Object.entries(readData(name).guilds?.[guildId]||{}).sort((a,b)=>(a[1].time||0)-(b[1].time||0))){
   if(!await quals.canSee(member,event.channelId))continue;
   const board=event.type==='qualification-board';if(!board&&event.time<=Date.now())continue;
   const rsvp=['accepted','tentative','declined'].find(k=>event.attendees?.[k]?.some(x=>x.id===userId)),assigned=mine.some(s=>s.id===event.squadId);
   if(tab==='events'&&!rsvp&&!assigned)continue;
   let recommended='';if(event.qualificationKey){const has=quals.qualified(member,event.qualificationKey);recommended=`\nRecommended qualification: ${event.qualificationKey.replaceAll('_',' ')} — ${has===null?'not configured':has?'certified':'not yet certified; browse Training'}`;}
   rows.push(`**${event.title||'Qualification signup board'}**\n${board?'Training applications':`<t:${Math.floor(event.time/1000)}:F>`} • ${rsvp||'No RSVP'}${assigned?' • Your squad':''}${recommended}\n[Open signup panel](${link(guildId,event.channelId,id)})`);
  }}
 }
 if(tab==='requests'){
  if(!maintenance.active(guildId,'squad'))for(const s of allSquads){if(s.requests[userId])rows.push(`**Squad: ${s.name}** — join request awaiting review`);if(s.invites[userId])rows.push(`**Squad: ${s.name}** — invitation waiting; use /squad join`);if(s.createdBy===userId&&s.status==='pending')rows.push(`**Squad: ${s.name}** — creation awaiting department approval`);}
  if(!maintenance.active(guildId,'commendation'))for(const n of Object.values(readData('commendations').guilds?.[guildId]?.nominations||{}).filter(n=>n.nominatorId===userId&&['pending','needs_info'].includes(n.status)))rows.push(`**Commendation nomination** — ${n.status.replaceAll('_',' ')}\nUse /commendation mine for details.`);
  if(!maintenance.active(guildId,'ticketpanel'))for(const r of Object.values(readData('verification-requests')).filter(r=>r.guildId===guildId&&r.userId===userId))rows.push(`**${r.type==='ally'?'Ally':'Member'} verification** — ${r.status}`);
 }
 const pages=Math.max(1,Math.ceil(rows.length/7));page=Math.max(1,Math.min(pages,Number(page)||1));return {embeds:[new EmbedBuilder().setColor(0x8b2525).setTitle(tabs[tab]).setDescription(rows.slice((page-1)*7,page*7).map(x=>x.slice(0,500)).join('\n\n')||'Nothing to show here yet.').setFooter({text:`Page ${page}/${pages} • Only records available to you • Refresh for current information`})],components:[...nav(),new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`me_${tab}:${page-1}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(page<=1),new ButtonBuilder().setCustomId(`me_refresh:${tab}:${page}`).setLabel('Refresh').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId(`me_${tab}:${page+1}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(page>=pages))],allowedMentions:{parse:[]}};
}
async function run(i,tab,page){await i.deferReply({ephemeral:true});try{i.member=await i.guild.members.fetch({user:i.user.id,force:true});return i.editReply(await payload(i,tab,page));}catch(e){return i.editReply({content:e.message,allowedMentions:{parse:[]}});}}
module.exports={data:new SlashCommandBuilder().setName('me').setDescription('Your squads, tasks, events, training and requests').setDMPermission(false).addStringOption(o=>o.setName('tab').setDescription('Dashboard page').addChoices(...Object.entries(tabs).map(([value,name])=>({name,value})))),payload,execute:i=>run(i,i.options.getString('tab')||'overview',1),handle(i){const[action,value,page]=i.customId.split(':');return run(i,action==='me_refresh'||action==='me_tab'?value:action.slice(3),action==='me_refresh'?page:action==='me_tab'?1:value);},nav};
