const {SlashCommandBuilder}=require('discord.js');
const c=require('../utils/community');
const data=new SlashCommandBuilder().setName('absence').setDescription('Record a temporary absence for officer activity reviews').setDMPermission(false)
 .addSubcommand(s=>s.setName('set').setDescription('Record your expected return date').addStringOption(o=>o.setName('return').setDescription('Return date YYYY-MM-DD (through that day, Brussels time)').setRequired(true)).addStringOption(o=>o.setName('note').setDescription('Optional note visible only to you and officers').setMaxLength(300)))
 .addSubcommand(s=>s.setName('clear').setDescription('Clear your current absence'))
 .addSubcommand(s=>s.setName('mine').setDescription('View your absence notice'))
 .addSubcommand(s=>s.setName('list').setDescription('Officer view of current absence notices'));
function returnTime(value,now=Date.now()) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('Use YYYY-MM-DD.');
 const d=new Date(value+'T12:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==value)throw new Error('Choose a valid date.');
 // Convert next local midnight using Intl, including daylight-saving time.
 const next=new Date(+d+86400000),target=next.toISOString().slice(0,10);let utc=Date.parse(target+'T00:00:00Z');
 for(let n=0;n<3;n++){const local=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(utc)).replace(' ','T');utc+=Date.parse(target+'T00:00:00Z')-Date.parse(local+'Z');}
 if(utc<=now||utc>now+180*86400000)throw new Error('Choose a return date within the next 180 days.');
 return utc-1;
}
async function act(i,action,page){c.member(i);if(action==='set'){const until=returnTime(i.options.getString('return'));c.transact(i.guildId,g=>{g.absences||={};g.absences[i.user.id]={since:Date.now(),until,note:i.options.getString('note')||''};});return {content:'Absence saved. Officers can see it during activity reviews. You must still respond to activity checks; this does not prevent rollover.'};}
 if(action==='clear'){c.transact(i.guildId,g=>{if(g.absences?.[i.user.id])g.absences[i.user.id].clearedAt=Date.now();});return {content:'Your absence notice is cleared.'};}
 if(action==='list')c.officer(i);
 const notices=c.absence(i.guildId).filter(([id])=>action==='list'||id===i.user.id);
 return c.page('Temporary absences',notices.map(([id,v])=>`<@${id}> • Returns <t:${Math.floor(v.until/1000)}:D>\n${v.note||'No note'}\nNo automatic exemption from activity checks.`),'absence',action,page);
}
module.exports={data,returnTime,execute:i=>c.run(i,x=>act(x,x.options.getSubcommand()),'absence'),handle:i=>c.run(i,x=>act(x,...x.customId.split(':').slice(1)),'absence')};
