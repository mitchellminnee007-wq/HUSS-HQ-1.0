const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle, FileUploadBuilder, EmbedBuilder } = require('discord.js');
const { randomUUID } = require('node:crypto');
const store = require('./logistics-store');
const { manager, canViewStockpile } = require('./logistics-access');
const { parseExport, fingerprint, applyImport, readAttachment } = require('./stockpile-import');
const audit = require('./audit');
const pending = new Map();
function importRow(id) {
  return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`sp_import:${id}`).setLabel('Import contents').setStyle(ButtonStyle.Primary));
}
function authorize(interaction, id) {
  if (!interaction.guildId || !manager(interaction.member)) throw new Error('Only Officers, Commanders and logistics staff can import inventory.');
  const guild = store.read().guilds[interaction.guildId];
  const pile = guild && store.pile(guild, id);
  if (!canViewStockpile(interaction.member, pile)) throw new Error('Stockpile not found or not accessible.');
  return { guild, pile };
}
function buildModal(id) {
  return new ModalBuilder().setCustomId(`sp_import_modal:${id}`).setTitle('Import stockpile contents').addLabelComponents(
    new LabelBuilder().setLabel('Upload full export (.txt or .csv)').setDescription('Keep the original header and blank lines. Maximum 256 KB.')
      .setFileUploadComponent(new FileUploadBuilder().setCustomId('export_file').setMinValues(0).setMaxValues(1).setRequired(false)),
    new LabelBuilder().setLabel('Or paste a short item-crate list').setDescription('Use either a file or text. Example: Basic Materials (Crate),107')
      .setTextInputComponent(new TextInputBuilder().setCustomId('export_text').setStyle(TextInputStyle.Paragraph).setMaxLength(4000).setRequired(false))
  );
}
async function handleButton(interaction) {
  try {
    const [action, id] = interaction.customId.split(':');
    if (action === 'sp_import') {
      authorize(interaction, id);
      return await interaction.showModal(buildModal(id));
    }
    const session = pending.get(id);
    if (!session || session.expiresAt < Date.now()) { pending.delete(id); throw new Error('Import preview expired. Open Import contents again.'); }
    if (session.guildId !== interaction.guildId || session.userId !== interaction.user.id) throw new Error('This import preview belongs to another user.');
    authorize(interaction, session.stockpileId);
    if (action === 'sp_cancel') {
      pending.delete(id);
      return await interaction.update({ content: 'Import cancelled. Inventory unchanged.', embeds: [], components: [] });
    }
    if (action !== 'sp_confirm') throw new Error('Unknown import action.');
    store.transact(interaction.guildId, guild => {
      if (fingerprint(guild, session.stockpileId) !== session.fingerprint) throw new Error('Inventory or orders changed after this preview. Import again to review the latest counts.');
      return applyImport(guild, session.stockpileId, session.parsed);
    });
    pending.delete(id);
    audit.record(interaction, 'stockpile.import', session.stockpileId, { rows: session.parsed.entries.length });
    return await interaction.update({ content: `Imported **${session.parsed.entries.length} inventory rows**. Listed quantities were replaced, including zero counts. Unlisted items and the reserve code were preserved. Open the updated inventory below.`, embeds: [], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`sp_view:${session.stockpileId}:1:all`).setLabel('Open inventory').setStyle(ButtonStyle.Primary))] });
  } catch (error) {
    return interaction.reply({ content: error.message, ephemeral: true, allowedMentions: { parse: [] } });
  }
}
async function handleModal(interaction) {
  try {
    const [, id] = interaction.customId.split(':');
    authorize(interaction, id);
    await interaction.deferReply({ ephemeral: true });
    const files = interaction.fields.getUploadedFiles('export_file');
    const text = interaction.fields.getTextInputValue('export_text').trim();
    if (Boolean(files?.size) === Boolean(text)) throw new Error('Provide exactly one export file or pasted list.');
    const parsed = parseExport(files?.size ? await readAttachment(files.first()) : text);
    const { guild, pile } = authorize(interaction, id);
    const before = fingerprint(guild, id);
    applyImport(structuredClone(guild), id, parsed);
    for (const [token, value] of pending) if (value.expiresAt < Date.now() || (value.guildId === interaction.guildId && value.userId === interaction.user.id)) pending.delete(token);
    if (pending.size >= 1000) throw new Error('Too many pending imports. Please try again later.');
    const token = randomUUID();
    pending.set(token, { guildId: interaction.guildId, userId: interaction.user.id, stockpileId: id, fingerprint: before, parsed, expiresAt: Date.now() + 10 * 60000 });
    const positive = parsed.entries.filter(entry => entry.quantity > 0);
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('Review stockpile import')
      .setDescription(`**Target: ${pile.name} (${id})**\n${pile.location} • ${pile.war}\n\nCheck that the export belongs to this stockpile before confirming.`)
      .addFields({ name: 'Export source', value: (parsed.source || 'Pasted item-crate list').slice(0, 1024) },
        { name: 'Inventory rows', value: `${parsed.entries.length} total • ${positive.length} non-zero • ${parsed.entries.length - positive.length} zero` },
        { name: 'Preview (first 8 non-zero rows)', value: positive.slice(0, 8).map(entry => `${entry.item}: ${entry.quantity} ${entry.unit}`).join('\n') || 'All imported quantities are zero.' },
        { name: 'Changes', value: 'Replaces counts for listed items, including zeros. Preserves unlisted items, reserve code and settings. Crates, vehicles and shippable crates remain separate. Uncrated shippables use the items unit.' })
      .setFooter({ text: 'Preview expires in 10 minutes. Nothing has been saved yet.' });
    return await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sp_confirm:${token}`).setLabel('Confirm import').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`sp_cancel:${token}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    )], allowedMentions: { parse: [] } });
  } catch (error) {
    const payload = { content: error.message, allowedMentions: { parse: [] } };
    return interaction.deferred ? interaction.editReply(payload) : interaction.reply({ ...payload, ephemeral: true });
  }
}
module.exports = { importRow, buildModal, handleButton, handleModal };
