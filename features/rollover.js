const fs = require('node:fs');
const path = require('node:path');
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getConfig } = require('../utils/config');

const COLLIE_ROLE_ID       = '1386230860587733123';
const UNVERIFIED_ROLE_ID   = '1386229683963826346';
const FORMER_MEMBER_ROLE_ID = '1426128855202271242';

const ROLLOVER_DAYS   = 4;
const ROLLOVER_MS     = ROLLOVER_DAYS * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL  = 5 * 60 * 1000; // check every 5 minutes
const STORE_PATH      = path.join(__dirname, '..', 'data', 'rollover.json');
const OFFICER_RANKS   = ['Officer', 'Commander'];

// ── Persistence helpers ───────────────────────────────────────────────────────
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

function isOfficer(member) {
  return member.roles.cache.some(r => OFFICER_RANKS.includes(r.name));
}

// ── Core rollover logic ───────────────────────────────────────────────────────
async function executeRollover(guild, notifyChannelId, dryRun = false) {
  await guild.members.fetch();

  const activeRoleId = getConfig(guild.id, 'ACTIVE_WAR_ROLE_ID') || COLLIE_ROLE_ID;
  const allyRoleId = getConfig(guild.id, 'ALLY_ROLE_ID') || null;

  const activeRole       = activeRoleId ? (guild.roles.cache.get(activeRoleId) ?? await guild.roles.fetch(activeRoleId).catch(() => null)) : null;
  const allyRole         = allyRoleId ? (guild.roles.cache.get(allyRoleId) ?? await guild.roles.fetch(allyRoleId).catch(() => null)) : null;
  const unverifiedRole   = guild.roles.cache.get(UNVERIFIED_ROLE_ID) ?? await guild.roles.fetch(UNVERIFIED_ROLE_ID).catch(() => null);
  const formerMemberRole = guild.roles.cache.get(FORMER_MEMBER_ROLE_ID) ?? await guild.roles.fetch(FORMER_MEMBER_ROLE_ID).catch(() => null);

  let alliesRemoved = 0;
  let alliesFailed = 0;
  let membersReset = 0;
  let membersFailed = 0;

  const members = [...guild.members.cache.values()];

  for (const member of members) {
    // Remove ally role if present
    if (allyRole && member.roles.cache.has(allyRole.id)) {
      try {
        if (!dryRun) await member.roles.remove(allyRole);
        if (!dryRun && unverifiedRole) await member.roles.add(unverifiedRole);
        alliesRemoved++;
      } catch (err) {
        alliesFailed++;
        console.warn(`[Rollover] Could not remove ally role from ${member.user.tag}:`, err.message);
      }
    }

    // If the member does NOT have the active war role, clear their roles and add unverified/former
    if (!activeRole || !member.roles.cache.has(activeRole.id)) {
      try {
        if (!dryRun) {
          const rolesToRemove = member.roles.cache.filter(r => r.id !== guild.id).map(r => r.id);
          for (const rid of rolesToRemove) {
            try { await member.roles.remove(rid); } catch {}
          }
          if (unverifiedRole)   await member.roles.add(unverifiedRole);
          if (formerMemberRole) await member.roles.add(formerMemberRole);
        }
        membersReset++;
      } catch (err) {
        membersFailed++;
        console.warn(`[Rollover] Could not reset roles for ${member.user.tag}:`, err.message);
      }
    }
  }

  // Send notification to the channel the command was run in
  if (notifyChannelId) {
    const channel = await guild.channels.fetch(notifyChannelId).catch(() => null);
    if (channel) {
      const embed = new EmbedBuilder()
        .setColor(0xF39C12)
        .setTitle(dryRun ? '🔍 Rollover Dry Run Result' : '🔄 Automatic Rollover Complete')
        .setDescription(dryRun ? `Dry run for the **${ROLLOVER_DAYS}-day** rollover (no changes applied).` : `The **${ROLLOVER_DAYS}-day** rollover has executed.`)
        .addFields(
          { name: 'Allies - removed', value: `${alliesRemoved}`, inline: true },
          { name: 'Allies - failed', value: `${alliesFailed}`, inline: true },
          { name: 'Members reset', value: `${membersReset}`, inline: true },
          { name: 'Members - failed', value: `${membersFailed}`, inline: true },
          { name: 'Notes', value: `Removed ally role: ${allyRole ? `<@&${allyRole.id}>` : '*Not configured*'}\nActive war role: ${activeRole ? `<@&${activeRole.id}>` : '*Not configured (all members will be reset)*'}` + (dryRun ? '\n**Dry run — no role changes were made**' : ''), inline: false }
        )
        .setFooter({ text: 'Powered by Hypha' })
        .setTimestamp();
      await channel.send({ embeds: [embed] }).catch(() => {});
    }
  }

  return { alliesRemoved, alliesFailed, membersReset, membersFailed };
}

// ── Module export ─────────────────────────────────────────────────────────────
module.exports = {
  // /startrollover
  data: new SlashCommandBuilder()
    .setName('startrollover')
    .setDescription(`Schedule the rollover: clear ally role and reset non-active members in ${ROLLOVER_DAYS} days.`)
    .setDMPermission(false),

  async execute(interaction) {
    if (!isOfficer(interaction.member)) {
      return interaction.reply({ content: 'Only Officers and Commanders can schedule a rollover.', ephemeral: true });
    }

    const store = readStore();
    if (store.guilds[interaction.guildId]) {
      const existing = store.guilds[interaction.guildId];
      const remaining = Math.ceil((existing.executeAt - Date.now()) / (1000 * 60 * 60));
      return interaction.reply({
        content: `A rollover is already scheduled in approximately **${remaining} hour(s)**. Use \`/cancelrollover\` first to reschedule.`,
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
      .setDescription(`In **${ROLLOVER_DAYS} days**, allies will have their ally role cleared and members without the active war role will be moved to <@&${UNVERIFIED_ROLE_ID}> and <@&${FORMER_MEMBER_ROLE_ID}>.`)
      .addFields({ name: 'Executes at', value: `<t:${timestamp}:F> (<t:${timestamp}:R>)` })
      .setFooter({ text: `Scheduled by ${interaction.user.tag} • Powered by Hypha` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },

  // /cancelrollover
  cancelData: new SlashCommandBuilder()
    .setName('cancelrollover')
    .setDescription('Cancel a pending automatic rollover.')
    .setDMPermission(false),

  async executeCancel(interaction) {
    if (!isOfficer(interaction.member)) {
      return interaction.reply({ content: 'Only Officers and Commanders can cancel a rollover.', ephemeral: true });
    }

    const store = readStore();
    if (!store.guilds[interaction.guildId]) {
      return interaction.reply({ content: 'There is no rollover scheduled for this server.', ephemeral: true });
    }

    delete store.guilds[interaction.guildId];
    writeStore(store);

    await interaction.reply({ content: '✅ Scheduled rollover has been **cancelled**.', ephemeral: true });
  },

  // /runrollover (immediate test)
  runData: new SlashCommandBuilder()
    .setName('runrollover')
    .setDescription('Run the rollover immediately for testing. Officers only.')
    .addBooleanOption(opt => opt.setName('dry').setDescription('Dry run — do not apply changes').setRequired(false))
    .setDMPermission(false),

  async executeRun(interaction) {
    if (!isOfficer(interaction.member)) {
      return interaction.reply({ content: 'Only Officers and Commanders can run the rollover.', ephemeral: true });
    }

    const dry = interaction.options.getBoolean('dry') ?? false;
    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await executeRollover(interaction.guild, null, dry);
      return interaction.editReply({ content: `Rollover ${dry ? 'dry run' : 'executed'} — Allies removed: ${result.alliesRemoved}, Members reset: ${result.membersReset}.` });
    } catch (err) {
      console.error('[Rollover] Manual run failed:', err);
      return interaction.editReply({ content: 'Rollover failed to run. Check logs for details.' });
    }
  },

  // Background checker — called once on bot startup
  init(client) {
    setInterval(async () => {
      const store = readStore();
      let changed = false;

      for (const [guildId, entry] of Object.entries(store.guilds)) {
        if (Date.now() < entry.executeAt) continue;

        // Time is up — run rollover
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
          console.warn(`[Rollover] Guild ${guildId} not found in cache, skipping.`);
          continue;
        }

        try {
          const result = await executeRollover(guild, entry.notifyChannelId);
          console.log(`[Rollover] Executed for guild ${guildId} — alliesRemoved=${result.alliesRemoved} membersReset=${result.membersReset}`);
        } catch (err) {
          console.error(`[Rollover] Failed for guild ${guildId}:`, err);
        }

        delete store.guilds[guildId];
        changed = true;
      }

      if (changed) writeStore(store);
    }, CHECK_INTERVAL);
  }
};
