const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, Events, ActivityType } = require('discord.js');
const dotenv = require('dotenv');

dotenv.config();

const cleanEnvValue = (value) => value?.split('//')[0].trim();
const token = cleanEnvValue(process.env.DISCORD_TOKEN);
if (!token) {
  console.error('Missing DISCORD_TOKEN in .env');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
client.commands = new Collection();

const commandDirs = [
  path.join(__dirname, 'commands'),
  path.join(__dirname, 'features')
];

for (const dir of commandDirs) {
  if (!fs.existsSync(dir)) continue;

  const commandFiles = fs.readdirSync(dir).filter(file => file.endsWith('.js'));
  for (const file of commandFiles) {
    const filePath = path.join(dir, file);
    const command = require(filePath);
    if (command && 'data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command);
      if (command.statusData && typeof command.executeStatus === 'function') {
        client.commands.set(command.statusData.name, {
          data: command.statusData,
          execute: command.executeStatus
        });
      }
      if (command.resetData && typeof command.executeReset === 'function') {
        client.commands.set(command.resetData.name, {
          data: command.resetData,
          execute: command.executeReset
        });
      }
      if (command.cancelData && typeof command.executeCancel === 'function') {
        client.commands.set(command.cancelData.name, {
          data: command.cancelData,
          execute: command.executeCancel
        });
      }
      if (typeof command.init === 'function') {
        command.init(client);
      }
    }
  }
}

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setActivity('Powered by Hypha', { type: ActivityType.Playing });
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isButton()) {
    const [handlerName] = interaction.customId.split(':');

    if (handlerName === 'warning_vote') {
      const command = client.commands.get('warning');
      if (command && typeof command.handleButton === 'function') {
        try {
          await command.handleButton(interaction);
        } catch (error) {
          console.error('Error handling warning vote:', error);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error while handling that vote!', ephemeral: true });
          } else {
            await interaction.reply({ content: 'There was an error while handling that vote!', ephemeral: true });
          }
        }
      }
      return;
    }

    if (handlerName === 'activitycheck_join') {
      const command = client.commands.get('activitycheck');
      if (command && typeof command.handleButton === 'function') {
        try {
          await command.handleButton(interaction);
        } catch (error) {
          console.error('Error handling activity check button:', error);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error processing your request!', ephemeral: true });
          } else {
            await interaction.reply({ content: 'There was an error processing your request!', ephemeral: true });
          }
        }
      }
      return;
    }

    if (handlerName.startsWith('ticket_')) {
      const command = client.commands.get('ticketpanel');
      if (command && typeof command.handleButton === 'function') {
        try {
          await command.handleButton(interaction);
        } catch (error) {
          console.error('Error handling ticket button:', error);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error handling that ticket action!', ephemeral: true });
          } else {
            await interaction.reply({ content: 'There was an error handling that ticket action!', ephemeral: true });
          }
        }
      }
      return;
    }

    if (handlerName.startsWith('op_')) {
      const command = client.commands.get('operation');
      if (command && typeof command.handleButton === 'function') {
        try {
          await command.handleButton(interaction);
        } catch (error) {
          console.error('Error handling operation button:', error);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error handling that operation action!', ephemeral: true });
          } else {
            await interaction.reply({ content: 'There was an error handling that operation action!', ephemeral: true });
          }
        }
      }
      return;
    }

    if (handlerName.startsWith('tr_')) {
      const command = client.commands.get('training');
      if (command && typeof command.handleButton === 'function') {
        try {
          await command.handleButton(interaction);
        } catch (error) {
          console.error('Error handling training button:', error);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error handling that training action!', ephemeral: true });
          } else {
            await interaction.reply({ content: 'There was an error handling that training action!', ephemeral: true });
          }
        }
      }
      return;
    }

    if (handlerName.startsWith('kc_')) {
      const command = client.commands.get('killcount');
      if (command && typeof command.handleButton === 'function') {
        try {
          await command.handleButton(interaction);
        } catch (error) {
          console.error('Error handling kill count button:', error);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error handling that action!', ephemeral: true });
          } else {
            await interaction.reply({ content: 'There was an error handling that action!', ephemeral: true });
          }
        }
      }
      return;
    }

    if (handlerName.startsWith('bp_')) {
      const command = client.commands.get('botpanel');
      if (command && typeof command.handleButton === 'function') {
        try {
          await command.handleButton(interaction);
        } catch (error) {
          console.error('Error handling bot panel button:', error);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error handling that action!', ephemeral: true });
          } else {
            await interaction.reply({ content: 'There was an error handling that action!', ephemeral: true });
          }
        }
      }
      return;
    }

    if (handlerName === 'rr_toggle') {
      const command = client.commands.get('reactionrole');
      if (command && typeof command.handleButton === 'function') {
        try {
          await command.handleButton(interaction);
        } catch (error) {
          console.error('Error handling reaction role button:', error);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error toggling that role!', ephemeral: true });
          } else {
            await interaction.reply({ content: 'There was an error toggling that role!', ephemeral: true });
          }
        }
      }
      return;
    }

    return;
  }

  if (interaction.isStringSelectMenu()) {
    const [prefix] = interaction.customId.split(':');
    if (prefix.startsWith('ticket_')) {
      const command = client.commands.get('ticketpanel');
      if (command && typeof command.handleSelect === 'function') {
        try {
          await command.handleSelect(interaction);
        } catch (error) {
          console.error('Error handling ticket select menu:', error);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error processing that selection!', ephemeral: true });
          } else {
            await interaction.reply({ content: 'There was an error processing that selection!', ephemeral: true });
          }
        }
      }
    }
    return;
  }

  if (interaction.isModalSubmit()) {
    const [prefix] = interaction.customId.split(':');
    if (prefix.startsWith('ticket_')) {
      const command = client.commands.get('ticketpanel');
      if (command && typeof command.handleModal === 'function') {
        try {
          await command.handleModal(interaction);
        } catch (error) {
          console.error('Error handling ticket modal:', error);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error processing that submission!', ephemeral: true });
          } else {
            await interaction.reply({ content: 'There was an error processing that submission!', ephemeral: true });
          }
        }
      }
    }

    if (prefix.startsWith('op_')) {
      const command = client.commands.get('operation');
      if (command && typeof command.handleModal === 'function') {
        try {
          await command.handleModal(interaction);
        } catch (error) {
          console.error('Error handling operation modal:', error);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error processing that operation!', ephemeral: true });
          } else {
            await interaction.reply({ content: 'There was an error processing that operation!', ephemeral: true });
          }
        }
      }
    }

    if (prefix.startsWith('tr_')) {
      const command = client.commands.get('training');
      if (command && typeof command.handleModal === 'function') {
        try {
          await command.handleModal(interaction);
        } catch (error) {
          console.error('Error handling training modal:', error);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error processing that training!', ephemeral: true });
          } else {
            await interaction.reply({ content: 'There was an error processing that training!', ephemeral: true });
          }
        }
      }
    }

    if (prefix.startsWith('kc_')) {
      const command = client.commands.get('killcount');
      if (command && typeof command.handleModal === 'function') {
        try {
          await command.handleModal(interaction);
        } catch (error) {
          console.error('Error handling kill count modal:', error);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error processing that submission!', ephemeral: true });
          } else {
            await interaction.reply({ content: 'There was an error processing that submission!', ephemeral: true });
          }
        }
      }
    }

    if (prefix.startsWith('bp_')) {
      const command = client.commands.get('botpanel');
      if (command && typeof command.handleModal === 'function') {
        try {
          await command.handleModal(interaction);
        } catch (error) {
          console.error('Error handling bot panel modal:', error);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error processing that submission!', ephemeral: true });
          } else {
            await interaction.reply({ content: 'There was an error processing that submission!', ephemeral: true });
          }
        }
      }
    }

    if (prefix === 'rr_setup_modal') {
      const command = client.commands.get('reactionrole');
      if (command && typeof command.handleModal === 'function') {
        try {
          await command.handleModal(interaction);
        } catch (error) {
          console.error('Error handling reaction role modal:', error);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error setting up reaction roles!', ephemeral: true });
          } else {
            await interaction.reply({ content: 'There was an error setting up reaction roles!', ephemeral: true });
          }
        }
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Error executing ${interaction.commandName}:`, error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
    } else {
      await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
    }
  }
});

// Load feature handlers (e.g., welcome messages, automations)
const featuresPath = path.join(__dirname, 'features');
const featureFiles = fs.existsSync(featuresPath)
  ? fs.readdirSync(featuresPath).filter(file => file.endsWith('.js'))
  : [];

for (const file of featureFiles) {
  const featurePath = path.join(featuresPath, file);
  try {
    const feature = require(featurePath);
    if (feature && 'data' in feature && 'execute' in feature) {
      continue;
    }

    if (typeof feature === 'function') {
      feature(client);
    } else if (feature && typeof feature.init === 'function') {
      feature.init(client);
    } else {
      console.warn(`Feature at ${featurePath} does not export a function or init().`);
    }
  } catch (err) {
    console.warn(`Failed to load feature ${featurePath}:`, err.message);
  }
}

client.login(token);
