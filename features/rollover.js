const fs = require('../utils/data-fs');
const path = require('node:path');
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { getConfig } = require('../utils/config');
const audit = require('../utils/audit');

function configuredRoles(guildId) {
  return {
    active: getConfig(guildId, 'ACTIVE_WAR_ROLE_ID') || ACTIVE_ROLE_ID,
    unverified: getConfig(guildId, 'UNVERIFIED_ROLE_ID') || UNVERIFIED_ROLE_ID,
    former: getConfig(guildId, 'FORMER_MEMBER_ROLE_ID') || FORMER_MEMBER_ROLE_ID,
  };
}

const ACTIVE_ROLE_ID        = '1424722021325082625'; // Active role
const UNVERIFIED_ROLE_ID    = '1386229683963826346';
const FORMER_MEMBER_ROLE_ID = '1426128855202271242';

const ROLLOVER_DAYS  = 4;
const ROLLOVER_MS = 4 * 24 * 60 * 60 * 1000;
const ROLLOVER_COOLDOWN_MS = 60 * 1000;
const CHECK_INTERVAL = 5 * 60 * 1000; // check every 5 minutes
const STORE_PATH     = path.join(__dirname, '..', 'data', 'rollover.json');

const OFFICER_RANKS = ['Officer', 'Commander'];

let intervalStarted = false;
const rolloverInProgress = new Set();
const lastRolloverAttempt = new Map();

function acquireRollover(guildId) {
  if (rolloverInProgress.has(guildId)) {
    return { allowed: false, reason: 'already running' };
  }

  const remainingMs = ROLLOVER_COOLDOWN_MS - (Date.now() - (lastRolloverAttempt.get(guildId) ?? 0));
  if (remainingMs > 0) {
    return { allowed: false, reason: 'cooldown', remainingMs };
  }

  rolloverInProgress.add(guildId);
  return { allowed: true };
}

function releaseRollover(guildId) {
  rolloverInProgress.delete(guildId);
  lastRolloverAttempt.set(guildId, Date.now());
}

// ── Persistence helpers ───────────────────────────────────────────────────────

function readStore() {
  if (!fs.existsSync(STORE_PATH)) return { guilds: {} };

  return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
}

function writeStore(data) {
  const dir = path.dirname(STORE_PATH);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

const { isOfficer } = require('../utils/ranks');

function roleName(role) {
  return role ? `${role.name} (${role.id})` : 'Not found';
}

function canEditRole(role) {
  return role && role.editable && !role.managed;
}

async function clearActiveMembers(guild) {
  await guild.members.fetch();
  const activeId = configuredRoles(guild.id).active;
  const activeRole = guild.roles.cache.get(activeId)
    ?? await guild.roles.fetch(activeId).catch(() => null);

  if (!activeRole) return { role: null, removed: 0, failed: 0 };

  let removed = 0;
  let failed = 0;
  const members = [...guild.members.cache.values()]
    .filter(member => !member.user.bot && member.roles.cache.has(activeRole.id));

  for (const member of members) {
    try {
      if (!canEditRole(activeRole)) throw new Error('role hierarchy prevents removal');
      await member.roles.remove(activeRole);
      removed++;
    } catch (error) {
      failed++;
      console.warn(`[Rollover] Could not clear active role from ${member.user.tag}:`, error.message);
    }
  }

  return { role: activeRole, removed, failed };
}

function buildActivityCheckMessage(roleName, endUnix) {
  const embed = new EmbedBuilder()
    .setColor(0xE74C3C)
    .setTitle('Activity Check')
    .setDescription(
      `The previous Active Member roster has been cleared.\n\n` +
      `Click **Mark Active** below to add yourself to the **${roleName}** roster.\n\n` +
      `⏳ **Closes:** <t:${endUnix}:R>\n` +
      `🕒 **Exact time:** <t:${endUnix}:F>`
    )
    .setFooter({ text: 'Powered by Hypha' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`activitycheck_join_${endUnix}`)
      .setLabel('Mark Active')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`activitycheck_cancel_${endUnix}`)
      .setLabel('Cancel Activity Check')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

// ── Core rollover logic ───────────────────────────────────────────────────────

async function executeRollover(guild, notifyChannelId, dryRun = false, activeIds = null) {
  console.log(`[Rollover] Starting rollover for guild: ${guild.name} (${guild.id})`);
  console.log(`[Rollover] Dry run: ${dryRun}`);

  await guild.members.fetch();
  await guild.roles.fetch();

  const roleIds = configuredRoles(guild.id);
  const activeRoleId = roleIds.active;
  const allyRoleId = getConfig(guild.id, 'ALLY_ROLE_ID') || null;

  const activeRole = guild.roles.cache.get(activeRoleId)
    ?? await guild.roles.fetch(activeRoleId).catch(() => null);

  const allyRole = allyRoleId
    ? guild.roles.cache.get(allyRoleId) ?? await guild.roles.fetch(allyRoleId).catch(() => null)
    : null;

  const unverifiedRole = guild.roles.cache.get(roleIds.unverified)
    ?? await guild.roles.fetch(roleIds.unverified).catch(() => null);

  const formerMemberRole = guild.roles.cache.get(roleIds.former)
    ?? await guild.roles.fetch(roleIds.former).catch(() => null);

  if (![activeRole, unverifiedRole, formerMemberRole].every(canEditRole)) {
    throw new Error('Rollover stopped: configure Active War, Unverified and Former Member roles and place the bot above them. No roles were changed.');
  }
  if (new Set([activeRole.id, unverifiedRole.id, formerMemberRole.id]).size !== 3) {
    throw new Error('Rollover roles must be three different roles. No roles were changed.');
  }

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

    const hasActiveRole = activeIds ? activeIds.has(member.id) : activeRole && member.roles.cache.has(activeRole.id);

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
      // Allies are not departing regiment members. Never fall through to the
      // member reset, including dry runs or a failed Ally-role removal.
      continue;
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
        .setColor(dryRun ? 0xD4AF37 : 0xF39C12)
        .setTitle(dryRun ? '🔍 Rollover Dry Run Result' : '🔄 Commander-approved Rollover Complete')
        .setDescription(
          dryRun
            ? 'Rollover preview. No changes were applied.'
            : 'The Commander-approved rollover has executed.'
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

// Legacy commands remain discoverable, but cannot bypass the war lifecycle.
module.exports = {
  executeRollover, clearActiveMembers,
  data: new SlashCommandBuilder().setName('startrollover').setDescription('Open the Commander-approved war lifecycle.').setDMPermission(false),
  cancelData: new SlashCommandBuilder().setName('cancelrollover').setDescription('Cancel a legacy automatic rollover schedule.').setDMPermission(false),
  runData: new SlashCommandBuilder().setName('runrollover').setDescription('Preview role changes; use /warflow preview for actual rollover.').setDMPermission(false)
    .addBooleanOption(o=>o.setName('dry').setDescription('Preview only; false redirects to warflow')),
  async execute(i){return i.reply({content:'Use /warflow status. A Commander must approve the activity check and separately confirm rollover after 48 hours.',ephemeral:true});},
  async executeCancel(i){
    if(!require('../utils/squad-store').commander(await i.guild.members.fetch(i.user.id)))return i.reply({content:'Commander role required.',ephemeral:true});
    const data=readStore();delete data.guilds[i.guildId];writeStore(data);audit.record(i,'rollover.legacy_cancel',null);
    return i.reply({content:'Legacy automatic schedule removed. New warflow approvals are separate.',ephemeral:true});
  },
  async executeRun(i){
    if(!isOfficer(i.member))return i.reply({content:'Officer access required.',ephemeral:true});
    return i.reply({content:'Use /warflow preview after the approved activity check closes. This provides a preview based on the correct response roster.',ephemeral:true});
  },
  init(){console.log('[Rollover] Legacy automatic scheduling disabled; using Commander approvals.');}
};
