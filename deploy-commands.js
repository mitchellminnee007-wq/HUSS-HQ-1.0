const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');
const dotenv = require('dotenv');

dotenv.config();

const cleanEnvValue = (value) => value?.split('//')[0].trim();
const token = cleanEnvValue(process.env.DISCORD_TOKEN);
const clientId = cleanEnvValue(process.env.CLIENT_ID);
const guildId = cleanEnvValue(process.env.GUILD_ID);

if (!token || !clientId) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID in .env');
  process.exit(1);
}

const commands = [];
const commandDirs = [
  path.join(__dirname, 'commands'),
  path.join(__dirname, 'features')
];

for (const dir of commandDirs) {
  if (!fs.existsSync(dir)) continue;

  const commandFiles = fs.readdirSync(dir).filter(file => file.endsWith('.js'));
  for (const file of commandFiles) {
    const command = require(path.join(dir, file));
    if (command && 'data' in command) {
      commands.push(command.data.toJSON());
      if (command.statusData) {
        commands.push(command.statusData.toJSON());
      }
      if (command.resetData) {
        commands.push(command.resetData.toJSON());
      }
      if (command.cancelData) {
        commands.push(command.cancelData.toJSON());
      }
    }
  }
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log(`Started refreshing ${commands.length} application command(s).`);

    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      console.log('Successfully reloaded guild application commands.');
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      console.log('Successfully reloaded global application commands.');
      console.log('');
      console.log('Bot invite link (make sure "Public Bot" is ON in the Developer Portal):');
      console.log(`https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=268520454&scope=bot%20applications.commands`);
    }
  } catch (error) {
    console.error(error);
  }
})();
