const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const WAR_ROLE_ID = '1424722021325082625';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warcount')
    .setDescription('Shows how many members are signed up for the active war.')
    .setDMPermission(false),

  async execute(interaction) {
    await interaction.deferReply();

    const guild = interaction.guild;

    // Fetch all members to ensure cache is up to date
    await guild.members.fetch();

    const role = guild.roles.cache.get(WAR_ROLE_ID);
    if (!role) {
      return interaction.editReply({ content: 'The active war role was not found in this server.', ephemeral: true });
    }

    const members = role.members;
    const count = members.size;

    const memberList = members
      .map(m => `• ${m.displayName}`)
      .sort((a, b) => a.localeCompare(b))
      .join('\n') || 'No members yet.';

    const embed = new EmbedBuilder()
      .setColor(0xE74C3C)
      .setTitle('⚔️ Active War Roster')
      .setDescription(`Members signed up for the current war:`)
      .addFields(
        { name: `Enlisted (${count})`, value: memberList.length > 1024 ? memberList.slice(0, 1021) + '...' : memberList }
      )
      .setFooter({ text: `Role: ${role.name} • Powered by Hypha` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};
