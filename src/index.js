import {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Events,
  ChannelType
} from 'discord.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  initDb,
  addConfession,
  fetchPendingConfessions,
  markApproved,
  getApprovedCount
} from './utils/db.js';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { BOT_TOKEN, CONFESSION_CHANNEL_ID, ADMIN_CHANNEL_ID } = process.env;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel]
});

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await initDb();
  const channel = await client.channels.fetch(CONFESSION_CHANNEL_ID);
  if (!channel) return console.error('Invalid CONFESSION_CHANNEL_ID');
  try {
    if (channel.type === ChannelType.GuildForum) {
      const fetched = await channel.threads.fetchActive();
      const existing = fetched.threads.find(t => t.ownerId === client.user.id && t.name === 'Hướng dẫn gửi confession');
      if (!existing) {
        const embed = new EmbedBuilder()
          .setTitle('Gửi Confession Ẩn Danh')
          .setDescription('Click nút bên dưới để gửi confession ẩn danh.')
          .setColor('Random');
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('open_confess_modal').setLabel('Gửi Confession').setStyle(ButtonStyle.Primary)
        );
        const thread = await channel.threads.create({ name: 'Hướng dẫn gửi confession', message: { embeds: [embed], components: [row] } });
        const starter = await thread.fetchStarterMessage();
        if (starter) await starter.pin();
      }
    } else if (channel.isTextBased()) {
      const messages = await channel.messages.fetch({ limit: 50 });
      const exists = messages.find(m => m.author.id === client.user.id && m.embeds.length);
      if (!exists) {
        const embed = new EmbedBuilder().setTitle('Gửi Confession Ẩn Danh').setDescription('Click nút bên dưới để gửi confession ẩn danh.').setColor('Random');
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('open_confess_modal').setLabel('Gửi Confession').setStyle(ButtonStyle.Primary)
        );
        const msg = await channel.send({ embeds: [embed], components: [row] });
        await msg.pin();
      }
    } else console.error('CONFESSION_CHANNEL_ID must be a forum or text channel.');
  } catch (err) { console.error('Error setting up initial message:', err); }
});

client.on(Events.InteractionCreate, async interaction => {
  // Open confession modal
  if (interaction.isButton() && interaction.customId === 'open_confess_modal') {
    const modal = new ModalBuilder().setCustomId('confess_modal').setTitle('Gửi Confession');
    const titleInput = new TextInputBuilder().setCustomId('confess_title').setLabel('Tiêu đề').setStyle(TextInputStyle.Short).setRequired(true);
    const descInput = new TextInputBuilder().setCustomId('confess_description').setLabel('Mô tả').setStyle(TextInputStyle.Paragraph).setRequired(true);
    const imageInput = new TextInputBuilder().setCustomId('confess_image').setLabel('URL Hình ảnh (tuỳ chọn)').setStyle(TextInputStyle.Short).setRequired(false);
    modal.addComponents(new ActionRowBuilder().addComponents(titleInput), new ActionRowBuilder().addComponents(descInput), new ActionRowBuilder().addComponents(imageInput));
    return interaction.showModal(modal);
  }

  // Handle confession submit
  if (interaction.isModalSubmit() && interaction.customId === 'confess_modal') {
    const title = interaction.fields.getTextInputValue('confess_title');
    const description = interaction.fields.getTextInputValue('confess_description');
    const imageUrl = interaction.fields.getTextInputValue('confess_image');
    const content = JSON.stringify({ title, description, imageUrl });
    const id = await addConfession(content, interaction.user.id);
    const adminChannel = await client.channels.fetch(ADMIN_CHANNEL_ID);
    const embed = new EmbedBuilder().setTitle('Confession chờ duyệt').setDescription(`**Tiêu đề:** ${title}\n**Mô tả:** ${description}`).setFooter({ text: `ID: ${id}` }).setColor('Yellow');
    if (imageUrl) embed.setImage(imageUrl);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`approve:${id}`).setLabel('Duyệt').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reject:${id}`).setLabel('Từ chối').setStyle(ButtonStyle.Danger)
    );
    await adminChannel.send({ embeds: [embed], components: [row] });
    return interaction.reply({ content: 'Đã gửi và chờ duyệt.', ephemeral: true });
  }

  // Admin approve/reject or open reply
  if (interaction.isButton()) {
    const [action, id] = interaction.customId.split(':');
    if (action === 'approve' || action === 'reject') {
      const record = await fetchPendingConfessions(id);
      if (!record) return interaction.reply({ content: 'Không tìm thấy.', ephemeral: true });
      // original embed
      const origEmbed = interaction.message.embeds[0];
      const color = action === 'approve' ? 'Green' : 'Red';
      const title = action === 'approve' ? 'Đã duyệt confession' : 'Đã từ chối confession';
      const updated = new EmbedBuilder(origEmbed).setColor(color).setTitle(title);
      // update admin message
      await interaction.update({ embeds: [updated], components: [] });
      if (action === 'approve') {
        const num = await getApprovedCount() + 1;
        const data = JSON.parse(record.content);
        const channel = await client.channels.fetch(CONFESSION_CHANNEL_ID);
        // post confession thread
        let starter;
        if (channel.type === ChannelType.GuildForum) {
          const thread = await channel.threads.create({ name: `Hocmai Confession #${num}: ${data.title}`, message: { content: data.description } });
          starter = await thread.fetchStarterMessage();
          if (data.imageUrl) await thread.send({ files: [data.imageUrl] });
        } else {
          const thread = await channel.threads.create({ name: `Hocmai Confession #${num}: ${data.title}`, autoArchiveDuration: 1440 });
          starter = await thread.send({ content: data.description });
          if (data.imageUrl) await thread.send({ files: [data.imageUrl] });
        }
        // add anonymous reply button
        const replyRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`reply:${id}`).setLabel('Trả lời ẩn danh').setStyle(ButtonStyle.Secondary)
        );
        if (starter) await starter.edit({ components: [replyRow] });
        await markApproved(id);
      }
      return;
    }
    if (interaction.customId.startsWith('reply:')) {
      // open reply modal
      const [, id] = interaction.customId.split(':');
      const modal = new ModalBuilder().setCustomId(`reply_modal:${id}`).setTitle('Trả lời ẩn danh');
      const textInput = new TextInputBuilder().setCustomId('reply_text').setLabel('Nội dung trả lời').setStyle(TextInputStyle.Paragraph).setRequired(true);
      const imgInput = new TextInputBuilder().setCustomId('reply_image').setLabel('URL Hình ảnh (tuỳ chọn)').setStyle(TextInputStyle.Short).setRequired(false);
      modal.addComponents(new ActionRowBuilder().addComponents(textInput), new ActionRowBuilder().addComponents(imgInput));
      return interaction.showModal(modal);
    }
  }

  // Handle reply submit
  if (interaction.isModalSubmit() && interaction.customId.startsWith('reply_modal:')) {
    const id = interaction.customId.split(':')[1];
    const reply = interaction.fields.getTextInputValue('reply_text');
    const imageUrl = interaction.fields.getTextInputValue('reply_image');
    const embed = new EmbedBuilder().setTitle('Phản hồi ẩn danh').setDescription(reply).setColor('Random');
    if (imageUrl) embed.setImage(imageUrl);
    await interaction.channel.send({ embeds: [embed] });
    return interaction.reply({ content: 'Đã gửi phản hồi ẩn danh.', ephemeral: true });
  }
});

client.login(BOT_TOKEN);
