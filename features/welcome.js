const fs = require('node:fs');
const path = require('node:path');
const { Events, EmbedBuilder } = require('discord.js');

function cleanEnvValue(value) {
  return value?.split('//')[0].trim();
}

const WELCOME_IMAGE_URL = cleanEnvValue(process.env.WELCOME_IMAGE_URL);

function getRoleByName(guild, roleName) {
  const normalized = roleName.toLowerCase();
  return guild.roles.cache.find(role => role.name.toLowerCase() === normalized) || null;
}

module.exports = (client) => {
  // Welcome new members: ping and direct them to verification and rules
  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      const welcomeChannelId = cleanEnvValue(process.env.WELCOME_CHANNEL_ID);
      const verificationChannelId = cleanEnvValue(process.env.VERIFICATION_CHANNEL_ID);
      const rulesChannelId = cleanEnvValue(process.env.RULES_CHANNEL_ID);

      if (!welcomeChannelId) {
        console.warn('WELCOME_CHANNEL_ID not configured; skipping welcome message.');
        return;
      }

      const channel = await member.guild.channels.fetch(welcomeChannelId).catch(() => null);
      if (!channel) {
        console.warn('Could not find welcome channel with ID', welcomeChannelId);
        return;
      }

      const unverifiedRole = getRoleByName(member.guild, 'unverified');
      if (unverifiedRole && !member.roles.cache.has(unverifiedRole.id)) {
        await member.roles.add(unverifiedRole);
      } else if (!unverifiedRole) {
        console.warn('Could not find unverified role.');
      }

      const verificationMention = verificationChannelId ? `<#${verificationChannelId}>` : 'the verification channel';
      const rulesMention = rulesChannelId ? `<#${rulesChannelId}>` : 'the rules channel';

      const embed = new EmbedBuilder()
        .setTitle('Welcome to Winged Hussars Industries')
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

      if (WELCOME_IMAGE_URL) {
        const isRemoteImage = /^https?:\/\//i.test(WELCOME_IMAGE_URL) || /^attachment:/i.test(WELCOME_IMAGE_URL);
        if (isRemoteImage) {
          embed.setImage(WELCOME_IMAGE_URL);
        } else if (fs.existsSync(WELCOME_IMAGE_URL)) {
          const imageName = path.basename(WELCOME_IMAGE_URL);
          messagePayload.files = [{ attachment: WELCOME_IMAGE_URL, name: imageName }];
          embed.setImage(`attachment://${imageName}`);
        } else {
          console.warn('WELCOME_IMAGE_URL file not found:', WELCOME_IMAGE_URL);
        }
      }

      await channel.send(messagePayload);
    } catch (err) {
      console.error('Error sending welcome message:', err);
    }
  });
};
