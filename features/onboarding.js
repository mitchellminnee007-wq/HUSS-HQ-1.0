const {SlashCommandBuilder,ButtonBuilder,ButtonStyle}=require('discord.js');const c=require('../utils/community');
const data=new SlashCommandBuilder().setName('onboarding').setDescription('Your verification, squad, training and first-operation checklist').setDMPermission(false)
 .addSubcommand(s=>s.setName('view').setDescription('Open your personal checklist'))
 .addSubcommand(s=>s.setName('interests').setDescription('Choose your main interest').addStringOption(o=>o.setName('interest').setDescription('What would you like to do?').setRequired(true).addChoices(...['Logistics','Facility','Army','Navy','Air','Undecided'].map(value=>({name:value,value})))))
 .addSubcommand(s=>s.setName('skip').setDescription('Skip an optional checklist step').addStringOption(o=>o.setName('step').setDescription('Optional step').setRequired(true).addChoices(...['squad','training','operation'].map(value=>({name:value,value})))))
 .addSubcommand(s=>s.setName('reset').setDescription('Restore skipped optional steps'));
async function act(i,action){const verified=require('../utils/logistics-access').memberAccess(i.member);
 if(action==='interests')c.transact(i.guildId,g=>{g.onboarding||={};g.onboarding[i.user.id]||={};g.onboarding[i.user.id].interest=i.options.getString('interest');});
 if(action==='skip')c.transact(i.guildId,g=>{g.onboarding||={};g.onboarding[i.user.id]||={};g.onboarding[i.user.id].skips||=[];const step=i.options.getString('step');if(!['squad','training','operation'].includes(step))throw new Error('Only optional steps can be skipped.');if(!g.onboarding[i.user.id].skips.includes(step))g.onboarding[i.user.id].skips.push(step);});
 if(action==='reset')c.transact(i.guildId,g=>{if(g.onboarding?.[i.user.id])g.onboarding[i.user.id].skips=[];});
 const own=c.state(i.guildId).onboarding?.[i.user.id]||{},read=require('../utils/member-data').readData,sq=require('../utils/squad-store');
 const joined=verified&&Object.values(sq.read().guilds[i.guildId]?.squads||{}).some(s=>sq.visible(i.member,s)&&s.members.includes(i.user.id));
 const qualification=verified&&require('../utils/qualifications').list(i.member).length>0;
 const operation=verified&&Object.values(read('operations').guilds?.[i.guildId]||{}).some(o=>o.attendees?.accepted?.some(m=>m.id===i.user.id));
 const mark=(key,done)=>done?'✅':own.skips?.includes(key)?'⏭️':'⬜';
 return c.page('Your HUSS onboarding',[
 `${verified?'✅':'⬜'} **Verification**\n${verified?'Member access confirmed.':'Use the server verification panel. This step cannot be skipped.'}`,
 `${own.interest?'✅':'⬜'} **Choose interests**\n${own.interest||'Use /onboarding interests to choose your preferred role.'}`,
 `${mark('squad',joined)} **Find a squad (optional)**\n/hub → Recruiting squads; /squad join to request membership.`,
 `${mark('training',qualification)} **Training (optional)**\n/me tab:training shows qualifications and training. Only trainer assessment awards a qualification.`,
 `${mark('operation',operation)} **First operation signup (optional)**\n/hub → Upcoming events. Signing up does not prove attendance.`
 ],'onboarding','view',1,[c.button('hub','home','Open war hub')]);
}
async function handle(i){
 const [,action,guildId,userId]=i.customId.split(':');
 if(action!=='open')return c.run(i,x=>act(x,'view'),'onboarding');
 await i.deferReply({ephemeral:true});
 try {
  if(userId!==i.user.id)throw new Error('This onboarding button belongs to the verified applicant. Use /onboarding view for your own checklist.');
  if(i.guildId&&i.guildId!==guildId)throw new Error('This button belongs to another server.');
  const guild=i.guild||await i.client.guilds.fetch(guildId);
  const member=await guild.members.fetch({user:i.user.id,force:true});
  const held=require('../utils/maintenance').active(guildId,'onboarding');
  if(held)return i.editReply({...c.safe,...require('../utils/maintenance').notice(held)});
  if(!require('../utils/logistics-access').memberAccess(member))throw new Error('Member access is no longer available. Contact an officer if you need help.');
  const payload=await act({guildId,guild,member,user:i.user},'view');
  if(!i.guildId)payload.components=c.rows([c.button('onboarding',`open:${guildId}:${userId}`,'Refresh checklist'),new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Continue in server').setURL(`https://discord.com/channels/${guildId}`)]);
  return i.editReply(payload);
 }catch(e){return i.editReply({...c.safe,content:e.message||'Could not open onboarding. Use /onboarding view in the server.'});}
}
module.exports={data,execute:i=>c.run(i,x=>act(x,x.options.getSubcommand()),'onboarding'),handle};
