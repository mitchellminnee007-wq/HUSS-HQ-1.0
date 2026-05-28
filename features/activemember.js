const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const WAR_ROLE_ID = '1424722021325082625';
const OFFICER_RANKS = ['Officer', 'Commander'];

function isOfficer(member) {
  return member.roles.cache.some(r => OFFICER_RANKS.includes(r.name));
}

module.exports = {
  // ── /activemember ──────────────────────────────────────────────────────────
  data: new SlashCommandBuilder()
    .setName('activemember')
    .setDescription('Post a sign-up embed so members can join the active war roster.')
    .setDMPermission(false),

  async execute(interaction) {
    if (!isOfficer(interaction.member)) {
      return interaction.reply({ content: 'Only Officers and Commanders can post the war sign-up.', ephemeral: true });
    }

    const role = interaction.guild.roles.cache.get(WAR_ROLE_ID);
    const roleName = role ? role.name : 'Active War';

    const embed = new EmbedBuilder()
      .setColor(0xE74C3C)
      .setTitle('⚔️ War Sign-Up')
      .setDescription(`A war is being organised!\nClick **Join War** below to add yourself to the **${roleName}** roster.\nClick again to remove yourself.`)
      .setFooter({ text: 'Powered by Hypha' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('activemember_join')
        .setLabel('⚔️ Join War')
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({ embeds: [embed], components: [row] });
  },

  // ── /resetactivemember ─────────────────────────────────────────────────────
  resetData: new SlashCommandBuilder()
    .setName('resetactivemember')
    .setDescription('Remove all members from the active war roster.')
    .setDMPermission(false),

  async executeReset(interaction) {
    if (!isOfficer(interaction.member)) {
      return interaction.reply({ content: 'Only Officers and Commanders can reset the war roster.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    await guild.members.fetch();

    const role = guild.roles.cache.get(WAR_ROLE_ID);
    if (!role) {
      return interaction.editReply('The active war role was not found in this server.');
    }

    const members = [...role.members.values()];
    let removed = 0;

    for (const member of members) {
      try {
        await member.roles.remove(role);
        removed++;
      } catch {
        // skip members we can't modify
      }
    }

    await interaction.editReply(`✅ Removed **${removed}** member(s) from the **${role.name}** roster.`);
  },

  // ── Button handler ─────────────────────────────────────────────────────────
  async handleButton(interaction) {
    const role = interaction.guild.roles.cache.get(WAR_ROLE_ID);
    if (!role) {
      return interaction.reply({ content: 'The active war role was not found.', ephemeral: true });
    }

    const member = interaction.member;
    const hasRole = member.roles.cache.has(WAR_ROLE_ID);

    if (hasRole) {
      await member.roles.remove(role);
      await interaction.reply({ content: `✅ You have been **removed** from the **${role.name}** roster.`, ephemeral: true });
    } else {
      await member.roles.add(role);
      await interaction.reply({ content: `⚔️ You have been **added** to the **${role.name}** roster!`, ephemeral: true });
    }
  }
};
