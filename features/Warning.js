const fs = require('node:fs');
const path = require('node:path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');
const { getConfig } = require('../utils/config');

const ranks = ['Cadet', 'Private', 'Legionaire', 'Dragoon', 'Hussar', 'Officer', 'Commander'];
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
  fs.writeFileSync(warningStorePath, JSON.stringify(store, null, 2));
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
  const normalized = roleName.toLowerCase();
  return guild.roles.cache.find(role => role.name.toLowerCase() === normalized) || null;
}

function getMemberRank(member) {
  return ranks.slice().reverse().find(rank => member.roles.cache.some(role => role.name === rank)) || null;
}

function getRankRoles(member) {
  return ranks
    .map(rank => getRoleByName(member.guild, rank))
    .filter(role => role && member.roles.cache.has(role.id));
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
  record.warnings = record.warnings.filter(warning => warning.forgivenAt);
}

function latestActiveWarning(record) {
  return record.warnings
    .filter(warning => !warning.forgivenAt)
    .sort((a, b) => b.createdAt - a.createdAt)[0] || null;
}

function hasOpenVoteForTarget(guildStore, targetId) {
  return Object.values(guildStore.votes).some(vote =>
    vote.targetId === targetId &&
    !vote.closed &&
    Date.now() <= vote.expiresAt
  );
}

function hasAutomatedVoteThisMonth(record) {
  return record.automatedVoteMonths?.includes(currentMonthKey());
}

function markAutomatedVoteThisMonth(record) {
  record.automatedVoteMonths ??= [];
  record.automatedVoteMonths.push(currentMonthKey());
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

function canStartRemovalVote(record, guildStore, targetId) {
  const warning = latestActiveWarning(record);
  if (!warning) {
    return false;
  }

  if (Date.now() - warning.createdAt < warningForgiveAgeMs) {
    return false;
  }

  const monthKey = currentMonthKey();
  return !record.forgivenMonths.includes(monthKey) &&
    !hasAutomatedVoteThisMonth(record) &&
    !hasOpenVoteForTarget(guildStore, targetId);
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

function buildVoteEmbed(target, vote, activeCount) {
  return new EmbedBuilder()
    .setTitle('Warning Removal Vote')
    .setColor(0xffcc00)
    .setDescription(`Vote to remove one warning from ${target}.`)
    .addFields(
      { name: 'Active warnings', value: String(activeCount), inline: true },
      { name: 'Yes votes', value: String(vote.yes.length), inline: true },
      { name: 'No votes', value: String(vote.no.length), inline: true },
      { name: 'Reason', value: vote.reason || 'No reason provided.', inline: false }
    )
    .setFooter({ text: `Needs ${requiredYesVotes} yes votes. Vote closes in 24 hours.` })
    .setTimestamp();
}

function buildVoteButtons(voteId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`warning_vote:${voteId}:yes`)
      .setLabel('Approve')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`warning_vote:${voteId}:no`)
      .setLabel('Reject')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

function createRemovalVote(guildStore, targetId, starterId, reason, automated = false) {
  const voteId = `${Date.now()}-${targetId}`;
  const vote = {
    id: voteId,
    targetId,
    starterId,
    reason,
    yes: automated ? [] : [starterId],
    no: [],
    createdAt: Date.now(),
    expiresAt: Date.now() + voteDurationMs,
    closed: false,
    automated
  };

  guildStore.votes[voteId] = vote;
  return vote;
}

async function removeOneWarning(guildStore, record, moderatorId) {
  const warning = latestActiveWarning(record);
  if (!warning) {
    return false;
  }

  warning.forgivenAt = Date.now();
  warning.forgivenBy = moderatorId;
  record.forgivenMonths.push(currentMonthKey());
  return true;
}

async function sendAutomatedRemovalVotes(client) {
  const store = readStore();
  let changed = false;

  for (const [guildId, guildStore] of Object.entries(store.guilds)) {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) continue;

    const officerChannelId = getConfig(guildId, 'OFFICER_CHANNEL_ID');
    if (!officerChannelId) {
      console.warn(`OFFICER_CHANNEL_ID not configured for guild ${guildId}; skipping automated warning removal votes.`);
      continue;
    }

    const channel = await guild.channels.fetch(officerChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) continue;

    for (const [targetId, record] of Object.entries(guildStore.members || {})) {
      if (!canStartRemovalVote(record, guildStore, targetId)) continue;

      const target = await guild.members.fetch(targetId).catch(() => null);
      const vote = createRemovalVote(
        guildStore,
        targetId,
        client.user.id,
        'This member has a warning older than 30 days. Officers may vote to remove one warning.',
        true
      );
      markAutomatedVoteThisMonth(record);
      changed = true;

      await channel.send({
        content: `Automated warning review opened for ${target || `<@${targetId}>`}.`,
        embeds: [buildVoteEmbed(target || `<@${targetId}>`, vote, activeWarningCount(record))],
        components: [buildVoteButtons(vote.id)],
        allowedMentions: { users: [targetId] }
      });
    }
  }

  if (changed) {
    writeStore(store);
  }
}

async function sendAutomaticForgiveness(client) {
  const store = readStore();
  let changed = false;

  for (const [guildId, guildStore] of Object.entries(store.guilds)) {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) continue;

    const officerChannelId = getConfig(guildId, 'OFFICER_CHANNEL_ID');
    const channel = officerChannelId ? await guild.channels.fetch(officerChannelId).catch(() => null) : null;

    for (const [targetId, record] of Object.entries(guildStore.members || {})) {
      if (hasAutomaticForgivenessThisMonth(record)) continue;

      const warning = oldestActiveWarning(record);
      if (!warning) continue;
      if (Date.now() - warning.createdAt < warningForgiveAgeMs) continue;

      // Forgive the oldest active warning
      warning.forgivenAt = Date.now();
      warning.forgivenBy = client.user?.id || 'system';
      markAutomaticForgivenessThisMonth(record);
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
        .setDescription('The reason for the warning')
        .setRequired(true)
    )
    .setDMPermission(false),

  statusData: new SlashCommandBuilder()
    .setName('warningstatus')
    .setDescription('List all members with active warnings.')
    .setDMPermission(false),

  init(client) {
    client.once('ready', async () => {
      await sendAutomatedRemovalVotes(client).catch(error => {
        console.error('Error sending automated warning removal votes:', error);
      });

      await sendAutomaticForgiveness(client).catch(error => {
        console.error('Error running automatic forgiveness:', error);
      });

      setInterval(() => {
        sendAutomatedRemovalVotes(client).catch(error => {
          console.error('Error sending automated warning removal votes:', error);
        });
      }, checkIntervalMs);

      setInterval(() => {
        sendAutomaticForgiveness(client).catch(error => {
          console.error('Error running automatic forgiveness:', error);
        });
      }, oneDayMs);
    });
  },

  async execute(interaction) {
    if (!isOfficer(interaction.member)) {
      return interaction.reply({ content: 'Only Officers and Commanders can manage warnings.', ephemeral: true });
    }

    const target = interaction.options.getMember('user', true);
    if (!target || !target.guild) {
      return interaction.reply({ content: 'That member is not available.', ephemeral: true });
    }

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
    const [, voteId, choice] = interaction.customId.split(':');
    const store = readStore();
    const guildStore = getGuildStore(store, interaction.guild.id);
    const vote = guildStore.votes[voteId];

    if (!vote) {
      return interaction.reply({ content: 'That warning vote no longer exists.', ephemeral: true });
    }

    if (vote.closed || Date.now() > vote.expiresAt) {
      vote.closed = true;
      writeStore(store);
      return interaction.reply({ content: 'That warning vote is already closed.', ephemeral: true });
    }

    if (!isOfficer(interaction.member)) {
      return interaction.reply({ content: 'Only Officers and Commanders can vote on warnings.', ephemeral: true });
    }

    vote.yes = vote.yes.filter(id => id !== interaction.user.id);
    vote.no = vote.no.filter(id => id !== interaction.user.id);
    vote[choice].push(interaction.user.id);

    const target = await interaction.guild.members.fetch(vote.targetId).catch(() => null);
    const record = getMemberRecord(guildStore, vote.targetId);
    let components = [buildVoteButtons(voteId)];
    let content = `Vote recorded for ${target || `<@${vote.targetId}>`}.`;

    if (vote.yes.length >= requiredYesVotes) {
      const removed = await removeOneWarning(guildStore, record, interaction.user.id);
      if (removed && target) {
        await syncWarningRoles(target, activeWarningCount(record));
      }
      vote.closed = true;
      content = removed
        ? `Vote passed. One warning was removed from ${target || `<@${vote.targetId}>`}.`
        : 'Vote passed, but there were no active warnings left to remove.';
      components = [buildVoteButtons(voteId, true)];
    }

    writeStore(store);

    await interaction.update({
      content,
      embeds: [buildVoteEmbed(target || `<@${vote.targetId}>`, vote, activeWarningCount(record))],
      components,
      allowedMentions: { users: [vote.targetId] }
    });
  }
};
