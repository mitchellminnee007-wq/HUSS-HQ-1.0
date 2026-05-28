const fs = require('node:fs');
const path = require('node:path');
const { Events, EmbedBuilder } = require('discord.js');
const { getConfig } = require('../utils/config');

function getRoleByName(guild, roleName) {
  const normalized = roleName.toLowerCase();
  return guild.roles.cache.find(role => role.name.toLowerCase() === normalized) || null;
}

module.exports = (client) => {
  // Welcome new members: ping and direct them to verification and rules
  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      const welcomeChannelId      = getConfig(member.guild.id, 'WELCOME_CHANNEL_ID');
      const verificationChannelId  = getConfig(member.guild.id, 'VERIFICATION_CHANNEL_ID');
      const rulesChannelId         = getConfig(member.guild.id, 'RULES_CHANNEL_ID');

      if (!welcomeChannelId) {
        console.warn('WELCOME_CHANNEL_ID not configured; skipping welcome message.');
        return;
      }

      const channel = await member.guild.channels.fetch(welcomeChannelId).catch(() => null);
      if (!channel) {
        console.warn('Could not find welcome channel with ID', welcomeChannelId);
        return;
      }

      const unverifiedRole = member.guild.roles.cache.get('1386229683963826346')
        || getRoleByName(member.guild, 'unverified');
      if (unverifiedRole && !member.roles.cache.has(unverifiedRole.id)) {
        await member.roles.add(unverifiedRole);
      } else if (!unverifiedRole) {
        console.warn('Could not find unverified role.');
      }

      const verificationMention = verificationChannelId ? `<#${verificationChannelId}>` : 'the verification channel';
      const rulesMention = rulesChannelId ? `<#${rulesChannelId}>` : 'the rules channel';

      const embed = new EmbedBuilder()
        .setTitle(`Welcome to ${member.guild.name}`)
        .setDescription(`Hello ${member}, welcome aboard! Please complete verification in ${verificationMention} and read ${rulesMention} to join the ranks.`)
        .setColor(0xff0000)
        .setThumbnail(member.user.displayAvatarURL({ extension: 'png', size: 256 }))
        .setFooter({ text: 'HUSS HQ • Hail Mike.' })
        .setTimestamp();

      const messagePayload = {
        content: `${member}`,
        embeds: [embed],
        allowedMentions: { users: [member.id] }
      };

      const welcomeImageUrl = getConfig(member.guild.id, 'WELCOME_IMAGE_URL');
      if (welcomeImageUrl) {
        const isRemoteImage = /^https?:\/\//i.test(welcomeImageUrl) || /^attachment:/i.test(welcomeImageUrl);
        if (isRemoteImage) {
          embed.setImage(welcomeImageUrl);
        } else {
          const resolvedPath = path.isAbsolute(welcomeImageUrl)
            ? welcomeImageUrl
            : path.resolve(path.join(__dirname, '..'), welcomeImageUrl);
          if (fs.existsSync(resolvedPath)) {
            const imageName = path.basename(resolvedPath);
            messagePayload.files = [{ attachment: resolvedPath, name: imageName }];
            embed.setImage(`attachment://${imageName}`);
          } else {
            console.warn('WELCOME_IMAGE_URL file not found:', resolvedPath);
          }
        }
      }

      await channel.send(messagePayload);
    } catch (err) {
      console.error('Error sending welcome message:', err);
    }
  });
};
