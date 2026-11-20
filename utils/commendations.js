const fs = require('./data-fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {memberAccess} = require('./logistics-access');
const {isOfficer} = require('./ranks');
const file = path.join(__dirname,'..','data','commendations.json');
const AWARDS = {cross:"Winged Hussar’s Cross",valor:'Combat Valor',leadership:'Field Leadership',guardian:'Guardian Angel',brother:'Brother in Arms',instructor:"Instructor’s Badge",campaign:'Campaign Service'};
function read() { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : {guilds:{}}; }
function transact(guildId,fn){return fs.transaction?fs.transaction(()=>transactUnlocked(guildId,fn)):transactUnlocked(guildId,fn);}
function transactUnlocked(guildId,fn) {
  const data=read(),guild=data.guilds[guildId] ||= {nominations:{}};
  const result=fn(guild);
  for(const n of Object.values(guild.nominations||{}))require('./war-context').tag(guildId,n);
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(data,null,2));fs.renameSync(file+'.tmp',file);
  return result;
}
function text(value,max=1000) { const result=String(value||'').trim();if(!result || result.length>max)throw new Error(`Enter text between 1 and ${max} characters.`);return result; }
function record(n,action,actorId,note) { n.updatedAt=Date.now();n.history.push({action,actorId,note,at:n.updatedAt}); }
function get(guild,id) { const n=guild.nominations[id];if(!n)throw new Error('Nomination not found in this server.');return n; }
function recipients(n) { return n.recipientIds || [n.recipientId]; }
function recipientLabel(n) { return n.squadName ? `**${n.squadName}**\n${recipients(n).map(id=>`<@${id}>`).join(', ')}` : `<@${n.recipientId}>`; }
function requiredApprovals(n) { return n.award==='cross'?2:1; }
function nominate(guild,member,actorId,target,award,reason,war,evidence) {
  if(!memberAccess(member))throw new Error('Verified members may submit nominations.');
  if(!target || target.user.bot || !memberAccess(target))throw new Error('Choose a verified regiment member.');
  if(actorId===target.id)throw new Error('You cannot nominate yourself.');
  if(!AWARDS[award])throw new Error('Choose a supported commendation.');
  reason=text(reason);war=text(war||'Not specified',80);
  if(evidence && (!/^https:\/\/\S+$/i.test(evidence)||evidence.length>500))throw new Error('Evidence must be an HTTPS link, at most 500 characters.');
  const entries=Object.values(guild.nominations);
  if(entries.some(n=>recipients(n).includes(target.id)&&n.award===award&&require('./war-context').matches(member.guild.id,n,war)&&['pending','needs_info'].includes(n.status)))throw new Error('An active nomination for this member, award and war already exists.');
  if(entries.filter(n=>n.nominatorId===actorId&&['pending','needs_info'].includes(n.status)).length>=10)throw new Error('You already have 10 open nominations.');
  const id=randomUUID().slice(0,8);if(guild.nominations[id])throw new Error('ID collision; retry.');
  const n={id,recipientId:target.id,nominatorId:actorId,award,reason,war,evidence:evidence||null,status:'pending',createdAt:Date.now(),history:[]};
  record(n,'nominated',actorId,reason);guild.nominations[id]=n;return n;
}
function nominateSquad(guild,member,actorId,targets,squadName,award,reason,war,evidence) {
  squadName=text(squadName,80);
  if(targets.length<2||targets.length>20||new Set(targets.map(t=>t.id)).size!==targets.length)throw new Error('Choose 2–20 different squad members.');
  for(const target of targets){
    if(!target||target.user.bot||!memberAccess(target))throw new Error('Every recipient must be a verified regiment member.');
    if(target.id===actorId)throw new Error('You cannot nominate yourself as part of a squad.');
    if(Object.values(guild.nominations).some(n=>recipients(n).includes(target.id)&&n.award===award&&require('./war-context').matches(member.guild.id,n,war||'Not specified')&&['pending','needs_info'].includes(n.status)))throw new Error('A squad member already has an active nomination for this award and war.');
  }
  const n=nominate(guild,member,actorId,targets[0],award,reason,war,evidence);
  n.squadName=squadName;n.recipientIds=targets.map(t=>t.id);return n;
}
function review(guild,member,actorId,id,action,note) {
  if(!isOfficer(member))throw new Error('Only Officers and Commanders can review commendations.');
  const n=get(guild,id);
  if([n.nominatorId,...recipients(n)].includes(actorId))throw new Error('Another officer must review this nomination: you cannot review your own nomination or award.');
  if(!['pending','needs_info'].includes(n.status))throw new Error('This nomination has already been decided.');
  if(!['approve','reject','request'].includes(action))throw new Error('Unknown review action.');
  if(action==='approve'&&n.status==='needs_info')throw new Error('Wait for the nominator to supply the requested information.');
  if(action!=='approve')note=text(note,500);
  if(action==='approve'){
    n.approvals ||= [];
    if(n.approvals.some(a=>a.actorId===actorId))throw new Error('You have already approved this nomination. A different officer must provide the second approval.');
    n.approvals.push({actorId,at:Date.now()});
    n.status=n.approvals.length>=requiredApprovals(n)?'approved':'pending';
    if(n.status==='approved'){n.approvedBy=actorId;n.approvedAt=Date.now();n.autoAnnouncement={state:'pending',queuedAt:Date.now()};}
  }else{n.status=action==='reject'?'rejected':'needs_info';n.approvals=[];}
  if(action==='request')n.question=note;
  if(action==='reject')n.rejectionReason=note;
  record(n,action,actorId,note||'Approved');return n;
}
function respond(guild,actorId,id,note) {
  const n=get(guild,id);if(n.nominatorId!==actorId)throw new Error('Only the nominator can provide this information.');
  if(n.status!=='needs_info')throw new Error('This nomination is not awaiting information.');
  note=text(note);n.response=note;n.status='pending';record(n,'information',actorId,note);return n;
}
function amend(guild,member,actorId,id,action,note,reason) {
  if(!isOfficer(member))throw new Error('Only Officers and Commanders can amend awards.');
  const n=get(guild,id);
  if([n.nominatorId,...recipients(n)].includes(actorId))throw new Error('Another officer must amend this award.');
  if(n.status!=='approved')throw new Error('Only active approved awards can be amended.');
  note=text(note,500);
  if(action==='revoke'){n.status='revoked';n.revokedBy=actorId;n.revokedAt=Date.now();n.revocationReason=note;}
  else if(action==='correct'){reason=text(reason);record(n,'previous_reason',actorId,n.reason);n.reason=reason;}
  else throw new Error('Unknown amendment.');
  record(n,action,actorId,note);return n;
}
function awardsFor(guild,userId) {return Object.values(guild?.nominations||{}).filter(n=>n.status==='approved'&&(!userId||recipients(n).includes(userId))).sort((a,b)=>b.approvedAt-a.approvedAt);}
function activeAwards(guildId,userId) {return awardsFor(read().guilds[guildId],userId);}
module.exports={AWARDS,read,transact,get,nominate,nominateSquad,review,respond,amend,activeAwards,recipients,recipientLabel,requiredApprovals,awardsFor};
