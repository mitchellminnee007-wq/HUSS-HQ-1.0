const { SlashCommandBuilder } = require('discord.js');
const { LANGUAGES } = require('../utils/tts-audio');
const service = require('../utils/tts-service');
module.exports = {
  data: new SlashCommandBuilder().setName('tts').setDescription('Speak through HUSS HQ in your voice channel.').setDMPermission(false)
    .addSubcommand(sub => sub.setName('join').setDescription('Enable chat speech for everyone in your voice channel')
      .addStringOption(option => option.setName('language').setDescription('Speech language (default: English)').addChoices(...Object.entries(LANGUAGES).map(([value, name]) => ({ name, value })))))
    .addSubcommand(sub => sub.setName('leave').setDescription('Stop reading your chat messages and remove your queued speech'))
    .addSubcommand(sub => sub.setName('languages').setDescription('List speech languages or change your active chat language')
      .addStringOption(option => option.setName('language').setDescription('New language for your active voice-chat TTS').addChoices(...Object.entries(LANGUAGES).map(([value, name]) => ({ name, value })))))
    .addSubcommand(sub => sub.setName('say').setDescription('Read a message aloud in your current voice channel')
      .addStringOption(option => option.setName('text').setDescription('Message to speak (up to 400 characters)').setRequired(true).setMaxLength(400))
      .addStringOption(option => option.setName('language').setDescription('Speech language (default: English)').addChoices(...Object.entries(LANGUAGES).map(([value, name]) => ({ name, value })))))
    .addSubcommand(sub => sub.setName('status').setDescription('Show voice connection and queue status'))
    .addSubcommand(sub => sub.setName('stop').setDescription('Stop speech, clear the queue and leave your voice channel')),
  init: service.init,
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    try {
      const sub = interaction.options.getSubcommand();
      if (sub === 'languages') {
        const language = interaction.options.getString('language');
        if (language) {
          service.setLanguage(interaction, language);
          return interaction.editReply(`Your next voice-chat messages will use ${LANGUAGES[language]}. Already queued messages keep their original language.`);
        }
        return interaction.editReply(`Available speech languages:\n${Object.entries(LANGUAGES).map(([code, name]) => `• ${name} (${code})`).join('\n')}\n\nUse /tts languages language:<choice> to change your active chat voice, or choose a language with /tts join or /tts say. This changes pronunciation; it does not translate your text.`);
      }
      if (sub === 'leave') { service.leave(interaction.guildId, interaction.user.id); return interaction.editReply('Voice-chat TTS disabled for you. Your queued speech was removed.'); }
      const channel = service.eligible(interaction.member);
      if (sub === 'join') return await service.join(interaction, interaction.options.getString('language') || 'en');
      if (sub === 'say') return await service.enqueue(interaction, interaction.options.getString('text'), interaction.options.getString('language') || 'en');
      const status = service.status(interaction.guildId);
      if (sub === 'stop') {
        if (status && status.channelId !== channel.id) throw new Error('Join the bot’s voice channel to stop its speech.');
        service.stop(interaction.guildId);
        return interaction.editReply('Speech stopped, queue cleared and HUSS HQ disconnected.');
      }
      // Do not reveal another channel's identity to someone outside it.
      return interaction.editReply(!status ? 'HUSS HQ is not connected to voice.' : status.channelId !== channel.id ? 'HUSS HQ is active in another voice channel.' : `HUSS HQ is in your channel. ${status.chatUsers} member(s) using chat TTS. ${status.queued} message(s) waiting${status.speaking ? '; speech is in progress' : ''}.`);
    } catch (error) { return interaction.editReply({ content: error.message, allowedMentions: { parse: [] } }); }
  },
};
