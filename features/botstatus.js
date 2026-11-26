const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Status, PermissionFlagsBits: P } = require('discord.js');
const { isOfficer } = require('../utils/ranks');
const tts = require('../utils/tts-service');

function isNextWar(state) {
  return state?.release === 'next-war' || /^Prepared for next war\b/i.test(state?.reason || '');
}

function payload(client, guildId) {
  const maintenance = require('../utils/maintenance');
  const entries = Object.entries(maintenance.states(guildId));
  const ready = client.isReady();
  const seconds = Math.floor((client.uptime || 0) / 1000);
  const uptime = `${Math.floor(seconds / 86400)}d ${Math.floor(seconds % 86400 / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
  const ping = client.ws.ping;
  const voice = tts.status(guildId);
  const groups = {
    'Member tools': [['Onboarding','onboarding'], ['War hub','hub'], ['Feedback reports','feedback'], ['Absence notices','absence'], ['Officer health alerts','healthalerts']],
    'Next-war workflows': [['Operation debriefs','debrief'], ['Squad goal reviews','squad-review'], ['Notification preferences','notifications'], ['War archive','wararchive']],
    'Community': [['Verification & tickets', 'ticketpanel'], ['Squads', 'squad'], ['Commendations', 'commendation'], ['Voice TTS', 'tts']],
    'Foxhole & logistics': [['Stockpiles', 'stockpile'], ['Orders', 'order'], ['Shipping manifests', 'manifest'], ['Logistics tasks', 'logitask']],
    'Events & administration': [['Operations', 'operation'], ['Training', 'training'], ['War lifecycle', 'warflow'], ['Squad operations', 'operation-team'], ['Approval queue', 'approvals'], ['Task links', 'tasklink'], ['Command guide', 'help']],
  };
  const health = require('../utils/health').snapshot(guildId);
  const healthError = health.restErrors > 0 || health.interactionFailures > 0 || health.ttsErrors > 0 || health.notificationFailures > 0;
  const healthIssue = healthError || health.loopP95 > 200 || health.throttledRequests > 0;
  const down = client.ws.status === Status.Disconnected;
  const warState = require('../utils/war-state').read().guilds[guildId];
  const warIssue = require('../utils/config').getConfig(guildId, 'WARFLOW_ENABLED') && (!warState?.lastPoll || Date.now() - warState.lastPoll > 900000 || warState.error);
  const error = healthError || Boolean(warIssue && warState?.error);
  function state(name) {
    if (down || !client.commands.has(name)) return 'down';
    const paused = maintenance.active(guildId, name);
    if (paused) return isNextWar(paused) ? 'nextwar' : 'maintenance';
    if ((name === 'warflow' && warIssue && warState?.error) || (name === 'tts' && health.ttsErrors > 0)) return 'error';
    if (!ready || (name === 'warflow' && warIssue)) return 'attention';
    return 'available';
  }
  const counts = {available: 0, maintenance: 0, nextwar: 0, attention: 0, error: 0, down: 0};
  Object.values(groups).flat().forEach(([,name]) => counts[state(name)]++);
  const hasMaintenance = counts.maintenance || entries.some(([, entry]) => !isNextWar(entry));
  const overall = down ? '🔴 Bot disconnected' : counts.down ? '🔴 Some features unavailable' : error ? '🟣 Errors detected' : !ready ? '🟡 Connecting to Discord' : warIssue || healthIssue ? '🟡 Online • Needs attention' : hasMaintenance ? '🟡 Online • Some features in maintenance' : counts.nextwar ? '🟢 Current features operational • Next-war releases planned' : '🟢 All listed features available';
  const caution = !ready || warIssue || healthIssue || hasMaintenance;
  const icon = {available: '🟢', maintenance: '🟡', nextwar: '🕒', attention: '🟡', error: '🟣', down: '🔴'};
  const detail = name => {
    const value = state(name);
    if (value === 'down') return ' — Unavailable';
    if (value === 'error') return ' — Errors recorded';
    if (value === 'nextwar') return ' — Next war';
    if (value === 'maintenance') return name === 'tts' ? ' — Available shortly' : ' — Maintenance';
    if (value === 'attention') return ' — Needs attention';
    return name === 'tts' ? voice ? ' — Connected' : ' — Ready to join' : '';
  };
  return {
    embeds: [new EmbedBuilder().setTitle('HUSS HQ • Service status')
      .setColor(down || counts.down ? 0xE74C3C : error ? 0x9B59B6 : caution ? 0xF1C40F : 0x2ECC71)
      .setDescription(`**${overall}**\n${counts.available} available • ${counts.maintenance} in maintenance • ${counts.down + counts.attention + counts.error} need attention${counts.nextwar ? ` • ${counts.nextwar} next war` : ''}\n\n🟢 Available • 🟡 Maintenance / attention • 🟣 Errors • 🔴 Unavailable • 🕒 Next war`)
      .addFields(
        ...Object.entries(groups).map(([name, features]) => ({name, value: features.map(([label, key]) => `${icon[state(key)]} ${label}${detail(key)}`).join('\n')})),
        {name: 'Discord connection', value: down ? '🔴 Disconnected' : ready ? '🟢 Connected' : '🟡 Reconnecting', inline: true},
        {name: 'Gateway latency', value: Number.isFinite(ping) && ping >= 0 ? `${Math.round(ping)} ms` : 'Measuring…', inline: true},
        {name: 'Uptime', value: uptime, inline: true},
        {name: 'Recent health • Last 15 minutes', value: healthError ? '🟣 Errors were recorded. Officers can inspect Health details; this does not mean every feature is down.' : healthIssue ? '🟡 Discord throttling or elevated event-loop delay measured. Officers can inspect Health details.' : '🟢 No request, interaction, notification or TTS errors recorded; no throttling or elevated event-loop delay measured.'},
        {name: 'Need more information?', value: 'Refresh for a new snapshot. Maintenance & releases explains paused features and next-war plans. Health details is for Officers and Commanders.'},
        {name: 'War 144 UX upgrade', value: require('../utils/ux-release').enabled(guildId) ? 'Released • HUSS Home is available.' : '🕒 Locked for members until the War 144 Commander release. War 143 keeps the current UX.'},
      ).setTimestamp().setFooter({text: 'Snapshot only • Availability reflects loaded modules and maintenance. An offline bot cannot update this panel.'})],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('botstatus:refresh').setLabel('Refresh status').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('botstatus:maintenance').setLabel('Maintenance & releases').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('botstatus:health').setLabel('Health details').setStyle(ButtonStyle.Secondary),
    )],
    allowedMentions: {parse: []},
  };
}
module.exports = {
  data: new SlashCommandBuilder().setName('botstatus').setDescription('View the HUSS HQ status or post a shared status panel.').setDMPermission(false)
    .addSubcommand(sub => sub.setName('view').setDescription('View the current bot status privately'))
    .addSubcommand(sub => sub.setName('panel').setDescription('Post a shared status panel here (officers)')),
  async execute(interaction) {
    const shared = interaction.options.getSubcommand() === 'panel';
    if (shared && !isOfficer(interaction.member) && !interaction.member.permissions.has(P.ManageGuild)) {
      return interaction.reply({ content: 'Officer or Manage Server access is required to post a panel.', ephemeral: true });
    }
    await interaction.reply({ ...payload(interaction.client, interaction.guildId), ephemeral: !shared });
    if (shared) require('../utils/shared-panels').register(await interaction.fetchReply(), interaction.guildId, 'status');
  },
  async handleButton(interaction) {
    if (!interaction.guildId) return;
    if (interaction.customId === 'botstatus:health') return require('./health').execute(interaction);
    if (interaction.customId === 'botstatus:maintenance') {
      const maintenance = require('../utils/maintenance');
      const entries = Object.entries(maintenance.states(interaction.guildId));
      return interaction.reply({ephemeral: true, allowedMentions: {parse: []}, embeds: [new EmbedBuilder()
        .setTitle('HUSS HQ • Maintenance & releases').setColor(entries.some(([, entry]) => !isNextWar(entry)) ? 0xF1C40F : 0x2ECC71)
        .setDescription(entries.length ? '🕒 Next war: planned releases, not faults. 🟡 Maintenance: temporarily paused. Available features can still be used unless the entire server is paused.' : '🟢 No maintenance or next-war holds in this server.')
        .addFields(entries.slice(0, 20).map(([key, value]) => ({name: `${isNextWar(value) ? '🕒' : '🟡'} ${maintenance.TARGETS[key] || key}`, value: String(value.reason || 'Temporarily paused.').slice(0, 250)})))
        .setTimestamp()]});
    }
    if (interaction.customId !== 'botstatus:refresh') return;
    await interaction.deferUpdate();
    await interaction.editReply(payload(interaction.client, interaction.guildId));
    require('../utils/shared-panels').register(interaction.message, interaction.guildId, 'status');
  },
  payload,
};
