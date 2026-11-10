const fs = require('node:fs');
const path = require('node:path');
function readData(name) {
  const file = path.join(__dirname, '..', 'data', `${name}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}
function eventSignups(guildId, userId) {
  return ['operations', 'trainings'].flatMap(name => Object.values(readData(name).guilds?.[guildId] || {}))
    .filter(event => event.attendees?.accepted?.some(member => member.id === userId));
}
module.exports = { readData, eventSignups };
