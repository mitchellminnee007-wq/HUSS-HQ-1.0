const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(){
  let now=1_000_000_000,failAPI=false,enabled=true,paused=false;
  class Clock extends Date {static now(){return now;}}
  const state={guilds:{}},sent=[],executions=[],changes=[];
  const db={read:()=>structuredClone(state),transact:(id,fn)=>fn(state.guilds[id]||={})};
  function load(file,mocks){const full=path.resolve(__dirname,'..',file),module={exports:{}};vm.runInNewContext(fs.readFileSync(full,'utf8'),{module,__dirname:path.dirname(full),Date:Clock,console,Set,WeakSet,AbortSignal,setInterval,fetch:async()=>{if(failAPI)throw Error('API unavailable');return {ok:true,json:async()=>structuredClone(api)};},require:n=>n in mocks?mocks[n]:require(n.startsWith('.')?path.resolve(path.dirname(full),n):n)});return module.exports;}
  const api={warId:'w142',warNumber:142,winner:'NONE',conquestStartTime:now-1000,conquestEndTime:null};
  const store=load('utils/war-state.js',{'./atomic-json':()=>db});
  const channel={isTextBased:()=>true,send:async p=>{sent.push(p);return {id:'m'+sent.length,channelId:'announcements'};}};
  const guild={id:'g',channels:{fetch:async()=>channel},members:{fetch:async id=>({id,user:{bot:false},commander:id==='commander'||id==='other-commander',roles:{add:async()=>changes.push(id)}})}};
  const client={guilds:{cache:new Map([['g',guild]])}};
  const flow=load('features/warflow.js',{
    '../utils/war-state':store,'../utils/config':{getConfig:(_,key)=>key==='WARFLOW_ENABLED'?enabled:key},
    '../utils/squad-store':{commander:m=>m.commander,activatePlannedGoals:()=>{}},
    '../utils/maintenance':{active:()=>paused},'../utils/audit':{record:()=>{}},
    './killcount':{apiSync:async()=>{},apiHistory:()=>({history:[]})},
    '../utils/commendations':{read:()=>({guilds:{}}),awardsFor:()=>[]},
    '../utils/war-context':{matches:()=>false},'../utils/community':{state:()=>({}),absenceReview:()=> 'No absences.'},
    './rollover':{clearActiveMembers:async()=>{changes.push('clear');return {role:{},failed:0};},executeRollover:async(g,ch,dry,active)=>{executions.push({dry,active:[...active]});return {activeMembersSkipped:active.size,membersReset:2,rolesRemoved:4,alliesRemoved:0,rolesFailed:0,membersFailed:0,alliesFailed:0};}},
  });
  function interaction(user='commander',messageId){return {guild,guildId:'g',user:{id:user},message:messageId?{id:messageId}:null,editReply:async p=>p};}
  return {flow,store,sent,executions,changes,interaction,client,state,api,setNow:v=>now=v,now:()=>now,setFailure:v=>failAPI=v,setEnabled:v=>enabled=v,setPaused:v=>paused=v};
}
test('confirmed war end posts a summary and approval once, without activity or automatic reset',async()=>{
  const f=fixture();await f.flow.poll(f.client);assert.equal(f.sent.length,0);
  f.api.scheduledConquestEndTime=f.now()-100;await f.flow.poll(f.client);assert.equal(f.sent.length,0);
  f.api.conquestEndTime=f.now();f.api.winner='COLONIALS';await f.flow.poll(f.client);
  assert.equal(f.sent.length,2);assert.match(JSON.stringify(f.sent),/Approve activity check/);
  await f.flow.poll(f.client);assert.equal(f.sent.length,2);assert.equal(f.changes.length,0);assert.equal(f.executions.length,0);
  assert.equal(f.state.guilds.g.wars.w142.activity,undefined);
});
test('full lifecycle grants 48 hours from late approval, requires a fresh owner-bound preview, executes only once',async()=>{
  const f=fixture();f.api.conquestEndTime=f.now();f.api.winner='WARDENS';await f.flow.poll(f.client);
  f.setNow(f.now()+3*86400000);
  await assert.rejects(()=>f.flow.act(f.interaction('member'),'activity','w142'),/Commander/);
  await f.flow.act(f.interaction(),'activity','w142');
  let war=f.store.read().guilds.g.wars.w142;
  assert.equal(war.activity.endsAt,f.now()+48*3600000);assert.deepEqual(f.changes,['clear']);
  await f.flow.act(f.interaction('member',war.activity.messageId),'respond','w142');
  await assert.rejects(()=>f.flow.act(f.interaction(),'preview','w142'),/48-hour/);
  f.setNow(war.activity.endsAt);await f.flow.poll(f.client);
  assert.equal(f.executions.length,0);assert.match(JSON.stringify(f.sent.at(-1)),/Preview rollover/);
  await assert.rejects(()=>f.flow.act(f.interaction('late',war.activity.messageId),'respond','w142'),/not open/);
  await f.flow.act(f.interaction(),'preview','w142');
  war=f.store.read().guilds.g.wars.w142;const token=war.preview.token;
  assert.equal(f.executions[0].dry,true);assert.deepEqual(f.executions[0].active,['member']);
  await assert.rejects(()=>f.flow.act(f.interaction('other-commander'),'confirm','w142',token),/another Commander/);
  await f.flow.act(f.interaction(),'confirm','w142',token);
  assert.equal(f.executions[1].dry,false);assert.equal(f.store.read().guilds.g.wars.w142.rollover,'done');
  await assert.rejects(()=>f.flow.act(f.interaction(),'confirm','w142',token),/cannot run again/);
  await f.flow.poll(f.client);assert.equal(f.executions.length,2);
});
test('disabled tracking, maintenance and API failures do not initiate war-end work',async()=>{
  const f=fixture();f.api.conquestEndTime=f.now();f.api.winner='WARDENS';
  f.setEnabled(false);await f.flow.poll(f.client);assert.equal(f.sent.length,0);
  f.setEnabled(true);f.setPaused(true);await f.flow.poll(f.client);assert.equal(f.sent.length,0);
  f.setPaused(false);f.setFailure(true);await f.flow.poll(f.client);assert.equal(f.sent.length,0);assert.match(f.state.guilds.g.error,/API unavailable/);
  f.setFailure(false);await f.flow.poll(f.client);assert.equal(f.sent.length,2);
});
