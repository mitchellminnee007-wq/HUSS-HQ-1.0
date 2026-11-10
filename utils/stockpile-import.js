const { createHash } = require('node:crypto');
const store = require('./logistics-store');
const { findFoxholeItem } = require('./foxhole-icons');
const MAX_BYTES = 256 * 1024;
function parseExport(text) {
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new Error('Export must be smaller than 256 KB.');
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  let source = null;
  if (/X:\s*[\d.-]+\s+Y:\s*[\d.-]+,\d{4}\.\d{2}\.\d{2}-/.test(lines[0])) source = lines.shift().trim();
  const groups = lines.join('\n').trim().split(/\n\s*\n/).map(group => group.split('\n').filter(line => line.trim()));
  const full = Boolean(source && groups.length === 5);
  if (groups.length !== 1 && !full) throw new Error('Keep all five sections and the header from the Foxhole export, or paste a single list of item crates.');
  const entries = [], seen = new Set();
  for (let section = 0; section < groups.length; section++) {
    for (const line of groups[section]) {
      const match = line.trim().match(/^(.+),\s*(\d+)\s*$/);
      if (!match) throw new Error(`Invalid row: ${line.slice(0, 100)}. Expected item,quantity.`);
      let name = match[1].trim();
      if (name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1).replace(/""/g, '"');
      const crated = /\s+\(Crate\)$/i.test(name);
      if (!full && !crated) throw new Error('Uncrated goods need the full five-section export to identify their unit.');
      if (full && crated !== [0, 2, 4].includes(section)) throw new Error('Export sections are out of order. Upload the original complete export.');
      name = name.replace(/\s+\(Crate\)$/i, '').trim();
      const item = findFoxholeItem(name)?.name || name;
      const unit = !full || section === 0 ? 'crates' : section === 1 ? 'vehicles' : section === 3 ? 'items' : 'shippable_crates';
      const quantity = Number(match[2]);
      if (!item || item.length > 100 || !Number.isSafeInteger(quantity) || quantity > 1000000) throw new Error('Invalid item name or quantity in export.');
      const key = store.key(item, unit);
      if (seen.has(key)) throw new Error(`Duplicate inventory row: ${item} (${unit}).`);
      seen.add(key); entries.push({ item, unit, quantity });
    }
  }
  if (!entries.length || entries.length > 3000) throw new Error('Import must contain 1–3,000 inventory rows.');
  return { source, entries };
}
function fingerprint(guild, id) {
  const pile = store.pile(guild, id);
  return createHash('sha256').update(JSON.stringify({ inventory: pile.inventory, updatedAt: pile.updatedAt, orders: guild.orders })).digest('hex');
}
function applyImport(guild, id, parsed) {
  // Validate on a copy first; not a single row changes on a reservation conflict.
  const copy = structuredClone(guild);
  for (const entry of parsed.entries) store.setInventory(copy, id, entry.item, entry.unit, entry.quantity);
  const target = store.pile(guild, id);
  target.inventory = copy.stockpiles[id].inventory;
  target.updatedAt = Date.now();
  target.lastImport = { source: parsed.source, at: Date.now(), rows: parsed.entries.length };
  return target;
}
async function readAttachment(attachment) {
  if (!/\.(txt|csv)$/i.test(attachment.name || '') || attachment.size > MAX_BYTES) throw new Error('Upload a UTF-8 .txt or .csv file smaller than 256 KB.');
  const url = new URL(attachment.url);
  // Modal uploads can use temporary CDN paths rather than /attachments/.
  // Trust only Discord's exact CDN hosts; never follow redirects off them.
  if (url.protocol !== 'https:' || !['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname) || (url.port && url.port !== '443') || url.username || url.password) throw new Error('Use a file uploaded directly to Discord.');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Could not download this export. Upload it again.');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error('Export must be smaller than 256 KB.');
    chunks.push(chunk);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}
module.exports = { parseExport, fingerprint, applyImport, readAttachment };
