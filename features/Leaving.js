const { Events, EmbedBuilder } = require('discord.js');
const { getConfig } = require('../utils/config');

module.exports = (client) => {
  client.on(Events.GuildMemberRemove, async (member) => {
    try {
      const leaveLogChannelId = getConfig(member.guild.id, 'LOG_CHANNEL_ID');
      if (!leaveLogChannelId) {
        console.warn('LOG_CHANNEL_ID not configured; skipping leave log.');
        return;
      }

      const channel = await member.guild.channels.fetch(leaveLogChannelId).catch(() => null);
      if (!channel) {
        console.warn('Could not find leave log channel with ID', leaveLogChannelId);
        return;
      }

      const durationSinceJoin = member.joinedTimestamp
        ? Date.now() - member.joinedTimestamp
        : null;
      const joinDays = durationSinceJoin ? Math.floor(durationSinceJoin / 86_400_000) : 0;
      const joinMonths = durationSinceJoin ? Math.floor(joinDays / 30) : 0;
      const joinDaysRemainder = durationSinceJoin ? joinDays % 30 : 0;
      const joinedDuration = durationSinceJoin
        ? `${joinMonths} month${joinMonths !== 1 ? 's' : ''}${joinDaysRemainder ? `, ${joinDaysRemainder} day${joinDaysRemainder !== 1 ? 's' : ''}` : ''}`
        : 'Unknown';

      const roles = member.roles.cache
        .filter(role => role.id !== member.guild.id)
        .sort((a, b) => b.position - a.position)
        .map(role => role.toString());
      const rolesText = roles.length ? roles.join(', ') : 'None';
      const displayedRoles = rolesText.length > 1024 ? `${rolesText.slice(0, 1021)}...` : rolesText;

      const embed = new EmbedBuilder()
        .setTitle('Member Left')
        .setColor(0xff0000)
        .setDescription(`${member.user.tag} has left the server.`)
        .addFields(
          { name: 'User', value: `${member.user}`, inline: true },
          { name: 'Account created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:f>`, inline: false },
          { name: 'Time on server', value: joinedDuration, inline: false },
          { name: 'Roles', value: displayedRoles, inline: false }
        )
        .setFooter({ text: `User ID: ${member.id}` })
        .setTimestamp();

      await channel.send({ embeds: [embed] });
    } catch (err) {
      console.error('Error logging member leave:', err);
    }
  });
};
