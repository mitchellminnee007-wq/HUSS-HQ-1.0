const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits: P, ChannelType } = require('discord.js');
const { getConfig } = require('../utils/config');
const { isOfficer } = require('../utils/ranks');
module.exports = {
  data: new SlashCommandBuilder().setName('setup-check').setDescription('Check bot channels, roles and permissions without making changes.').setDMPermission(false),
  async execute(interaction) {
    if (!isOfficer(interaction.member) && !interaction.member.permissions.has(P.ManageGuild)) return interaction.reply({ content: 'Officer or Manage Server access is required.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const guild = interaction.guild;
    await guild.roles.fetch();
    const me = await guild.members.fetchMe();
    const lines = [];
    for (const [label, permission] of [['Manage roles', P.ManageRoles], ['Manage channels', P.ManageChannels], ['Manage threads', P.ManageThreads]]) lines.push(`${me.permissions.has(permission) ? '✅' : '❌'} ${label}`);
    for (const [label, key, expected] of [['Verification', 'VERIFICATION_CHANNEL_ID', ChannelType.GuildText], ['Review', 'VERIFICATION_REVIEW_CHANNEL_ID', ChannelType.GuildText], ['Ticket category', 'TICKET_CATEGORY_ID', ChannelType.GuildCategory], ['Operations', 'OPERATIONS_CHANNEL_ID', ChannelType.GuildText], ['Training', 'TRAININGS_CHANNEL_ID', ChannelType.GuildText], ['Kill count', 'KILLCOUNT_CHANNEL_ID', ChannelType.GuildText]]) {
      const id = getConfig(guild.id, key) || (label === 'Review' ? getConfig(guild.id, 'OFFICER_CHANNEL_ID') : null);
      const channel = id ? await guild.channels.fetch(id).catch(() => null) : null;
      if (!channel || channel.type !== expected) { lines.push(`❌ ${label}: configure a valid ${expected === ChannelType.GuildCategory ? 'category' : 'text channel'}`); continue; }
      const needs = expected === ChannelType.GuildCategory ? [P.ViewChannel, P.ManageChannels] : [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory];
      if (label === 'Review') needs.push(P.AttachFiles);
      const privateOK = label !== 'Review' || !channel.permissionsFor(guild.roles.everyone).has(P.ViewChannel);
      lines.push(`${channel.permissionsFor(me)?.has(needs) && privateOK ? '✅' : '❌'} ${label}: <#${channel.id}>${privateOK ? '' : ' — must be private'}`);
    }
    for (const [key, name] of [['VERIFIED_MEMBER_ROLE_ID', 'Member'], ['CADET_ROLE_ID', 'Cadet'], ['ALLY_ROLE_ID', 'Ally'], ['UNVERIFIED_ROLE_ID', 'unverified'], ['ACTIVE_WAR_ROLE_ID', 'Active Member'], ['FORMER_MEMBER_ROLE_ID', 'Former Member']]) {
      const id = getConfig(guild.id, key);
      const role = id ? guild.roles.cache.get(id) : guild.roles.cache.find(role => role.name.toLowerCase() === name.toLowerCase());
      lines.push(`${role?.editable && !role.managed ? '✅' : '❌'} ${name}: ${role ? `<@&${role.id}>` : 'missing'}${!id && ['ACTIVE_WAR_ROLE_ID', 'FORMER_MEMBER_ROLE_ID'].includes(key) ? ' — explicitly configure for rollover' : ''}`);
    }
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('HUSS setup check').setColor(lines.some(line => line.startsWith('❌')) ? 0xE67E22 : 0x2ECC71).setDescription(lines.join('\n')).setFooter({ text: 'Read-only check • Other role overwrites may also grant channel access.' })], allowedMentions: { parse: [] } });
  },
};
