const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '..', 'data', 'activity-checks.json');
let running = false;
function read() { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}; }
function save(data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2)); fs.renameSync(`${file}.tmp`, file); }
function register(message, guildId, endUnix) {
  const data = read(); data[message.id] = { guildId, channelId: message.channelId || message.channel.id, endUnix }; save(data);
}
function forget(id) { const data = read(); delete data[id]; save(data); }
async function sweep(client) {
  if (running) return;
  running = true;
  try {
    for (const [id, check] of Object.entries(read())) {
      if (Date.now() < check.endUnix * 1000) continue;
      try {
        const channel = await client.channels.fetch(check.channelId);
        const message = await channel.messages.fetch(id);
        if (message.embeds[0]?.title === 'Activity Check') {
          const embed = message.embeds[0].toJSON(); embed.title = 'Activity Check Closed'; embed.description = 'This activity check is closed. The recorded active roster is retained.';
          const components = message.components.map(row => ({ ...row.toJSON(), components: row.components.map(button => ({ ...button.toJSON(), disabled: true })) }));
          await message.edit({ embeds: [embed], components });
        }
        forget(id);
      } catch (error) {
        if ([10003, 10008].includes(error.code)) forget(id);
        else console.error('[Activity] Could not close stored check:', error.message);
      }
    }
  } finally { running = false; }
}
function init(client) {
  client.once('clientReady', () => {
    sweep(client).catch(console.error);
    setInterval(() => sweep(client).catch(console.error), 60000).unref();
  });
}
module.exports = { register, forget, init, sweep };
