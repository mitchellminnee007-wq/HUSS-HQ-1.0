const fs = require('./data-fs');
const path = require('node:path');
const file = path.join(__dirname, '..', 'data', 'audit.jsonl');
function record(interaction, action, targetId, details = {}) {
  if (!interaction.guildId || !interaction.user?.id) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ at: Date.now(), guildId: interaction.guildId, actorId: interaction.user.id, action, targetId, ...details }) + '\n');
}
function read(guildId) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap(line => {
    try { const entry = JSON.parse(line); return entry.guildId === guildId ? [entry] : []; } catch { return []; }
  });
}
module.exports = { record, read };
