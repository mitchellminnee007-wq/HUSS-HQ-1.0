const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const ranks = ['Cadet', 'Private', 'Legionaire', 'Dragoon', 'Hussar', 'Officer', 'Commander'];
const highestOfficerDemoteIndex = ranks.indexOf('Dragoon');

function getMemberRank(member) {
  return ranks.slice().reverse().find(rank => member.roles.cache.some(role => role.name === rank)) || null;
}

function getRankRole(guild, rank) {
  return guild.roles.cache.find(role => role.name === rank) || null;
}

function getMemberRankRoles(member) {
  return ranks.filter(rank => member.roles.cache.some(role => role.name === rank));
}

function canAffectRank(executorRank, targetRank) {
  if (executorRank === 'Officer' && (targetRank === 'Officer' || targetRank === 'Commander')) {
    return false;
  }

  return true;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('demote')
    .setDescription('Demote a member to the previous rank.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The member to demote')
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
    if (executorRank !== 'Officer' && executorRank !== 'Commander') {
      return interaction.reply({ content: 'Only Officers and Commanders can demote members.', ephemeral: true });
    }

    if (executorRank === 'Commander' && target.id === executor.id) {
      return interaction.reply({ content: 'A Commander cannot demote themselves.', ephemeral: true });
    }

    const targetRank = getMemberRank(target);
    if (!targetRank) {
      return interaction.reply({ content: 'Target member does not have a rank role.', ephemeral: true });
    }

    if (!canAffectRank(executorRank, targetRank)) {
      return interaction.reply({ content: 'Officers cannot demote other Officers or the Commander.', ephemeral: true });
    }

    const currentIndex = ranks.indexOf(targetRank);
    if (currentIndex === 0) {
      return interaction.reply({ content: 'That member is already at the lowest rank.', ephemeral: true });
    }

    if (executorRank === 'Officer' && currentIndex > highestOfficerDemoteIndex) {
      return interaction.reply({ content: 'Officers can only demote members up to Dragoon.', ephemeral: true });
    }

    const previousRank = ranks[currentIndex - 1];
    const previousRole = getRankRole(interaction.guild, previousRank);
    if (!previousRole) {
      return interaction.reply({ content: `The rank role "${previousRank}" does not exist on this server.`, ephemeral: true });
    }

    const rolesToRemove = getMemberRankRoles(target)
      .map(rank => getRankRole(interaction.guild, rank))
      .filter(Boolean);

    if (rolesToRemove.length) {
      await target.roles.remove(rolesToRemove);
    }

    await target.roles.add(previousRole);

    const oldRankRole = getRankRole(interaction.guild, targetRank);
    const oldRankMention = oldRankRole ? `${oldRankRole}` : targetRank;
    const newRankMention = `${previousRole}`;

    const embed = new EmbedBuilder()
      .setTitle('Demotion Complete')
      .setColor('#FF0000')
      .setDescription(`${target.user.tag} has been demoted from ${oldRankMention} to ${newRankMention}.`)
      .setFooter({ text: `Demoted by ${executor.user.tag}` })
      .setTimestamp();

    await interaction.reply({
      content: `${target}`,
      embeds: [embed],
      allowedMentions: { users: [target.id], roles: [previousRole.id, ...(oldRankRole ? [oldRankRole.id] : [])] },
      ephemeral: false
    });
  }
};
