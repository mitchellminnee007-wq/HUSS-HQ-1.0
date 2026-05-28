const fs = require('node:fs');
const path = require('node:path');
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

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
async function executeRollover(guild, notifyChannelId) {
  await guild.members.fetch();

  const collieRole       = guild.roles.cache.get(COLLIE_ROLE_ID);
  const unverifiedRole   = guild.roles.cache.get(UNVERIFIED_ROLE_ID);
  const formerMemberRole = guild.roles.cache.get(FORMER_MEMBER_ROLE_ID);

  if (!collieRole) {
    console.warn(`[Rollover] Collie role not found in guild ${guild.id}`);
    return 0;
  }

  const targets = [...collieRole.members.values()];
  let processed = 0;

  for (const member of targets) {
    try {
      await member.roles.remove(collieRole);
      if (unverifiedRole)   await member.roles.add(unverifiedRole);
      if (formerMemberRole) await member.roles.add(formerMemberRole);
      processed++;
    } catch (err) {
      console.warn(`[Rollover] Could not update roles for ${member.user.tag}:`, err.message);
    }
  }

  // Send notification to the channel the command was run in
  if (notifyChannelId) {
    const channel = await guild.channels.fetch(notifyChannelId).catch(() => null);
    if (channel) {
      const embed = new EmbedBuilder()
        .setColor(0xF39C12)
        .setTitle('🔄 Automatic Rollover Complete')
        .setDescription(`The **${ROLLOVER_DAYS}-day** rollover has executed.`)
        .addFields(
          { name: 'Members processed', value: `${processed}`, inline: true },
          { name: 'Changes applied', value: `Removed: <@&${COLLIE_ROLE_ID}>\nAdded: <@&${UNVERIFIED_ROLE_ID}> + <@&${FORMER_MEMBER_ROLE_ID}>`, inline: false }
        )
        .setFooter({ text: 'Powered by Hypha' })
        .setTimestamp();
      await channel.send({ embeds: [embed] }).catch(() => {});
    }
  }

  return processed;
}

// ── Module export ─────────────────────────────────────────────────────────────
module.exports = {
  // /startrollover
  data: new SlashCommandBuilder()
    .setName('startrollover')
    .setDescription(`Schedule the collie → unverified/former-member rollover in ${ROLLOVER_DAYS} days.`)
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
      .setDescription(`In **${ROLLOVER_DAYS} days**, all members with <@&${COLLIE_ROLE_ID}> will automatically be moved to <@&${UNVERIFIED_ROLE_ID}> and <@&${FORMER_MEMBER_ROLE_ID}>.`)
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
          const count = await executeRollover(guild, entry.notifyChannelId);
          console.log(`[Rollover] Executed for guild ${guildId} — ${count} member(s) updated.`);
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
