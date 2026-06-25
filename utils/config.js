const fs = require('node:fs');
const path = require('node:path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'config.json');

function cleanEnvValue(value) {
  if (!value) return null;
  let cleaned = value.trim();
  cleaned = cleaned.replace(/(?:\s*#.*$)|(?:\s*\/\/.*$)/, '').trim();
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1);
  }
  return cleaned || null;
}

function readStore() {
  if (!fs.existsSync(STORE_PATH)) return { guilds: {} };
  try { return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); }
  catch { return { guilds: {} }; }
}

function writeStore(data) {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

/**
 * Get a config value for a guild.
 * Checks guild-specific config first, falls back to .env.
 */
function getConfig(guildId, key) {
  const store = readStore();
  return store.guilds[guildId]?.[key] || cleanEnvValue(process.env[key]) || null;
}

/**
 * Set a config value for a guild and persist it.
 */
function setConfig(guildId, key, value) {
  const store = readStore();
  if (!store.guilds[guildId]) store.guilds[guildId] = {};
  store.guilds[guildId][key] = value;
  writeStore(store);
}

/**
 * Get all config values for a guild (merged with .env fallbacks).
 */
function getAllConfig(guildId) {
  const store = readStore();
  const guildConfig = store.guilds[guildId] || {};
  const keys = [
    'WELCOME_CHANNEL_ID',
    'VERIFICATION_CHANNEL_ID',
    'RULES_CHANNEL_ID',
    'LOG_CHANNEL_ID',
    'OFFICER_CHANNEL_ID',
    'RECRUITMENT_OFFICER_ROLE_ID',
    'TICKET_CATEGORY_ID',
    'TICKET_LOG_CHANNEL_ID',
    'OPERATIONS_CHANNEL_ID',
    'TRAININGS_CHANNEL_ID',
    'KILLCOUNT_CHANNEL_ID',
    'ACTIVE_WAR_ROLE_ID',
    'ALLY_ROLE_ID',
    'COLLIE_ROLE_ID',
    'UNVERIFIED_ROLE_ID',
    'FORMER_MEMBER_ROLE_ID',
    'WELCOME_IMAGE_URL'
  ];
  const result = {};
  for (const key of keys) {
    result[key] = guildConfig[key] || cleanEnvValue(process.env[key]) || null;
  }
  return result;
}

module.exports = { getConfig, setConfig, getAllConfig };
