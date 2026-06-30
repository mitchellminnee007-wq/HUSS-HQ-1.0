const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { getConfig } = require('../utils/config');

const DEFAULT_ACTIVITY_ROLE_ID = '1424722021325082625';
const OFFICER_RANKS = ['Officer', 'Commander'];
const DEFAULT_TIMER_MINUTES = 30;

function isOfficer(member) {
  return member.roles.cache.some(r => OFFICER_RANKS.includes(r.name));
}

function getActivityRoleId(guildId) {
  return getConfig(guildId, 'ACTIVE_WAR_ROLE_ID') ?? DEFAULT_ACTIVITY_ROLE_ID;
}

async function getActivityRole(guild, guildId) {
  const activityRoleId = getActivityRoleId(guildId);
  return guild.roles.cache.get(activityRoleId)
    ?? await guild.roles.fetch(activityRoleId).catch(() => null);
}

function getActivityMembers(guild, roleId) {
  return guild.members.cache
    .filter(member => member.roles.cache.has(roleId))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function buildActivityRow(endUnix, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`activitycheck_join_${endUnix}`)
      .setLabel(disabled ? 'Activity Check Closed' : 'Mark Active')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('activitycheck')
    .setDescription('Post an activity check panel so members can mark themselves active.')
    .addIntegerOption(option =>
      option
        .setName('minutes')
        .setDescription('How long should the activity check stay open?')
        .setMinValue(1)
        .setMaxValue(1440)
        .setRequired(false)
    )
    .setDMPermission(false),

  async execute(interaction) {
    if (!isOfficer(interaction.member)) {
      return interaction.reply({
        content: 'Only Officers and Commanders can post an activity check.',
        ephemeral: true
      });
    }

    const role = await getActivityRole(interaction.guild, interaction.guildId);
    const roleName = role ? role.name : 'Activity Check';

    const minutes = interaction.options.getInteger('minutes') ?? DEFAULT_TIMER_MINUTES;
    const endUnix = Math.floor((Date.now() + minutes * 60 * 1000) / 1000);

    const embed = new EmbedBuilder()
      .setColor(0xE74C3C)
      .setTitle('Activity Check')
      .setDescription(
        `We are preparing for a new war and need to know who is ready to ride.\n\n` +
        `Click **Mark Active** below to add yourself to the **${roleName}** roster.\n` +
        `Click again to remove yourself.\n\n` +
        `⏳ **Closes:** <t:${endUnix}:R>\n` +
        `🕒 **Exact time:** <t:${endUnix}:F>`
      )
      .setFooter({ text: 'Powered by Hypha' })
      .setTimestamp();

    const row = buildActivityRow(endUnix);

    const message = await interaction.reply({
      embeds: [embed],
      components: [row],
      fetchReply: true
    });

    setTimeout(async () => {
      try {
        const closedEmbed = EmbedBuilder.from(embed)
          .setColor(0x7F8C8D)
          .setTitle('Activity Check Closed')
          .setDescription(
            `This activity check is now closed.\n\n` +
            `The **${roleName}** roster is locked for this check.\n\n` +
            `✅ **Closed:** <t:${endUnix}:F>`
          );

        await message.edit({
          embeds: [closedEmbed],
          components: [buildActivityRow(endUnix, true)]
        });
      } catch (error) {
        console.error('Could not close activity check message:', error);
      }
    }, minutes * 60 * 1000);
  },

  resetData: new SlashCommandBuilder()
    .setName('clearactivitycheck')
    .setDescription('Remove all members from the activity check roster.')
    .setDMPermission(false),

  statusData: new SlashCommandBuilder()
    .setName('activitycheckroster')
    .setDescription('Shows how many members are marked active for the current activity check.')
    .setDMPermission(false),

  async executeReset(interaction) {
    try {
      if (!isOfficer(interaction.member)) {
        return interaction.reply({
          content: 'Only Officers and Commanders can clear the activity check roster.',
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });

      const guild = interaction.guild;
      await guild.members.fetch();

      const role = await getActivityRole(guild, interaction.guildId);
      if (!role) {
        return interaction.editReply('The activity check role was not found in this server.');
      }

      const members = [...getActivityMembers(guild, role.id).values()];
      let removed = 0;
      let failed = 0;

      for (const member of members) {
        try {
          await member.roles.remove(role);
          removed++;
        } catch {
          failed++;
        }
      }

      const message = failed
        ? `Removed **${removed}** member(s) from the **${role.name}** roster. **${failed}** member(s) could not be cleared, likely because of role hierarchy or permissions.`
        : `Removed **${removed}** member(s) from the **${role.name}** roster.`;

      return interaction.editReply(message);
    } catch (error) {
      console.error('Error in clearactivitycheck:', error);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply('Something went wrong while clearing the activity check roster.');
      }

      return interaction.reply({
        content: 'Something went wrong while clearing the activity check roster.',
        ephemeral: true
      });
    }
  },

  async executeStatus(interaction) {
    try {
      await interaction.deferReply();

      const guild = interaction.guild;
      await guild.members.fetch();

      const role = await getActivityRole(guild, interaction.guildId);
      if (!role) {
        return interaction.editReply('The activity check role was not found in this server.');
      }

      const members = getActivityMembers(guild, role.id);
      const count = members.size;

      const memberList = count
        ? members.map(member => `- ${member.displayName}`).join('\n')
        : 'No active members yet. The banner is raised, but nobody has marked active.';

      const embed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle('Activity Check Roster')
        .setDescription(count
          ? 'Members marked active for the current activity check:'
          : 'No one has marked active for this check yet.')
        .addFields({
          name: `Active (${count})`,
          value: memberList.length > 1024 ? memberList.slice(0, 1021) + '...' : memberList
        })
        .setFooter({ text: `Role: ${role.name} • Powered by Hypha` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error in activitycheckroster:', error);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply('Something went wrong while showing the activity check roster.');
      }

      return interaction.reply({
        content: 'Something went wrong while showing the activity check roster.',
        ephemeral: true
      });
    }
  },

  async handleButton(interaction) {
    const parts = interaction.customId.split('_');
    const endUnix = Number(parts[2]);

    if (!endUnix || Date.now() > endUnix * 1000) {
      return interaction.reply({
        content: 'This activity check is already closed.',
        ephemeral: true
      });
    }

    const activityRoleId = getActivityRoleId(interaction.guildId);
    const role = await getActivityRole(interaction.guild, interaction.guildId);

    if (!role) {
      return interaction.reply({
        content: 'The activity check role was not found.',
        ephemeral: true
      });
    }

    const member = interaction.member;
    const hasRole = member.roles.cache.has(activityRoleId);

    if (hasRole) {
      await member.roles.remove(role);

      await interaction.reply({
        content: `You have been **removed** from the **${role.name}** roster.`,
        ephemeral: true
      });
    } else {
      await member.roles.add(role);

      await interaction.reply({
        content: `You have been **added** to the **${role.name}** roster.`,
        ephemeral: true
      });
    }
  }
};