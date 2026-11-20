const {randomUUID}=require('node:crypto');
const db=require('./atomic-json')('squads');
const {getConfig}=require('./config');
const ROLE_KEYS={command:'SQUAD_COMMANDER_ROLE_ID',logistics:'SQUAD_LOGISTICS_HEAD_ID',facility:'SQUAD_FACILITY_HEAD_ID',army:'SQUAD_ARMY_HEAD_ID',navy:'SQUAD_NAVY_HEAD_ID',air:'SQUAD_AIR_HEAD_ID'};
const has=(member,key)=>Boolean(member&&getConfig(member.guild.id,key)&&member.roles.cache.has(getConfig(member.guild.id,key)));
const commander=member=>has(member,ROLE_KEYS.command);
const allowed=member=>has(member,'VERIFIED_MEMBER_ROLE_ID')||Object.values(ROLE_KEYS).some(key=>has(member,key));
function authority(member,squad){return commander(member)||has(member,ROLE_KEYS[squad.department==='frontline'?squad.branch:squad.department]);}
function manage(member,squad){return allowed(member)&&(authority(member,squad)||squad.leaderId===member.id);}
function ensureMember(member){if(!allowed(member)||member.user?.bot)throw new Error('A verified regiment member is required.');}
function get(guild,id){const s=guild.squads?.[id];if(!s||s.deletedAt)throw new Error('Squad not found in this server.');return s;}
function visible(member,s){return allowed(member)&&!s.deletedAt&&(s.status==='approved'||s.leaderId===member.id||s.createdBy===member.id||authority(member,s));}
function clean(value,max){value=String(value||'').trim();if(!value||value.length>max)throw new Error(`Enter 1–${max} characters.`);return value;}
function event(s,actor,action,details={}){s.updatedAt=Date.now();s.audit.push({at:s.updatedAt,actorId:actor,action,...details});}
function unique(guild,name,exclude){if(Object.values(guild.squads||{}).some(s=>!s.deletedAt&&s.id!==exclude&&s.name.toLowerCase()===name.toLowerCase()))throw new Error('A squad with that name already exists.');}
function create(guild,actor,leader,input){ensureMember(actor);ensureMember(leader);const name=clean(input.name,80);unique(guild,name);
  if(!['logistics','facility','frontline'].includes(input.department))throw new Error('Choose a department.');
  if(input.department==='frontline'&&!['army','navy','air'].includes(input.branch))throw new Error('Frontline squads require Army, Navy or Air.');
  if(input.department!=='frontline'&&input.branch)throw new Error('Branches only apply to Frontline squads.');
  guild.squads||={};const id=randomUUID().slice(0,8);if(guild.squads[id])throw new Error('ID collision; retry.');
  const s={id,name,department:input.department,branch:input.branch||null,leaderId:leader.id,members:[leader.id],requests:{},invites:{},goal:{text:clean(input.goal,1000),war:clean(input.war||'Unassigned war',80),status:'Active'},description:String(input.description||'').trim().slice(0,1000),recruiting:false,status:'pending',createdBy:actor.id,createdAt:Date.now(),goals:[],audit:[]};
  require('./war-context').tag(actor.guild.id,s.goal);
  event(s,actor.id,'create_requested');guild.squads[id]=s;return s;
}
function change(guild,actor,id,action,input={}){ensureMember(actor);const s=get(guild,id),admin=authority(actor,s),leader=manage(actor,s);
  if(action==='approve'){
    const kind=input.kind||'creation';
    if(kind==='membership'){
      if(!leader||s.status!=='approved')throw new Error('Only this squad leader or department leadership can decide membership requests.');
      if(!s.requests[input.userId])throw new Error('No membership request from that member.');
      if(input.accept){ensureMember(input.target);if(input.target.id!==input.userId)throw new Error("Membership target mismatch.");if(!s.members.includes(input.userId))s.members.push(input.userId);}delete s.requests[input.userId];
    }else{
      if(!admin)throw new Error('Department leadership or High Command approval is required.');
      if(kind==='creation'){
        if(s.status!=='pending')throw new Error('Squad creation has already been decided.');
        if(input.accept){ensureMember(input.target);if(input.target.id!==s.leaderId)throw new Error('Leader mismatch.');s.status='approved';}else{s.status='rejected';s.deletedAt=Date.now();}
      }else if(kind==='goal'){
        if(!s.pendingGoal)throw new Error('No goal change is awaiting approval.');
        const review=s.reviews?.find(r=>r.id===s.pendingGoal.reviewId);if(review)Object.assign(review,{status:input.accept?'Approved':'Rejected',reviewedAt:Date.now(),reviewedBy:actor.id});
        if(input.accept){
          const current=require('./war-context').current(actor.guild.id),number=Number(String(s.pendingGoal.war).match(/^War (\d+)$/i)?.[1]);
          if(s.pendingGoal.reviewId&&current&&number>current.number){s.plannedGoal={...s.pendingGoal,status:'Approved for next war',approvedBy:actor.id,approvedAt:Date.now(),targetWar:number};}
          else {s.goals.push({...s.goal,status:s.goal.status==='Active'?'Cancelled':s.goal.status,endedAt:Date.now(),reason:'Replaced by approved goal'});s.goal={...s.pendingGoal,status:'Active',approvedBy:actor.id};require('./war-context').tag(actor.guild.id,s.goal);}
        }delete s.pendingGoal;
      }else if(kind==='delete'){
        if(!s.deleteRequested)throw new Error('No deletion request is pending.');
        if(input.accept){if(!input.confirm)throw new Error('Confirm deletion first.');s.deletedAt=Date.now();s.status='deleted';}delete s.deleteRequested;
      }else throw new Error('Unknown approval type.');
    }
    event(s,actor.id,`${kind}_${input.accept?'approved':'rejected'}`,{userId:input.userId,reason:input.reason});return s;
  }
  if(s.status!=='approved')throw new Error('Squad creation must be approved first.');
  if(action==='join'){
    if(s.members.includes(actor.id))throw new Error('You are already a member.');
    if(s.invites[actor.id]){s.members.push(actor.id);delete s.invites[actor.id];delete s.requests[actor.id];}
    else{if(s.requests[actor.id])throw new Error('Your request is already pending.');s.requests[actor.id]={at:Date.now()};}
  }else if(action==='leave'){
    if(s.leaderId===actor.id)throw new Error('Transfer leadership before leaving.');
    s.members=s.members.filter(id=>id!==actor.id);delete s.requests[actor.id];delete s.invites[actor.id];
  }else{
    if(!leader)throw new Error('Only this squad leader or department leadership can manage it.');
    if(action==='invite'){
      ensureMember(input.target);if(s.members.includes(input.target.id))throw new Error('This member is already in the squad.');s.invites[input.target.id]={by:actor.id,at:Date.now()};
    }else if(action==='kick'){
      if(input.userId===s.leaderId)throw new Error('Transfer leadership before removing the leader.');
      if(!s.members.includes(input.userId)&&!s.invites[input.userId]&&!s.requests[input.userId])throw new Error('That member has no squad membership, invitation or request.');
      s.members=s.members.filter(id=>id!==input.userId);delete s.invites[input.userId];delete s.requests[input.userId];
    }else if(action==='transfer'){
      ensureMember(input.target);if(!input.confirm)throw new Error('Confirm the leadership transfer.');if(!s.members.includes(input.target.id))throw new Error('The new leader must already be a squad member.');s.leaderId=input.target.id;
    }else if(action==='edit'){
      if(input.name){const name=clean(input.name,80);unique(guild,name,id);s.name=name;}if(input.description!==null&&input.description!==undefined)s.description=String(input.description).trim().slice(0,1000);if(typeof input.recruiting==='boolean')s.recruiting=input.recruiting;
    }else if(action==='goal'){
      if(input.status){if(!['Completed','Cancelled'].includes(input.status))throw new Error('Choose Completed or Cancelled.');if(s.goal.status!=='Active')throw new Error('The current goal is already closed. Request a new goal.');s.goal.status=input.status;s.goal.closedAt=Date.now();}
      else{if(s.pendingGoal)throw new Error('A goal change is already awaiting approval.');s.pendingGoal={text:clean(input.goal,1000),war:clean(input.war||s.goal.war,80),requestedBy:actor.id,requestedAt:Date.now()};}
    }else if(action==='delete'){
      if(!input.confirm)throw new Error('Confirm the deletion request.');
      if(s.deleteRequested)throw new Error('A deletion request is already awaiting approval.');
      s.deleteRequested={by:actor.id,at:Date.now(),reason:clean(input.reason,500)};
    }else throw new Error('Unknown squad action.');
  }
  event(s,actor.id,action,{userId:input.target?.id||input.userId,reason:input.reason});return s;
}
function activatePlannedGoals(guildId,war){
  const planned=Object.values(db.read().guilds[guildId]?.squads||{}).some(s=>!s.deletedAt&&s.status==='approved'&&s.plannedGoal?.targetWar===war.warNumber);
  if(!planned)return;
  db.transact(guildId,g=>{for(const s of Object.values(g.squads||{}))if(!s.deletedAt&&s.status==='approved'&&s.plannedGoal?.targetWar===war.warNumber){s.goals.push({...s.goal,status:s.goal.status==='Active'?'Cancelled':s.goal.status,endedAt:Date.now(),reason:'Approved next-war goal activated'});s.goal={...s.plannedGoal,status:'Active',warRef:{shard:'Able',id:war.warId,number:war.warNumber}};delete s.plannedGoal;event(s,s.goal.approvedBy,'approved_next_war_goal_activated');}});
}
module.exports={...db,ROLE_KEYS,commander,allowed,authority,manage,ensureMember,get,visible,create,change,activatePlannedGoals};
