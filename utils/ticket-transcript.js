const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
async function buildTranscript(channel, ticket, actor, reason) {
  const messages = [];
  let before;
  for (;;) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;
    messages.push(...batch.values());
    const next = batch.last().id;
    if (next === before) throw new Error('Transcript pagination stalled; ticket was not deleted.');
    before = next;
    if (batch.size < 100) break;
  }
  const body = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp).map(message => {
    const embeds = message.embeds.map(embed => `<aside><b>${escape(embed.title)}</b><p>${escape(embed.description)}</p>${(embed.fields || []).map(field => `<p>${escape(field.name)}: ${escape(field.value)}</p>`).join('')}</aside>`).join('');
    const files = [...message.attachments.values()].map(file => `<p><a href="${escape(/^https?:\/\//i.test(file.url) ? file.url : '')}">${escape(file.name)}</a></p>`).join('');
    return `<article><b>${escape(message.author?.tag)}</b> · ${escape(new Date(message.createdTimestamp).toISOString())}<p>${escape(message.content)}</p>${embeds}${files}</article>`;
  }).join('');
  return `<!doctype html><meta charset="utf-8"><title>${escape(channel.name)}</title><style>body{font:15px system-ui;background:#111827;color:#eee;max-width:900px;margin:30px auto;padding:20px}article,aside{padding:12px;background:#1f2937;margin:10px 0}p{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#93c5fd}</style><h1>${escape(channel.name)}</h1><p>Applicant: ${escape(ticket.username || ticket.userId)}\nClosed by: ${escape(actor)}\nReason: ${escape(reason || 'No reason')}\nMessages: ${messages.length}</p>${body}`;
}
module.exports = { buildTranscript };
