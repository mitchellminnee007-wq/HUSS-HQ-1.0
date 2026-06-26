const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getConfig } = require('../utils/config.js');

const ranks = ['Cadet', 'Private', 'Legionaire', 'Dragoon', 'Hussar', 'Officer', 'Commander'];
const highestOfficerPromoteIndex = ranks.indexOf('Dragoon');

function getMemberRank(member) {
  return ranks.slice().reverse().find(rank => member.roles.cache.some(role => role.name === rank)) || null;
}

function getRankRole(guild, rank) {
  return guild.roles.cache.find(role => role.name === rank) || null;
}

function getRoleByName(guild, roleName) {
  const normalized = roleName.toLowerCase();
  return guild.roles.cache.find(role => role.name.toLowerCase() === normalized) || null;
}

function getMemberRankRoles(member) {
  return ranks.filter(rank => member.roles.cache.some(role => role.name === rank));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('promote')
    .setDescription('Promote a member to the next rank.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The member to promote')
        .setRequired(true)
    )
    .setDMPermission(false),

  async execute(interaction) {
    const target = interaction.options.getMember('user', true);
    if (!target || !target.guild) {
      return interaction.reply({ content: 'That member is not available.', ephemeral: true });
    }

    const executor = interaction.member;
    const executorRank = getMemberRank(executor);
    const recruitmentOfficerRole = getRoleByName(interaction.guild, 'Recruitment Officer');
    const isRecruitmentOfficer = recruitmentOfficerRole && executor.roles.cache.has(recruitmentOfficerRole.id);
    
    if (executorRank !== 'Officer' && executorRank !== 'Commander' && !isRecruitmentOfficer) {
      return interaction.reply({ content: 'Only Officers, Commanders, and Recruitment Officers can promote members.', ephemeral: true });
    }

    const targetRank = getMemberRank(target);
    const currentIndex = targetRank ? ranks.indexOf(targetRank) : -1;
    if (currentIndex === ranks.length - 1) {
      return interaction.reply({ content: 'That member is already at the highest rank.', ephemeral: true });
    }

    const nextRank = ranks[currentIndex + 1];
    if (isRecruitmentOfficer && nextRank !== 'Cadet') {
      return interaction.reply({ content: 'Recruitment Officers can only promote members to Cadet.', ephemeral: true });
    }
    if ((executorRank === 'Officer' || isRecruitmentOfficer) && currentIndex + 1 > highestOfficerPromoteIndex) {
      return interaction.reply({ content: 'Officers and Recruitment Officers can only promote members up to Dragoon.', ephemeral: true });
    }

    const nextRole = getRankRole(interaction.guild, nextRank);
    if (!nextRole) {
      return interaction.reply({ content: `The rank role "${nextRank}" does not exist on this server.`, ephemeral: true });
    }

    let demotedCommanders = [];
    let hussarRole = null;
    if (nextRank === 'Commander') {
      const commanderRole = nextRole;
      hussarRole = getRankRole(interaction.guild, 'Hussar');
      const currentCommanders = commanderRole.members.filter(member => member.id !== target.id);
      if (currentCommanders.size) {
        demotedCommanders = [...currentCommanders.values()];
        await Promise.all(currentCommanders.map(async member => {
          await member.roles.remove(commanderRole);
          if (hussarRole) {
            await member.roles.add(hussarRole);
          }
        }));
      }
    }

    const rolesToRemove = getMemberRankRoles(target)
      .map(rank => getRankRole(interaction.guild, rank))
      .filter(Boolean);

    const formerMemberRoleId = getConfig(interaction.guildId, 'FORMER_MEMBER_ROLE_ID');
    const formerMemberRole = formerMemberRoleId ? interaction.guild.roles.cache.get(formerMemberRoleId) : null;
    
    if (formerMemberRole && target.roles.cache.has(formerMemberRole.id)) {
      rolesToRemove.push(formerMemberRole);
    }

    if (rolesToRemove.length) {
      await target.roles.remove(rolesToRemove);
    }

    await target.roles.add(nextRole);

    if (!targetRank && nextRank === 'Cadet') {
      const memberRole = getRoleByName(interaction.guild, 'Member');
      if (memberRole && !target.roles.cache.has(memberRole.id)) {
        await target.roles.add(memberRole);
      }

      const cleanupRoles = ['unverified', 'Former collie', 'Ally']
        .map(roleName => getRoleByName(interaction.guild, roleName))
        .filter(role => role && target.roles.cache.has(role.id));

      if (cleanupRoles.length) {
        await target.roles.remove(cleanupRoles);
      }
    }

    const previousRank = targetRank || 'Unranked';
    const oldRankRole = targetRank ? getRankRole(interaction.guild, targetRank) : null;
    const oldRankMention = oldRankRole ? `${oldRankRole}` : `**${previousRank}**`;
    const newRankMention = `${nextRole}`;

    const embed = new EmbedBuilder()
      .setTitle('Promotion Complete')
      .setColor('#00FF00')
      .setDescription(`${target.user.tag} has been promoted from ${oldRankMention} to ${newRankMention}!`)
      .setFooter({ text: `Promoted by ${executor.user.tag}` })
      .setTimestamp();

    if (demotedCommanders.length) {
      const demotedText = hussarRole
        ? demotedCommanders.map(member => `${member} has been demoted from ${nextRole} to ${hussarRole}.`).join('\n')
        : demotedCommanders.map(member => `${member} has been removed from ${nextRole}. The Hussar role was not found.`).join('\n');

      embed.addFields({
        name: 'Commander Replaced',
        value: demotedText
      });
    }

    await interaction.reply({
      content: `${target}`,
      embeds: [embed],
      allowedMentions: {
        users: [target.id, ...demotedCommanders.map(member => member.id)],
        roles: [nextRole.id, ...(oldRankRole ? [oldRankRole.id] : []), ...(hussarRole ? [hussarRole.id] : [])]
      },
      ephemeral: false
    });
  }
};
