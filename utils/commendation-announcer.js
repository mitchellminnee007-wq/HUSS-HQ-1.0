const {EmbedBuilder,PermissionFlagsBits:P}=require('discord.js');
const {createHash}=require('node:crypto');
const store=require('./commendations'),{getConfig}=require('./config');
const locks=new Set(),initialized=new WeakSet();
const marker=id=>`HUSS nomination ${id}`;
function payload(n,guildId){return require('./commendation-art').decorate({embeds:[new EmbedBuilder().setTitle(store.AWARDS[n.award]).setColor(n.status==='revoked'?0xE74C3C:0xD4AF37).setDescription(require('./commendation-emoji').text(n.award,guildId)+' '+(n.status==='revoked'?`This award for ${store.recipientLabel(n)} has been revoked.`:`Awarded to ${store.recipientLabel(n)}\n\n${n.reason}`)).addFields({name:'War',value:n.war},{name:'Approved by',value:(n.approvals?.length?n.approvals.map(a=>`<@${a.actorId}>`).join(', '):`<@${n.approvedBy}>`)}).setTimestamp(n.approvedAt).setFooter({text:`${marker(n.id)} • HUSS regiment commendation • See Hall for current record`})],allowedMentions:{parse:[]}},true,n.award);}
async function publish(guild,id,options={}){
 const key=`${guild.id}:${id}`;if(locks.has(key))throw new Error('This announcement is already being processed.');locks.add(key);
 let sending=false;
 try{
  let n=store.get(store.read().guilds[guild.id]||{nominations:{}},id);
  if(n.announcement)return n.announcement;
  if(n.status!=='approved')throw new Error('Only approved awards can be announced.');
  const channelId=n.autoAnnouncement?.channelId||options.channelId||getConfig(guild.id,'COMMENDATION_ANNOUNCEMENT_CHANNEL_ID')||getConfig(guild.id,'WAR_ANNOUNCEMENT_CHANNEL_ID');
  if(!channelId)throw new Error('Configure an announcement channel or use /commendation announce.');
  const channel=await guild.channels.fetch(channelId),me=guild.members.me||await guild.members.fetchMe();
  if(!channel?.isTextBased()||channel.guildId!==guild.id||!channel.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks,P.AttachFiles,P.ReadMessageHistory])||options.actor&&!channel.permissionsFor(options.actor)?.has(P.ViewChannel))throw new Error('Announcement channel is inaccessible or the bot lacks message, embed, attachment or history permissions.');
  store.transact(guild.id,g=>{const current=store.get(g,id);current.autoAnnouncement={...current.autoAnnouncement,channelId};});
  // Recover a send interrupted before its message ID was saved, without blindly reposting it.
  const recent=await channel.messages.fetch({limit:100});
  let message=recent.find(m=>m.author?.id===guild.client.user.id&&m.embeds?.some(e=>e.footer?.text?.startsWith(marker(id)+' •')));
  n=store.get(store.read().guilds[guild.id],id);
  if(n.announcement)return n.announcement;
  if(n.status!=='approved')return null;
  if(require('./maintenance').active(guild.id,'commendation'))throw new Error('Commendations are under maintenance.');
  if(!message){
   if(['sending','attention'].includes(n.autoAnnouncement?.state))throw new Error('An earlier send has an uncertain outcome. Check the announcement channel before retrying.');
   store.transact(guild.id,g=>{const current=store.get(g,id);current.autoAnnouncement={...current.autoAnnouncement,state:'sending',channelId,attemptedAt:Date.now()};});
   sending=true;
   message=await channel.send({...payload(n,guild.id),nonce:createHash('sha256').update('honours:'+key).digest('hex').slice(0,24),enforceNonce:true});
  }
  store.transact(guild.id,g=>{const current=store.get(g,id);current.announcement={channelId,messageId:message.id};current.autoAnnouncement={...current.autoAnnouncement,state:'sent',sentAt:Date.now()};});
  const latest=store.get(store.read().guilds[guild.id],id);
  // Preserve corrections/revocations that happened while Discord processed the send.
  if(latest.status!==n.status||latest.reason!==n.reason)await message.edit(payload(latest,guild.id));
  return {channelId,messageId:message.id};
 }catch(error){
  store.transact(guild.id,g=>{const n=g.nominations?.[id];if(!n||n.announcement)return;
   const uncertain=sending&&!Number.isInteger(error.status)||['sending','attention'].includes(n.autoAnnouncement?.state)&&!sending;
   n.autoAnnouncement={...n.autoAnnouncement,state:uncertain?'attention':'pending',lastAttempt:Date.now(),lastError:uncertain?'Uncertain send; manual channel check required.':'Could not publish. Check channel permissions and configuration.'};
  });
  throw error;
 }finally{locks.delete(key);}
}
async function sweep(client){
 for(const[guildId,g]of Object.entries(store.read().guilds)){
  const guild=client.guilds.cache.get(guildId);if(!guild||require('./maintenance').active(guildId,'commendation'))continue;
  for(const n of Object.values(g.nominations||{})){
   if(n.status!=='approved'||n.announcement||!n.autoAnnouncement||n.autoAnnouncement.state==='attention'||Date.now()-(n.autoAnnouncement.lastAttempt||0)<300000||locks.has(`${guildId}:${n.id}`))continue;
   try{await publish(guild,n.id);}catch{console.warn('[Commendations] Automatic announcement pending; inspect the nomination for details.');}
  }
 }
}
function init(client){if(initialized.has(client))return;initialized.add(client);const tick=()=>sweep(client).catch(()=>console.warn('[Commendations] Announcement queue check failed'));if(client.isReady())tick();else client.once('clientReady',tick);setInterval(tick,60000).unref();}
module.exports={payload,publish,sweep,init};
