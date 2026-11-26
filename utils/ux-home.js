const {randomUUID} = require('node:crypto');
const {EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,ModalBuilder,TextInputBuilder,TextInputStyle} = require('discord.js');
const release = require('./ux-release');
const c = require('./community');
const access = require('./logistics-access');
const ranks = require('./ranks');
const {readData} = require('./member-data');
const sessions = new Map();
const TTL = 14 * 60000;
const row = (...items) => new ActionRowBuilder().addComponents(...items);
const button = (id,label,primary=false) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(primary?ButtonStyle.Primary:ButtonStyle.Secondary);
const link = (label,url) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url);
const view = (title,text,components=[]) => ({embeds:[new EmbedBuilder().setColor(0x8b2525).setTitle(title).setDescription(text.slice(0,4000))],components});
const interests = ['Logistics','Facility','Army','Navy','Air','Undecided'];
function held(i,feature) { const h=require('./maintenance').active(i.guildId,feature);if(h)throw Error(h.reason); }
function canUse(i,s) { return s.preview?ranks.isCommander(i.member):release.enabled(i.guildId); }
function routeKey(r) { return JSON.stringify(r); }
function move(s,r) { if(routeKey(r)!==routeKey(s.current)){s.history.push(s.current);s.history=s.history.slice(-20);s.current=r;} }
function nativeFeature(id) {
  if (/^ord_/.test(id)) return 'order';
  if (/^sp_/.test(id)) return 'stockpile';
  if (/^mf_/.test(id)) return 'manifest';
  if (/^sq_/.test(id)) return 'squad';
  if (/^cm_/.test(id)) return 'commendation';
  if (/^aq_/.test(id)) return 'approvals';
  if (/^nav_/.test(id)) return 'help';
  if (/^cx_(feedback|notifications|absence):/.test(id)) return id.split(':')[0].slice(3);
  throw Error('Open this action from its original panel.');
}
function inferRoute(payload) {
  const controls=(payload.components||[]).flatMap(r=>(r.toJSON?r.toJSON():r).components);
  const refresh=controls.find(x=>/refresh/i.test(x.label||'')&&/^(ord_(view|list):|sp_(view|list):|mf_(view|list):|sq_refresh:|cm_(view|list):|aq_refresh:|cx_(feedback|notifications|absence):)/.test(x.custom_id||''));
  return refresh?{native:refresh.custom_id}:null;
}
function token(s,action) {
  const id=(++s.sequence).toString(36);s.actions.set(id,action);
  while(s.actions.size>250)s.actions.delete(s.actions.keys().next().value);
  return `ux:${s.id}:${id}`;
}
function decorate(s,payload) {
  const p=typeof payload==='string'?{content:payload}:{...payload};
  delete p.ephemeral;delete p.flags;
  const rows=(p.components||[]).map(r=>r.toJSON?r.toJSON():structuredClone(r));
  // Single-page lists do not need disabled Previous/Next controls.
  const paging=rows.flatMap(r=>r.components).filter(x=>['Previous','Next'].includes(x.label));
  const single=paging.length===2&&paging.every(x=>x.disabled);
  for(const r of rows) {
    if(single)r.components=r.components.filter(x=>!['Previous','Next'].includes(x.label));
    for(const item of r.components) {
      if(!item.custom_id)continue;
      const id=item.custom_id;
      item.custom_id=token(s,id.startsWith('home:')?{home:id.slice(5)}:{native:id});
    }
  }
  const components=rows.filter(r=>r.components.length);
  components.push(row(button(token(s,{back:true}),'Back').setDisabled(!s.history.length),button(token(s,{home:'home'}),'Home'),button(token(s,{refresh:true}),'Refresh')));
  if(components.length>5)throw Error('This view has too many controls. Open its original panel.');
  return {content:null,embeds:[],...p,components,allowedMentions:{parse:[]}};
}
async function events(i,trainingOnly=false) {
  const result=[];
  for(const name of trainingOnly?['trainings']:['operations','trainings']) {
    if(require('./maintenance').active(i.guildId,name==='operations'?'operation':'training'))continue;
    for(const [id,e]of Object.entries(readData(name).guilds?.[i.guildId]||{})) {
      if(!(e.time>Date.now()||e.type==='qualification-board'))continue;
      if(await require('./qualifications').canSee(i.member,e.channelId))result.push({...e,id,kind:name});
    }
  }
  return result.sort((a,b)=>(a.time||Infinity)-(b.time||Infinity)||a.id.localeCompare(b.id));
}
function paged(title,entries,page,route,empty) {
  const count=Math.max(1,Math.ceil(entries.length/5));page=Math.max(1,Math.min(count,Number(page)||1));
  const shown=entries.slice((page-1)*5,page*5);
  const p=view(title,shown.map(e=>e.text).join('\n\n')||empty);
  if(shown.length)p.components.push(row(new StringSelectMenuBuilder().setCustomId(`home:choose:${route}`).setPlaceholder('Choose an entry').addOptions(shown.map(e=>({label:e.label.slice(0,100),value:e.value})))));
  if(count>1)p.components.push(row(button(`home:${route}:${page-1}`,'Previous').setDisabled(page===1),button(`home:${route}:${page+1}`,'Next').setDisabled(page===count)));
  p.embeds[0].setFooter({text:`Page ${page}/${count}`});return p;
}
async function render(i,s,r=s.current) {
  if(r.native){await delegate(i,s,r.native);return null;}
  const [tab,arg]=String(r.home||'home').split(':');
  const verified=access.memberAccess(i.member), own=c.state(i.guildId).onboarding?.[i.user.id]||{};
  if(!verified&&!['home','onboarding','help'].includes(tab))throw Error('Complete verification before joining regiment activities.');
  if(tab==='home') {
    const upcoming=verified?(await events(i)).filter(e=>e.attendees?.accepted?.some(m=>m.id===i.user.id)):[];
    const all=verified?Object.values(readData('logistics-inventory').guilds?.[i.guildId]?.orders||{}):[];
    const mine=all.filter(o=>o.workerId===i.user.id&&!['delivered','cancelled','completed_with_losses'].includes(o.status)&&access.canViewOrder(i.member,o,readData('logistics-inventory').guilds[i.guildId]));
    const next=upcoming[0];
    return view('HUSS • Home',`${s.preview?'**Commander preview • Actions use real server data. Member rollout is controlled separately.**\n\n':''}${verified?`**Your next operation / training**\n${next?`${next.title} • <t:${Math.floor(next.time/1000)}:R>`:'No signup yet. Find an activity below.'}\n\n**Your active orders:** ${require('./maintenance').active(i.guildId,'order')?'Temporarily unavailable':mine.length}`:'Welcome! Start with your membership checklist.'}`,[
      row(button('home:onboarding','My checklist',!verified),button('home:events','Join activities',verified),button('home:logistics','Logistics')),
      row(button('home:squads','Squads'),button('home:requests','My requests'),button('home:help','Help & settings')),
      ...(ranks.isOfficer(i.member)?[row(button('home:staff','Officer tools'))]:[])]);
  }
  if(tab==='logistics')return view('Logistics','Choose work, find supplies or join a shipment.',[row(button('ord_list:mine:1','My orders'),button('ord_list:active:1','Available orders',true)),row(button('sp_list:1','Stockpiles'),button('mf_list:active:1','Shipments'))]);
  if(tab==='squads') {
    held(i,'squad');const store=require('./squad-store');
    const entries=Object.values(store.read().guilds[i.guildId]?.squads||{}).filter(x=>store.visible(i.member,x)&&x.status==='approved'&&(x.recruiting||x.members.includes(i.user.id)||x.invites[i.user.id]));
    const score=x=>[x.department,x.branch].includes(own.interest?.toLowerCase())?1:0;
    entries.sort((a,b)=>score(b)-score(a)||a.name.localeCompare(b.name));
    return paged('Find your squad',entries.map(x=>({label:x.name,value:x.id,text:`**${x.name}** • ${x.department}${score(x)?' • Matches your interest':''}\n${x.goal.text.slice(0,220)}\n${x.members.includes(i.user.id)?'Your squad':x.requests[i.user.id]?'Request pending':x.invites[i.user.id]?'Invitation waiting':'Recruiting'}`})),arg,'squads','No recruiting squads available. Check back later or ask an officer.');
  }
  if(tab==='events'||tab==='training') {
    if(tab==='training')held(i,'training');
    const list=await events(i,tab==='training');
    return paged(tab==='training'?'Training':'Upcoming activities',list.map(e=>({label:e.title||'Training applications',value:`${e.kind}/${e.id}`,text:`**${e.title||'Training applications'}**\n${e.time?`<t:${Math.floor(e.time/1000)}:F>`:'Applications open'} • ${e.kind==='operations'?'Operation':'Training'}`})),arg,tab,'No upcoming activities available. Check back later; your existing signups are unchanged.');
  }
  if(tab==='event') {
    const [kind,id]=arg.split('/');const e=(await events(i)).find(x=>x.kind===kind&&x.id===id);if(!e)throw Error('This activity is no longer available. Refresh the list.');
    return view(e.title||'Training applications',`${e.description?.slice(0,1800)||'Open the activity panel to sign up.'}\n\n${e.time?`Starts <t:${Math.floor(e.time/1000)}:F>`:'Training applications'}\nSigning up records your intention to attend.`,[row(link('Open signup',`https://discord.com/channels/${i.guildId}/${e.channelId}/${e.id}`))]);
  }
  if(tab==='onboarding') {
    held(i,'onboarding');const store=require('./squad-store');
    const joined=verified&&Object.values(store.read().guilds[i.guildId]?.squads||{}).some(x=>store.visible(i.member,x)&&x.members.includes(i.user.id));
    const trained=verified&&require('./qualifications').list(i.member).length>0;
    const signed=verified&&Object.values(readData('operations').guilds?.[i.guildId]||{}).some(x=>x.attendees?.accepted?.some(m=>m.id===i.user.id));
    const steps=[['verification','Verification',verified],['interest','Choose interests',!!own.interest],['squad','Find a squad',joined],['training','Training qualification',trained],['operation','First operation signup',signed]];
    const next=steps.find(([key,,done])=>!done&&!own.skips?.includes(key));
    const controls=[row(new StringSelectMenuBuilder().setCustomId('home:interest').setPlaceholder('Choose your interest').addOptions(interests.map(x=>({label:x,value:x,default:own.interest===x}))))];
    if(verified)controls.push(row(button('home:squads','Find a squad'),button('home:training','Find training'),button('home:events','Find an operation')));
    else { const channel=require('./config').getConfig(i.guildId,'VERIFICATION_CHANNEL_ID');if(channel)controls.push(row(link('Open verification',`https://discord.com/channels/${i.guildId}/${channel}`))); }
    controls.push(row(new StringSelectMenuBuilder().setCustomId('home:skip').setPlaceholder('Optional steps').addOptions(['squad','training','operation'].map(x=>({label:`Skip ${x}`,value:x})).concat([{label:'Restore skipped steps',value:'reset'}]))));
    return view('Your HUSS checklist',`**${next?'Next: '+next[1]:'Checklist complete'}**\n\n${steps.map(([key,label,done])=>`${done?'✅':own.skips?.includes(key)?'⏭️':'⬜'} ${label}`).join('\n')}\n\nA trainer must assess qualifications. A signup is not proof of attendance.`,controls);
  }
  if(tab==='help')return view('Help & settings','Choose what you need. Personal updates stay private.',[row(button('home:onboarding','Membership checklist'),button('home:settings','Reminders'),button('home:absence','Absence')),row(button('cx_feedback:new','Report a problem'),button('home:reports','My reports'),button('nav_start','Command guide'))]);
  if(tab==='settings') {
    const n=require('./member-notifications');const controls=[];
    for(const key of Object.keys(n.defaults)) {
      if(key!=='operations'&&require('./maintenance').active(i.guildId,'notifications'))continue;
      controls.push(row(new StringSelectMenuBuilder().setCustomId(`home:notify:${key}`).setPlaceholder(`${key}: ${n.mode(i.guildId,i.user.id,key)}`).addOptions([{label:'Off',value:'off'},{label:'Direct message',value:'dm'},{label:key==='operations'||key==='training'?'Event channel':'Private inbox',value:'channel'}].map(x=>({...x,default:x.value===n.mode(i.guildId,i.user.id,key)})))));
    }
    return view('Reminder preferences','Choose delivery for each category. Report and review updates sent to “Private inbox” are never posted publicly.',controls);
  }
  if(tab==='absence') {
    held(i,'absence');const a=c.absence(i.guildId).find(([id])=>id===i.user.id)?.[1];
    return view('Temporary absence',a?`Expected return: <t:${Math.floor(a.until/1000)}:D>\n${a.note||''}\nYou must still respond to activity checks.`:'No absence recorded. Let officers know when you expect to return.',[row(button('home:absence-form','Set return date',true),...(a?[button('home:absence-clear','Clear absence')]:[]))]);
  }
  if(tab==='reports') {
    held(i,'feedback');const entries=Object.values(c.state(i.guildId).feedback||{}).filter(x=>x.userId===i.user.id).sort((a,b)=>b.createdAt-a.createdAt);
    const p=paged('My reports',entries.map(x=>({label:x.title,value:x.id,text:`**${x.title}** • ${x.status}\n${x.history.at(-1)?.note||'Waiting for an officer update.'}`})),arg,'reports','No reports yet. Submit a problem or suggestion below.');p.components.push(row(button('cx_feedback:new','Submit report')));return p;
  }
  if(tab==='report') {
    held(i,'feedback');const x=c.state(i.guildId).feedback?.[arg];if(!x||x.userId!==i.user.id)throw Error('Report not available.');
    return view(x.title,`**${x.status}**\n${x.details}\n\n**Latest update**\n${x.history.at(-1)?.note||'No update yet.'}`);
  }
  if(tab==='requests')return view('My requests','Open a request to see its status and available actions.',[row(button('home:squads','Squad invitations & requests'),button('cm_list:mine:1','My nominations'),button('home:reports','My reports'))]);
  if(tab==='staff') { if(!ranks.isOfficer(i.member))throw Error('Officer access required.');return view('Officer tools','Review pending requests or open the officer command guide.',[row(button('aq_refresh:1','Approval queue',true),button('cx_feedback:queue:1','Feedback queue'),button('nav_staff','Officer guide'))]); }
  throw Error('Unknown page. Return Home.');
}
async function send(i,s,payload) {
  const input=s.orderInput;s.orderInput=null;
  if(input && !payload.embeds?.length) {
    s.retryOrder=input;
    payload={...payload,components:[row(button('home:retry-order','Review saved form'))]};
  }
  if(input && payload.embeds?.length) {
    const [,id,action]=input.custom_id.split(':');
    const o=require('./logistics-store').read().guilds[i.guildId]?.orders?.[id];
    if(o)payload={...payload,content:`${action==='cancel'?'Order cancelled':`${input.quantity} ${o.unit.replaceAll('_',' ')} recorded: ${action}`} • ${o.delivered}/${o.quantity} delivered • ${o.transit} in transit.`};
    s.retryOrder=null;
  }
  const next=inferRoute(payload);if(next)move(s,next);
  const result=decorate(s,payload);
  if(i.deferred||i.replied)return i.editReply(result);
  if(i.message?.flags?.has(64)&&!i.isModalSubmit?.())return i.update(result);
  if(i.isModalSubmit?.()&&i.message?.flags?.has(64))return i.update(result);
  return i.reply({...result,ephemeral:true});
}
async function delegate(i,s,id) {
  const feature=nativeFeature(id);held(i,feature);
  if(feature!=='help')c.member(i);
  s.orderInput=id.startsWith('ord_update:')?{custom_id:id,quantity:id.split(':')[2]==='cancel'?'':i.fields.getTextInputValue('quantity'),note:i.fields.getTextInputValue('note')}:null;
  const proxy=new Proxy(i,{get(target,key){
    if(key==='customId')return id;
    if(key==='deferReply'||key==='deferUpdate')return async()=>{if(!i.deferred&&!i.replied){if(i.message?.flags?.has(64))await i.deferUpdate();else await i.deferReply({ephemeral:true});}};
    if(['reply','update','editReply'].includes(key))return p=>send(i,s,p);
    if(key==='showModal')return async modal=>{
      const form=modal.toJSON();s.form=structuredClone(form);form.custom_id=token(s,{native:form.custom_id});return i.showModal(new ModalBuilder(form));
    };
    const v=target[key];return typeof v==='function'?v.bind(target):v;
  }});
  if(feature==='order')return require('./order-panel')[id.startsWith('ord_update:')?'handleModal':i.isStringSelectMenu?.()?'handleSelect':'handleButton'](proxy);
  if(feature==='stockpile')return require('./stockpile-panel')[i.isModalSubmit?.()?'handleModal':i.isStringSelectMenu?.()?'handleSelect':'handleButton'](proxy);
  if(feature==='manifest')return require('./manifest-panel').handle(proxy);
  if(feature==='commendation')return require('../features/commendation')[i.isModalSubmit?.()?'handleModal':i.isStringSelectMenu?.()?'handleSelect':'handleButton'](proxy);
  return require('../features/'+feature).handle(proxy);
}
async function open(i,home='home',preview=false) {
  if(!i.deferred&&!i.replied)await i.deferReply({ephemeral:true});
  i.member=await i.guild.members.fetch({user:i.user.id,force:true});
  const s={id:randomUUID().slice(0,12),owner:i.user.id,guildId:i.guildId,preview,expires:Date.now()+TTL,sequence:0,actions:new Map(),history:[],current:{home}};
  if(!canUse(i,s))return i.editReply('The new HUSS UX is locked until the War 144 Commander release.');
  held(i,'hub');
  for(const [id,x]of sessions)if(x.expires<=Date.now())sessions.delete(id);
  if(sessions.size>=500)sessions.delete(sessions.keys().next().value);
  sessions.set(s.id,s);
  const p=await render(i,s);if(p)return send(i,s,p);
}
async function handle(i) {
  try {
    const [,sessionId,actionId]=i.customId.split(':'),s=sessions.get(sessionId);
    if(!s||s.expires<=Date.now())throw Error('This private view expired. Reopen /hub to continue.');
    if(s.owner!==i.user.id||s.guildId!==i.guildId)throw Error('Open your own dashboard with /hub.');
    i.member=await i.guild.members.fetch({user:i.user.id,force:true});
    if(!canUse(i,s))throw Error('The War 144 UX is currently locked.');
    held(i,'hub');
    const a=s.actions.get(actionId);if(!a)throw Error('This control expired. Reopen /hub.');
    if(s.busy)throw Error('Your previous action is still running. Please try again shortly.');
    s.busy=true;
    try {
      if(a.native)return await delegate(i,s,a.native);
      let home=a.home;
      if(home?.startsWith('choose:')) {
        const kind=home.split(':')[1],value=i.values[0];
        if(kind==='squads')return await delegate(i,s,`sq_info:${value}:0`);
        home=kind==='reports'?`report:${value}`:`event:${value}`;
      }
      if(home==='interest'||home==='skip') {
        held(i,'onboarding');const value=i.values[0];
        if(home==='interest'&&!interests.includes(value)||home==='skip'&&!['squad','training','operation','reset'].includes(value))throw Error('Invalid checklist choice.');
        c.transact(i.guildId,g=>{g.onboarding||={};const o=g.onboarding[i.user.id]||={};if(home==='interest')o.interest=value;else if(value==='reset')o.skips=[];else o.skips=[...new Set([...(o.skips||[]),value])];});home='onboarding';
      }
      if(home?.startsWith('notify:')) {c.member(i);const key=home.split(':')[1];held(i,key==='operations'?'hub':'notifications');require('./member-notifications').set(i.guildId,i.user.id,key,i.values[0]);home='settings';}
      if(home==='retry-order') {
        c.member(i);held(i,'order');const saved=s.retryOrder;
        if(!saved)throw Error('No saved form. Reopen the order.');
        const [,id,action]=saved.custom_id.split(':');
        const g=require('./logistics-store').read().guilds[i.guildId],o=g?.orders?.[id];
        if(!o||!access.canViewOrder(i.member,o,g)||(!access.manager(i.member)&&o.workerId!==i.user.id))throw Error('This order is no longer available for you to update.');
        if(['delivered','cancelled','completed_with_losses'].includes(o.status))throw Error('This order is already closed. Open the current order.');
        const form=new ModalBuilder().setCustomId(token(s,{native:`ord_update:${id}:${action}:${o.updates.length}`})).setTitle('Review saved order update');
        if(action!=='cancel')form.addComponents(row(new TextInputBuilder().setCustomId('quantity').setLabel(`Quantity (${o.unit.replaceAll('_',' ')})`).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(7).setValue(saved.quantity)));
        const note=new TextInputBuilder().setCustomId('note').setLabel('Review note / confirmation').setStyle(TextInputStyle.Paragraph).setRequired(['cancel','deliver','loss'].includes(action)).setMaxLength(500);if(saved.note)note.setValue(saved.note);
        form.addComponents(row(note));s.orderInput=null;
        return await i.showModal(form);
      }
      if(home==='absence-form') {
        c.member(i);held(i,'absence');
        return await i.showModal(new ModalBuilder().setCustomId(token(s,{home:'absence-save'})).setTitle('Temporary absence').addComponents(row(new TextInputBuilder().setCustomId('date').setLabel('Return date: YYYY-MM-DD (Brussels)').setStyle(TextInputStyle.Short).setRequired(true)),row(new TextInputBuilder().setCustomId('note').setLabel('Note for officers (optional)').setStyle(TextInputStyle.Paragraph).setMaxLength(300).setRequired(false))));
      }
      if(home==='absence-save'||home==='absence-clear') {
        c.member(i);held(i,'absence');
        if(home==='absence-save'){const until=require('../features/absence').returnTime(i.fields.getTextInputValue('date'));c.transact(i.guildId,g=>{g.absences||={};g.absences[i.user.id]={since:Date.now(),until,note:i.fields.getTextInputValue('note')};});}
        else c.transact(i.guildId,g=>{if(g.absences?.[i.user.id])g.absences[i.user.id].clearedAt=Date.now();});
        home='absence';
      }
      if(a.back)s.current=s.history.pop()||{home:'home'};else if(home)move(s,{home});
      if(!i.deferred&&!i.replied){if(i.message?.flags?.has(64))await i.deferUpdate();else await i.deferReply({ephemeral:true});}
      const p=await render(i,s);if(p)return await send(i,s,p);
    } finally {s.busy=false;}
  } catch(e) {
    const p={content:e.message||'Could not open this view. Reopen /hub.',ephemeral:true,allowedMentions:{parse:[]}};
    return i.deferred||i.replied?i.followUp(p):i.reply(p);
  }
}
module.exports={open,handle,events,decorate,nativeFeature,inferRoute,render,canUse};
