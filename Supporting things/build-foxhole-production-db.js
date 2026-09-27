const fs = require('node:fs');

const apiUrl = 'https://foxhole.wiki.gg/api.php';
const sourcePages = {
  factory: 'https://foxhole.wiki.gg/wiki/Factory',
  mpf: 'https://foxhole.wiki.gg/wiki/Mass_Production_Factory',
};

const factoryCategories = [
  'Small Arms', 'Heavy Arms', 'Heavy Ammunition', 'Utility', 'Medical', 'Resources', 'Uniforms',
];
const mpfCategories = [
  'Small Arms', 'Heavy Arms', 'Heavy Ammunition', 'Resources', 'Uniforms', 'Vehicles', 'Structures',
];
const factions = [
  { code: 'Col', name: 'Colonial' },
  { code: 'War', name: 'Warden' },
];

function htmlDecode(value) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function wikiLinks(value) {
  return [...value.matchAll(/\[\[([^|\]]+)(?:\|[^\]]+)?\]\]/g)]
    .map(match => match[1].trim())
    .filter(link => !link.startsWith('File:'));
}

function tableRows(html) {
  return html.split(/<tr[^>]*>/i).slice(2).map(row => row.split('</tr>')[0]).filter(Boolean);
}

function cells(row) {
  return [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(match => match[1]);
}

async function expand(text) {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'HUSS-HQ production database builder' },
    body: new URLSearchParams({ action: 'expandtemplates', format: 'json', prop: 'wikitext', text }),
  });
  if (!response.ok) throw new Error(`Wiki API returned ${response.status}`);
  const json = await response.json();
  return json.expandtemplates?.wikitext || '';
}

function addRecord(records, record) {
  const key = record.name.toLowerCase();
  const existing = records.get(key);
  if (!existing) {
    records.set(key, record);
    return;
  }

  existing.factory ||= record.factory;
  existing.mpf ||= record.mpf;
  existing.factions = [...new Set([...existing.factions, ...record.factions])].sort();
  existing.categories = [...new Set([...existing.categories, ...record.categories])].sort();
  existing.production = [...new Set([...existing.production, ...record.production])].sort();
  if (!existing.amount_per_crate && record.amount_per_crate) existing.amount_per_crate = record.amount_per_crate;
  if (!existing.time_per_crate && record.time_per_crate) existing.time_per_crate = record.time_per_crate;
  existing.sources = [...new Set([...existing.sources, ...record.sources])];
}

function makeRecord(name, category, type, faction, method, amount, time) {
  const wikiTitle = name.replace(/ /g, '_');
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    name,
    type,
    category,
    faction,
    factions: [faction],
    factory: method === 'factory',
    mpf: method === 'mpf',
    ...(amount ? { amount_per_crate: amount } : {}),
    ...(time ? { time_per_crate: time } : {}),
    production: [method],
    categories: [category],
    wiki_title: name,
    wiki_page: `https://foxhole.wiki.gg/wiki/${encodeURIComponent(wikiTitle).replace(/%2F/g, '/')}`,
    icon: {
      provider: 'foxhole_wiki_pageimages',
      api_url: `${apiUrl}?action=query&format=json&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=256&titles=${encodeURIComponent(name).replace(/%20/g, '+')}`,
      extract: 'query.pages.*.thumbnail.source',
      size: 256,
    },
    sources: [sourcePages[method]],
  };
}

async function main() {
  const records = new Map();

  for (const faction of factions) {
    for (const category of factoryCategories) {
      const html = await expand(`{{RecipeSource3|Factory|${category}|${faction.code}}}`);
      for (const row of tableRows(html)) {
        const rowCells = cells(row);
        if (rowCells.length < 3) continue;
        const outputLinks = wikiLinks(rowCells[1]);
        const name = outputLinks.at(-1);
        if (!name || name === 'Crate') continue;
        const amountMatch = htmlDecode(rowCells[1]).match(/of\s+(\d+)\s*x/i);
        const amount = amountMatch ? Number(amountMatch[1]) : null;
        const time = htmlDecode(rowCells.at(-1));
        addRecord(records, makeRecord(name, category, 'item', faction.name, 'factory', amount, time));
      }
    }

    for (const category of mpfCategories) {
      const type = category === 'Vehicles' ? 'vehicle' : category === 'Structures' ? 'structure' : 'item';
      const categoryArgument = category === 'Vehicles' || category === 'Structures' ? '' : category;
      const template = `{{RecipeSourceMPF3|${categoryArgument}|${type}|${faction.code}}}`;
      const html = await expand(template);
      for (const row of tableRows(html)) {
        const rowCells = cells(row);
        if (rowCells.length < 3) continue;
        const name = wikiLinks(rowCells[0])[0];
        if (!name || name === 'Crate') continue;
        const amountMatch = htmlDecode(rowCells[1]).match(/\d+/);
        const amount = amountMatch ? Number(amountMatch[0]) : null;
        const time = htmlDecode(rowCells[2]);
        addRecord(records, makeRecord(name, category, type, faction.name, 'mpf', amount, time));
      }
    }
  }

  const output = {
    name: 'Foxhole Factory + MPF Production Database',
    generated_on: new Date().toISOString().slice(0, 10),
    foxhole_version: '1.65',
    faction_scope: 'Warden and Colonial',
    record_count: records.size,
    source_sections: {
      factory: factoryCategories.map(category => `${sourcePages.factory}#${category.replace(/ /g, '_')}-1`),
      mpf: mpfCategories.map(category => `${sourcePages.mpf}#${category.replace(/ /g, '_')}-1`),
    },
    records: [...records.values()].sort((left, right) => left.name.localeCompare(right.name)),
  };

  fs.writeFileSync('data/foxhole_factory_mpf_with_icons.json', JSON.stringify(output, null, 2) + '\n');
  console.log(`records=${output.record_count}`);
  console.log(`factory=${output.records.filter(record => record.factory).length}`);
  console.log(`mpf=${output.records.filter(record => record.mpf).length}`);
  console.log(`vehicles=${output.records.filter(record => record.type === 'vehicle').length}`);
  console.log(`structures=${output.records.filter(record => record.type === 'structure').length}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
