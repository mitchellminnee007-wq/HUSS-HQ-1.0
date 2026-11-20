const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getConfig } = require('../utils/config.js');
const audit = require('../utils/audit');

const ranks = ['Cadet', 'Private', 'Legionaire', 'Dragoon', 'Hussar', 'Officer', 'Commander'];
const promotionLimits = {
  Officer: 'Hussar',
  Commander: 'Officer',
};

const { getMemberRank, getRankRole, getMemberRankRoles } = require('../utils/ranks');

function getRoleByName(guild, roleName) {
  const key=roleName==='Member'?'VERIFIED_MEMBER_ROLE_ID':`${roleName.toUpperCase().replaceAll(' ', '_')}_ROLE_ID`;
  const id=getConfig(guild.id,key);
  if(id)return guild.roles.cache.get(id)||null;
  const normalized = roleName.toLowerCase();
  return guild.roles.cache.find(role => role.name.toLowerCase() === normalized) || null;
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
    .addStringOption(option => option.setName('reason').setDescription('Reason for the promotion').setMaxLength(500).setRequired(false))
    .setDMPermission(false),

  async execute(interaction) {
    const target = interaction.options.getMember('user', true);
    if (!target || !target.guild) {
      return interaction.reply({ content: 'That member is not available.', ephemeral: true });
    }

    const executor = interaction.member;
    const executorRank = getMemberRank(executor);
    const maximumRank = promotionLimits[executorRank];
    
    if (!maximumRank) {
      return interaction.reply({ content: 'Only Officers and Commanders can promote members.', ephemeral: true });
    }

    const targetRank = getMemberRank(target);
    const currentIndex = targetRank ? ranks.indexOf(targetRank) : -1;
    if (currentIndex === ranks.length - 1) {
      return interaction.reply({ content: 'That member is already at the highest rank.', ephemeral: true });
    }

    const nextRank = ranks[currentIndex + 1];
    if (currentIndex + 1 > ranks.indexOf(maximumRank)) {
      return interaction.reply({ content: `Your ${executorRank} rank can promote members up to ${maximumRank}. This member is already ${targetRank}; the next rank would be ${nextRank}.`, ephemeral: true });
    }

    const nextRole = getRankRole(interaction.guild, nextRank);
    if (!nextRole) {
      return interaction.reply({ content: `The rank role "${nextRank}" does not exist on this server.`, ephemeral: true });
    }
    if (nextRole.editable === false || getMemberRankRoles(target).some(role => role.editable === false)) return interaction.reply({ content: 'The bot cannot manage these ranks. Move its role above the affected ranks and grant Manage Roles.', ephemeral: true });

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

    const rolesToRemove = getMemberRankRoles(target);

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

    audit.record(interaction, 'member.promoted', target.id, { from: previousRank, to: nextRank, reason: interaction.options.getString?.('reason') || null });
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
