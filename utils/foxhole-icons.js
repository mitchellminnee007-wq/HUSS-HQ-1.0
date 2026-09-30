const fs = require('node:fs');
const path = require('node:path');

const DATABASE_PATH = path.join(__dirname, '..', 'data', 'foxhole_factory_mpf_with_icons.json');
const iconCache = new Map();

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/["'’“”]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function readRecords() {
  try {
    return JSON.parse(fs.readFileSync(DATABASE_PATH, 'utf8')).records || [];
  } catch (error) {
    console.error('[foxhole-icons] Failed to read production database:', error);
    return [];
  }
}

const records = readRecords();

function findRecord(itemName) {
  const search = normalize(itemName);
  return records.find(record => normalize(record.name) === search) || null;
}

function findFoxholeItem(itemName) {
  return findRecord(itemName);
}

async function getFoxholeIconUrl(itemName) {
  const record = findRecord(itemName);
  if (!record?.icon?.api_url) return null;

  const key = record.id;
  if (iconCache.has(key)) return iconCache.get(key);

  try {
    const response = await fetch(record.icon.api_url);
    let iconUrl = null;
    if (response.ok) {
      const data = await response.json();
      const page = Object.values(data.query?.pages || {})[0];
      iconUrl = page?.thumbnail?.source || null;
    }

    if (!iconUrl) {
      const sourceResponse = await fetch(`https://foxhole.wiki.gg/api.php?action=parse&format=json&prop=wikitext&redirects=1&page=${encodeURIComponent(record.wiki_title)}`);
      if (!sourceResponse.ok) return null;
      const sourceData = await sourceResponse.json();
      const source = sourceData.parse?.wikitext?.['*'] || '';
      const imageName = source.match(/^\|\s*image\s*=\s*([^\r\n|]+)/im)?.[1]?.trim();
      if (imageName) {
        iconUrl = `https://foxhole.wiki.gg/wiki/Special:FilePath/${encodeURIComponent(imageName)}?width=64`;
      }
    }

    iconCache.set(key, iconUrl);
    return iconUrl;
  } catch (error) {
    console.error(`[foxhole-icons] Failed to fetch icon for ${record.name}:`, error);
    return null;
  }
}

module.exports = { findFoxholeItem, getFoxholeIconUrl };
