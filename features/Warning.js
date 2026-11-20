const fs = require('../utils/data-fs');
const path = require('node:path');
const {
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');
const { getConfig } = require('../utils/config');
const { canModerate } = require('../utils/ranks');
const audit = require('../utils/audit');

const { ranks, matchesRank } = require('../utils/ranks');
const officerRanks = ['Officer', 'Commander'];
const warningRoleNames = ['Warning I', 'Warning II', 'Warning III'];
const warningStorePath = path.join(__dirname, '..', 'data', 'warnings.json');
const oneDayMs = 86_400_000;
const warningForgiveAgeMs = 30 * oneDayMs;
const voteDurationMs = oneDayMs;
const requiredYesVotes = 2;
const checkIntervalMs = 60 * 60 * 1000;

function cleanEnvValue(value) {
  return value?.split('//')[0].trim();
}

function ensureStore() {
  const dir = path.dirname(warningStorePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(warningStorePath)) {
    fs.writeFileSync(warningStorePath, JSON.stringify({ guilds: {} }, null, 2));
  }
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(warningStorePath, 'utf8'));
}

function writeStore(store) {
  ensureStore();
  fs.writeFileSync(`${warningStorePath}.tmp`, JSON.stringify(store, null, 2));
  fs.renameSync(`${warningStorePath}.tmp`, warningStorePath);
}

function getGuildStore(store, guildId) {
  store.guilds[guildId] ??= { members: {}, votes: {} };
  store.guilds[guildId].members ??= {};
  store.guilds[guildId].votes ??= {};
  return store.guilds[guildId];
}

function getMemberRecord(guildStore, userId) {
  guildStore.members[userId] ??= { warnings: [], forgivenMonths: [] };
  guildStore.members[userId].warnings ??= [];
  guildStore.members[userId].forgivenMonths ??= [];
  return guildStore.members[userId];
}

function getRoleByName(guild, roleName) {
  if (ranks.includes(roleName)) return require('../utils/ranks').getRankRole(guild,roleName);
  const key = roleName === 'Member' ? 'VERIFIED_MEMBER_ROLE_ID' : `${roleName.toUpperCase().replaceAll(' ', '_')}_ROLE_ID`;
  const configured = getConfig(guild.id,key);
  if(configured)return guild.roles.cache.get(configured)||null;
  const normalized = roleName.toLowerCase();
  return guild.roles.cache.find(role => role.name.toLowerCase() === normalized || matchesRank(role, roleName)) || null;
}

const { getMemberRank } = require('../utils/ranks');

function getRankRoles(member) {
  return require('../utils/ranks').getMemberRankRoles(member);
}

function getWarningRoles(guild) {
  return warningRoleNames
    .map(roleName => getRoleByName(guild, roleName))
    .filter(Boolean);
}

function isOfficer(member) {
  const rank = getMemberRank(member);
  return officerRanks.includes(rank);
}

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

function activeWarningCount(record) {
  return record.warnings.filter(warning => !warning.forgivenAt).length;
}

function clearActiveWarnings(record) {
  for (const warning of record.warnings.filter(warning => !warning.forgivenAt)) {
    warning.forgivenAt = Date.now();
    warning.resolution = 'discharge';
  }
}

function oldestActiveWarning(record) {
  return record.warnings
    .filter(w => !w.forgivenAt)
    .sort((a, b) => a.createdAt - b.createdAt)[0] || null;
}

function hasAutomaticForgivenessThisMonth(record) {
  return record.automaticForgivenessMonths?.includes(currentMonthKey());
}

function markAutomaticForgivenessThisMonth(record) {
  record.automaticForgivenessMonths ??= [];
  record.automaticForgivenessMonths.push(currentMonthKey());
}

function formatWarningList(record) {
  const activeWarnings = record.warnings.filter(warning => !warning.forgivenAt);
  if (!activeWarnings.length) {
    return 'No active warnings.';
  }

  return activeWarnings
    .map((warning, index) => `${index + 1}. <t:${Math.floor(warning.createdAt / 1000)}:d> by <@${warning.moderatorId}> - ${warning.reason}`)
    .join('\n')
    .slice(0, 1024);
}

function formatWarningSummary(guildStore) {
  const rows = Object.entries(guildStore.members || {})
    .map(([userId, record]) => ({ userId, count: activeWarningCount(record) }))
    .filter(row => row.count > 0)
    .sort((a, b) => b.count - a.count);

  if (!rows.length) {
    return 'No members have active warnings.';
  }

  return rows
    .map((row, index) => `${index + 1}. <@${row.userId}> - ${row.count} warning${row.count === 1 ? '' : 's'}`)
    .join('\n')
    .slice(0, 4096);
}

async function dischargeMember(member) {
  const unverifiedRole = getRoleByName(member.guild, 'unverified');
  const formerCollieRole = getRoleByName(member.guild, 'Former collie');
  const rolesToRemove = [
    ...getRankRoles(member),
    ...member.roles.cache.filter(role => role.id === getRoleByName(member.guild,'Member')?.id).values(),
    ...getWarningRoles(member.guild).filter(role => member.roles.cache.has(role.id))
  ];

  if (rolesToRemove.length) {
    await member.roles.remove(rolesToRemove);
  }

  const rolesToAdd = [unverifiedRole, formerCollieRole].filter(Boolean);
  if (rolesToAdd.length) {
    await member.roles.add(rolesToAdd);
  }

  return {
    missingRoles: [
      ...(!unverifiedRole ? ['unverified'] : []),
      ...(!formerCollieRole ? ['Former collie'] : [])
    ]
  };
}

async function demoteMember(member) {
  const currentRank = getMemberRank(member);
  const rolesToRemove = getRankRoles(member);

  if (rolesToRemove.length) {
    await member.roles.remove(rolesToRemove);
  }

  if (!currentRank) {
    return { missingRoles: [] };
  }

  const idx = ranks.indexOf(currentRank);
  // If already at lowest rank (Cadet) remove rank roles and leave unranked
  if (idx <= 0) {
    return { missingRoles: [] };
  }

  const newRank = ranks[idx - 1];
  const newRole = getRoleByName(member.guild, newRank);
  if (newRole) {
    await member.roles.add(newRole);
    return { missingRoles: [] };
  }

  return { missingRoles: [newRank] };
}

async function syncWarningRoles(member, warningCount) {
  const warningRoles = getWarningRoles(member.guild);
  const roleToAdd = warningCount > 0
    ? getRoleByName(member.guild, warningRoleNames[Math.min(warningCount, warningRoleNames.length) - 1])
    : null;
  const rolesToRemove = warningRoles.filter(role => role.id !== roleToAdd?.id && member.roles.cache.has(role.id));

  if (rolesToRemove.length) {
    await member.roles.remove(rolesToRemove);
  }

  if (roleToAdd && !member.roles.cache.has(roleToAdd.id)) {
    await member.roles.add(roleToAdd);
  }

  return warningRoleNames.filter(roleName => !getRoleByName(member.guild, roleName));
}

let warningQueue = Promise.resolve();
function serialized(action) {
  const next = warningQueue.then(action);
  warningQueue = next.catch(() => {});
  return next;
}
function sendAutomaticForgiveness(client) { return serialized(() => runAutomaticForgiveness(client)); }
async function runAutomaticForgiveness(client) {
  const store = readStore();
  let changed = false;

  for (const [guildId, guildStore] of Object.entries(store.guilds)) {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) continue;

    const officerChannelId = getConfig(guildId, 'OFFICER_CHANNEL_ID');
    const channel = officerChannelId ? await guild.channels.fetch(officerChannelId).catch(() => null) : null;

    for (const [targetId, record] of Object.entries(guildStore.members || {})) {
      if (!record.lastAutomaticForgivenessAt && hasAutomaticForgivenessThisMonth(record)) continue;
      if (record.lastAutomaticForgivenessAt && Date.now() - record.lastAutomaticForgivenessAt < warningForgiveAgeMs) continue;

      const warning = oldestActiveWarning(record);
      if (!warning) continue;
      if (Date.now() - warning.createdAt < warningForgiveAgeMs) continue;

      // Forgive the oldest active warning
      warning.forgivenAt = Date.now();
      warning.forgivenBy = client.user?.id || 'system';
      markAutomaticForgivenessThisMonth(record);
      record.lastAutomaticForgivenessAt = Date.now();
      changed = true;

      // Try to sync roles for the member if available
      const member = await guild.members.fetch(targetId).catch(() => null);
      if (member) {
        await syncWarningRoles(member, activeWarningCount(record)).catch(() => {});
      }

      // Notify officer channel if configured
      if (channel && channel.isTextBased()) {
        channel.send({ content: `Automatically removed one warning from <@${targetId}>.`, allowedMentions: { parse: [] } }).catch(() => {});
      }
    }
  }

  if (changed) {
    writeStore(store);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warning')
    .setDescription('Give a member a warning.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The member to warn')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason')
.setDescription('The reason for the warning').setMaxLength(1000)
        .setRequired(true)
    )
    .setDMPermission(false),

  statusData: new SlashCommandBuilder()
    .setName('warningstatus')
    .setDescription('List all members with active warnings.')
    .setDMPermission(false),

  init(client) {
    client.once('clientReady', async () => {
      await sendAutomaticForgiveness(client).catch(error => {
        console.error('Error running automatic forgiveness:', error);
      });

      setInterval(() => {
        sendAutomaticForgiveness(client).catch(error => {
          console.error('Error running automatic forgiveness:', error);
        });
      }, oneDayMs);
    });
  },

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const deferred = Object.create(interaction);
    deferred.reply = payload => interaction.editReply(payload);
    return serialized(() => module.exports.executeWarning(deferred));
  },
  async executeWarning(interaction) {
    if (!isOfficer(interaction.member)) {
      return interaction.reply({ content: 'Only Officers and Commanders can manage warnings.', ephemeral: true });
    }

    const target = interaction.options.getMember('user', true);
    if (!target || !target.guild) {
      return interaction.reply({ content: 'That member is not available.', ephemeral: true });
    }
    if (!canModerate(interaction.member, target)) return interaction.reply({ content: 'You can only warn members below your own rank, never yourself.', ephemeral: true });

    const store = readStore();
    const guildStore = getGuildStore(store, interaction.guild.id);
    const record = getMemberRecord(guildStore, target.id);

    const reason = interaction.options.getString('reason', true);
    record.warnings.push({
      id: `${Date.now()}-${target.id}`,
      reason,
      moderatorId: interaction.user.id,
      createdAt: Date.now()
    });

    const warningCount = activeWarningCount(record);
    let displayedWarningCount = warningCount;
    let consequence = 'No consequence.';
    const missingRoles = [];
    let missingWarningRoles = [];

    const requiredRoles = getWarningRoles(target.guild);
    if (warningCount === 2) {
      requiredRoles.push(...getRankRoles(target));
      const index = ranks.indexOf(getMemberRank(target));
      if (index > 0) {
        const next = getRoleByName(target.guild, ranks[index - 1]);
        if (!next) return interaction.reply({ content: 'The demotion role is missing. No warning was recorded.', ephemeral: true });
        requiredRoles.push(next);
      }
    }
    if (warningCount >= 3) {
      const unverified = getRoleByName(target.guild, 'unverified');
      if (!unverified) return interaction.reply({ content: 'The unverified role is missing. No warning was recorded.', ephemeral: true });
      requiredRoles.push(unverified, getRoleByName(target.guild, 'Former collie'), ...getRankRoles(target), getRoleByName(target.guild, 'Member'));
    }
    if (requiredRoles.filter(Boolean).some(role => role.editable === false)) return interaction.reply({ content: 'The bot cannot manage all required warning or rank roles. No warning was recorded.', ephemeral: true });

    if (warningCount === 2) {
      missingWarningRoles = await syncWarningRoles(target, warningCount);
      const demotion = await demoteMember(target);
      if (demotion && demotion.missingRoles?.length) {
        missingRoles.push(...demotion.missingRoles);
      }
      consequence = 'Demoted by one rank.';
    } else if (warningCount >= 3) {
      const discharge = await dischargeMember(target);
      missingRoles.push(...discharge.missingRoles);
      clearActiveWarnings(record);
      displayedWarningCount = 0;
      consequence = 'Discharged from the regiment. Active warnings cleared.';
    } else {
      missingWarningRoles = await syncWarningRoles(target, warningCount);
    }

    writeStore(store);

    audit.record(interaction, 'warning.issued', target.id, { reason, consequence });

    const embed = new EmbedBuilder()
      .setTitle('Warning Issued')
      .setColor(0xff0000)
      .setDescription(`${target} now has **${displayedWarningCount}** active warning${displayedWarningCount === 1 ? '' : 's'}.`)
      .addFields(
        { name: 'Reason', value: reason, inline: false },
        { name: 'Consequence', value: consequence, inline: false },
        { name: 'Active warnings', value: formatWarningList(record), inline: false }
      )
      .setFooter({ text: `Warned by ${interaction.user.tag}` })
      .setTimestamp();

    if (missingRoles.length) {
      embed.addFields({ name: 'Missing discharge roles', value: missingRoles.join(', '), inline: false });
    }

    if (missingWarningRoles.length) {
      embed.addFields({ name: 'Missing warning roles', value: missingWarningRoles.join(', '), inline: false });
    }

    return interaction.reply({ content: `${target}`, embeds: [embed], allowedMentions: { users: [target.id] } });
  },

  async executeStatus(interaction) {
    if (!isOfficer(interaction.member)) {
      return interaction.reply({ content: 'Only Officers and Commanders can view warning status.', ephemeral: true });
    }

    const store = readStore();
    const guildStore = getGuildStore(store, interaction.guild.id);
    const embed = new EmbedBuilder()
      .setTitle('Warning Status')
      .setColor(0xffcc00)
      .setDescription(formatWarningSummary(guildStore))
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true, allowedMentions: { parse: [] } });
  },

  async handleButton(interaction) {
    return interaction.reply({ content: 'Warning votes have been retired. One eligible warning expires automatically after 30 days.', ephemeral: true });
  }
};

module.exports.runAutomaticForgiveness = sendAutomaticForgiveness;
