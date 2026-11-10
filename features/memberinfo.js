const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getMemberRank, isOfficer } = require('../utils/ranks');
const { readData, eventSignups } = require('../utils/member-data');
module.exports = {
  data: new SlashCommandBuilder().setName('memberinfo').setDescription('View a member’s rank, qualifications and event signups.').setDMPermission(false)
    .addUserOption(option => option.setName('user').setDescription('Member to view; defaults to you').setRequired(false)),
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const user = interaction.options.getUser('user') || interaction.user;
    const member = await interaction.guild.members.fetch(user.id);
    const qualifications = member.roles.cache.filter(role => /^Qualified\s*-/i.test(role.name)).map(role => role.name);
    const events = eventSignups(interaction.guildId, user.id);
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`Member • ${member.displayName}`)
      .setThumbnail(user.displayAvatarURL()).addFields(
        { name: 'Rank', value: getMemberRank(member) || 'Unranked', inline: true },
        { name: 'Joined', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : 'Unknown', inline: true },
        { name: 'Qualifications', value: qualifications.join('\n').slice(0, 1024) || 'None recorded' },
        { name: 'Event signups', value: `${events.length} accepted RSVPs in stored events. These are signups, not confirmed attendance.` },
      );
    if (isOfficer(interaction.member)) {
      const record = readData('warnings').guilds?.[interaction.guildId]?.members?.[user.id];
      const warnings = record?.warnings || [];
      embed.addFields({ name: 'Warnings • officers only', value: `${warnings.filter(w => !w.forgivenAt).length} active / ${warnings.length} recorded` });
    }
    return interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
