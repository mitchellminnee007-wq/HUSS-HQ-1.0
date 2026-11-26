const {SlashCommandBuilder,EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder}=require('discord.js');
const store=require('../utils/squad-store');
const {getConfig}=require('../utils/config');
const audit=require('../utils/audit');
const data=new SlashCommandBuilder().setName('squad').setDescription('Regiment squads, recruitment and war goals').setDMPermission(false);
const str=(s,name,description,required=false)=>s.addStringOption(o=>o.setName(name).setDescription(description).setRequired(required));
const squad=s=>s.addStringOption(o=>o.setName('squad').setDescription('Choose a squad by name').setRequired(true).setAutocomplete(true));
data.addSubcommand(s=>{s.setName('create').setDescription('Request a new squad');str(s,'name','Unique squad name',true);s.addStringOption(o=>o.setName('department').setDescription('Department').setRequired(true).addChoices(...['logistics','facility','frontline'].map(value=>({name:value,value}))));s.addUserOption(o=>o.setName('leader').setDescription('Squad leader').setRequired(true));str(s,'goal','War goal',true);s.addStringOption(o=>o.setName('branch').setDescription('Required for Frontline').addChoices(...['army','navy','air'].map(value=>({name:value,value}))));str(s,'description','Optional description');return s;});
for(const name of ['list','panel','review'])data.addSubcommand(s=>s.setName(name).setDescription(name==='panel'?'Publish the squad directory here':name==='review'?'Browse requests you can approve':'Browse squads and recruitment'));
for(const name of ['info','join','leave','history'])data.addSubcommand(s=>squad(s.setName(name).setDescription({info:'View roster and goal',join:'Request to join or accept an invitation',leave:'Leave a squad or withdraw your request',history:'View previous war goals'}[name])));
for(const name of ['invite','kick','transfer'])data.addSubcommand(s=>{squad(s.setName(name).setDescription(`${name} a squad member`));s.addUserOption(o=>o.setName('member').setDescription('Member').setRequired(true));if(name==='transfer')s.addBooleanOption(o=>o.setName('confirm').setDescription('Confirm leadership transfer').setRequired(true));return s;});
data.addSubcommand(s=>{squad(s.setName('delete').setDescription('Request deletion; leadership approval is also required'));str(s,'reason','Reason for deletion',true);return s.addBooleanOption(o=>o.setName('confirm').setDescription('Confirm requesting deletion').setRequired(true));});
data.addSubcommand(s=>{squad(s.setName('edit').setDescription('Edit squad information'));str(s,'name','New unique name');str(s,'description','Description');return s.addBooleanOption(o=>o.setName('recruiting').setDescription('Open recruitment'));});
data.addSubcommand(s=>{squad(s.setName('goal').setDescription('Request a new goal or close the current goal'));s.addStringOption(o=>o.setName('action').setDescription('Goal action').setRequired(true).addChoices({name:'Request new goal',value:'request'},{name:'Completed',value:'Completed'},{name:'Cancelled',value:'Cancelled'}));str(s,'text','Required when requesting a goal');str(s,'war','War label (defaults to the current war)');return s;});
data.addSubcommand(s=>{squad(s.setName('approve').setDescription('Approve or reject a pending request'));s.addStringOption(o=>o.setName('kind').setDescription('Request type').setRequired(true).addChoices(...['creation','membership','goal','delete'].map(value=>({name:value,value}))));s.addBooleanOption(o=>o.setName('accept').setDescription('Approve (true) or reject (false)').setRequired(true));s.addUserOption(o=>o.setName('member').setDescription('Required for membership requests'));s.addBooleanOption(o=>o.setName('confirm').setDescription('Required to approve deletion'));str(s,'reason','Decision reason');return s;});
const button=(id,label)=>new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Secondary);
function state(id){return store.read().guilds[id]||{};}
function war(id){const w=require('../utils/atomic-json')('warflow').read().guilds[id]?.current;return w?`War ${w.warNumber}`:'Unassigned war';}
function directory(member,page=0,publicView=false){
 const squads=Object.values(state(member.guild.id).squads||{}).filter(s=>publicView?s.status==='approved'&&!s.deletedAt:store.visible(member,s));
 const pages=Math.max(1,Math.ceil(squads.length/8));page=Math.max(0,Math.min(pages-1,Number(page)||0));const selected=squads.slice(page*8,page*8+8);
 const embed=new EmbedBuilder().setColor(0x8b2525).setTitle('HUSS squad directory').setDescription(selected.map(s=>`**${s.name}** • ${s.department}${s.branch?` / ${s.branch}`:''}\nLeader: <@${s.leaderId}> • ${s.members.length} members • ${s.recruiting?'Recruiting':'Recruitment closed'}\n${s.goal.status}: ${s.goal.text.slice(0,180)}${s.status!=='approved'?`\nApproval: ${s.status}`:''}`).join('\n\n')||'No squads yet. Use /squad create.').setFooter({text:`Page ${page+1}/${pages} • Select a squad to view and manage it`});
 const rows=[];if(selected.length)rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('sq_open').setPlaceholder('Choose a squad').addOptions(selected.map(s=>({label:s.name,value:s.id})))));
 rows.push(new ActionRowBuilder().addComponents(button(`sq_prev:${Math.max(0,page-1)}`,'Previous'),button(`sq_list:${page}`,'Refresh'),button(`sq_next:${Math.min(pages-1,page+1)}`,'Next')));
 return {embeds:[embed],components:rows,allowedMentions:{parse:[]}};
}
function detail(member,id,page=0,history=false){
 const s=history?state(member.guild.id).squads?.[id]:store.get(state(member.guild.id),id);if(!s||!(store.visible(member,s)||(history&&store.authority(member,s))))throw new Error('This squad is not available to you.');
 const entries=history?s.goals:s.members,pages=Math.max(1,Math.ceil(entries.length/(history?1:15)));page=Math.max(0,Math.min(pages-1,Number(page)||0));
 const embed=new EmbedBuilder().setColor(0x8b2525).setTitle(s.name).setDescription(`${s.description||'Regiment squad'}\n\n**${s.department}${s.branch?` / ${s.branch}`:''}** • ${s.status}\nLeader: <@${s.leaderId}> • ${s.members.length} members\nRecruitment: ${s.recruiting?'Open':'Closed'}\n\n**${s.goal.war} — ${s.goal.status}**\n${s.goal.text}`).addFields({name:history?'Previous goals':'Roster',value:(history?entries.slice(page,page+1).map(g=>`**${g.war} — ${g.status}**\n${g.text.slice(0,880)}`).join('\n\n'):entries.slice(page*15,page*15+15).map(id=>`<@${id}>`).join('\n'))||'None'}).setFooter({text:`Page ${page+1}/${pages} • /squad for management commands`});
 if(store.manage(member,s)){embed.addFields({name:'Pending requests',value:`Membership: ${Object.keys(s.requests).length} • Goal: ${s.pendingGoal?'Yes':'No'} • Deletion: ${s.deleteRequested?'Yes':'No'}\nUse /squad approve to decide requests.`});if(s.pendingGoal)embed.addFields({name:'Requested goal',value:s.pendingGoal.text});}
 const view=history?'history':'info';const rows=[new ActionRowBuilder().addComponents(button(`sq_${view}:${id}:${Math.max(0,page-1)}`,'Previous'),button(`sq_refresh:${id}:${page}:${history?'history':'info'}`,'Refresh'),button(`sq_${view}:${id}:${Math.min(pages-1,page+1)}`,'Next').setCustomId(`sq_page:${id}:${Math.min(pages-1,page+1)}:${view}`))];
 if(!history&&s.status==='approved')rows.push(new ActionRowBuilder().addComponents(button(`sq_join:${id}`,s.invites[member.id]?'Accept invitation':'Request to join'),button(`sq_leave:${id}`,'Leave / withdraw'),button(`sq_history:${id}:0`,'Goal history'),button(`sq_requests:${id}:0`,'Membership requests')));
 return {embeds:[embed],components:rows,allowedMentions:{parse:[]}};
}
function requests(member,id,page=0){const s=store.get(state(member.guild.id),id);if(!store.manage(member,s))throw new Error('Only squad leadership can review membership.');const ids=Object.keys(s.requests),pages=Math.max(1,Math.ceil(ids.length/5));page=Math.max(0,Math.min(pages-1,Number(page)||0));return {content:`Membership requests for **${s.name}** • Page ${page+1}/${pages}\n${ids.slice(page*5,page*5+5).map(id=>`<@${id}>`).join('\n')||'No pending requests.'}\nUse /squad approve kind:membership member:... to approve or reject.`,embeds:[],components:[new ActionRowBuilder().addComponents(button(`sq_requests:${id}:${Math.max(0,page-1)}`,'Previous'),button(`sq_reqnext:${id}:${Math.min(pages-1,page+1)}`,'Next'))],allowedMentions:{parse:[]}};}
async function refresh(guild){const ref=state(guild.id).directory;if(!ref)return;const channel=await guild.channels.fetch(ref.channelId);const message=await channel.messages.fetch(ref.messageId);await message.edit(directory({guild},0,true));}
async function changed(i,s,action){audit.record(i,`squad.${action}`,s.id,{name:s.name});await refresh(i.guild).catch(e=>console.warn('[Squad directory]',e.message));
 if(['create','delete','goal'].includes(action)&&(s.status==='pending'||s.pendingGoal||s.deleteRequested)){
  const channelId=getConfig(i.guildId,'OFFICER_CHANNEL_ID');if(channelId)try{const channel=await i.guild.channels.fetch(channelId);await channel.send({content:`Squad request: **${s.name}** (${s.department}${s.branch?' / '+s.branch:''}). Use /squad review or /squad approve to review.`,allowedMentions:{parse:[]}});}catch(e){console.warn('[Squad approval notice]',e.message);}
 }
}
function review(member,page=0){const entries=Object.values(state(member.guild.id).squads||{}).filter(s=>!s.deletedAt&&((store.authority(member,s)&&(s.status==='pending'||s.pendingGoal||s.deleteRequested))||(store.manage(member,s)&&Object.keys(s.requests).length)));const pages=Math.max(1,Math.ceil(entries.length/8));page=Math.max(0,Math.min(pages-1,Number(page)||0));return {content:`**Squad approvals • ${page+1}/${pages}**\n`+(entries.slice(page*8,page*8+8).map(s=>`**${s.name}** — ${s.status==='pending'?'creation; ':''}${s.pendingGoal?'goal; ':''}${s.deleteRequested?'deletion; ':''}${Object.keys(s.requests).length} membership requests`).join('\n')||'No pending requests you can decide.')+'\nUse /squad info to inspect the goal and /squad approve to decide.',components:[new ActionRowBuilder().addComponents(button(`sq_review:${Math.max(0,page-1)}`,'Previous'),button(`sq_reviewnext:${Math.min(pages-1,page+1)}`,'Next'))],allowedMentions:{parse:[]}};}

async function execute(i){await i.deferReply({ephemeral:true});try{const actor=await i.guild.members.fetch(i.user.id);store.ensureMember(actor);const sub=i.options.getSubcommand(),opt=n=>i.options.getString(n),id=opt('squad');
 if(sub==='list')return i.editReply(directory(actor));
 if(sub==='review')return i.editReply(review(actor));
 if(sub==='panel'){if(!store.commander(actor))throw new Error('Only High Command can publish a directory.');const msg=await i.channel.send(directory(actor,0,true));store.transact(i.guildId,g=>{g.directory={channelId:msg.channelId,messageId:msg.id};});return i.editReply('Squad directory published. It refreshes after squad changes.');}
 if(['info','history'].includes(sub))return i.editReply(detail(actor,id,0,sub==='history'));
 const targetUser=i.options.getUser(sub==='create'?'leader':'member'),target=targetUser?await i.guild.members.fetch(targetUser.id):null;
 let result;
 if(sub==='create')result=store.transact(i.guildId,g=>store.create(g,actor,target,{name:opt('name'),department:opt('department'),branch:opt('branch'),description:opt('description'),goal:opt('goal'),war:war(i.guildId)}));
 else {let input={name:opt('name'),description:opt('description'),reason:opt('reason'),target,userId:target?.id,confirm:i.options.getBoolean('confirm'),recruiting:i.options.getBoolean('recruiting')};
 if(sub==='goal')Object.assign(input,{goal:opt('text'),war:opt('war')||war(i.guildId),status:opt('action')==='request'?null:opt('action')});
 if(sub==='approve'){Object.assign(input,{kind:opt('kind'),accept:i.options.getBoolean('accept')});if(input.kind==='creation'&&input.accept)input.target=await i.guild.members.fetch(store.get(state(i.guildId),id).leaderId);}
 result=store.transact(i.guildId,g=>store.change(g,actor,id,sub,input));}
 await changed(i,result,sub);return i.editReply(result.deletedAt?{content:'Decision saved. Squad archived.'}:detail(actor,result.id));
 }catch(e){return i.editReply({content:e.message,embeds:[],components:[],allowedMentions:{parse:[]}});}}
async function handle(i) {
 const [action,id,page,view]=i.customId.split(':');
 const directoryAction=['sq_list','sq_next','sq_prev'].includes(action);
 const shared=!i.message?.flags?.has(64);
 // Public directories render only their public projection, never the viewer's private details.
 const update=directoryAction || !shared;
 if(update)await i.deferUpdate();else await i.deferReply({ephemeral:true});
 try {
  const member=await i.guild.members.fetch({user:i.user.id,force:true});store.ensureMember(member);
  if(directoryAction){
   await i.editReply(directory(member,id,shared));
   if(shared)require('../utils/shared-panels').register(i.message,i.guildId,'squads',Number(id)||0);
   return;
  }
  if(action==='sq_open')return i.editReply(detail(member,i.values[0]));
  if(action==='sq_review'||action==='sq_reviewnext')return i.editReply(review(member,id));
  if(['sq_requests','sq_reqnext'].includes(action))return i.editReply(requests(member,id,page));
  if(['sq_info','sq_history','sq_refresh','sq_page'].includes(action))return i.editReply(detail(member,id,page,action==='sq_history'||view==='history'));
  const s=store.transact(i.guildId,g=>store.change(g,member,id,action.slice(3)));
  await changed(i,s,action);return i.editReply(detail(member,id));
 }catch(e){const payload={content:e.message,allowedMentions:{parse:[]}};return update?i.followUp({...payload,ephemeral:true}):i.editReply(payload);}
}
module.exports={data,execute,handle,directory,detail,async autocomplete(i){const member=await i.guild.members.fetch(i.user.id),query=String(i.options.getFocused()).toLowerCase();await i.respond(Object.values(state(i.guildId).squads||{}).filter(s=>(store.visible(member,s)||(i.options.getSubcommand()==='history'&&store.authority(member,s)))&&s.name.toLowerCase().includes(query)).slice(0,25).map(s=>({name:s.name,value:s.id})));}};
