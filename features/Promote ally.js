const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const officerRanks = ['Officer', 'Commander'];

function getRoleByName(guild, roleName) {
  const normalized = roleName.toLowerCase();
  return guild.roles.cache.find(role => role.name.toLowerCase() === normalized) || null;
}

function getMemberOfficerRank(member) {
  return officerRanks.find(rank => member.roles.cache.some(role => role.name === rank)) || null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('promoteally')
    .setDescription('Promote a member from unranked to Ally.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The member to promote to Ally')
        .setRequired(true)
    )
    .setDMPermission(false),

  async execute(interaction) {
    const target = interaction.options.getMember('user', true);
    if (!target || !target.guild) {
      return interaction.reply({ content: 'That member is not available.', ephemeral: true });
    }

    const executor = interaction.member;
    const executorRank = getMemberOfficerRank(executor);
    if (!executorRank) {
      return interaction.reply({ content: 'Only Officers and Commanders can promote allies.', ephemeral: true });
    }

    const allyRole = getRoleByName(interaction.guild, 'Ally');
    if (!allyRole) {
      return interaction.reply({ content: 'The role "Ally" does not exist on this server.', ephemeral: true });
    }

    if (target.roles.cache.has(allyRole.id)) {
      return interaction.reply({ content: 'That member is already an Ally.', ephemeral: true });
    }

    await target.roles.add(allyRole);

    const cleanupRoles = ['unverified']
      .map(roleName => getRoleByName(interaction.guild, roleName))
      .filter(role => role && target.roles.cache.has(role.id));

    if (cleanupRoles.length) {
      await target.roles.remove(cleanupRoles);
    }

    const embed = new EmbedBuilder()
      .setTitle('Ally Promotion Complete')
      .setColor('#00FF00')
      .setDescription(`${target.user.tag} has been promoted from **Unranked** to ${allyRole}!`)
      .setFooter({ text: `Promoted by ${executor.user.tag}` })
      .setTimestamp();

    await interaction.reply({
      content: `${target}`,
      embeds: [embed],
      allowedMentions: { users: [target.id], roles: [allyRole.id] },
      ephemeral: false
    });
  }
};
