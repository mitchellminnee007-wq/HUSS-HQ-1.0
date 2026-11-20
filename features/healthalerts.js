const {SlashCommandBuilder,PermissionFlagsBits:P}=require('discord.js');
const c=require('../utils/community'),{getConfig}=require('../utils/config');
const data=new SlashCommandBuilder().setName('healthalerts').setDescription('Officer alerts for repeated errors and War API outages').setDMPermission(false)
 .addSubcommand(s=>s.setName('on').setDescription('Enable alerts in the configured private officer channel'))
 .addSubcommand(s=>s.setName('off').setDescription('Disable automated health alerts'))
 .addSubcommand(s=>s.setName('status').setDescription('View alert status and last delivery'));
async function channel(guild){const id=getConfig(guild.id,'OFFICER_CHANNEL_ID');const ch=id?await guild.channels.fetch(id).catch(()=>null):null;
 if(!ch?.isTextBased()||ch.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel)||!ch.permissionsFor(await guild.members.fetchMe())?.has([P.ViewChannel,P.SendMessages]))throw new Error('Configure a private officer channel with bot View Channel and Send Messages access.');return ch;}
function issues(guildId,now=Date.now()) {
 const h=require('../utils/health').snapshot(guildId),war=require('../utils/war-state').read().guilds[guildId],result=[];
 if(h.throttledRequests>=10)result.push('Heavy Discord throttling (10 or more responses)');
 if(h.restErrors>=3)result.push('Repeated Discord request errors');
 if(h.interactionFailures>=3)result.push('Repeated interaction response failures');
 if(h.notificationFailures>=3)result.push('Repeated notification delivery failures');
 if(h.ttsErrors>=3)result.push('Repeated TTS failures');
 if(h.loopP95>500)result.push('High event-loop delay');
 if(getConfig(guildId,'WARFLOW_ENABLED')&&(!war?.lastPoll||now-war.lastPoll>15*60000||war.error))result.push('War API is stale or reporting an error');
 return result;
}
let running=false;const clean=new Map(),started=Date.now();
async function sweep(client,now=Date.now()) {
 if(running||now-started<60000)return;running=true;
 try{for(const guild of client.guilds.cache.values()){
  const a=c.state(guild.id).healthAlerts;if(!a?.enabled)continue;
  const found=issues(guild.id,now),signature=found.join('|');
  if(signature)clean.set(guild.id,0);else clean.set(guild.id,(clean.get(guild.id)||0)+1);
  const recovery=!signature&&a.incident&&(clean.get(guild.id)||0)>=3;
  if(!signature&&!recovery)continue;
  if(signature&&a.incident===signature&&now-(a.lastSent||0)<30*60000)continue;
  if(now-(a.lastAttempt||0)<5*60000)continue;
  c.transact(guild.id,g=>{g.healthAlerts.lastAttempt=now;});
  try{const ch=await channel(guild);await ch.send({...c.safe,content:recovery?'🟢 **HUSS health recovered**\nThe previously reported conditions have cleared for three consecutive checks.':`🟣 **HUSS health needs attention**\n${found.map(x=>'• '+x).join('\n')}\nUse /health for diagnostic categories and timestamps. Repeated alerts are grouped for 30 minutes.`});
   c.transact(guild.id,g=>{Object.assign(g.healthAlerts,{incident:signature||null,lastSent:now,lastDelivery:'sent'});});
  }catch{c.transact(guild.id,g=>{g.healthAlerts.lastDelivery='failed';});}
 }}finally{running=false;}
}
module.exports={data,issues,sweep,channel,execute:i=>c.run(i,async x=>{c.officer(x);const action=x.options.getSubcommand();if(action==='on'){await channel(x.guild);c.transact(x.guildId,g=>{g.healthAlerts={...g.healthAlerts,enabled:true};});}if(action==='off')c.transact(x.guildId,g=>{g.healthAlerts={...g.healthAlerts,enabled:false};});const a=c.state(x.guildId).healthAlerts||{};return {content:`Health alerts: **${a.enabled?'Enabled':'Disabled'}**\nLast delivery: ${a.lastDelivery||'None'}${a.lastSent?` • <t:${Math.floor(a.lastSent/1000)}:R>`:''}\nPrivate officer channel only. Recovery requires three clean checks. An offline bot cannot send its own outage alert.`};},'healthalerts'),init(client){const tick=()=>sweep(client).catch(()=>console.warn('[Health alerts] Check failed'));client.once('clientReady',()=>{setInterval(tick,60000).unref();});}};
