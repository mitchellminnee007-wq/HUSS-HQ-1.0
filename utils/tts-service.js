const { Readable } = require('node:stream');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { cleanText, synthesize, LANGUAGES, retain, release } = require('./tts-audio');
const sessions = new Map(), cooldowns = new Map();
const IDLE_MS = 120000;
const initialized = new WeakSet();
function voiceLibrary() { return require('@discordjs/voice'); }
function eligible(member) {
  if (member?.guild && require('./maintenance').active(member.guild.id, 'tts')) throw new Error('Voice TTS is under maintenance. Use /botstatus view for details.');
  if (!member || member.user?.bot) throw new Error('TTS is available to people in the voice channel.');
  if (member.voice?.serverMute || member.communicationDisabledUntilTimestamp > Date.now()) throw new Error('TTS is unavailable while you are server-muted or timed out.');
  const channel = member.voice?.channel;
  if (!channel || channel.type !== ChannelType.GuildVoice) throw new Error('Join a regular voice channel first, then use /tts say.');
  if (!channel.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect])) throw new Error('You do not have access to this voice channel.');
  return channel;
}
function stop(guildId) {
  const session = sessions.get(guildId);
  if (!session) return;
  sessions.delete(guildId); clearTimeout(session.idleTimer);
  session.current?.abort.abort(); session.queue.length = 0;
  session.player.stop(true);
  release(guildId);
  if (session.connection.state.status !== 'destroyed') session.connection.destroy();
}
function idle(session) {
  clearTimeout(session.idleTimer);
  if (session.channelChat) return;
  session.idleTimer = setTimeout(() => { if (sessions.get(session.guild.id) === session) stop(session.guild.id); }, IDLE_MS);
  session.idleTimer.unref?.();
}
async function notify(item, message) {
  try { await item.interaction.followUp({ content: message, ephemeral: true, allowedMentions: { parse: [] } }); } catch { /* Expired interaction or unavailable user. */ }
}
async function drain(session) {
  if (session.running) return;
  session.running = true;
  const voice = voiceLibrary();
  try {
    while (sessions.get(session.guild.id) === session && session.queue.length) {
      const item = session.queue.shift(); session.current = item;
      try {
        const member = session.guild.members.cache.get(item.userId);
        if (!member || member.voice.channelId !== session.channelId) throw new Error('Your queued speech was cancelled because you left the voice channel or lost access.');
        eligible(member);
        if (session.guild.members.me?.voice?.serverMute) throw new Error('The bot is server-muted. An officer must unmute it before it can speak.');
        const synthesisStarted=Date.now();require('./health').record('tts_wait',synthesisStarted-(item.queuedAt||synthesisStarted),session.guild.id);
        const audio = await synthesize(item.text, item.language, item.abort.signal);
        require('./health').record('tts_synthesis',Date.now()-synthesisStarted,session.guild.id);
        if (item.abort.signal.aborted || sessions.get(session.guild.id) !== session) continue;
        session.player.play(voice.createAudioResource(Readable.from([audio]), { inputType: voice.StreamType.Raw }));
        await voice.entersState(session.player, voice.AudioPlayerStatus.Playing, 5000);
        await voice.entersState(session.player, voice.AudioPlayerStatus.Idle, 90000);
      } catch (error) {
        if(!item.abort.signal.aborted)require('./health').record('tts_failure',0,session.guild.id);
        session.player.stop(true);
        if (!item.abort.signal.aborted) await notify(item, error.message);
      } finally { if (session.current === item) session.current = null; }
    }
  } finally {
    session.running = false;
    if (sessions.get(session.guild.id) === session) idle(session);
  }
}
function connect(interaction, channel) {
    const voice = voiceLibrary();
    const connection = voice.joinVoiceChannel({ channelId: channel.id, guildId: interaction.guildId, adapterCreator: interaction.guild.voiceAdapterCreator, selfDeaf: true, selfMute: false });
    const player = voice.createAudioPlayer({ behaviors: { noSubscriber: voice.NoSubscriberBehavior.Stop } });
    const session = { guild: interaction.guild, channelId: channel.id, connection, player, queue: [], chatUsers: new Map(), excluded: new Set(), channelChat: false, current: null, running: false };
    sessions.set(interaction.guildId, session);
    retain(interaction.guildId);
    connection.subscribe(player);
    connection.on('error', () => { if (sessions.get(interaction.guildId) === session) stop(interaction.guildId); });
    connection.on(voice.VoiceConnectionStatus.Disconnected, () => { if (sessions.get(interaction.guildId) === session) stop(interaction.guildId); });
    player.on('error', () => { /* Playback promise handles the error. */ });
    session.ready = voice.entersState(connection, voice.VoiceConnectionStatus.Ready, 20000);
    session.ready.catch(() => { if (sessions.get(interaction.guildId) === session) stop(interaction.guildId); });
    return session;
}
async function enqueue(interaction, raw, language) {
  const member = interaction.member, channel = eligible(member);
  const text = cleanText(raw);
  if (!text || text.length > 400) throw new Error('Enter a message between 1 and 400 characters.');
  if (!LANGUAGES[language]) throw new Error('Choose a supported speech language.');
  const me = interaction.guild.members.me || await interaction.guild.members.fetchMe();
  if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) throw new Error('HUSS HQ needs View Channel, Connect and Speak permissions in your voice channel.');
  const key = `${interaction.guildId}:${interaction.user.id}`, now = Date.now();
  for (const [id, until] of cooldowns) if (until <= now) cooldowns.delete(id);
  if ((cooldowns.get(key) || 0) > now) throw new Error('Wait five seconds between TTS messages.');
  let session = sessions.get(interaction.guildId);
  if (session && session.channelId !== channel.id) throw new Error('HUSS HQ is active in another voice channel. Use /tts stop in that channel to disconnect it.');
  if (session && session.queue.length + Number(Boolean(session.current)) >= 10) throw new Error('The speech queue is full. Try again shortly.');
  if (session && session.queue.filter(item => item.userId === interaction.user.id).length + Number(session.current?.userId === interaction.user.id) >= 2) throw new Error('You already have two speech messages queued. Wait for them to finish.');
  cooldowns.set(key, now + 5000);
  if (interaction.ttsChat && (!session?.channelChat || session.excluded.has(interaction.user.id))) return;
  if (!session) session = connect(interaction, channel);
  clearTimeout(session.idleTimer);
  // Reserve a queue slot before awaiting the connection, including simultaneous requests.
  const item = { queuedAt:Date.now(), userId: interaction.user.id, text: `${cleanText(member.displayName || interaction.user.username).slice(0, 40)} says: ${text}`, language, interaction, abort: new AbortController() };
  session.queue.push(item);
  try { await session.ready; } catch { throw new Error('Could not join voice. Check the bot’s permissions and try again.'); }
  if (sessions.get(interaction.guildId) !== session) throw new Error('Voice connection closed. Try again.');
  await interaction.editReply({ content: `Queued for speech in <#${channel.id}> (${LANGUAGES[language]}).`, allowedMentions: { parse: [] } });
  void drain(session);
}
function status(guildId) { const session = sessions.get(guildId); return session ? { channelId: session.channelId, queued: session.queue.length, speaking: Boolean(session.current), chatUsers: session.channelChat ? (session.guild.channels.cache.get(session.channelId)?.members.filter(member => !member.user.bot && !session.excluded.has(member.id)).size || 0) : 0 } : null; }
function init(client) {
  if (initialized.has(client)) return;
  initialized.add(client);
  client.on('messageCreate', message => { void handleMessage(message).catch(() => {}); });
  client.on('voiceStateUpdate', (oldState, newState) => {
    const session = sessions.get(newState.guild.id);
    if (!session) return;
    if (newState.id === client.user.id && newState.channelId !== session.channelId) return stop(newState.guild.id);
    if (oldState.channelId === session.channelId && newState.channelId !== session.channelId) {
      session.chatUsers.delete(newState.id);
      session.excluded.delete(newState.id);
      session.queue = session.queue.filter(item => item.userId !== newState.id);
      if (session.current?.userId === newState.id) { session.current.abort.abort(); session.player.stop(true); }
      const channel = newState.guild.channels.cache.get(session.channelId);
      if (!channel?.members.some(member => !member.user.bot)) stop(newState.guild.id);
      else if (!session.running && !session.queue.length) idle(session);
    }
  });
}
async function join(interaction, language = 'en') {
  const channel = eligible(interaction.member);
  if (!LANGUAGES[language]) throw new Error('Choose a supported speech language.');
  const me = interaction.guild.members.me || await interaction.guild.members.fetchMe();
  if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) throw new Error('HUSS HQ needs View Channel, Connect and Speak in your voice channel.');
  let session = sessions.get(interaction.guildId);
  if (session && session.channelId !== channel.id) throw new Error('HUSS HQ is active in another voice channel.');
  if (!session) session = connect(interaction, channel);
  clearTimeout(session.idleTimer);
  session.channelChat = true;
  session.excluded.delete(interaction.user.id);
  session.chatUsers.set(interaction.user.id, language);
  try { await session.ready; } catch { throw new Error('Could not join voice. Check permissions and try again.'); }
  if (sessions.get(interaction.guildId) !== session || interaction.member.voice.channelId !== channel.id || session.excluded.has(interaction.user.id)) {
    if (sessions.get(interaction.guildId) === session) leave(interaction.guildId, interaction.user.id);
    throw new Error('Voice channel changed or TTS was disabled. Join your channel and try /tts join again.');
  }
  return interaction.editReply({ content: `Voice-chat TTS enabled for you (${LANGUAGES[language]}). Type in this voice channel’s own text chat and HUSS HQ will read your messages aloud. Use /tts leave to opt out or /tts stop to stop everyone’s queue.`, allowedMentions: { parse: [] } });
}
function setLanguage(interaction, language) {
  const channel = eligible(interaction.member);
  if (!LANGUAGES[language]) throw new Error('Choose a supported speech language.');
  const session = sessions.get(interaction.guildId);
  if (!session?.channelChat || session.channelId !== channel.id || session.excluded.has(interaction.user.id)) throw new Error('Enable your voice-chat TTS with /tts join first.');
  session.chatUsers.set(interaction.user.id, language);
}
function leave(guildId, userId) {
  const session = sessions.get(guildId);
  if (!session) return;
  session.chatUsers.delete(userId);
  session.excluded.add(userId);
  session.queue = session.queue.filter(item => item.userId !== userId);
  if (session.current?.userId === userId) { session.current.abort.abort(); session.player.stop(true); }
  if (!session.channelChat && !session.queue.length && !session.current) stop(guildId);
}
async function handleMessage(message) {
  if (message.guildId && require('./maintenance').active(message.guildId, 'tts')) return;
  if (!message.guildId || message.author.bot || message.webhookId || message.system || !message.content?.trim() || message.content.trim().startsWith('/')) return;
  const session = sessions.get(message.guildId);
  if (!session?.channelChat || session.excluded.has(message.author.id)) return;
  const language = session.chatUsers.get(message.author.id) || 'en';
  if (message.member?.id !== message.author.id || session.channelId !== message.channelId || message.member?.voice?.channelId !== message.channelId) return;
  const reply = payload => message.reply({ content: payload.content, allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
  try {
    await enqueue({ guildId: message.guildId, guild: message.guild, member: message.member, user: message.author, ttsChat: true, editReply: async () => {}, followUp: reply }, message.content, language);
  } catch (error) { await reply({ content: error.message }); }
}
module.exports = { enqueue, eligible, status, stop, init, join, leave, handleMessage, setLanguage };
