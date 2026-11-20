const {EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,ModalBuilder,TextInputBuilder,TextInputStyle}=require('discord.js');
const store=require('./commendations');
const emoji=require('./commendation-emoji');
const {isOfficer}=require('./ranks');
const {memberAccess}=require('./logistics-access');
const safe={allowedMentions:{parse:[]}};
const row=(...items)=>new ActionRowBuilder().addComponents(...items);
const button=(id,label)=>new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Secondary);
function data(i){if(!i.guildId||!memberAccess(i.member))throw new Error('Commendations are available to verified members.');return store.read().guilds[i.guildId]||{nominations:{}};}
function sharedBase(){return {...safe,embeds:[new EmbedBuilder().setTitle('🏅 HUSS • Hall of Honours').setColor(0xD4AF37).setDescription('Recognising service, teamwork and exceptional contributions.\n\nUse /commendation nominate to recognise a fellow member. Open the Hall to see approved awards, or My nominations to check requests for information.\n\nHUSS awards do not change ranks or Discord permissions.')],components:[row(button('cm_open:hall','Hall of Honours'),button('cm_open:mine','My nominations'),button('cm_open:review','Officer review'))]};}
function shared(){return require('./commendation-art').decorate(sharedBase(),true);}
function list(guild,i,mode='hall',page=1){
  if(!['hall','mine','review','history'].includes(mode))throw new Error('Unknown view.');
  if(['review','history'].includes(mode)&&!isOfficer(i.member))throw new Error('Only officers can access the review queue and decision history.');
  const all=Object.values(guild.nominations).filter(n=>mode==='hall'?n.status==='approved':mode==='mine'?n.nominatorId===i.user.id:mode==='review'?['pending','needs_info'].includes(n.status):!['pending','needs_info'].includes(n.status)).sort((a,b)=>mode==='review'?a.createdAt-b.createdAt:b.updatedAt-a.updatedAt);
  const pages=Math.max(1,Math.ceil(all.length/8));page=Math.max(1,Math.min(pages,Number(page)||1));const shown=all.slice((page-1)*8,page*8);
  const embed=new EmbedBuilder().setTitle(mode==='hall'?'🏅 Hall of Honours':mode==='mine'?'Your nominations':mode==='history'?'Commendation decision history':'Officer review queue').setColor(0xD4AF37).setDescription(shown.length?shown.map(n=>`${emoji.text(n.award,i.guildId)} **${store.AWARDS[n.award]}** — ${n.squadName?`**${n.squadName}** (${store.recipients(n).length} members)`:store.recipientLabel(n)}\n${n.war} • ${mode==='hall'?`Awarded <t:${Math.floor(n.approvedAt/1000)}:D>`:n.status.replaceAll('_',' ')}`).join('\n\n'):'No entries yet.').setFooter({text:`Page ${page}/${pages} • HUSS awards, not in-game commendations`});
  const components=[];if(shown.length)components.push(row(new StringSelectMenuBuilder().setCustomId(`cm_choose:${mode}`).setPlaceholder('Choose an entry').addOptions(shown.map(n=>({label:`${n.squadName||i.guild?.members.cache.get(n.recipientId)?.displayName||n.recipientId} • ${store.AWARDS[n.award]}`.slice(0,100),description:`${n.war} • ${n.status}`.slice(0,100),value:n.id,emoji:emoji.component(n.award,i.guildId)})))));
  components.push(row(button(`cm_list:${mode}:${page-1}`,'Previous').setDisabled(page<=1),button(`cm_list:${mode}:${page+1}`,'Next').setDisabled(page>=pages),button(`cm_list:${mode}:${page}`,'Refresh')));
  if(['review','history'].includes(mode))components.push(row(button(`cm_list:${mode==='review'?'history':'review'}:1`,mode==='review'?'Decision history':'Pending queue')));
  return require('./commendation-art').decorate({...safe,embeds:[embed],components});
}
function detail(guild,i,id){
  const n=store.get(guild,id),staff=isOfficer(i.member),owner=n.nominatorId===i.user.id;
  if(n.status!=='approved'&&!staff&&!owner)throw new Error('Nomination not accessible.');
  const embed=new EmbedBuilder().setTitle(store.AWARDS[n.award]).setColor(n.status==='revoked'?0xE74C3C:0xD4AF37).setDescription(`${emoji.text(n.award,i.guildId)} ${store.recipientLabel(n)}\n**${n.status.replaceAll('_',' ')} • ${n.war}**\n\n${n.reason}`).setTimestamp(n.approvedAt||n.createdAt);
  if(n.approvedBy)embed.addFields({name:'Approved by',value:(n.approvals?.length?n.approvals.map(a=>`<@${a.actorId}>`).join(', '):`<@${n.approvedBy}>`)});
  if(['pending','needs_info'].includes(n.status))embed.addFields({name:'Officer approvals',value:`${n.approvals?.length||0}/${store.requiredApprovals(n)} independent approvals`});
  if(staff&&n.status==='approved'&&n.autoAnnouncement&&!n.announcement)embed.addFields({name:'Automatic announcement',value:n.autoAnnouncement.lastError||'Queued for publication in the announcements channel.'});
  if(staff||owner){embed.addFields({name:'Nominated by',value:`<@${n.nominatorId}>`},{name:'Evidence (review only)',value:n.evidence||'None supplied'});if(n.question)embed.addFields({name:'Information requested',value:n.question});if(n.response)embed.addFields({name:'Nominator response',value:n.response});if(n.rejectionReason)embed.addFields({name:'Rejection reason',value:n.rejectionReason});if(n.revocationReason)embed.addFields({name:'Revocation reason',value:n.revocationReason});if(staff)embed.addFields({name:'Recent history',value:n.history.slice(-6).map(h=>`${h.action} • <@${h.actorId}> • <t:${Math.floor(h.at/1000)}:R>\n${h.note}`).join('\n').slice(0,1024)});}
  const components=[row(button(`cm_view:${id}`,'Refresh'),button('cm_list:hall:1','Hall'),button('cm_list:mine:1','My nominations'))];
  if(staff&&!owner&&!store.recipients(n).includes(i.user.id)&&['pending','needs_info'].includes(n.status))components.push(row(button(`cm_approve:${id}`,'Approve').setDisabled(n.status==='needs_info'||Boolean(n.approvals?.some(a=>a.actorId===i.user.id))),button(`cm_reject:${id}`,'Reject'),button(`cm_request:${id}`,'Request details')));
  if(owner&&n.status==='needs_info')components.push(row(button(`cm_respond:${id}`,'Provide information')));
  return require('./commendation-art').decorate({...safe,embeds:[embed],components},true,n.award);
}
async function handle(i){
  try{
    const guild=data(i),[action,id,value]=i.customId.split(':');
    if(action==='cm_roster')return await require('./commendation-extras').roster(i);
    if(action==='cm_summary'){
      const extras=require('./commendation-extras'),war=extras.summaryWar(i.guildId,id);
      if(!war)throw new Error('This war has no stored award entries. Use /commendation summary.');
      return await i.update(extras.summary(i.guildId,war,value));
    }
    if(action==='cm_open')return await i.reply({...list(guild,i,id),ephemeral:true});
    if(action==='cm_list')return await i.update(list(guild,i,id,value));
    if(action==='cm_choose')return await i.update(detail(guild,i,i.values[0]));
    if(action==='cm_view')return await i.update(detail(guild,i,id));
    const n=store.get(guild,id);
    if(['cm_reject','cm_request','cm_respond'].includes(action)){
      if(action==='cm_respond'){if(n.nominatorId!==i.user.id||n.status!=='needs_info')throw new Error('This nomination is not awaiting information from you.');}
      else {if(!isOfficer(i.member)||[n.nominatorId,...store.recipients(n)].includes(i.user.id))throw new Error('Another officer must review this nomination.');if(!['pending','needs_info'].includes(n.status))throw new Error('This nomination is already decided.');}
      return await i.showModal(new ModalBuilder().setCustomId(`cm_submit:${id}:${action.slice(3)}:${n.history.length}`).setTitle(action==='cm_respond'?'Provide information':action==='cm_reject'?'Reject nomination':'Request details').addComponents(row(new TextInputBuilder().setCustomId('note').setLabel(action==='cm_respond'?'Additional information':'Reason / question').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(action==='cm_respond'?1000:500))));
    }
    let verb=action==='cm_approve'?'approve':value;
    if(!['cm_approve','cm_submit'].includes(action))throw new Error('Unknown action.');
    const note=action==='cm_submit'?i.fields.getTextInputValue('note'):null;
    const payload=store.transact(i.guildId,current=>{
      if(action==='cm_submit'&&String(store.get(current,id).history.length)!==i.customId.split(':')[3])throw new Error('This nomination changed. Refresh and reopen the form.');
      if(verb==='respond')store.respond(current,i.user.id,id,note);else store.review(current,i.member,i.user.id,id,verb,note);
      return detail(current,i,id);
    });
    require('./audit').record(i,`commendation.${verb}`,id,{reason:note});
    if(action==='cm_approve'){
      await i.update(payload);
      const latest=store.get(store.read().guilds[i.guildId],id);
      if(latest.status==='approved'){
        try{await require('./commendation-announcer').publish(i.guild,id);await i.editReply(detail(store.read().guilds[i.guildId],i,id));}
        catch{await i.followUp({content:'Approval saved. The automatic announcement could not be completed yet. Refresh the nomination to check its publication status.',ephemeral:true,...safe});}
      }
      return;
    }
    return await i.reply({...payload,ephemeral:true});
  }catch(error){return i.deferred?i.editReply({content:error.message,...safe}):i.reply({content:error.message,ephemeral:true,...safe});}
}
module.exports={data,shared,list,detail,handle};
