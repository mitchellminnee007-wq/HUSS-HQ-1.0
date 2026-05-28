const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('fakeban')
    .setDescription('Fake ban a member for laughs.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The member to fake ban')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for the fake ban')
        .setRequired(false)
    )
    .setDMPermission(false),

  async execute(interaction) {
    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') ?? 'No reason provided';

    const embed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setTitle('⛔ Member Banned')
      .setThumbnail(target.displayAvatarURL({ dynamic: true }))
      .setImage('https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExY2N4ZGN2ZmRob3Npb2ticzd6dmMxamszdHM0ZGpudWNmd3JrdHp1eCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/yVIVzpJt08AnjaBnel/giphy.gif')
      .addFields(
        { name: 'User', value: `${target.tag}`, inline: true },
        { name: 'User ID', value: target.id, inline: true },
        { name: 'Reason', value: reason }
      )
      .setFooter({ text: 'This is a joke ban. No action was taken.' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};
