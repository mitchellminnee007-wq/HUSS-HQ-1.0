const {randomUUID,createHash}=require('node:crypto');
const {EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,UserSelectMenuBuilder,PermissionFlagsBits:P}=require('discord.js');
const store=require('./commendations');
const {isOfficer}=require('./ranks');
const {getConfig}=require('./config');
const {decorate}=require('./commendation-art');
const drafts=new Map(),initialized=new WeakSet(),running=new Set();
const safe={allowedMentions:{parse:[]}};
function squadDraft(i,input){
  for(const [id,d] of drafts)if(d.expires<Date.now())drafts.delete(id);
  if(drafts.size>=500)throw new Error('Too many pending squad forms. Try again later.');
  const id=randomUUID();drafts.set(id,{guildId:i.guildId,userId:i.user.id,input,expires:Date.now()+15*60000});
  return {...safe,content:'Select 2–20 verified squad members. The roster is fixed when submitted; nobody on it can approve the award. This form expires in 15 minutes.',components:[new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`cm_roster:${id}`).setPlaceholder('Choose squad recipients').setMinValues(2).setMaxValues(20))],ephemeral:true};
}
async function roster(i){
  const id=i.customId.split(':')[1],d=drafts.get(id);
  if(!d||d.expires<Date.now()||d.guildId!==i.guildId||d.userId!==i.user.id)throw new Error('This squad form expired or belongs to another member. Run /commendation squad again.');
  await i.deferReply({ephemeral:true});
  const targets=await Promise.all(i.values.map(userId=>i.guild.members.fetch(userId)));
  // Recheck after fetching to prevent duplicate simultaneous submissions.
  if(!drafts.has(id))throw new Error('This squad form has already been submitted.');
  const n=store.transact(i.guildId,g=>store.nominateSquad(g,i.member,i.user.id,targets,d.input.name,d.input.award,d.input.reason,d.input.war,d.input.evidence));
  drafts.delete(id);require('./audit').record(i,'commendation.squad',n.id,{recipientIds:store.recipients(n)});
  return i.editReply({content:'Squad nomination submitted.',...require('./commendation-panel').detail({nominations:{[n.id]:n}},i,n.id)});
}
const warKey=war=>createHash('sha256').update(war.trim().toLowerCase()).digest('hex').slice(0,16);
function summary(guildId,war,page=1){
  war=String(war||'').trim();if(!war||war.length>80)throw new Error('Choose a recorded war.');
  const awards=store.awardsFor(store.read().guilds[guildId]).filter(n=>require('./war-context').matches(guildId,n,war));
  const pages=Math.max(1,Math.ceil(awards.length/5));page=Math.max(1,Math.min(pages,Number(page)||1));
  const people=new Set(awards.flatMap(store.recipients));
  const embed=new EmbedBuilder().setTitle(`🏅 Honours • ${war}`).setColor(0xD4AF37).setDescription(`${awards.length} approved awards • ${people.size} recognised members • ${awards.filter(n=>n.squadName).length} squad awards\n${awards.length?'Celebrating this campaign’s service and teamwork.':'No approved awards recorded for this war.'}`).setFooter({text:`Page ${page}/${pages} • Approved awards only • Refresh for current records`}).setTimestamp();
  for(const n of awards.slice((page-1)*5,page*5))embed.addFields({name:store.AWARDS[n.award],value:`${require('./commendation-emoji').text(n.award,guildId)} ${store.recipientLabel(n)}\n${n.reason.slice(0,200)}${n.reason.length>200?'…':''}\nAwarded <t:${Math.floor(n.approvedAt/1000)}:D>`});
  const button=(p,label)=>new ButtonBuilder().setCustomId(`cm_summary:${warKey(war)}:${p}`).setLabel(label).setStyle(ButtonStyle.Secondary);
  return decorate({...safe,embeds:[embed],components:[new ActionRowBuilder().addComponents(button(page-1,'Previous').setDisabled(page<=1),button(page+1,'Next').setDisabled(page>=pages),button(page,'Refresh'))]},true);
}
function summaryWar(guildId,key){return Object.values(store.read().guilds[guildId]?.nominations||{}).find(n=>warKey(n.war)===key)?.war;}
function reminderSettings(guildId,guild){return guild.reminders||{enabled:Boolean(getConfig(guildId,'OFFICER_CHANNEL_ID')),channelId:getConfig(guildId,'OFFICER_CHANNEL_ID'),afterDays:3,intervalHours:24};}
function due(guildId,guild,now=Date.now()){
  const config=reminderSettings(guildId,guild);
  if(!config.enabled||!config.channelId||now-(guild.lastReminderAt||0)<config.intervalHours*3600000)return null;
  const count=Object.values(guild.nominations||{}).filter(n=>n.status==='pending'&&now-(n.updatedAt||n.createdAt)>=config.afterDays*86400000).length;
  return count?{...config,count}:null;
}
async function reminders(client){
  for(const [guildId,guild] of Object.entries(store.read().guilds)){
    if(running.has(guildId)||!client.guilds.cache.has(guildId)||require('./maintenance').active(guildId,'commendation'))continue;
    const reminder=due(guildId,guild);if(!reminder)continue;
    running.add(guildId);
    try{
      const discordGuild=client.guilds.cache.get(guildId),channel=await discordGuild.channels.fetch(reminder.channelId),me=discordGuild.members.me||await discordGuild.members.fetchMe();
      if(channel?.guildId!==guildId||!channel?.isTextBased()||!channel.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages]))continue;
      // Recheck current settings and pending state after Discord fetches.
      const latest=store.read().guilds[guildId],fresh=due(guildId,latest);
      if(!fresh||fresh.channelId!==reminder.channelId||require('./maintenance').active(guildId,'commendation'))continue;
      await channel.send({content:`🏅 ${fresh.count} commendation nomination(s) have been awaiting officer review for at least ${fresh.afterDays} days. Use /commendation review.`,...safe});
      store.transact(guildId,current=>{current.lastReminderAt=Date.now();});
    }catch(error){console.error('Commendation reminder failed:',error.message);}finally{running.delete(guildId);}
  }
}
async function configureReminders(i){
  if(!isOfficer(i.member))throw new Error('Only officers can configure reminders.');
  const enabled=i.options.getBoolean('enabled'),guild=store.read().guilds[i.guildId]||{nominations:{}},old=reminderSettings(i.guildId,guild);
  const channelId=i.options.getChannel('channel')?.id||old.channelId;
  if(enabled){
    if(!channelId)throw new Error('Choose an officer channel for reminders.');
    const channel=await i.guild.channels.fetch(channelId),me=i.guild.members.me||await i.guild.members.fetchMe();
    if(channel.guildId!==i.guildId||!channel.permissionsFor(i.member)?.has(P.ViewChannel)||!channel.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages]))throw new Error('Choose a channel you can view where the bot can send messages.');
  }
  const afterDays=i.options.getInteger('after-days')||old.afterDays,intervalHours=i.options.getInteger('interval-hours')||old.intervalHours;
  if(!Number.isInteger(afterDays)||afterDays<1||afterDays>30||!Number.isInteger(intervalHours)||intervalHours<6||intervalHours>168)throw new Error('Choose 1–30 days and a 6–168 hour reminder interval.');
  store.transact(i.guildId,current=>{current.reminders={enabled,channelId,afterDays,intervalHours};});
  return i.editReply({content:enabled?`Review reminders enabled: after ${afterDays} idle days, at most once every ${intervalHours} hours in <#${channelId}>.`:'Review reminders disabled.',...safe});
}
function init(client){if(initialized.has(client))return;initialized.add(client);const tick=()=>{void reminders(client).catch(error=>console.error('Commendation reminders:',error.message));};client.once('clientReady',tick);const timer=setInterval(tick,15*60000);timer.unref?.();}
module.exports={squadDraft,roster,summary,summaryWar,warKey,reminderSettings,due,reminders,configureReminders,init};
