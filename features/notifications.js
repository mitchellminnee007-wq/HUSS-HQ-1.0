const {SlashCommandBuilder}=require('discord.js');const c=require('../utils/community'),n=require('../utils/member-notifications');
const data=new SlashCommandBuilder().setName('notifications').setDescription('Choose personal reminders and update delivery').setDMPermission(false)
 .addSubcommand(s=>s.setName('view').setDescription('View your notification preferences'))
 .addSubcommand(s=>s.setName('set').setDescription('Change a reminder or update preference').addStringOption(o=>o.setName('category').setDescription('Notification type').setRequired(true).addChoices(...Object.keys(n.defaults).map(value=>({name:value,value})))).addStringOption(o=>o.setName('delivery').setDescription('Server: event channel for reminders, private inbox for reports').setRequired(true).addChoices({name:'Off',value:'off'},{name:'Direct message',value:'dm'},{name:'Server / private inbox',value:'channel'})))
 .addSubcommand(s=>s.setName('inbox').setDescription('Read your private server update inbox'));
async function act(i,action,page){c.member(i);if(action==='set'){n.set(i.guildId,i.user.id,i.options.getString('category'),i.options.getString('delivery'));return {content:'Preference saved. Event-channel posts remain visible but only opted-in members are pinged. Report and review updates use your private inbox when Server is selected.'};}
 if(action==='inbox')return c.page('Your update inbox',(c.state(i.guildId).inbox?.[i.user.id]||[]).slice().reverse().map(v=>`<t:${Math.floor(v.at/1000)}:R> • ${v.category}\n${v.text}`),'notifications','inbox',page);
 return c.page('Notification preferences',Object.keys(n.defaults).map(k=>`**${k}** — ${n.mode(i.guildId,i.user.id,k)}`),'notifications','view',page);
}
module.exports={data,execute:i=>c.run(i,x=>act(x,x.options.getSubcommand()),'notifications'),handle:i=>c.run(i,x=>act(x,...x.customId.split(':').slice(1)),'notifications')};
