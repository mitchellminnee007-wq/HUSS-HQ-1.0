const { getFoxholeItems } = require('./foxhole-icons');
const store = require('./logistics-store');
const { memberAccess, canViewStockpile } = require('./logistics-access');
const normalize = value => String(value || '').toLowerCase().replace(/["'’“”]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
function choices(guild, member, query, { sourceId, unit, transport = false } = {}) {
  if (!memberAccess(member)) return [];
  const source = sourceId ? guild.stockpiles[sourceId] : null;
  if (sourceId && (!source || source.archived || !canViewStockpile(member, source))) return [];
  const candidates = new Map();
  const add = (item, extra = '', preferred = false) => {
    if (!item || item.length > 100) return;
    const key = normalize(item);
    if (!candidates.has(key) || preferred) candidates.set(key, { item, extra });
  };
  if (transport && source) {
    for (const [key, entry] of Object.entries(source.inventory)) {
      const available = store.available(guild, source.id, key);
      if (available > 0 && (!unit || entry.unit === unit)) add(entry.item, `${available} ${entry.unit.replaceAll('_', ' ')} available`);
    }
  } else {
    for (const item of getFoxholeItems()) add(item.name, item.category || item.type || '');
    for (const pile of Object.values(guild.stockpiles)) {
      if (pile.archived || !canViewStockpile(member, pile)) continue;
      for (const entry of Object.values(pile.inventory)) {
        if (!unit || entry.unit === unit) add(entry.item, '', pile.id === sourceId);
      }
    }
  }
  const search = normalize(query), words = search.split(' ').filter(Boolean);
  const score = item => normalize(item) === search ? 0 : normalize(item).startsWith(search) ? 1 : 2;
  return [...candidates.values()].filter(entry => words.every(word => normalize(`${entry.item} ${entry.extra}`).includes(word)))
    .sort((a, b) => score(a.item) - score(b.item) || a.item.localeCompare(b.item)).slice(0, 25)
    .map(entry => ({ name: `${entry.item}${entry.extra ? ` • ${entry.extra}` : ''}`.slice(0, 100), value: entry.item }));
}
async function autocomplete(interaction) {
  let result = [];
  try {
    const guild = store.read().guilds[interaction.guildId] || { stockpiles: {}, orders: {} };
    const type = interaction.options.getString('type');
    result = choices(guild, interaction.member, interaction.options.getFocused(), {
      sourceId: type === 'production' ? null : interaction.options.getString('source') || interaction.options.getString('stockpile'),
      unit: interaction.options.getString('unit'), transport: ['transport', 'frontline_supply'].includes(type),
    });
  } catch { /* No inventory information is returned when access/data cannot be checked. */ }
  return interaction.respond(result);
}
module.exports = { choices, autocomplete };
