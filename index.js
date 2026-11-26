const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, Events, ActivityType, Partials } = require('discord.js');
const dotenv = require('dotenv');

dotenv.config();
require('./utils/data-fs').bootstrap();

const cleanEnvValue = (value) => value?.split('//')[0].trim();
const token = cleanEnvValue(process.env.DISCORD_TOKEN);
if (!token) {
  console.error('Missing DISCORD_TOKEN in .env');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});
client.commands = new Collection();

function formatErrorMessage(error) {
  if (!error) return 'Unknown error';

  const raw = error.stack || error.message || String(error);
  const cleaned = String(raw)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return 'Unknown error';
  return cleaned.length > 600 ? `${cleaned.slice(0, 600).trimEnd()}…` : cleaned;
}

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
      if (command.runData && typeof command.executeRun === 'function') {
        client.commands.set(command.runData.name, {
          data: command.runData,
          execute: command.executeRun
        });
      }
    }
  }
}

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setActivity('Powered by Hypha', { type: ActivityType.Playing });
});

client.on(Events.InteractionCreate, async interaction => {
  require('./utils/health').attach(interaction);
  if (interaction.customId?.startsWith('ux:')) return require('./utils/ux-home').handle(interaction);
  if (interaction.guildId && require('./utils/ux-release').enabled(interaction.guildId)) {
    const id = interaction.customId || '';
    const home = id === 'cx_hub:home' ? 'home' : id.startsWith('me_tab:') ? ({overview:'home',orders:'logistics',events:'events',squads:'squads',training:'training',requests:'requests'}[id.split(':')[1]]) : null;
    if (home) {
      try { return await require('./utils/ux-home').open(interaction, home); }
      catch(e) { const p={content:e.message,ephemeral:true,allowedMentions:{parse:[]}};return interaction.deferred?interaction.editReply(p):interaction.reply(p); }
    }
  }
  if ((interaction.isButton() || interaction.isModalSubmit() || interaction.isStringSelectMenu()) && interaction.customId.startsWith('cx_')) {
    const name=interaction.customId.split(':')[0].slice(3);
    if(!['hub','feedback','absence','notifications','onboarding','debrief','squad-review','wararchive','warvote'].includes(name))return;
    try { await client.commands.get(name).handle(interaction); }
    catch(e){const reply={content:e.message||'Could not complete this action.',ephemeral:true,allowedMentions:{parse:[]}};if(interaction.deferred||interaction.replied)await interaction.followUp(reply).catch(()=>{});else await interaction.reply(reply).catch(()=>{});}
    return;
  }
  if((interaction.isButton()||interaction.isStringSelectMenu())&&/^(aq_|nav_)/.test(interaction.customId||'')){try{if(await require('./utils/maintenance').guard(interaction))return;await client.commands.get(interaction.customId.startsWith('aq_')?'approvals':'help').handle(interaction);}catch(e){require('./utils/health').record('interaction_failure',0,interaction.guildId);console.error('[Navigation]',e.message);}return;}
  if(interaction.isButton()&&interaction.customId.startsWith('me_')) {
    try { if(await require('./utils/maintenance').guard(interaction))return;await client.commands.get('me').handle(interaction); } catch(e){console.error('[Dashboard]',e.message);}
    return;
  }
  if(['stockpile','order','manifest'].includes(interaction.commandName)||/^(sp_|ord_|mf_)/.test(interaction.customId||''))require('./utils/live-panels').attach(interaction);
  if ((interaction.isButton() || interaction.isStringSelectMenu()) && /^(sq_|wf_)/.test(interaction.customId)) {
    try { if (await require('./utils/maintenance').guard(interaction)) return; await client.commands.get(interaction.customId.startsWith('sq_') ? 'squad' : 'warflow').handle(interaction); }
    catch(error) { console.error('Squad/war action failed:',error.message); const payload={content:'Could not complete this action. Please retry.',ephemeral:true}; if(interaction.deferred||interaction.replied)await interaction.followUp(payload).catch(()=>{});else await interaction.reply(payload).catch(()=>{}); }
    return;
  }
  try { if (await require('./utils/maintenance').guard(interaction)) return; }
  catch (error) { console.error('Maintenance check failed:', error.message); return; }
  if ((interaction.isButton() || interaction.isStringSelectMenu() || interaction.isUserSelectMenu() || interaction.isModalSubmit()) && interaction.customId.startsWith('cm_')) {
    try { await client.commands.get('commendation')[interaction.isButton() ? 'handleButton' : interaction.isModalSubmit() ? 'handleModal' : 'handleSelect'](interaction); }
    catch (error) {
      console.error('Commendation action failed:', error.message);
      const payload = {content:'Could not complete this commendation action. Refresh and try again.',ephemeral:true};
      if(interaction.deferred||interaction.replied)await interaction.followUp(payload).catch(()=>{});else await interaction.reply(payload).catch(()=>{});
    }
    return;
  }
  if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith('mf_')) {
    try { await client.commands.get('manifest')[interaction.isButton() ? 'handleButton' : 'handleSelect'](interaction); }
    catch (error) {
      console.error('Manifest panel failed:', error.message);
      const payload = { content: 'Could not update the manifest. Refresh and try again.', ephemeral: true };
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
    return;
  }
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    try { if (command?.autocomplete) await command.autocomplete(interaction); else await interaction.respond([]); }
    catch (error) { console.error('Autocomplete failed:', error); if (!interaction.responded) await interaction.respond([]).catch(() => {}); }
    return;
  }
  if ((interaction.isButton() || interaction.isModalSubmit() || interaction.isStringSelectMenu()) && interaction.customId.startsWith('ord_')) {
    const command = client.commands.get('order');
    try { await command[interaction.isButton() ? 'handleButton' : interaction.isStringSelectMenu() ? 'handleSelect' : 'handleModal'](interaction); }
    catch (error) {
      console.error('Order panel failed:', error.message);
      const payload = { content: 'Could not complete the order action. Refresh the panel and try again.', ephemeral: true };
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
    return;
  }
  if ((interaction.isButton() || interaction.isModalSubmit() || interaction.isStringSelectMenu()) && interaction.customId.startsWith('sp_')) {
    const command = client.commands.get('stockpile');
    try { await command[interaction.isButton() ? 'handleButton' : interaction.isStringSelectMenu() ? 'handleSelect' : 'handleModal'](interaction); }
    catch (error) {
      console.error('Stockpile import failed:', error.message);
      const payload = { content: 'The import could not be completed. Please reopen the stockpile and try again.', ephemeral: true };
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
    return;
  }
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('botstatus:')) {
      try { await client.commands.get('botstatus').handleButton(interaction); }
      catch (error) {
        console.error('Bot status refresh failed:', error.message);
        const message = { content: 'Could not refresh the status. Try again shortly.', ephemeral: true };
        if (interaction.deferred || interaction.replied) await interaction.followUp(message).catch(() => {});
        else await interaction.reply(message).catch(() => {});
      }
      return;
    }
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

    if (interaction.customId.startsWith('activitycheck_')) {
  const command = client.commands.get('activitycheck');

  if (command && typeof command.handleButton === 'function') {
    try {
      await command.handleButton(interaction);
    } catch (error) {
      console.error('Error handling activity check button:', error);

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: 'There was an error processing your request!',
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: 'There was an error processing your request!',
          ephemeral: true
        });
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

    if (handlerName.startsWith('logitask_')) {
      const command = client.commands.get('logitask');
      if (command && typeof command.handleButton === 'function') {
        try {
          await command.handleButton(interaction);
        } catch (error) {
          console.error('Error handling logistics task button:', error);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error handling that logistics task action!', ephemeral: true });
          } else {
            await interaction.reply({ content: 'There was an error handling that logistics task action!', ephemeral: true });
          }
        }
      }
      return;
    }

    if (handlerName.startsWith('task_')) {
      const command = client.commands.get('task');
      if (command && typeof command.handleButton === 'function') {
        try {
          await command.handleButton(interaction);
        } catch (error) {
          console.error('Error handling task button:', error);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error handling that task action!', ephemeral: true });
          } else {
            await interaction.reply({ content: 'There was an error handling that task action!', ephemeral: true });
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
    if (prefix === 'tr_qualify' || prefix === 'tr_manage_qualifications') {
      const command = client.commands.get('training');
      if (command && typeof command.handleSelect === 'function') {
        try {
          await command.handleSelect(interaction);
        } catch (error) {
          console.error('Error handling training qualification selection:', error);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error processing that qualification!', ephemeral: true });
          } else {
            await interaction.reply({ content: 'There was an error processing that qualification!', ephemeral: true });
          }
        }
      }
      return;
    }

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

    if (prefix.startsWith('task_')) {
      const command = client.commands.get('task');
      if (command && typeof command.handleModal === 'function') {
        try {
          await command.handleModal(interaction);
        } catch (error) {
          console.error('Error handling task modal:', error);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error processing that task submission!', ephemeral: true });
          } else {
            await interaction.reply({ content: 'There was an error processing that task submission!', ephemeral: true });
          }
        }
      }
    }

    if (prefix.startsWith('logitask_')) {
      const command = client.commands.get('logitask');
      if (command && typeof command.handleModal === 'function') {
        try {
          await command.handleModal(interaction);
        } catch (error) {
          console.error('Error handling logistics task modal:', error);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error processing that logistics task submission!', ephemeral: true });
          } else {
            await interaction.reply({ content: 'There was an error processing that logistics task submission!', ephemeral: true });
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
    const ux = require('./utils/ux-release').enabled(interaction.guildId);
    const name = interaction.commandName;
    const sub = interaction.options.getSubcommand(false);
    if (ux && (name === 'me' || name === 'help' || name === 'hub' && sub === 'view' || name === 'onboarding' && sub === 'view')) {
      const tab = name === 'me' ? interaction.options.getString('tab') : null;
      const home = name === 'help' ? 'help' : name === 'onboarding' ? 'onboarding' : ({orders:'logistics',events:'events',training:'training',squads:'squads',requests:'requests'}[tab] || 'home');
      await require('./utils/ux-home').open(interaction, home);
    } else await command.execute(interaction);
  } catch (error) {
    console.error(`Error executing ${interaction.commandName}:`, error);
    const message = formatErrorMessage(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: `There was an error while executing this command: ${message}`, ephemeral: true });
    } else {
      await interaction.reply({ content: `There was an error while executing this command: ${message}`, ephemeral: true });
    }
  }
});

// Load feature handlers (e.g., welcome messages, automations)
const featuresPath = path.join(__dirname, 'features');
const featureFiles = fs.existsSync(featuresPath)
  ? fs.readdirSync(featuresPath).filter(file => file.endsWith('.js'))
  : [];

for (const file of featureFiles) {
  if (file === 'rollback-active-members-15min.js') {
    continue;
  }

  const featurePath = path.join(featuresPath, file);
  try {
    const feature = require(featurePath);
    if (feature && 'data' in feature && 'execute' in feature) {
      if (typeof feature.init === 'function') {
        feature.init(client);
      }
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

require('./utils/live-panels').init(client);
require('./utils/shared-panels').init(client);
require('./utils/health').init(client);
client.login(token);
