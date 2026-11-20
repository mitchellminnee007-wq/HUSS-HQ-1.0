# HUSS HQ voice text-to-speech

Anyone with access to a regular voice channel can use HUSS HQ to speak in a regular Discord voice channel. No separate bot or paid speech account is required. Piper neural voices provide more natural speech locally on the VPS.

For automatic voice-chat reading:

1. Join a regular voice channel and run `/tts join` (optionally choose `language`).
2. Open that voice channel's own text chat and type normally. New messages from everyone currently in voice are spoken, including people who join later.
3. Others do not need to run a command. Their default language is English; `/tts languages` changes their personal language.
4. Use `/tts leave` to opt out and remove your queued speech. Leaving voice removes your queued speech and resets your language and opt-out. Rejoining an active TTS channel automatically enables speech again. After a bot restart, someone must run `/tts join` again.

The bot stays connected while people remain in the channel after `/tts join`. Bot/webhook messages, slash-command text, attachment-only messages and messages from other channels are ignored. Error notices may be posted in the same voice-channel chat; successful messages do not create extra replies. Original text messages remain in Discord's chat as usual.

Use `/tts languages` to list English, Dutch, French and German. Use `/tts languages language:Dutch` to change the language of your next chat messages while channel chat TTS is active. This only changes your own session; queued messages retain their original language. It selects pronunciation, not translation. Language selections reset when you leave or the bot restarts.

For individual messages:

1. Join the voice channel where you want to speak.
2. Use `/tts say text:Hello everyone` in the server. You can use the voice channel's text chat.
3. Optionally choose English (default), Dutch, French or German with `language`.
4. HUSS HQ joins your channel and reads your display name followed by the message.

`/tts status` shows the queue in your channel. `/tts stop` stops playback, clears the queue and disconnects the bot; it is available to eligible members in the bot's voice channel.

The bot supports one voice channel per server, up to ten messages in the queue (including current speech), and two outstanding messages per user. Messages are limited to 400 characters with a five-second cooldown per user. For `/tts say` without channel chat enabled, it leaves after two idle minutes. It always leaves when no human members remain. Queued speech is removed when its sender leaves. Server-muted or timed-out members cannot use TTS. Stage channels are not supported.

The bot needs View Channel, Connect and Speak in the target voice channel and must not be server-muted. Members need access to the channel and application commands. The bot enables the GuildVoiceStates intent and joins self-deafened. It does not record voice, save speech files or send message text to a third-party TTS service. Audio and queued text are held in memory until playback ends; a restart clears the queue.

## VPS setup

- Node.js >=22.12.0; HUSS uses `/opt/huss-node-runtime/bin/node` through its PM2 configuration. Other applications retain their existing runtime.
- `@discordjs/voice` with its DAVE dependency and `opusscript` for Opus encoding.
- `ffmpeg` on PATH for conversion to 48 kHz stereo PCM.
- Python virtual environment `/opt/huss-piper-venv` with `piper-tts==1.3.0`. Install with `python3 -m venv /opt/huss-piper-venv` and `/opt/huss-piper-venv/bin/pip install piper-tts==1.3.0` (Ubuntu requires `python3-venv`).
- Download voices with `/opt/huss-piper-venv/bin/python -m piper.download_voices --data-dir /opt/huss-piper-voices en_US-ryan-medium nl_BE-nathalie-medium fr_FR-siwis-medium de_DE-thorsten-medium`.
- Optional `HUSS_PIPER_PYTHON` and `HUSS_PIPER_MODELS` override those paths. All selected models output 22,050 Hz mono PCM. Missing neural tools/models report an error rather than silently reverting to a robotic voice.
- Neural generation runs one job at a time across servers, with a bounded queue and 30-second synthesis timeout. A private Python worker warms English on voice connection and retains the most recently used language while any voice session remains. Switching languages replaces the cached model to limit RAM usage. The last voice disconnect releases the worker; cancellation or a worker failure can require a fresh load on the next message. No network TTS endpoint is exposed.
- Save the PM2 process list after changing the interpreter so reboot restoration retains it.

Automated tests use mocked voice connections. Server smoke checks validate speech generation and Opus encoding without joining a populated voice channel. Actual audibility is verified when a member runs `/tts say` in Discord.

## Voice sources and attribution

Engine: [OHF Piper](https://github.com/OHF-Voice/piper1-gpl), GPL-3.0. Model cards are published in [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices).

- English: en_US-ryan-medium, [RyanSpeech dataset](https://www.kaggle.com/datasets/roholazandie/ryanspeech), CC BY-NC-SA 4.0; male English voice, model distributed by rhasspy/piper-voices without modifications.
- Dutch: nl_BE-nathalie-medium, Nathalie dataset (CC0).
- French: fr_FR-siwis-medium, [SIWIS French Speech Synthesis Database](https://datashare.ed.ac.uk/handle/10283/2353), CC-BY 4.0; model distributed by rhasspy/piper-voices. Used without model modifications.
- German: de_DE-thorsten-medium, Thorsten Voice dataset (CC0).
