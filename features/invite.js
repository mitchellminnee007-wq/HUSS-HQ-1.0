const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

// Permissions the bot needs to function correctly across servers
const INVITE_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
].reduce((acc, perm) => acc | perm, 0n);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Get the invite link to add HUSS HQ Bot to your server.')
    .setDMPermission(true),

  async execute(interaction) {
    const clientId = interaction.client.user.id;
    const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${INVITE_PERMISSIONS}&scope=bot%20applications.commands`;

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Invite HUSS HQ Bot')
      .setThumbnail(interaction.client.user.displayAvatarURL())
      .setDescription(`Click the link below to add **HUSS HQ Bot** to your server.\n\n[**Add to Server**](${inviteUrl})`)
      .addFields({ name: 'Invite Link', value: inviteUrl })
      .setFooter({ text: 'Powered by Hypha' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
