const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const discord=require('discord.js');
function load(file,mocks={}) {
  const full=path.resolve(__dirname,'..',file),module={exports:{}};
  vm.runInNewContext(fs.readFileSync(full,'utf8'),{module,__dirname:path.dirname(full),console,Date,Map,Set,WeakSet,Proxy,structuredClone,setTimeout,setInterval,
    require:n=>n in mocks?mocks[n]:require(n.startsWith('.')?path.resolve(path.dirname(full),n):n)});
  return module.exports;
}
function memory(){const data={guilds:{}};return {read:()=>structuredClone(data),transact:(id,fn)=>fn(data.guilds[id]||={}),data};}
test('War 144 target is fixed, defaults locked and rejects early, ended, stale or failed tracking',()=>{
  const db=memory(),api=load('utils/ux-release.js',{'./atomic-json':()=>db});
  const war=n=>({current:{warNumber:n,warId:'able-'+n,conquestStartTime:100},lastPoll:Date.now()});
  assert.equal(api.enabled('g'),false);assert.equal(api.TARGET_WAR,144);
  for(const w of [war(142),war(143),{...war(144),lastPoll:1},{...war(144),error:'offline'},{...war(144),current:{...war(144).current,conquestEndTime:200}}])assert.throws(()=>api.release('g','cmd',w),/War 144/);
  api.release('g','cmd',war(144));assert.equal(api.enabled('g'),true);
  const restarted=load('utils/ux-release.js',{'./atomic-json':()=>db});assert.equal(restarted.enabled('g'),true);
  restarted.hold('g','cmd');assert.equal(api.enabled('g'),false);
});
test('shared panel registration is durable, excludes ephemeral messages and never renders admin data publicly',()=>{
  const db=memory(),api=load('utils/shared-panels.js',{'./atomic-json':()=>db,'./maintenance':{active:()=>null},'./admin-panel':{buildPage:()=>({content:'private'})}});
  api.register({id:'private',channelId:'c',flags:{has:()=>true}},'g','admin');assert.equal(db.data.guilds.g,undefined);
  api.register({id:'shared',channelId:'c'},'g','admin','review',2);
  assert.equal(db.data.guilds.g.panels.shared.offset,2);
  assert.equal(api.render({}, {id:'g',roles:{everyone:{}}},{permissionsFor:()=>({has:()=>true})},{kind:'admin'}),null);
  assert.equal(api.render({}, {id:'g',roles:{everyone:{}}},{permissionsFor:()=>({has:()=>false})},{kind:'admin'}).content,'private');
});
test('automatic shared refresh edits stored messages, skips unchanged content and removes deleted references',async()=>{
  const db=memory(),edits=[];let gone=false;
  const api=load('utils/shared-panels.js',{'./atomic-json':()=>db,'../features/botstatus':{payload:()=>({content:'status'})}});
  api.register({id:'m',channelId:'c'},'g','status');
  const channel={isTextBased:()=>true,messages:{fetch:async()=>{if(gone)throw {code:10008};return {author:{id:'bot'},edit:async p=>edits.push(p)};}}};
  const client={user:{id:'bot'},guilds:{cache:new Map([['g',{channels:{fetch:async()=>channel}}]])}};
  await api.sweep(client);await api.sweep(client);assert.equal(edits.length,1);
  gone=true;api.register({id:'m',channelId:'c'},'g','status');await api.sweep(client);assert.equal(db.data.guilds.g.panels.m,undefined);
});
test('admin fixed-panel navigation edits the original message and refuses a now-public channel',async()=>{
  const registrations=[],api=load('features/botpanel.js',{'../utils/ranks':{isOfficer:()=>true},'../utils/admin-panel':{buildPage:()=>({embeds:[]})},'../utils/shared-panels':{register:(...x)=>registrations.push(x)}});
  let edits=0,replies=0,defers=0,publicChannel=false;
  const i={customId:'bp_page:review:2',guild:{roles:{everyone:{}}},guildId:'g',member:{},message:{id:'m',flags:{has:()=>false}},channel:{permissionsFor:()=>({has:()=>publicChannel})},deferUpdate:async()=>defers++,editReply:async()=>edits++,reply:async()=>replies++};
  await api.handleButton(i);assert.equal(edits,1);assert.equal(defers,1);assert.equal(replies,0);assert.equal(registrations[0][3],'review');
  publicChannel=true;await api.handleButton(i);assert.equal(edits,1);assert.equal(replies,1);
});
test('published vote refresh updates in place and never opens a ballot or private duplicate',async()=>{
  const vote={id:'v',status:'open',messageId:'m',channelId:'c',title:'Goal',kind:'goal',options:['Army','Navy'],votes:{},closesAt:Date.now()+100000,createdBy:'officer'};
  const api=load('features/warvote.js',{'../utils/community':{member:()=>{}},'../utils/war-vote':{read:()=>({guilds:{g:{}}}),get:()=>vote,open:()=>true,counts:()=>[0,0]},'../utils/maintenance':{active:()=>null},'../utils/qualifications':{canSee:async()=>true}});
  let updates=0,errors=[];
  const i={customId:'cx_warvote:refresh:v',guildId:'g',channelId:'c',user:{id:'u'},guild:{members:{fetch:async()=>({})}},message:{id:'m',flags:{has:()=>false}},deferUpdate:async()=>{},editReply:async p=>{updates++;assert.match(JSON.stringify(p),/Goal/);},followUp:async p=>errors.push(p)};
  await api.handle(i);assert.equal(updates,1);assert.equal(errors.length,0);
  i.message.id='wrong';await api.handle(i);assert.equal(updates,1);assert.match(errors[0].content,/original vote/);
});
test('status panels register their shared message and refresh in place',async()=>{
  const registrations=[],api=load('features/botstatus.js',{'../utils/ranks':{isOfficer:()=>true},'../utils/tts-service':{status:()=>null},'../utils/maintenance':{states:()=>({}),active:()=>null},'../utils/health':{snapshot:()=>({})},'../utils/war-state':{read:()=>({guilds:{}})},'../utils/config':{getConfig:()=>null},'../utils/shared-panels':{register:(...x)=>registrations.push(x)}});
  const client={isReady:()=>true,ws:{ping:1},commands:{has:()=>true}},message={id:'m',channelId:'c',flags:{has:()=>false}};
  let reply,edits=0;await api.execute({client,guildId:'g',member:{},options:{getSubcommand:()=> 'panel'},reply:async p=>reply=p,fetchReply:async()=>message});
  assert.equal(reply.ephemeral,false);assert.equal(registrations[0][0].id,'m');
  await api.handleButton({client,guildId:'g',customId:'botstatus:refresh',message,deferUpdate:async()=>{},editReply:async()=>edits++});assert.equal(edits,1);assert.equal(registrations.length,2);
});
test('public squad refresh renders only approved squads in place; private details remain private',async()=>{
  const squads={a:{id:'a',status:'approved',name:'Approved',department:'army',members:[],leaderId:'leader',recruiting:true,goal:{text:'Goal',status:'Active'},requests:{},invites:{}},b:{id:'b',status:'pending',name:'SECRET',members:[],goal:{text:'Secret'}}};
  const api=load('features/squad.js',{'../utils/squad-store':{read:()=>({guilds:{g:{squads}}}),ensureMember:()=>{},visible:()=>true},'../utils/shared-panels':{register:()=>{}}});
  let payload,deferred='',replies=0;const guild={id:'g',members:{fetch:async()=>({guild})}};
  const i={customId:'sq_list:0',guildId:'g',guild,user:{id:'u'},message:{flags:{has:()=>false}},deferUpdate:async()=>deferred='update',deferReply:async()=>{replies++;},editReply:async p=>payload=p,followUp:async p=>{throw Error(p.content);}};
  await api.handle(i);assert.equal(deferred,'update');assert.equal(replies,0);assert.match(JSON.stringify(payload),/Approved/);assert.doesNotMatch(JSON.stringify(payload),/SECRET/);
});
function uxFixture() {
  let enabled=false,commander=false,paused=null;
  const community={guilds:{g:{}}},writes=[];
  const datasets={operations:{guilds:{g:{op:{title:'Later operation',channelId:'visible',time:Date.now()+900000,attendees:{accepted:[]}},hidden:{title:'SECRET',channelId:'hidden',time:Date.now()+1000}}}},trainings:{guilds:{g:{tr:{title:'Earlier training',channelId:'visible',time:Date.now()+600000}}}},'logistics-inventory':{guilds:{g:{orders:{}}}}};
  const api=load('utils/ux-home.js',{
    './ux-release':{enabled:()=>enabled},'./ranks':{isCommander:()=>commander,isOfficer:()=>commander},
    './community':{state:id=>community.guilds[id],member:i=>{if(!i.member.verified)throw Error('Member required');},transact:(id,fn)=>{writes.push(id);return fn(community.guilds[id]);}},
    './member-data':{readData:name=>datasets[name]||{}},'./maintenance':{active:()=>paused},
    './logistics-access':{memberAccess:m=>m.verified,canViewOrder:()=>true},
    './qualifications':{canSee:async(m,ch)=>ch==='visible',list:()=>[]},
    './squad-store':{read:()=>({guilds:{g:{squads:{}}}})},
    './config':{getConfig:()=>null},
    './order-panel':{handleButton:async i=>i.update({embeds:[new discord.EmbedBuilder().setTitle('Orders')],components:[new discord.ActionRowBuilder().addComponents(new discord.ButtonBuilder().setCustomId('ord_list:mine:2').setLabel('Refresh').setStyle(2))]})},
  });
  const member={verified:true},guild={id:'g',members:{fetch:async()=>member}};member.guild=guild;
  function interaction(extra={}){const result={};const i={guildId:'g',guild,member,user:{id:'u'},deferred:false,replied:false,...extra};
    i.deferReply=async()=>{result.deferReply=true;i.deferred=true;};i.deferUpdate=async()=>{result.deferUpdate=true;i.deferred=true;};
    i.reply=async p=>{result.reply=p;i.replied=true;};i.editReply=async p=>{result.edit=p;};i.update=async p=>{result.update=p;i.replied=true;};i.followUp=async p=>{result.follow=p;};return {i,result};}
  return {api,interaction,community,writes,setEnabled:v=>enabled=v,setCommander:v=>commander=v,setPaused:v=>paused=v};
}
function controls(p){return p.components.flatMap(r=>(r.toJSON?r.toJSON():r).components);}
test('UX entry stays locked for members, permits Commander private preview and rechecks on every click',async()=>{
  const f=uxFixture(),a=f.interaction();await f.api.open(a.i);assert.match(a.result.edit,/locked/);
  f.setCommander(true);const p=f.interaction();await f.api.open(p.i,'home',true);assert.match(JSON.stringify(p.result.edit),/Commander preview/);
  const id=controls(p.result.edit).find(x=>x.label==='Help & settings').custom_id;
  f.setCommander(false);const click=f.interaction({customId:id,message:{flags:{has:()=>true}}});await f.api.handle(click.i);assert.match(click.result.reply.content,/locked/);
});
test('private navigation updates the same message, keeps Back/Home, and protects session ownership',async()=>{
  const f=uxFixture();f.setEnabled(true);const a=f.interaction();await f.api.open(a.i);
  const id=controls(a.result.edit).find(x=>x.label==='Join activities').custom_id;
  const wrong=f.interaction({customId:id,user:{id:'other'},message:{flags:{has:()=>true}}});await f.api.handle(wrong.i);assert.match(wrong.result.reply.content,/own dashboard/);
  const click=f.interaction({customId:id,message:{flags:{has:()=>true}}});await f.api.handle(click.i);
  assert.ok(click.result.edit);assert.equal(click.result.deferUpdate,true);assert.equal(click.result.reply,undefined);
  const text=JSON.stringify(click.result.edit);assert.ok(text.indexOf('Earlier training')<text.indexOf('Later operation'));assert.doesNotMatch(text,/SECRET/);
  assert.ok(controls(click.result.edit).find(x=>x.label==='Back'&&!x.disabled));
  for(const x of controls(click.result.edit))if(x.custom_id)assert.ok(x.custom_id.startsWith('ux:'));
});
test('onboarding choices persist and maintenance blocks mutation',async()=>{
  const f=uxFixture();f.setEnabled(true);const a=f.interaction();await f.api.open(a.i,'onboarding');
  const id=controls(a.result.edit).find(x=>x.placeholder==='Choose your interest').custom_id;
  const click=f.interaction({customId:id,values:['Navy'],message:{flags:{has:()=>true}}});await f.api.handle(click.i);
  assert.equal(f.community.guilds.g.onboarding.u.interest,'Navy');
  f.setPaused({reason:'Maintenance'});const blocked=f.interaction({customId:id,values:['Army']});await f.api.handle(blocked.i);assert.equal(f.community.guilds.g.onboarding.u.interest,'Navy');assert.match(blocked.result.reply.content,/Maintenance/);
});
test('native order navigation does not double-reply and Back restores its parent',async()=>{
  const f=uxFixture();f.setEnabled(true);const a=f.interaction();await f.api.open(a.i,'logistics');
  const id=controls(a.result.edit).find(x=>x.label==='My orders').custom_id;
  const b=f.interaction({customId:id,message:{flags:{has:()=>true}}});await f.api.handle(b.i);assert.match(JSON.stringify(b.result.update),/Orders/);
  const back=controls(b.result.update).find(x=>x.label==='Back').custom_id;
  const d=f.interaction({customId:back,message:{flags:{has:()=>true}}});await f.api.handle(d.i);assert.match(JSON.stringify(d.result.edit),/Choose work/);assert.equal(d.result.follow,undefined);
});
test('release command and UX components serialize within Discord limits',()=>{
  assert.equal(require('../features/uxrelease').data.toJSON().name,'uxrelease');
  const f=uxFixture(),s={id:'test',actions:new Map(),sequence:0,history:[]};
  const p=f.api.decorate(s,{embeds:[],components:[new discord.ActionRowBuilder().addComponents(new discord.ButtonBuilder().setCustomId('ord_list:active:0').setLabel('Previous').setDisabled(true).setStyle(2),new discord.ButtonBuilder().setCustomId('ord_list:active:2').setLabel('Next').setDisabled(true).setStyle(2))]});
  assert.equal(controls(p).some(x=>x.label==='Previous'),false);assert.ok(p.components.length<=5);
});
