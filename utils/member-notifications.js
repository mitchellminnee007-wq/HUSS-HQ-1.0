const c = require('./community');
const {ActionRowBuilder, ButtonBuilder, ButtonStyle} = require('discord.js');
const defaults = {operations:'channel', training:'channel', feedback:'off', reviews:'off'};
function mode(guildId, userId, category) { return c.state(guildId).preferences?.[userId]?.[category] || defaults[category] || 'off'; }
function set(guildId, userId, category, value) {
  if (!(category in defaults) || !['off','dm','channel'].includes(value)) throw new Error('Choose a supported notification category and delivery method.');
  c.transact(guildId, g => {g.preferences ||= {}; g.preferences[userId] ||= {}; g.preferences[userId][category] = value;});
}
function operationButtons(guildId, eventId) {
  return c.rows([['confirm','Confirm attendance'],['late','Running late'],['withdraw','Withdraw']].map(([action,label]) => c.button('hub',`rsvp:${guildId}:${eventId}:${action}`,label)));
}
async function deliver(guild, userId, category, key, payload, channelId) {
  const value = mode(guild.id, userId, category);
  if (value === 'off') return false;
  const member = await guild.members.fetch({user:userId,force:true}).catch(() => null);
  if (!member || !require('./logistics-access').memberAccess(member)) return false;
  // Even DMs containing event names must respect the source channel's current access.
  if (channelId && !await require('./qualifications').canSee(member,channelId)) return false;
  const keyId = `${category}:${key}:${userId}`;
  let claimed = false;
  c.transact(guild.id,g => {
    g.deliveries ||= {};
    for(const [k,v] of Object.entries(g.deliveries)) if(Date.now()-v.at>7*86400000) delete g.deliveries[k];
    if (!g.deliveries[keyId]) {g.deliveries[keyId]={at:Date.now(),status:'attempting'};claimed=true;}
  });
  if (!claimed) return false;
  try {
    if(value === 'dm') await member.send({...payload, ...c.safe});
    else {
      // Personal reports/reviews never get posted in a public channel. Channel delivery uses a private inbox.
      c.transact(guild.id,g => {g.inbox ||= {};g.inbox[userId] ||= [];g.inbox[userId].push({at:Date.now(),category,text:String(payload.content||'An update is available.').slice(0,900)});g.inbox[userId]=g.inbox[userId].slice(-50);});
    }
    c.transact(guild.id,g => {g.deliveries[keyId].status='sent';});
    return true;
  } catch {
    c.transact(guild.id,g => {g.deliveries[keyId].status='failed';});
    require('./health').record('notification_failure',0,guild.id);
    return false;
  }
}
async function eventDMs(client,guildId,eventId,event,category) {
  const guild = await client.guilds.fetch(guildId).catch(()=>null);
  if(!guild) return;
  for(const user of event.attendees?.accepted || []) {
    if(mode(guildId,user.id,category)!=='dm') continue;
    const components = category==='operations' ? operationButtons(guildId,eventId) : [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open training').setURL(`https://discord.com/channels/${guildId}/${event.channelId}/${eventId}`))];
    await deliver(guild,user.id,category,`${eventId}:${event.time}`,{content:`**${String(event.title).slice(0,100)}** starts <t:${Math.floor(event.time/1000)}:R>.`,components},event.channelId);
  }
}
module.exports={mode,set,defaults,deliver,eventDMs,operationButtons};
