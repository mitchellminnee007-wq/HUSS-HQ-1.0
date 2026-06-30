const { Client, GatewayIntentBits, AuditLogEvent } = require('discord.js');

try {
  require('dotenv').config();
} catch {}

const TOKEN =
  process.env.DISCORD_TOKEN ||
  process.env.BOT_TOKEN ||
  process.env.TOKEN;

const GUILD_ID = '1385714710405582858';

const ACTIVE_ROLE_ID = '1424722021325082625';
const UNVERIFIED_ROLE_ID = '1386229683963826346';
const FORMER_MEMBER_ROLE_ID = '1426128855202271242';

const DRY_RUN = false; // change to false after checking output
const SINCE_MINUTES = 40; // rollback changes from the last 40 minutes
const MAX_AUDIT_PAGES = 40; // 40 pages = up to 4000 audit entries

function getRoleIdsFromChange(change) {
  const values = [];

  if (Array.isArray(change.old)) values.push(...change.old);
  if (Array.isArray(change.new)) values.push(...change.new);

  return values
    .map(role => {
      if (!role) return null;
      if (typeof role === 'string') return role;
      return role.id || null;
    })
    .filter(Boolean);
}

function unique(array) {
  return [...new Set(array)];
}

async function fetchRelevantAuditEntries(guild, client) {
  const since = Date.now() - SINCE_MINUTES * 60 * 1000;

  let before;
  let allEntries = [];

  for (let page = 1; page <= MAX_AUDIT_PAGES; page++) {
    const options = {
      type: AuditLogEvent.MemberRoleUpdate,
      limit: 100
    };

    if (before) {
      options.before = before;
    }

    const logs = await guild.fetchAuditLogs(options);
    const entries = [...logs.entries.values()];

    if (entries.length === 0) {
      break;
    }

    allEntries.push(...entries);

    const oldestEntry = entries[entries.length - 1];
    before = oldestEntry.id;

    if (oldestEntry.createdTimestamp < since) {
      break;
    }
  }

  return allEntries
    .filter(entry => entry.executorId === client.user.id)
    .filter(entry => entry.createdTimestamp >= since)
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

async function main() {
  if (!TOKEN) {
    throw new Error('No bot token found. Make sure DISCORD_TOKEN, BOT_TOKEN, or TOKEN exists in your .env file.');
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildModeration
    ]
  });

  client.once('clientReady', async () => {
    console.log(`[Rollback] Logged in as ${client.user.tag}`);
    console.log(`[Rollback] Dry run: ${DRY_RUN}`);
    console.log(`[Rollback] Looking back ${SINCE_MINUTES} minute(s)`);
    console.log(`[Rollback] Active role ID: ${ACTIVE_ROLE_ID}`);

    const guild = await client.guilds.fetch(GUILD_ID);

    await guild.members.fetch();
    await guild.roles.fetch();

    const activeRole = guild.roles.cache.get(ACTIVE_ROLE_ID)
      || await guild.roles.fetch(ACTIVE_ROLE_ID).catch(() => null);

    if (!activeRole) {
      throw new Error(`Active role not found: ${ACTIVE_ROLE_ID}`);
    }

    console.log(`[Rollback] Active role found: ${activeRole.name} (${activeRole.id})`);

    if (!activeRole.editable) {
      console.log(`[Rollback] WARNING: Bot cannot add the Active role. Move the bot role above "${activeRole.name}".`);
    }

    const unverifiedRole = guild.roles.cache.get(UNVERIFIED_ROLE_ID)
      || await guild.roles.fetch(UNVERIFIED_ROLE_ID).catch(() => null);

    const formerMemberRole = guild.roles.cache.get(FORMER_MEMBER_ROLE_ID)
      || await guild.roles.fetch(FORMER_MEMBER_ROLE_ID).catch(() => null);

    console.log(`[Rollback] Unverified role: ${unverifiedRole ? `${unverifiedRole.name} (${unverifiedRole.id})` : 'not found'}`);
    console.log(`[Rollback] Former Member role: ${formerMemberRole ? `${formerMemberRole.name} (${formerMemberRole.id})` : 'not found'}`);

    const auditEntries = await fetchRelevantAuditEntries(guild, client);

    console.log(`[Rollback] Found ${auditEntries.length} member role update audit entries from this bot in the last ${SINCE_MINUTES} minute(s).`);

    const memberChanges = new Map();

    for (const entry of auditEntries) {
      const memberId = entry.targetId;

      if (!memberChanges.has(memberId)) {
        memberChanges.set(memberId, {
          removedRoleIds: new Set(),
          addedRoleIds: new Set(),
          lostActiveRole: false,
          entries: []
        });
      }

      const data = memberChanges.get(memberId);
      data.entries.push(entry);

      for (const change of entry.changes) {
        if (change.key === '$remove') {
          const removedIds = getRoleIdsFromChange(change);

          for (const roleId of removedIds) {
            data.removedRoleIds.add(roleId);

            if (roleId === ACTIVE_ROLE_ID) {
              data.lostActiveRole = true;
            }
          }
        }

        if (change.key === '$add') {
          const addedIds = getRoleIdsFromChange(change);

          for (const roleId of addedIds) {
            data.addedRoleIds.add(roleId);
          }
        }
      }
    }

    const targetMembers = [...memberChanges.entries()]
      .filter(([, data]) => data.lostActiveRole);

    console.log(`[Rollback] Members that lost Active role in the last ${SINCE_MINUTES} minute(s): ${targetMembers.length}`);

    let membersProcessed = 0;
    let rolesRestored = 0;
    let rollbackRolesRemoved = 0;
    let failed = 0;
    let skipped = 0;

    for (const [memberId, data] of targetMembers) {
      const member = await guild.members.fetch(memberId).catch(() => null);

      if (!member) {
        console.log(`[Rollback] Member not found anymore: ${memberId}`);
        skipped++;
        continue;
      }

      membersProcessed++;

      const removedRoleIds = unique([...data.removedRoleIds]);
      const addedRoleIds = unique([...data.addedRoleIds]);

      console.log('');
      console.log(`[Rollback] Processing ${member.user.tag} / ${member.displayName}`);
      console.log(`[Rollback] Roles to restore: ${removedRoleIds.length}`);

      for (const roleId of removedRoleIds) {
        const role = guild.roles.cache.get(roleId)
          || await guild.roles.fetch(roleId).catch(() => null);

        if (!role) {
          console.log(`[Rollback] Role no longer exists: ${roleId}`);
          skipped++;
          continue;
        }

        if (role.managed) {
          console.log(`[Rollback] Skipping managed role "${role.name}" for ${member.user.tag}`);
          skipped++;
          continue;
        }

        if (!role.editable) {
          console.log(`[Rollback] Cannot restore "${role.name}" to ${member.user.tag}. Bot role is too low.`);
          failed++;
          continue;
        }

        if (member.roles.cache.has(role.id)) {
          console.log(`[Rollback] Already has "${role.name}", skipping.`);
          skipped++;
          continue;
        }

        try {
          if (!DRY_RUN) {
            await member.roles.add(role);
          }

          rolesRestored++;
          console.log(`[Rollback] ${DRY_RUN ? '[DRY]' : ''} Restored "${role.name}" to ${member.user.tag}`);
        } catch (err) {
          failed++;
          console.log(`[Rollback] Failed restoring "${role.name}" to ${member.user.tag}: ${err.message}`);
        }
      }

      const rolesToRemoveAgain = addedRoleIds.filter(roleId =>
        [UNVERIFIED_ROLE_ID, FORMER_MEMBER_ROLE_ID].includes(roleId)
      );

      for (const roleId of rolesToRemoveAgain) {
        const role = guild.roles.cache.get(roleId)
          || await guild.roles.fetch(roleId).catch(() => null);

        if (!role) {
          skipped++;
          continue;
        }

        if (!member.roles.cache.has(role.id)) {
          skipped++;
          continue;
        }

        if (!role.editable || role.managed) {
          console.log(`[Rollback] Cannot remove "${role.name}" from ${member.user.tag}. Bot role is too low.`);
          failed++;
          continue;
        }

        try {
          if (!DRY_RUN) {
            await member.roles.remove(role);
          }

          rollbackRolesRemoved++;
          console.log(`[Rollback] ${DRY_RUN ? '[DRY]' : ''} Removed "${role.name}" from ${member.user.tag}`);
        } catch (err) {
          failed++;
          console.log(`[Rollback] Failed removing "${role.name}" from ${member.user.tag}: ${err.message}`);
        }
      }
    }

    console.log('');
    console.log('[Rollback] Done.');
    console.log(`[Rollback] Members processed: ${membersProcessed}`);
    console.log(`[Rollback] Roles restored: ${rolesRestored}`);
    console.log(`[Rollback] Unverified/Former Member removed: ${rollbackRolesRemoved}`);
    console.log(`[Rollback] Failed: ${failed}`);
    console.log(`[Rollback] Skipped: ${skipped}`);

    if (DRY_RUN) {
      console.log('');
      console.log('[Rollback] This was a DRY RUN. No changes were made.');
      console.log('[Rollback] If the output looks correct, change DRY_RUN to false and run again.');
    }

    client.destroy();
    process.exit(0);
  });

  await client.login(TOKEN);
}

main().catch(err => {
  console.error('[Rollback] Fatal error:', err);
  process.exit(1);
});
