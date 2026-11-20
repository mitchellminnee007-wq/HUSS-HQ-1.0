const {SlashCommandBuilder,ChannelType,EmbedBuilder,PermissionFlagsBits:P}=require('discord.js');
const store=require('../utils/commendations');
const panel=require('../utils/commendation-panel');
const extras=require('../utils/commendation-extras');
const {isOfficer}=require('../utils/ranks');
const publishing=new Set();
const idOption=s=>s.addStringOption(o=>o.setName('entry').setDescription('Search by recipient, award or war').setRequired(true).setAutocomplete(true));
const noteOption=s=>s.addStringOption(o=>o.setName('note').setDescription('Reason for this administrative change').setRequired(true).setMaxLength(500));
const announcement=(n,guildId)=>require('../utils/commendation-announcer').payload(n,guildId);
async function refreshAnnouncement(i,n){
  if(!n.announcement)return true;
  try{const channel=await i.guild.channels.fetch(n.announcement.channelId);const message=await channel.messages.fetch(n.announcement.messageId);await message.edit(announcement(n,i.guildId));return true;}catch{return false;}
}
module.exports={
  data:new SlashCommandBuilder().setName('commendation').setDescription('Nominate members, review awards and browse the Hall of Honours.').setDMPermission(false)
    .addSubcommand(s=>s.setName('nominate').setDescription('Recognise a fellow regiment member')
      .addUserOption(o=>o.setName('member').setDescription('Who deserves recognition?').setRequired(true))
      .addStringOption(o=>o.setName('award').setDescription('Commendation category').setRequired(true).addChoices(...Object.entries(store.AWARDS).map(([value,name])=>({value,name}))))
      .addStringOption(o=>o.setName('reason').setDescription('Their contribution; becomes public if approved').setRequired(true).setMaxLength(1000))
      .addStringOption(o=>o.setName('war').setDescription('War or campaign; defaults to the current tracked war').setMaxLength(80))
      .addStringOption(o=>o.setName('evidence').setDescription('Optional HTTPS screenshot/message link; only reviewers and you can see it').setMaxLength(500)))
    .addSubcommand(s=>s.setName('squad').setDescription('Nominate a squad; choose 2–20 recipients on the next screen')
      .addStringOption(o=>o.setName('name').setDescription('Squad or crew name').setRequired(true).setMaxLength(80))
      .addStringOption(o=>o.setName('award').setDescription('Award category').setRequired(true).addChoices(...Object.entries(store.AWARDS).map(([value,name])=>({value,name}))))
      .addStringOption(o=>o.setName('reason').setDescription('Public citation for the squad').setRequired(true).setMaxLength(1000))
      .addStringOption(o=>o.setName('war').setDescription('War or campaign; defaults to the tracked war').setMaxLength(80))
      .addStringOption(o=>o.setName('evidence').setDescription('Optional private HTTPS evidence link').setMaxLength(500)))
    .addSubcommand(s=>s.setName('summary').setDescription('View or publish an end-of-war honours summary')
      .addStringOption(o=>o.setName('war').setDescription('Choose a war; defaults to the last completed tracked war').setAutocomplete(true).setMaxLength(80))
      .addChannelOption(o=>o.setName('channel').setDescription('Officers: publish or update the summary here').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s=>s.setName('reminders').setDescription('Configure officer review reminders')
      .addBooleanOption(o=>o.setName('enabled').setDescription('Enable or disable reminders').setRequired(true))
      .addChannelOption(o=>o.setName('channel').setDescription('Destination; defaults to the configured officer channel').addChannelTypes(ChannelType.GuildText))
      .addIntegerOption(o=>o.setName('after-days').setDescription('Idle days before reminding (default 3)').setMinValue(1).setMaxValue(30))
      .addIntegerOption(o=>o.setName('interval-hours').setDescription('Minimum time between reminders (default 24 hours)').setMinValue(6).setMaxValue(168)))
    .addSubcommand(s=>s.setName('panel').setDescription('Post the shared Hall of Honours panel (officers)'))
    .addSubcommand(s=>s.setName('hall').setDescription('Browse approved regiment awards'))
    .addSubcommand(s=>s.setName('mine').setDescription('View your nominations and requests for details'))
    .addSubcommand(s=>s.setName('review').setDescription('Open the private officer review queue'))
    .addSubcommand(s=>s.setName('history').setDescription('Review decided and revoked nominations (officers)'))
    .addSubcommand(s=>idOption(s.setName('view').setDescription('Open an award or nomination available to you')))
    .addSubcommand(s=>noteOption(idOption(s.setName('revoke').setDescription('Revoke an approved award; preserve its history'))))
    .addSubcommand(s=>noteOption(idOption(s.setName('correct').setDescription('Correct the public citation for an approved award')))
      .addStringOption(o=>o.setName('reason').setDescription('Corrected public citation').setRequired(true).setMaxLength(1000)))
    .addSubcommand(s=>idOption(s.setName('announce').setDescription('Publish an approved award once in a selected channel'))
      .addChannelOption(o=>o.setName('channel').setDescription('Announcement destination').setRequired(true).addChannelTypes(ChannelType.GuildText))),
  init(client){require('../utils/commendation-emoji').init(client);extras.init(client);require('../utils/commendation-announcer').init(client);},
  handleButton:panel.handle,handleSelect:panel.handle,handleModal:panel.handle,
  async autocomplete(i){
    try{const guild=panel.data(i),query=String(i.options.getFocused()).toLowerCase(),sub=i.options.getSubcommand(),staff=isOfficer(i.member);
      if(i.options.getFocused(true)?.name==='war')return await i.respond([...new Set(Object.values(guild.nominations).filter(n=>n.status==='approved').map(n=>n.war))].filter(w=>w.toLowerCase().includes(query)).slice(0,25).map(w=>({name:w,value:w})));
      const entries=Object.values(guild.nominations).filter(n=>['revoke','correct','announce'].includes(sub)?staff&&n.status==='approved':n.status==='approved'||staff||n.nominatorId===i.user.id);
      return await i.respond(entries.map(n=>({name:`${n.squadName||i.guild.members.cache.get(n.recipientId)?.displayName||n.recipientId} • ${store.AWARDS[n.award]} • ${n.war} • ${n.id}`.slice(0,100),value:n.id})).filter(c=>c.name.toLowerCase().includes(query)).slice(0,25));
    }catch{return i.respond([]);}
  },
  async execute(i){
    try{
      const guild=panel.data(i),sub=i.options.getSubcommand(),staff=isOfficer(i.member),id=i.options.getString('entry');
      if(['panel','review','history','revoke','correct','announce','reminders'].includes(sub)&&!staff)throw new Error('Only Officers and Commanders can use this action.');
      if(sub==='panel')return await i.reply(panel.shared());
      if(['hall','mine','review','history'].includes(sub))return await i.reply({...panel.list(guild,i,sub),ephemeral:true});
      if(sub==='view')return await i.reply({...panel.detail(guild,i,id),ephemeral:true});
      if(sub==='squad'){
        const war=i.options.getString('war')||require('../utils/member-data').readData('killcount').guilds?.[i.guildId]?.active?.name||'Not specified';
        return await i.reply(extras.squadDraft(i,{name:i.options.getString('name'),award:i.options.getString('award'),reason:i.options.getString('reason'),war:String(war).slice(0,80),evidence:i.options.getString('evidence')}));
      }
      await i.deferReply({ephemeral:true});
      if(sub==='reminders')return await extras.configureReminders(i);
      if(sub==='summary'){
        const tracked=require('../utils/member-data').readData('killcount').guilds?.[i.guildId]||{};
        const war=i.options.getString('war')||tracked.history?.at(-1)?.name||tracked.active?.name;
        if(!war)throw new Error('Choose the war to summarise.');
        const payload=extras.summary(i.guildId,String(war)),channel=i.options.getChannel('channel');
        if(!channel)return await i.editReply(payload);
        if(!staff)throw new Error('Only officers can publish a summary.');
        const me=i.guild.members.me||await i.guild.members.fetchMe();
        if(!channel.permissionsFor(i.member)?.has(P.ViewChannel)||!channel.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks,P.AttachFiles]))throw new Error('Choose a visible channel where the bot can send embeds and attachments.');
        const key=extras.warKey(String(war)),lock=`summary:${i.guildId}:${key}`;
        if(publishing.has(lock))throw new Error('This summary is being published.');publishing.add(lock);
        try{
          const saved=store.read().guilds[i.guildId]?.summaries?.[key];
          if(saved&&saved.channelId!==channel.id)throw new Error('This war already has a published summary in another channel. Use that channel to update it.');
          if(saved){const message=await channel.messages.fetch(saved.messageId);await message.edit(payload);}
          else {const message=await channel.send(payload);store.transact(i.guildId,current=>{current.summaries||={};current.summaries[key]={channelId:channel.id,messageId:message.id,war:String(war)};});}
          require('../utils/audit').record(i,'commendation.summary',key,{war:String(war),channelId:channel.id});
          return await i.editReply({content:'Honours summary published. Its buttons browse and refresh approved awards for this war.',allowedMentions:{parse:[]}});
        }finally{publishing.delete(lock);}
      }
      if(sub==='nominate'){
        const target=await i.guild.members.fetch(i.options.getUser('member').id);
        const war=i.options.getString('war')||require('../utils/member-data').readData('killcount').guilds?.[i.guildId]?.active?.name||'Not specified';
        const n=store.transact(i.guildId,current=>store.nominate(current,i.member,i.user.id,target,i.options.getString('award'),i.options.getString('reason'),String(war).slice(0,80),i.options.getString('evidence')));
        require('../utils/audit').record(i,'commendation.nominate',n.id,{recipientId:n.recipientId,award:n.award});
        return await i.editReply({content:'Nomination submitted. Track it through My nominations; officers can review it in their queue.',...panel.detail({nominations:{[n.id]:n}},i,n.id)});
      }
      if(sub==='announce'){
        const n=store.get(store.read().guilds[i.guildId]||{nominations:{}},id);
        if(n.announcement)throw new Error('This award has already been announced.');
        const result=await require('../utils/commendation-announcer').publish(i.guild,id,{channelId:i.options.getChannel('channel').id,actor:i.member});
        if(!result)throw new Error('This award is no longer approved.');
        require('../utils/audit').record(i,'commendation.announce',id,{channelId:result.channelId});
        return await i.editReply({content:'Announcement posted.',allowedMentions:{parse:[]}});
      }
      const n=store.transact(i.guildId,current=>store.amend(current,i.member,i.user.id,id,sub,i.options.getString('note'),i.options.getString('reason')));
      require('../utils/audit').record(i,`commendation.${sub}`,id,{reason:i.options.getString('note')});
      const synced=await refreshAnnouncement(i,n);
      return await i.editReply({content:`Award ${sub==='revoke'?'revoked':'corrected'}.${synced?'':' The saved announcement could not be updated; please check that message manually.'}`,...panel.detail({nominations:{[id]:n}},i,id)});
    }catch(error){const payload={content:error.message,allowedMentions:{parse:[]}};return i.deferred?i.editReply(payload):i.reply({...payload,ephemeral:true});}
  },
};
