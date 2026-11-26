// Optional outbound publisher; no incoming port is needed on the bot host.
function snapshot(client, guildId) {
  const embed = require('./botstatus').payload(client, guildId).embeds[0].toJSON();
  return {
    connected: client.isReady(),
    color: embed.color,
    summary: embed.description.split('\n\n')[0].replace(/\*\*/g, ''),
    fields: embed.fields.filter(field => field.name !== 'Need more information?')
      .map(({name, value, inline}) => ({name, value, inline: Boolean(inline)})),
  };
}

function init(client) {
  const url = process.env.STATUS_PUSH_URL;
  if (!url) return;
  const token = process.env.STATUS_PUSH_TOKEN;
  const guildId = process.env.STATUS_GUILD_ID;
  if (!token || token.length < 32 || !guildId || !/^https:\/\//i.test(url)) {
    console.warn('[Web status] Configure an HTTPS URL, token of at least 32 characters and STATUS_GUILD_ID.');
    return;
  }
  let busy = false;
  let failed = false;
  async function publish() {
    if (busy) return;
    busy = true;
    try {
      const response = await fetch(url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: {'Content-Type': 'application/json', 'X-Status-Token': token},
        body: JSON.stringify(snapshot(client, guildId)),
      });
      if (!response.ok) throw new Error('Publish rejected');
      await response.body?.cancel();
      if (failed) console.log('[Web status] Updates restored.');
      failed = false;
    } catch {
      if (!failed) console.warn('[Web status] Update failed. Check dashboard configuration and hosting. Retrying every 15 seconds.');
      failed = true;
    } finally { busy = false; }
  }
  const timer = setInterval(publish, 15000);
  timer.unref();
  void publish();
}

module.exports = {init, snapshot};
