const {SlashCommandBuilder,EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle}=require('discord.js');
const {createHash,randomUUID}=require('node:crypto');
const store=require('../utils/war-state');
const {getConfig}=require('../utils/config');
const {commander}=require('../utils/squad-store');
const audit=require('../utils/audit');
const locks=new Set(),initialized=new WeakSet();
const data=new SlashCommandBuilder().setName('warflow').setDescription('Able war lifecycle and Commander approvals').setDMPermission(false);
for(const name of ['status','activity','preview','recover','reconcile'])data.addSubcommand(s=>{
 s.setName(name).setDescription({status:'View war tracking and outstanding approvals',activity:'Approve a full 48-hour activity check',preview:'Preview rollover and receive a confirmation button',recover:'Recover an interrupted activity start or rollover for manual review',reconcile:'Archive conflicting kill count and start the current API war'}[name]);
 if(['activity','recover','reconcile'].includes(name))s.addBooleanOption(o=>o.setName('confirm').setDescription('Confirm this action').setRequired(true));
 s.addStringOption(o=>o.setName('war').setDescription('Choose a recorded war (defaults to latest ended)').setAutocomplete(true));return s;
});
const snapshot=id=>store.read().guilds[id]||{};
const update=(id,war,fn)=>store.transact(id,g=>{const w=g.wars?.[war];if(!w)throw new Error('War not recorded.');return fn(w,g);});
const btn=(id,label)=>new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Secondary);
const safe={allowedMentions:{parse:[]}};
function chosen(g,id){return id?g.wars?.[id]:Object.values(g.wars||{}).filter(w=>w.conquestEndTime).sort((a,b)=>b.conquestEndTime-a.conquestEndTime)[0]||g.current;}
async function send(guild,channelId,key,payload){const channel=await guild.channels.fetch(channelId);if(!channel?.isTextBased())throw new Error('Configure a text channel for war lifecycle messages.');return channel.send({...payload,...safe,nonce:createHash('sha256').update(guild.id+key).digest('hex').slice(0,24),enforceNonce:true});}
function status(g){const w=chosen(g);return {content:`**Able war lifecycle**\nCurrent: ${g.current?`War ${g.current.warNumber}`:'Waiting for API'}\nLast successful poll: ${g.lastPoll?`<t:${Math.floor(g.lastPoll/1000)}:R>`:'Never'}\n${g.error?`Attention: ${g.error}\n`:''}${g.missedEnd?'A previous war end was missed while offline; no end date was fabricated.\n':''}${w?`Review: War ${w.warNumber}\nActivity: ${w.activity?.status||'Awaiting Commander approval'}${w.activity?` • closes <t:${Math.floor(w.activity.endsAt/1000)}:F>`:''}\nRollover: ${w.rollover||'Awaiting activity check and Commander preview'}`:''}\nUse /warflow activity after war end, then /warflow preview after the check closes.`,...safe};}
async function poll(client){
 const ids=[...client.guilds.cache.keys()].filter(id=>getConfig(id,'WARFLOW_ENABLED')&&!require('../utils/maintenance').active(id,'warflow'));if(!ids.length)return;
 let api;try{const response=await fetch('https://war-service-live.foxholeservices.com/api/worldconquest/war',{signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error(`War API HTTP ${response.status}`);api=await response.json();}catch(e){for(const id of ids)store.transact(id,g=>{g.error=e.message;});return;}
 for(const id of ids){if(locks.has(id))continue;locks.add(id);const guild=client.guilds.cache.get(id);
 try{
  store.transact(id,g=>store.observe(g,api));
  if(api.conquestStartTime&&!api.conquestEndTime&&!require('../utils/maintenance').active(id,'squad-review'))require('../utils/squad-store').activatePlannedGoals(id,api);
  // Finish old campaigns first, without making a role change.
  const wars=Object.values(snapshot(id).wars||{}).sort((a,b)=>(a.conquestStartTime||0)-(b.conquestStartTime||0));
  for(const w of wars){
   try{if(w.conquestEndTime||w.warId===api.warId)await require('./killcount').apiSync(guild,w);}catch(e){store.transact(id,g=>{g.error=e.message;});}
   if(!w.conquestEndTime)continue;
   if(!w.summary){
    const recorded=require('./killcount').apiHistory(id),kills=[recorded.active,...(recorded.history||[])].filter(Boolean).find(k=>k.apiWarId===w.warId);
    const awards=require('../utils/commendations').awardsFor(require('../utils/commendations').read().guilds[id]).filter(a=>require('../utils/war-context').matches(id,a,`War ${w.warNumber}`));
    const msg=await send(guild,getConfig(id,'WAR_ANNOUNCEMENT_CHANNEL_ID'),w.warId+'summary',{embeds:[new EmbedBuilder().setColor(0xD4AF37).setTitle(`Able • War ${w.warNumber} concluded`).setDescription(`Winner: **${w.winner}**\nEnded <t:${Math.floor(w.conquestEndTime/1000)}:F>\n\nReported regiment kills: **${kills?kills.kills.reduce((n,k)=>n+k.count,0):'No linked record'}**\nApproved commendations: **${awards.length}**\nApproved operation debriefs: **${Object.values(require('../utils/community').state(id).debriefs||{}).filter(d=>d.status==='Approved'&&d.warRef?.id===w.warId).length}**\nDebriefs and lessons: /wararchive (when released).\n\nA Commander will approve the activity check. Every member then has 48 hours to respond. Rollover requires a separate Commander confirmation.`).setFooter({text:'Foxhole War API • Regiment statistics are manually reported'})]});update(id,w.warId,s=>{s.summary=msg.id;});
   }
   if(!w.approvalMessage){const msg=await send(guild,getConfig(id,'OFFICER_CHANNEL_ID'),w.warId+'approval',{content:`**War ${w.warNumber} ended.** Commander approval required to start a full 48-hour activity check. Starting clears the previous Active role roster. Use /warflow activity confirm:True.`,components:[new ActionRowBuilder().addComponents(btn(`wf_activity:${w.warId}`,'Approve activity check'))]});update(id,w.warId,s=>{s.approvalMessage=msg.id;});}
   if(store.ready(w)&&!w.readyMessage){const msg=await send(guild,getConfig(id,'OFFICER_CHANNEL_ID'),w.warId+'ready',{content:`War ${w.warNumber}: activity check closed. Rollover requires a Commander preview and confirmation.`,components:[new ActionRowBuilder().addComponents(btn(`wf_preview:${w.warId}`,'Preview rollover'))]});update(id,w.warId,s=>{s.readyMessage=msg.id;});}
  }
 }catch(e){store.transact(id,g=>{g.error=e.message;});console.error('[Warflow]',e.message);}finally{locks.delete(id);}}
}
async function act(i,action,id,token){
 if(locks.has(i.guildId))throw new Error('A war action is processing. Please retry shortly.');locks.add(i.guildId);
 try{
 const member=await i.guild.members.fetch(i.user.id),g=snapshot(i.guildId),w=chosen(g,id);
 if(action==='status')return i.editReply(status(g));if(!w)throw new Error('No war has been recorded yet.');
 if(action==='respond'){
  if(member.user.bot)throw new Error('Members only.');
  const a=w.activity;if(a?.status!=='open'||Date.now()>=a.endsAt||i.message?.id!==a.messageId)throw new Error('This activity check is not open.');
  const roleId=getConfig(i.guildId,'ACTIVE_WAR_ROLE_ID');await member.roles.add(roleId);
  update(i.guildId,w.warId,s=>{if(!s.activity.respondents.includes(member.id))s.activity.respondents.push(member.id);});return i.editReply('You are marked active for this activity check.');
 }
 if(!commander(member))throw new Error('The configured Commander role is required.');
 if(action==='activity'){
  if(Object.values(g.wars).some(other=>other.activity&&other.warId!==w.warId&&other.rollover!=='done'))throw new Error('Finish the previous activity/rollover review first.');
  update(i.guildId,w.warId,s=>store.activity(s,member.id));
  const cleared=await require('./rollover').clearActiveMembers(i.guild);if(!cleared.role||cleared.failed)throw new Error('Could not clear the complete active roster. Fix role permissions, then /warflow recover confirm:True.');
  // The response window starts when the check is actually published, after clearing roles.
  const endsAt=Date.now()+store.WINDOW;
  const message=await send(i.guild,getConfig(i.guildId,'WAR_ANNOUNCEMENT_CHANNEL_ID'),w.warId+'activity'+endsAt,{content:`**Activity check • War ${w.warNumber}**\nMark yourself active before <t:${Math.floor(endsAt/1000)}:F>. You have a full 48 hours. Members who do not respond may have their roles reset after Commander approval.`,components:[new ActionRowBuilder().addComponents(btn(`wf_respond:${w.warId}`,'Mark active'))]});
  update(i.guildId,w.warId,s=>{Object.assign(s.activity,{status:'open',endsAt,messageId:message.id,channelId:message.channelId});});audit.record(i,'warflow.activity',w.warId);return i.editReply('Activity check approved and published. Members have 48 hours from publication.');
 }
 if(action==='recover'){
  update(i.guildId,w.warId,s=>{if(s.activity?.status==='starting')delete s.activity;else if(s.rollover==='running')s.rollover='attention';else throw new Error('No interrupted action to recover.');delete s.preview;});audit.record(i,'warflow.recover',w.warId);return i.editReply('Interrupted state released for manual review. Start the activity check again, or create a fresh rollover preview. No roles were changed by recovery.');
 }
 if(action==='reconcile'){if(!g.current)throw new Error('No current API war.');await require('./killcount').reconcile(i.guild,g.current);audit.record(i,'warflow.killcount_reconcile',g.current.warId);return i.editReply('Conflicting kill count archived and current API campaign synchronized.');}
 if(!store.ready(w))throw new Error('Rollover requires a completed 48-hour activity window and at least 48 hours since war end. A completed/running rollover cannot run again.');
 const rollover=require('./rollover'),active=new Set(w.activity.respondents);
 if(action==='preview'){
  const result=await rollover.executeRollover(i.guild,null,true,active);const nonce=randomUUID();update(i.guildId,w.warId,s=>{s.preview={token:nonce,userId:member.id,expires:Date.now()+10*60000};});
  return i.editReply({content:`**Rollover preview • War ${w.warNumber}**\nRespondents kept: ${result.activeMembersSkipped}\nInactive members reset: ${result.membersReset}\nRoles removed: ${result.rolesRemoved}\nAllies removed: ${result.alliesRemoved}\nFailures / inaccessible roles: ${result.rolesFailed+result.membersFailed+result.alliesFailed}\n\n${require('../utils/community').absenceReview(i.guildId,active)}\n\nInactive allies only lose Ally; no other roles are changed or added, even if they also have Member. Other inactive non-bot members (including officers, except the server owner) lose editable roles and receive Unverified + Former Member. This uses responses to this check, not old Active roles. Confirm within 10 minutes.`,components:[new ActionRowBuilder().addComponents(btn(`wf_confirm:${w.warId}:${nonce}`,'Confirm rollover').setStyle(ButtonStyle.Danger))],...safe});
 }
 if(action==='confirm'){
  if(!w.preview||w.preview.token!==token||w.preview.userId!==member.id||w.preview.expires<Date.now())throw new Error('Preview expired or belongs to another Commander. Create a new preview.');
  update(i.guildId,w.warId,s=>{s.rollover='running';delete s.preview;s.rolloverApprovedBy=member.id;});audit.record(i,'warflow.rollover_started',w.warId);
  const result=await rollover.executeRollover(i.guild,null,false,active);update(i.guildId,w.warId,s=>{s.rollover=result.rolesFailed+result.membersFailed+result.alliesFailed?'attention':'done';s.rolloverResult=result;});audit.record(i,'warflow.rollover_finished',w.warId,result);
  return i.editReply({content:`Rollover finished: ${result.membersReset} members reset, ${result.activeMembersSkipped} kept. Failures: ${result.rolesFailed+result.membersFailed+result.alliesFailed}. Partial failures require a fresh preview before retrying.`,components:[]});
 }
 throw new Error('Unknown action.');
 }finally{locks.delete(i.guildId);}
}
async function run(i,action,id,token){await i.deferReply({ephemeral:true});try{if(!getConfig(i.guildId,'WARFLOW_ENABLED'))throw new Error('War lifecycle is not configured in this server.');return await act(i,action,id,token);}catch(e){return i.editReply({content:e.message,components:[],...safe});}}
module.exports={data,poll,act,async execute(i){const action=i.options.getSubcommand();if(['activity','recover','reconcile'].includes(action)&&!i.options.getBoolean('confirm'))return i.reply({content:'No changes made. Set confirm:True to proceed.',ephemeral:true});return run(i,action,i.options.getString('war'));},handle(i){const [action,id,token]=i.customId.split(':');return run(i,action.slice(3),id,token);},async autocomplete(i){const q=String(i.options.getFocused()).toLowerCase();return i.respond(Object.values(snapshot(i.guildId).wars||{}).filter(w=>`war ${w.warNumber}`.includes(q)).slice(-25).map(w=>({name:`War ${w.warNumber}`,value:w.warId})));},init(client){if(initialized.has(client))return;initialized.add(client);const tick=()=>poll(client).catch(e=>console.error('[Warflow]',e.message));if(client.isReady())tick();else client.once('clientReady',tick);setInterval(tick,300000).unref();}};
