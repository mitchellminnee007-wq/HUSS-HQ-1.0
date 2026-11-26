const {SlashCommandBuilder} = require('discord.js');
const release = require('../utils/ux-release');
module.exports = {
  data:new SlashCommandBuilder().setName('uxrelease').setDescription('Commander controls for the War 144 UX release').setDMPermission(false)
    .addSubcommand(s=>s.setName('status').setDescription('Check the fixed release target'))
    .addSubcommand(s=>s.setName('preview').setDescription('Open a private Commander preview'))
    .addSubcommand(s=>s.setName('release').setDescription('Enable after War 144 has started').addBooleanOption(o=>o.setName('confirm').setDescription('Confirm member rollout').setRequired(true)))
    .addSubcommand(s=>s.setName('hold').setDescription('Return members to the existing UX')),
  async execute(i) {
    await i.deferReply({ephemeral:true});
    try {
      i.member = await i.guild.members.fetch({user:i.user.id,force:true});
      if (!require('../utils/ranks').isCommander(i.member)) throw new Error('Commander access required.');
      const sub = i.options.getSubcommand();
      if (sub === 'preview') return require('../utils/ux-home').open(i, 'home', true);
      if (sub === 'release') {
        if (i.options.getBoolean('confirm') !== true) throw new Error('Confirm the release to continue.');
        release.release(i.guildId, i.user.id, require('../utils/war-state').read().guilds[i.guildId]);
      }
      if (sub === 'hold') release.hold(i.guildId, i.user.id);
      return i.editReply({content:`HUSS UX • Target: Able War ${release.TARGET_WAR}\n${release.enabled(i.guildId)?'Released to members.':'Locked for members. Commander preview is available.'}\nWar 143 cannot unlock this package. Release requires fresh war tracking and Commander confirmation.`,allowedMentions:{parse:[]}});
    } catch(e) { return i.editReply({content:e.message,allowedMentions:{parse:[]}}); }
  }
};
