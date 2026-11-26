// Only explicitly public-safe renderers may be registered here. No user-specific views.
const db = require('./atomic-json')('shared-panels');
const {PermissionFlagsBits:P} = require('discord.js');
const clients = new WeakSet();
const hashes = new Map();
const kinds = new Set(['admin','status','squads']);
function register(message, guildId, kind, page = 'home', offset = 0) {
  if (!message || !kinds.has(kind) || message.flags?.has(64)) return;
  if (!message.id || !message.channelId) return;
  db.transact(guildId, g => {
    g.panels ||= {};
    if (Object.keys(g.panels).length >= 100 && !g.panels[message.id]) delete g.panels[Object.keys(g.panels)[0]];
    g.panels[message.id] = {channelId:message.channelId, kind, page, offset};
  });
  hashes.delete(`${guildId}:${message.id}`);
}
function render(client, guild, channel, ref) {
  if (ref.kind === 'status') return require('../features/botstatus').payload(client, guild.id);
  if (require('./maintenance').active(guild.id, ref.kind === 'squads' ? 'squad' : 'botpanel')) return null;
  if (ref.kind === 'admin') {
    if (channel.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel) !== false) return null;
    return require('./admin-panel').buildPage(guild, ref.page, ref.offset);
  }
  if (ref.kind === 'squads') return require('../features/squad').directory({guild}, Number(ref.page)||0, true);
  return null;
}
function fingerprint(payload) {
  return JSON.stringify(payload, (key,value) => key === 'timestamp' ? undefined : value);
}
async function sweep(client) {
  const state = db.read();
  for (const [guildId,g] of Object.entries(state.guilds)) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    for (const [messageId,ref] of Object.entries(g.panels || {})) {
      try {
        const channel = await guild.channels.fetch(ref.channelId);
        if (!channel?.isTextBased()) continue;
        const payload = render(client,guild,channel,ref);
        if (!payload) continue;
        const key = `${guildId}:${messageId}`, hash = fingerprint(payload);
        if (hashes.get(key) === hash) continue;
        const message = await channel.messages.fetch(messageId);
        if (message.author?.id !== client.user.id) continue;
        if (JSON.stringify(db.read().guilds[guildId]?.panels?.[messageId]) !== JSON.stringify(ref)) continue;
        await message.edit({content:null,...payload,allowedMentions:{parse:[]}});
        hashes.set(key,hash);
      } catch(e) {
        if (e.code === 10008 || e.code === 10003) db.transact(guildId, g => { delete g.panels?.[messageId]; });
        else { require('./health').record('interaction_failure',0,guildId); console.warn('[Shared panels] Refresh failed:',e.code||e.name); }
      }
    }
  }
}
function init(client) {
  if (clients.has(client)) return;
  clients.add(client);
  let running = false;
  const tick = async () => {
    if (running || !client.isReady()) return;
    running = true;
    try {
      // Existing squad directories already have durable message references.
      for (const [guildId,g] of Object.entries(require('./squad-store').read().guilds)) {
        const ref = g.directory;
        if (ref && !db.read().guilds[guildId]?.panels?.[ref.messageId]) register({id:ref.messageId,channelId:ref.channelId},guildId,'squads',0);
      }
      await sweep(client);
    } catch(e) { console.warn('[Shared panels]',e.message); }
    finally { running = false; }
  };
  client.once('clientReady',tick);
  if (client.isReady()) tick();
  setInterval(tick,60000).unref();
}
module.exports = {register,render,fingerprint,sweep,init};
