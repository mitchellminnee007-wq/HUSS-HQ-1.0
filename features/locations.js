const fs = require('node:fs');
const path = require('node:path');
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const DATA_PATH = path.join(__dirname, '..', 'data', 'foxhole_locations.json');

function readLocations() {
  if (!fs.existsSync(DATA_PATH)) return { locations: [] };

  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch (error) {
    console.error('[locations] Failed to read Foxhole locations:', error);
    return { locations: [] };
  }
}

function normalizeLocationText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ');
}

function findLocationMatch(input) {
  const search = normalizeLocationText(input);
  if (!search) return { hex: null, region: null, exact: null };

  const { locations } = readLocations();

  for (const item of locations || []) {
    const canonical = normalizeLocationText(item.name);
    const aliases = (item.aliases || []).map(alias => normalizeLocationText(alias));

    if (canonical === search || aliases.includes(search)) {
      return { hex: item.name, region: null, exact: item.name };
    }

    if (Array.isArray(item.regions)) {
      for (const region of item.regions) {
        const regionName = region.name || region;
        const regionCanonical = normalizeLocationText(regionName);
        const regionAliases = (region.aliases || []).map(alias => normalizeLocationText(alias));

        if (regionCanonical === search || regionAliases.includes(search)) {
          return { hex: item.name, region: regionName, exact: `${item.name}, ${regionName}` };
        }
      }
    }
  }

  return { hex: null, region: null, exact: null };
}

function getLocationMatch(input) {
  return findLocationMatch(input).exact || null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('locations')
    .setDescription('Look up known Foxhole locations.')
    .setDMPermission(false)
    .addStringOption(opt =>
      opt.setName('query')
        .setDescription('Search by location name or alias')
        .setRequired(false)
    ),

  async execute(interaction) {
    const query = interaction.options.getString('query') || '';
    const { locations } = readLocations();

    if (!query) {
      const names = (locations || []).map(item => item.name).slice(0, 25).join(', ');
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🗺️ Foxhole Locations')
            .setDescription(names)
            .setFooter({ text: 'Use /locations query:Name to search for a known location.' })
        ]
      });
    }

    const normalized = normalizeLocationText(query);
    const matches = (locations || []).filter(item => {
      const haystacks = [item.name, ...(item.aliases || [])];
      return haystacks.some(text => normalizeLocationText(text).includes(normalized));
    });

    if (!matches.length) {
      return interaction.reply({
        content: 'That location is not in the current Foxhole database. Try a known name or alias.',
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🗺️ Foxhole Location Match')
      .setDescription(matches.slice(0, 10).map(item => `• ${item.name}`).join('\n'))
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },

  normalizeLocationText,
  getLocationMatch,
  findLocationMatch,
};
