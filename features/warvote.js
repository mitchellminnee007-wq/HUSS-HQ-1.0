const {SlashCommandBuilder,EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,ModalBuilder,TextInputBuilder,TextInputStyle,PermissionFlagsBits:P}=require('discord.js');
const store=require('../utils/war-vote'),c=require('../utils/community');
const safe={allowedMentions:{parse:[]}},names={goal:'War goal',deployment:'Deployment',custom:'Member consultation'};
const data=new SlashCommandBuilder().setName('warvote').setDescription('Next-war planning and member voting').setDMPermission(false);
for(const [name,description]of [['panel','Officers: post the permanent War Planning panel'],['create','Officers: guided setup with templates and a private preview'],['status','Open War Planning and your current ballot'],['history','Browse past votes and Commander decisions'],['close','Officers: preview closing the latest vote']])data.addSubcommand(s=>s.setName(name).setDescription(description));
const row=(...items)=>new ActionRowBuilder().addComponents(...items);
const button=(action,id,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`cx_warvote:${action}:${id||'-'}`).setLabel(label).setStyle(style);
const all=id=>Object.values(store.read().guilds[id]?.polls||{}).sort((a,b)=>b.createdAt-a.createdAt);
const latest=id=>all(id).find(p=>['open','closed'].includes(p.status));
const mark=p=>{p.needsRefresh=true;p.revision=(p.revision||0)+1;};
const publishing=new Set(),refreshing=new Set();
function shared(){return {...safe,embeds:[new EmbedBuilder().setTitle('HUSS • War Planning').setColor(0x8b2525).setDescription('**Help choose our next war.**\n\n1. Choose our main goal.\n2. Compare deployment options.\n3. Review the Commander’s final decision.\n\nOpen your ballot to vote, change your choice or withdraw. One vote per verified member. Individual choices are not shown publicly.')],components:[row(button('current',null,'Open current vote',ButtonStyle.Success),button('history',null,'Past votes'),button('setup',null,'Officer setup'))]};}
function setup(){return {...safe,embeds:[new EmbedBuilder().setColor(0x8b2525).setTitle('Create a member vote').setDescription('Choose a template, complete the form, then review your private draft. Nothing is posted until you press **Publish vote**.\n\n**War goal:** what HUSS should focus on.\n**Deployment:** where to operate, after checking the next-war map.\n**Custom:** your own planning question.')],components:[row(button('new','goal','War goal',ButtonStyle.Primary),button('new','deployment','Deployment'),button('new','custom','Custom vote')),row(button('drafts',null,'My drafts'))]};}
function payload(p,{draft=false}={}){
 const counts=store.counts(p),total=Object.keys(p.votes).length,opened=store.open(p),best=Math.max(...counts),leaders=counts.flatMap((n,i)=>n===best?[i+1]:[]);
 const state=draft?'DRAFT':p.decision?'DECISION RECORDED':opened?'VOTING OPEN':'VOTING CLOSED';
 const lines=p.options.map((o,i)=>{const percent=total?Math.round(counts[i]/total*100):0;return `**${i+1}. ${o}**${draft?'':`\n${'▰'.repeat(Math.round(percent/10))}${'▱'.repeat(10-Math.round(percent/10))} ${percent}% · ${counts[i]} vote(s)`}`;});
 const embed=new EmbedBuilder().setTitle(p.title).setColor(p.decision?0x2ecc71:opened?0xD4AF37:0x8b2525).setDescription(`**${names[p.kind]||'Member vote'} · ${state}**\n${p.context?`\n${p.context}\n`:''}\n${lines.join('\n\n')}`);
 if(draft)embed.addFields({name:'Publication',value:`Voting lasts **${p.hours} hours from publication**.\nDestination: <#${p.channelId}>\nResults are visible; individual ballots are not shown publicly.`});
 else{
  embed.addFields({name:'Participation',value:`**${total}** member(s) voted`,inline:true},{name:opened?'Time remaining':'Voting closed',value:`<t:${Math.floor((p.closedAt||p.closesAt)/1000)}:R>\n<t:${Math.floor((p.closedAt||p.closesAt)/1000)}:F>`,inline:true});
  if(!opened)embed.addFields({name:'Member recommendation',value:!total?'No votes were cast.':leaders.length>1?`Tie: options ${leaders.join(', ')}. No automatic winner.`:`Option ${leaders[0]} received the most votes.`});
  if(p.decision)embed.addFields({name:'Commander decision',value:`**${p.options[p.decision.choice]}**\nRecorded by <@${p.decision.userId}>`},{name:'Decision explanation',value:p.decision.note});
 }
 embed.setFooter({text:`HUSS vote ${p.id} • Advisory until Commander decision • Totals refresh within a minute`});
 return {...safe,embeds:[embed],components:draft?[row(button('publish',`${p.id}:${p.revision}`,'Publish vote',ButtonStyle.Success),button('edit',p.id,'Edit draft'),button('discard',p.id,'Discard draft',ButtonStyle.Danger))]:[row(button('ballot',p.id,opened?'Vote / change vote':'Voting closed',ButtonStyle.Success).setDisabled(!opened),button('refresh',p.id,'Refresh results'),button('history',null,'Past votes'),button('manage',p.id,'Officer controls'))]};
}
function ballot(p,userId){const choice=p.votes[userId];return {...payload(p),content:choice===undefined?'You have not voted yet. Choose one option below.':`Your current choice: **${p.options[choice]}**. Selecting another option replaces it.`,components:[row(new StringSelectMenuBuilder().setCustomId(`cx_warvote:cast:${p.id}`).setPlaceholder('Choose your preferred option').addOptions(p.options.map((o,i)=>({label:`${i+1}. ${o}`.slice(0,100),value:String(i),default:choice===i})))),row(button('withdraw',p.id,'Withdraw my vote',ButtonStyle.Danger),button('view',p.id,'Back to results'))]};}
function modal(kind,p){
 const presets={goal:['What should HUSS focus on next war?','Combined Arms Frontline\nNaval Task Force\nLogistics Backbone\nDefensive Stronghold\nTraining & Recruitment'],deployment:['Where should HUSS deploy next war?','The Heartlands / The Blemish\nTerminus / Therizo\nWestgate'],custom:['','']};
 const fields=[['title','Question',180,p?.title||presets[kind][0]],['choices','Choices: one per line (2–5)',1004,p?.options.join('\n')||presets[kind][1]],['context','Context / trade-offs (optional)',1000,p?.context||(kind==='deployment'?'Candidates only: check next-war ownership, industry, routes and allied plans.':'')],['hours','Voting duration in hours (1–336)',3,String(p?.hours||72)]];
 return new ModalBuilder().setCustomId(`cx_warvote:save:${kind}:${p?.id||'-'}:${p?.revision||0}`).setTitle(p?'Edit vote draft':'New '+names[kind]).addComponents(...fields.map(([id,label,max,value])=>{const f=new TextInputBuilder().setCustomId(id).setLabel(label).setMaxLength(max).setRequired(id!=='context').setStyle(['choices','context'].includes(id)?TextInputStyle.Paragraph:TextInputStyle.Short);if(value)f.setValue(value);return row(f);}));
}
async function accessible(i,p){
 if(['draft','publishing','discarded'].includes(p.status)&&(p.createdBy!==i.user.id||!require('../utils/ranks').isOfficer(i.member)))throw Error('This private draft belongs to another officer.');
 if(p.channelId&&!await require('../utils/qualifications').canSee(i.member,p.channelId))throw Error('You cannot access this vote channel.');
}
async function refresh(guild,p){
 if(!p.channelId||!p.messageId)return;
 const key=`${guild.id}:${p.id}`;if(refreshing.has(key))return;refreshing.add(key);
 try{
 const channel=await guild.channels.fetch(p.channelId),message=await channel.messages.fetch(p.messageId);
 await message.edit(payload(p));
 store.transact(guild.id,g=>{const current=store.get(g,p.id);if(current.revision===p.revision)current.needsRefresh=false;});
 }finally{refreshing.delete(key);}
}
async function history(i,drafts=false){
 const visible=[];for(const p of all(i.guildId)){if(drafts?!['draft','publishing'].includes(p.status)||p.createdBy!==i.user.id:!['open','closed'].includes(p.status))continue;try{await accessible(i,p);visible.push(p);}catch{}if(visible.length===25)break;}
 return {...safe,embeds:[new EmbedBuilder().setColor(0x8b2525).setTitle(drafts?'Your vote drafts':'Recent votes & decisions').setDescription(visible.length?'Choose a vote below. The latest 25 accessible entries are listed.':'No entries yet.')],components:[...(visible.length?[row(new StringSelectMenuBuilder().setCustomId('cx_warvote:pick:-').setPlaceholder('Choose a vote').addOptions(visible.map(p=>({label:p.title.slice(0,100),description:`${names[p.kind]||'Member vote'} • ${['draft','publishing'].includes(p.status)?p.status:p.decision?'Decision recorded':store.open(p)?'Open':'Closed'} • ${Object.keys(p.votes).length} votes`,value:p.id}))))]:[]),row(button('current',null,'Current vote'),button('setup',null,'Officer setup'))]};
}
async function act(i,action,id,extra=[]){
 c.member(i);
 if(action==='panel'){c.officer(i);await i.channel.send(shared());return {content:'War Planning panel posted. Members can use it for current and future votes.'};}
 if(action==='setup'||action==='create'){c.officer(i);return setup();}
 if(action==='history')return history(i);
 if(action==='drafts'){c.officer(i);return history(i,true);}
 if(action==='save'){
  c.officer(i);const [oldId,revision]=extra;
  const input={kind:id,title:i.fields.getTextInputValue('title'),options:i.fields.getTextInputValue('choices').split(/\r?\n/).map(s=>s.trim()).filter(Boolean),context:i.fields.getTextInputValue('context'),hours:Number(i.fields.getTextInputValue('hours'))};
  const p=store.transact(i.guildId,g=>{const old=oldId!=='-'?store.get(g,oldId):null;if(old&&(old.createdBy!==i.user.id||old.status!=='draft'||old.revision!==Number(revision)))throw Error('This draft changed. Reopen it before editing.');if(old)old.status='discarded';const next=store.draft(g,input,i.user.id);next.channelId=i.channelId;return next;});return payload(p,{draft:true});
 }
 if(action==='pick')id=i.values[0];
 const p=id&&id!=='-'?store.get(store.read().guilds[i.guildId]||{},id):latest(i.guildId);
 if(!p)return shared();await accessible(i,p);
 if(action==='publish'){
  c.officer(i);const channel=await i.guild.channels.fetch(p.channelId),me=i.guild.members.me||await i.guild.members.fetchMe();
  if(!channel?.isTextBased()||!channel.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks,P.ReadMessageHistory]))throw Error('The bot cannot publish in this channel. Check its permissions.');
  const reserved=store.transact(i.guildId,g=>store.reserve(g,p.id,i.user.id,Number(extra[0])));
  const key=`${i.guildId}:${p.id}`;publishing.add(key);
  try{const message=await channel.send({...payload({...reserved,status:'open'}),nonce:p.id,enforceNonce:true});store.transact(i.guildId,g=>{Object.assign(store.get(g,p.id),{status:'open',messageId:message.id});});require('../utils/audit').record(i,'warvote.publish',p.id,{});return {content:`Vote published: ${message.url}`};}
  catch(e){throw Error('Publication could not be confirmed. Check the destination, then use My drafts > Officer controls to close this attempt. It is locked to prevent duplicate posts.');}
  finally{publishing.delete(key);}
 }
 if(action==='discard'){c.officer(i);store.transact(i.guildId,g=>{const x=store.get(g,p.id);if(x.status!=='draft'||x.createdBy!==i.user.id)throw Error('Only your unpublished drafts can be discarded.');x.status='discarded';});return {content:'Draft discarded.'};}
 if(action==='ballot'){if(!store.open(p))throw Error('This vote is closed.');return ballot(p,i.user.id);}
 if(action==='cast'||/^\d$/.test(action)||action==='withdraw'){
  store.transact(i.guildId,g=>{const x=store.get(g,p.id);if(action==='withdraw')store.withdraw(x,i.user.id);else store.cast(x,i.user.id,Number(action==='cast'?i.values[0]:action));mark(x);});
  return ballot(store.get(store.read().guilds[i.guildId],p.id),i.user.id);
 }
 if(action==='manage'){c.officer(i);return {...payload(p),components:[row(button('close',p.id,'Close voting',ButtonStyle.Danger).setDisabled(!['open','publishing'].includes(p.status)),button('decision',p.id,'Record Commander decision').setDisabled(store.open(p)||Boolean(p.decision)||p.status==='publishing'),button('view',p.id,'Back'))]};}
 if(action==='close'){c.officer(i);return {...safe,content:`Close **${p.title}** now? Members will no longer be able to change their votes.`,components:[row(button('confirmclose',p.id,'Confirm close',ButtonStyle.Danger),button('view',p.id,'Keep current state'))]};}
 if(action==='confirmclose'){c.officer(i);if(publishing.has(`${i.guildId}:${p.id}`))throw Error('Publication is still in progress. Please try again shortly.');store.transact(i.guildId,g=>{const x=store.get(g,p.id);if(!['open','publishing','closed'].includes(x.status))throw Error('This vote cannot be closed.');x.status='closed';x.closedBy=i.user.id;x.closedAt=Date.now();mark(x);});require('../utils/audit').record(i,'warvote.close',p.id,{});}
 if(action==='decisionSave'){
  if(!require('../utils/squad-store').commander(i.member))throw Error('Commander role required.');
  store.transact(i.guildId,g=>{const x=store.get(g,p.id);store.decide(x,Number(i.fields.getTextInputValue('choice'))-1,i.fields.getTextInputValue('note'),i.user.id);mark(x);});require('../utils/audit').record(i,'warvote.decision',p.id,{});
 }
 const current=store.get(store.read().guilds[i.guildId],p.id);
 if(['refresh','confirmclose','decisionSave'].includes(action))await refresh(i.guild,current).catch(()=>{});
 return payload(current,{draft:current.status==='draft'});
}
async function handle(i){
 const[,action,id,...extra]=i.customId.split(':');
 if(action==='refresh'){
  await i.deferUpdate();
  try{
   i.member=await i.guild.members.fetch({user:i.user.id,force:true});c.member(i);
   const held=require('../utils/maintenance').active(i.guildId,'warvote');if(held)throw Error(held.reason);
   const p=store.get(store.read().guilds[i.guildId]||{},id);await accessible(i,p);
   if(!['open','closed'].includes(p.status))throw Error('This vote has not been published.');
   if(!i.message.flags?.has(64)&&(i.message.id!==p.messageId||i.channelId!==p.channelId))throw Error('Open the original vote message to refresh its results.');
   return await i.editReply({...payload(p),content:null});
  }catch(e){return i.followUp({...safe,content:e.message,ephemeral:true});}
 }
 if(['new','edit','decision'].includes(action)){
  try{
   i.member=await i.guild.members.fetch({user:i.user.id,force:true});c.member(i);c.officer(i);
   const held=require('../utils/maintenance').active(i.guildId,'warvote');if(held)return i.reply({...require('../utils/maintenance').notice(held),ephemeral:true});
   if(action==='new'){if(!names[id])throw Error('Unknown template.');return i.showModal(modal(id));}
   const p=store.get(store.read().guilds[i.guildId]||{},id);await accessible(i,p);
   if(action==='edit'){if(p.status!=='draft'||p.createdBy!==i.user.id)throw Error('Only your drafts can be edited.');return i.showModal(modal(p.kind,p));}
   if(!require('../utils/squad-store').commander(i.member))throw Error('Commander role required.');
   if(store.open(p)||p.decision||!['open','closed'].includes(p.status))throw Error('Close the vote first; a decision can only be recorded once.');
   return i.showModal(new ModalBuilder().setCustomId(`cx_warvote:decisionSave:${id}`).setTitle('Record final decision').addComponents(row(new TextInputBuilder().setCustomId('choice').setLabel('Chosen option number (1–5)').setRequired(true).setMaxLength(1).setStyle(TextInputStyle.Short)),row(new TextInputBuilder().setCustomId('note').setLabel('Explain the decision to members').setRequired(true).setMaxLength(1000).setStyle(TextInputStyle.Paragraph))));
  }catch(e){return i.reply({...safe,content:e.message,ephemeral:true});}
 }
 return c.run(i,x=>act(x,action,id,extra),'warvote');
}
const initialized=new WeakSet();let running=false;
function init(client){
 if(initialized.has(client))return;initialized.add(client);
 const tick=async()=>{if(running)return;running=true;try{for(const[guildId,g]of Object.entries(store.read().guilds))for(const p of Object.values(g.polls||{})){
  if(!['open','closed'].includes(p.status)||(!p.needsRefresh&&(p.status!=='open'||store.open(p))))continue;
  const guild=client.guilds.cache.get(guildId);if(!guild)continue;
  if(p.status==='open'&&!store.open(p))store.transact(guildId,state=>{const x=store.get(state,p.id);x.status='closed';mark(x);});
  try{await refresh(guild,store.get(store.read().guilds[guildId],p.id));}catch{console.warn('[War vote] Panel refresh pending.');}
 }}finally{running=false;}};
 const run=()=>tick().catch(()=>console.warn('[War vote] Deadline check failed'));
 if(client.isReady())run();else client.once('clientReady',run);setInterval(run,60000).unref();
}
module.exports={data,payload,shared,setup,modal,ballot,init,handle,execute:i=>c.run(i,x=>act(x,x.options.getSubcommand()),'warvote')};
