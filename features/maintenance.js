const { SlashCommandBuilder, PermissionFlagsBits: P } = require('discord.js');
const { isOfficer } = require('../utils/ranks');
const maintenance = require('../utils/maintenance');
const targetOption = sub => sub.addStringOption(option => option.setName('target').setDescription('This server or one feature in this server').setRequired(true).setAutocomplete(true));
module.exports = {
  async autocomplete(i){const q=String(i.options.getFocused()).toLowerCase();return i.respond(Object.entries(maintenance.TARGETS).filter(([value,name])=>(value+' '+name).toLowerCase().includes(q)).slice(0,25).map(([value,name])=>({value,name})));},
  data: new SlashCommandBuilder().setName('maintenance').setDescription('Manage maintenance for this server or an individual feature.').setDMPermission(false)
    .addSubcommand(sub => targetOption(sub.setName('on').setDescription('Pause a feature or the bot in this server')).addStringOption(option => option.setName('reason').setDescription('Public reason shown to members').setRequired(true).setMaxLength(300)))
    .addSubcommand(sub => targetOption(sub.setName('off').setDescription('Remove maintenance from the selected target')))
    .addSubcommand(sub => sub.setName('status').setDescription('Show active maintenance in this server')),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'status') return interaction.reply({ ...require('./botstatus').payload(interaction.client, interaction.guildId), ephemeral:true });
    if (!isOfficer(interaction.member) && !interaction.member.permissions.has(P.ManageGuild)) return interaction.reply({content:'Officer or Manage Server access is required.',ephemeral:true});
    const target = interaction.options.getString('target');
    const reason = sub === 'on' ? interaction.options.getString('reason').trim() : null;
    if (reason === '') return interaction.reply({content:'Enter a maintenance reason.',ephemeral:true});
    maintenance.set(interaction.guildId,target,reason,interaction.user.id);
    if (sub === 'on' && ['server','tts'].includes(target)) require('../utils/tts-service').stop(interaction.guildId);
    return interaction.reply({content:`${maintenance.TARGETS[target]} maintenance ${sub === 'on' ? 'enabled' : 'disabled'} for **${interaction.guild.name}**. Other maintenance settings remain unchanged. Refresh the status panel to see the update.`,ephemeral:true,allowedMentions:{parse:[]}});
  },
};
