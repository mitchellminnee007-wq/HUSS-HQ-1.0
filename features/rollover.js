const fs = require('node:fs');
const path = require('node:path');
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getConfig } = require('../utils/config');

const ACTIVE_ROLE_ID        = '1424722021325082625'; // Active role
const UNVERIFIED_ROLE_ID    = '1386229683963826346';
const FORMER_MEMBER_ROLE_ID = '1426128855202271242';

const ROLLOVER_DAYS  = 4;
const ROLLOVER_MS = 4 * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL = 5 * 60 * 1000; // check every 5 minutes
const STORE_PATH     = path.join(__dirname, '..', 'data', 'rollover.json');

const OFFICER_RANKS = ['Officer', 'Commander'];

let intervalStarted = false;

// ── Persistence helpers ───────────────────────────────────────────────────────

function readStore() {
  if (!fs.existsSync(STORE_PATH)) return { guilds: {} };

  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return { guilds: {} };
  }
}

function writeStore(data) {
  const dir = path.dirname(STORE_PATH);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

function isOfficer(member) {
  return member.roles.cache.some(role => OFFICER_RANKS.includes(role.name));
}

function roleName(role) {
  return role ? `${role.name} (${role.id})` : 'Not found';
}

function canEditRole(role) {
  return role && role.editable && !role.managed;
}

// ── Core rollover logic ───────────────────────────────────────────────────────

async function executeRollover(guild, notifyChannelId, dryRun = false) {
  console.log(`[Rollover] Starting rollover for guild: ${guild.name} (${guild.id})`);
  console.log(`[Rollover] Dry run: ${dryRun}`);

  await guild.members.fetch();
  await guild.roles.fetch();

  const activeRoleId = ACTIVE_ROLE_ID;
  const allyRoleId = getConfig(guild.id, 'ALLY_ROLE_ID') || null;

  const activeRole = guild.roles.cache.get(activeRoleId)
    ?? await guild.roles.fetch(activeRoleId).catch(() => null);

  const allyRole = allyRoleId
    ? guild.roles.cache.get(allyRoleId) ?? await guild.roles.fetch(allyRoleId).catch(() => null)
    : null;

  const unverifiedRole = guild.roles.cache.get(UNVERIFIED_ROLE_ID)
    ?? await guild.roles.fetch(UNVERIFIED_ROLE_ID).catch(() => null);

  const formerMemberRole = guild.roles.cache.get(FORMER_MEMBER_ROLE_ID)
    ?? await guild.roles.fetch(FORMER_MEMBER_ROLE_ID).catch(() => null);

  console.log(`[Rollover] Active role: ${roleName(activeRole)}`);
  console.log(`[Rollover] Ally role: ${roleName(allyRole)}`);
  console.log(`[Rollover] Unverified role: ${roleName(unverifiedRole)}`);
  console.log(`[Rollover] Former Member role: ${roleName(formerMemberRole)}`);

  if (!activeRole) {
    console.warn(`[Rollover] WARNING: Active role was not found: ${ACTIVE_ROLE_ID}`);
    console.warn('[Rollover] Everyone will be treated as inactive if this role cannot be found.');
  }

  if (!unverifiedRole) {
    console.warn(`[Rollover] WARNING: Unverified role was not found: ${UNVERIFIED_ROLE_ID}`);
  } else if (!canEditRole(unverifiedRole)) {
    console.warn(`[Rollover] WARNING: Bot cannot add Unverified role: ${roleName(unverifiedRole)}. Move the bot role above it.`);
  }

  if (!formerMemberRole) {
    console.warn(`[Rollover] WARNING: Former Member role was not found: ${FORMER_MEMBER_ROLE_ID}`);
  } else if (!canEditRole(formerMemberRole)) {
    console.warn(`[Rollover] WARNING: Bot cannot add Former Member role: ${roleName(formerMemberRole)}. Move the bot role above it.`);
  }

  if (allyRole && !canEditRole(allyRole)) {
    console.warn(`[Rollover] WARNING: Bot cannot remove Ally role: ${roleName(allyRole)}. Move the bot role above it.`);
  }

  let alliesRemoved = 0;
  let alliesFailed = 0;
  let membersReset = 0;
  let membersFailed = 0;
  let activeMembersSkipped = 0;
  let rolesRemoved = 0;
  let rolesFailed = 0;

  const members = [...guild.members.cache.values()];

  for (const member of members) {
    if (member.user.bot) {
      console.log(`[Rollover] Skipping bot: ${member.user.tag}`);
      continue;
    }

    if (member.id === guild.ownerId) {
      console.log(`[Rollover] Skipping server owner: ${member.user.tag}`);
      continue;
    }

    const hasActiveRole = activeRole && member.roles.cache.has(activeRole.id);

    // Active members keep their roles and are skipped completely
    if (hasActiveRole) {
      activeMembersSkipped++;
      console.log(`[Rollover] Active member skipped, roles kept: ${member.user.tag}`);
      continue;
    }

    // Remove ally role from non-active allies
    if (allyRole && member.roles.cache.has(allyRole.id)) {
      try {
        if (!canEditRole(allyRole)) {
          throw new Error(`Bot cannot remove ally role "${allyRole.name}". Bot role is probably too low.`);
        }

        if (!dryRun) {
          await member.roles.remove(allyRole);
        }

        alliesRemoved++;
        console.log(`[Rollover] Ally role removed from ${member.user.tag}`);
      } catch (err) {
        alliesFailed++;
        console.warn(`[Rollover] Could not remove ally role from ${member.user.tag}:`, err.message);
      }
    }

    // Inactive members lose normal roles and get Unverified + Former Member
    try {
      console.log(`[Rollover] Resetting inactive member: ${member.user.tag}`);

      const rolesToRemove = member.roles.cache.filter(role => {
        if (role.id === guild.id) return false; // @everyone
        if (role.managed) return false; // bot/integration roles
        return true;
      });

      for (const role of rolesToRemove.values()) {
        try {
          if (!canEditRole(role)) {
            rolesFailed++;
            console.warn(`[Rollover] Cannot remove role "${role.name}" from ${member.user.tag}. Bot role is probably too low.`);
            continue;
          }

          if (!dryRun) {
            await member.roles.remove(role);
          }

          rolesRemoved++;
          console.log(`[Rollover] Removed role "${role.name}" from ${member.user.tag}`);
        } catch (err) {
          rolesFailed++;
          console.warn(`[Rollover] Failed to remove role "${role.name}" from ${member.user.tag}:`, err.message);
        }
      }

      if (unverifiedRole) {
        if (!canEditRole(unverifiedRole)) {
          rolesFailed++;
          console.warn(`[Rollover] Cannot add Unverified to ${member.user.tag}. Bot role is probably too low.`);
        } else if (!dryRun) {
          await member.roles.add(unverifiedRole);
          console.log(`[Rollover] Added Unverified to ${member.user.tag}`);
        }
      }

      if (formerMemberRole) {
        if (!canEditRole(formerMemberRole)) {
          rolesFailed++;
          console.warn(`[Rollover] Cannot add Former Member to ${member.user.tag}. Bot role is probably too low.`);
        } else if (!dryRun) {
          await member.roles.add(formerMemberRole);
          console.log(`[Rollover] Added Former Member to ${member.user.tag}`);
        }
      }

      membersReset++;
    } catch (err) {
      membersFailed++;
      console.warn(`[Rollover] Could not reset roles for ${member.user.tag}:`, err.message);
    }
  }

  // Send notification embed
  if (notifyChannelId) {
    const channel = await guild.channels.fetch(notifyChannelId).catch(() => null);

    if (channel) {
      const embed = new EmbedBuilder()
        .setColor(dryRun ? 0x3498DB : 0xF39C12)
        .setTitle(dryRun ? '🔍 Rollover Dry Run Result' : '🔄 Automatic Rollover Complete')
        .setDescription(
          dryRun
            ? `Dry run for the **${ROLLOVER_DAYS}-day** rollover. No changes were applied.`
            : `The **${ROLLOVER_DAYS}-day** rollover has executed.`
        )
        .addFields(
          { name: 'Allies removed', value: `${alliesRemoved}`, inline: true },
          { name: 'Allies failed', value: `${alliesFailed}`, inline: true },
          { name: 'Members reset', value: `${membersReset}`, inline: true },
          { name: 'Members failed', value: `${membersFailed}`, inline: true },
          { name: 'Active members skipped', value: `${activeMembersSkipped}`, inline: true },
          { name: 'Roles removed', value: `${rolesRemoved}`, inline: true },
          { name: 'Role actions failed', value: `${rolesFailed}`, inline: true },
          {
            name: 'Config',
            value:
              `Active role: ${activeRole ? `<@&${activeRole.id}>` : `*Not found: ${ACTIVE_ROLE_ID}*`}\n` +
              `Ally role: ${allyRole ? `<@&${allyRole.id}>` : '*Not configured*'}\n` +
              `Unverified role: ${unverifiedRole ? `<@&${unverifiedRole.id}>` : '*Not found*'}\n` +
              `Former Member role: ${formerMemberRole ? `<@&${formerMemberRole.id}>` : '*Not found*'}\n` +
              (dryRun ? '\n**Dry run — no role changes were made.**' : ''),
            inline: false
          }
        )
        .setFooter({ text: 'Powered by Hypha' })
        .setTimestamp();

      await channel.send({ embeds: [embed] }).catch(() => {});
    }
  }

  return {
    alliesRemoved,
    alliesFailed,
    membersReset,
    membersFailed,
    activeMembersSkipped,
    rolesRemoved,
    rolesFailed
  };
}

// ── Background checker ────────────────────────────────────────────────────────

async function checkScheduledRollovers(client) {
  const store = readStore();
  let changed = false;

  for (const [guildId, entry] of Object.entries(store.guilds)) {
    if (Date.now() < entry.executeAt) continue;

    const guild = client.guilds.cache.get(guildId);

    if (!guild) {
      console.warn(`[Rollover] Guild ${guildId} not found in cache. Removing scheduled rollover.`);
      delete store.guilds[guildId];
      changed = true;
      continue;
    }

    try {
      const result = await executeRollover(guild, entry.notifyChannelId, false);

      console.log(
        `[Rollover] Executed for guild ${guildId} — ` +
        `alliesRemoved=${result.alliesRemoved}, ` +
        `membersReset=${result.membersReset}, ` +
        `activeMembersSkipped=${result.activeMembersSkipped}, ` +
        `rolesRemoved=${result.rolesRemoved}, ` +
        `rolesFailed=${result.rolesFailed}`
      );
    } catch (err) {
      console.error(`[Rollover] Failed for guild ${guildId}:`, err);
    }

    delete store.guilds[guildId];
    changed = true;
  }

  if (changed) {
    writeStore(store);
  }
}

// ── Module export ─────────────────────────────────────────────────────────────

module.exports = {
  // /startrollover
  data: new SlashCommandBuilder()
    .setName('startrollover')
    .setDescription(`Schedule the rollover: reset non-active members in ${ROLLOVER_DAYS} days.`)
    .setDMPermission(false),

  async execute(interaction) {
    if (!isOfficer(interaction.member)) {
      return interaction.reply({
        content: 'Only Officers and Commanders can schedule a rollover.',
        ephemeral: true
      });
    }

    const store = readStore();

    if (store.guilds[interaction.guildId]) {
      const existing = store.guilds[interaction.guildId];
      const remainingMs = existing.executeAt - Date.now();
      const remainingHours = Math.max(0, Math.ceil(remainingMs / (1000 * 60 * 60)));

      return interaction.reply({
        content: `A rollover is already scheduled in approximately **${remainingHours} hour(s)**. Use \`/cancelrollover\` first to reschedule.`,
        ephemeral: true
      });
    }

    const executeAt = Date.now() + ROLLOVER_MS;

    store.guilds[interaction.guildId] = {
      executeAt,
      notifyChannelId: interaction.channelId,
      startedBy: interaction.user.id
    };

    writeStore(store);

    const timestamp = Math.floor(executeAt / 1000);

    const embed = new EmbedBuilder()
      .setColor(0xF39C12)
      .setTitle('⏳ Rollover Scheduled')
      .setDescription(
        `In **${ROLLOVER_DAYS} days**, members without the active role <@&${ACTIVE_ROLE_ID}> will have their roles removed and will receive <@&${UNVERIFIED_ROLE_ID}> and <@&${FORMER_MEMBER_ROLE_ID}>.`
      )
      .addFields(
        { name: 'Executes at', value: `<t:${timestamp}:F> (<t:${timestamp}:R>)` },
        { name: 'Active role', value: `<@&${ACTIVE_ROLE_ID}>`, inline: true },
        { name: 'Test now', value: 'Use `/runrollover dry:true` to simulate or `/runrollover dry:false` to actually run it now.' }
      )
      .setFooter({ text: `Scheduled by ${interaction.user.tag} • Powered by Hypha` })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },

  // /cancelrollover
  cancelData: new SlashCommandBuilder()
    .setName('cancelrollover')
    .setDescription('Cancel a pending automatic rollover.')
    .setDMPermission(false),

  async executeCancel(interaction) {
    if (!isOfficer(interaction.member)) {
      return interaction.reply({
        content: 'Only Officers and Commanders can cancel a rollover.',
        ephemeral: true
      });
    }

    const store = readStore();

    if (!store.guilds[interaction.guildId]) {
      return interaction.reply({
        content: 'There is no rollover scheduled for this server.',
        ephemeral: true
      });
    }

    delete store.guilds[interaction.guildId];
    writeStore(store);

    return interaction.reply({
      content: '✅ Scheduled rollover has been **cancelled**.',
      ephemeral: true
    });
  },

  // /runrollover
  runData: new SlashCommandBuilder()
    .setName('runrollover')
    .setDescription('Run the rollover immediately for testing. Officers only.')
    .addBooleanOption(option =>
      option
        .setName('dry')
        .setDescription('Dry run — do not apply changes')
        .setRequired(false)
    )
    .setDMPermission(false),

  async executeRun(interaction) {
    if (!isOfficer(interaction.member)) {
      return interaction.reply({
        content: 'Only Officers and Commanders can run the rollover.',
        ephemeral: true
      });
    }

    const dry = interaction.options.getBoolean('dry') ?? false;

    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await executeRollover(interaction.guild, interaction.channelId, dry);

      return interaction.editReply({
        content:
          `Rollover ${dry ? 'dry run completed' : 'executed'}.\n\n` +
          `Active members skipped: **${result.activeMembersSkipped}**\n` +
          `Members reset: **${result.membersReset}**\n` +
          `Allies removed: **${result.alliesRemoved}**\n` +
          `Roles removed: **${result.rolesRemoved}**\n` +
          `Role actions failed: **${result.rolesFailed}**\n\n` +
          `Active role used: <@&${ACTIVE_ROLE_ID}>\n` +
          `Check your bot console for detailed role errors.`
      });
    } catch (err) {
      console.error('[Rollover] Manual run failed:', err);

      return interaction.editReply({
        content: 'Rollover failed to run. Check your bot console for details.'
      });
    }
  },

  // Background checker — call once on bot startup
  init(client) {
    if (intervalStarted) {
      console.warn('[Rollover] init() was called more than once. Ignoring duplicate interval.');
      return;
    }

    intervalStarted = true;

    console.log('[Rollover] Background checker started.');

    checkScheduledRollovers(client).catch(err => {
      console.error('[Rollover] Startup check failed:', err);
    });

    setInterval(() => {
      checkScheduledRollovers(client).catch(err => {
        console.error('[Rollover] Scheduled check failed:', err);
      });
    }, CHECK_INTERVAL);
  }
};