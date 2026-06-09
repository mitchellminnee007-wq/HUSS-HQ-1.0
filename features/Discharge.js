const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getConfig } = require('../utils/config.js');

const ranks = ['Cadet', 'Private', 'Legionaire', 'Dragoon', 'Hussar', 'Officer', 'Commander'];

function getMemberRank(member) {
  return ranks.slice().reverse().find(rank => member.roles.cache.some(role => role.name === rank)) || null;
}

function getRoleByName(guild, roleName) {
  const normalized = roleName.toLowerCase();
  return guild.roles.cache.find(role => role.name.toLowerCase() === normalized) || null;
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
    .setName('discharge')
    .setDescription('Discharge a member and remove their rank.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The member to discharge')
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
      return interaction.reply({ content: 'Only Officers and Commanders can discharge members.', ephemeral: true });
    }

    if (executorRank === 'Commander' && target.id === executor.id) {
      return interaction.reply({ content: 'A Commander cannot discharge themselves.', ephemeral: true });
    }

    const unverifiedRole = getRoleByName(interaction.guild, 'unverified');
    if (!unverifiedRole) {
      return interaction.reply({ content: 'The role "unverified" does not exist on this server.', ephemeral: true });
    }

    const formerMemberRoleId = getConfig(interaction.guildId, 'FORMER_MEMBER_ROLE_ID');
    const formerMemberRole = formerMemberRoleId ? interaction.guild.roles.cache.get(formerMemberRoleId) : null;

    const targetRank = getMemberRank(target);
    if (targetRank && !canAffectRank(executorRank, targetRank)) {
      return interaction.reply({ content: 'Officers cannot discharge other Officers or the Commander.', ephemeral: true });
    }

    const memberRole = getRoleByName(interaction.guild, 'Member');
    const rolesToRemove = [
      ...getMemberRankRoles(target).map(rank => getRoleByName(interaction.guild, rank)),
      memberRole
    ].filter(role => role && target.roles.cache.has(role.id));

    if (!rolesToRemove.length && target.roles.cache.has(unverifiedRole.id)) {
      return interaction.reply({ content: 'That member is already discharged.', ephemeral: true });
    }

    if (rolesToRemove.length) {
      await target.roles.remove(rolesToRemove);
    }

    const rolesToAdd = [unverifiedRole];
    if (formerMemberRole) {
      rolesToAdd.push(formerMemberRole);
    }

    for (const role of rolesToAdd) {
      if (!target.roles.cache.has(role.id)) {
        await target.roles.add(role);
      }
    }

    const removedRankRole = targetRank ? getRoleByName(interaction.guild, targetRank) : null;
    const removedRank = removedRankRole ? `${removedRankRole}` : (targetRank || '**Unranked**');
    const removedRoles = [
      removedRank,
      ...(memberRole && rolesToRemove.some(role => role.id === memberRole.id) ? [`${memberRole}`] : [])
    ].join(' and ');

    const addedRoles = [unverifiedRole.toString(), ...(formerMemberRole ? [formerMemberRole.toString()] : [])].join(' and ');

    const embed = new EmbedBuilder()
      .setTitle('Discharge Complete')
      .setColor('#FF0000')
      .setDescription(`${target.user.tag} has been discharged. Removed ${removedRoles} and added ${addedRoles}.`)
      .setFooter({ text: `Discharged by ${executor.user.tag}` })
      .setTimestamp();

    await interaction.reply({
      content: `${target}`,
      embeds: [embed],
      allowedMentions: {
        users: [target.id],
        roles: [
          unverifiedRole.id,
          ...(removedRankRole ? [removedRankRole.id] : []),
          ...(memberRole ? [memberRole.id] : []),
          ...(formerMemberRole ? [formerMemberRole.id] : [])
        ]
      },
      ephemeral: false
    });
  }
};
