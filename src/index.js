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
  if (!channel) throw new Error('Invalid CONFESSION_CHANNEL_ID');

  // Setup pinned instruction
  if (channel.type === ChannelType.GuildForum) {
    const fetched = await channel.threads.fetchActive();
    const exists = fetched.threads.some(t => t.ownerId === client.user.id && t.name === 'Hướng dẫn gửi confession');
    if (!exists) {
      const embed = new EmbedBuilder()
        .setTitle('Gửi Confession Ẩn Danh')
        .setDescription('Nhấn nút dưới đây để gửi confession.')
        .setColor('Blue');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('open_confess_modal').setLabel('Gửi Confession').setStyle(ButtonStyle.Primary)
      );
      const thread = await channel.threads.create({ name: 'Hướng dẫn gửi confession', message: { embeds: [embed], components: [row] } });
      const starter = await thread.fetchStarterMessage();
      if (starter) await starter.pin();
    }
  } else if (channel.isTextBased()) {
    const msgs = await channel.messages.fetch({ limit: 50 });
    const exists = msgs.some(m => m.author.id === client.user.id && m.embeds.length);
    if (!exists) {
      const embed = new EmbedBuilder()
        .setTitle('Gửi Confession Ẩn Danh')
        .setDescription('Nhấn nút dưới đây để gửi confession.')
        .setColor('Blue');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('open_confess_modal').setLabel('Gửi Confession').setStyle(ButtonStyle.Primary)
      );
      const msg = await channel.send({ embeds: [embed], components: [row] });
      await msg.pin();
    }
  }
});

client.on(Events.InteractionCreate, async interaction => {
  // Open submission modal
  if (interaction.isButton() && interaction.customId === 'open_confess_modal') {
    const modal = new ModalBuilder().setCustomId('confess_modal').setTitle('Gửi Confession');
    const t = new TextInputBuilder().setCustomId('confess_title').setLabel('Tiêu đề').setStyle(TextInputStyle.Short).setRequired(true);
    const d = new TextInputBuilder().setCustomId('confess_desc').setLabel('Mô tả').setStyle(TextInputStyle.Paragraph).setRequired(true);
    const i = new TextInputBuilder().setCustomId('confess_img').setLabel('URL Hình ảnh (tùy chọn)').setStyle(TextInputStyle.Short).setRequired(false);
    modal.addComponents(new ActionRowBuilder().addComponents(t), new ActionRowBuilder().addComponents(d), new ActionRowBuilder().addComponents(i));
    return interaction.showModal(modal);
  }

  // Handle confession modal submit
  if (interaction.isModalSubmit() && interaction.customId === 'confess_modal') {
    const title = interaction.fields.getTextInputValue('confess_title');
    const description = interaction.fields.getTextInputValue('confess_desc');
    const imageUrl = interaction.fields.getTextInputValue('confess_img');
    const content = JSON.stringify({ title, description, imageUrl });
    const id = await addConfession(content, interaction.user.id);
    const adminChannel = await client.channels.fetch(ADMIN_CHANNEL_ID);
    const embed = new EmbedBuilder()
      .setTitle('Confession chờ duyệt')
      .setDescription(`**${title}**\n${description}`)
      .setFooter({ text: `ID: ${id}` })
      .setColor('Yellow');
    if (imageUrl) embed.setImage(imageUrl);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`approve:${id}`).setLabel('Duyệt').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reject:${id}`).setLabel('Từ chối').setStyle(ButtonStyle.Danger)
    );
    await adminChannel.send({ embeds: [embed], components: [row] });
    return interaction.reply({ content: 'Đã gửi confession, chờ duyệt.', ephemeral: true });
  }

  // Admin approve/reject or initiate reply
  if (interaction.isButton()) {
    const [action, id] = interaction.customId.split(':');
    if (['approve','reject'].includes(action)) {
      const rec = await fetchPendingConfessions(id);
      if (!rec) return interaction.reply({ content: 'Không tìm thấy confession.', ephemeral: true });
      const orig = interaction.message.embeds[0];
      const embed = new EmbedBuilder(orig)
        .setColor(action==='approve'?'Green':'Red')
        .setTitle(action==='approve'?'Đã duyệt':'Đã từ chối');
      await interaction.update({ embeds: [embed], components: [] });
      if (action==='approve') {
        const num = await getApprovedCount()+1;
        const { title, description, imageUrl } = JSON.parse(rec.content);
        const channel = await client.channels.fetch(CONFESSION_CHANNEL_ID);
        let msg;
        // send embed into thread
        if (channel.type===ChannelType.GuildForum) {
          const thread = await channel.threads.create({ name:`Hocmai Confession #${num}: ${title}`, message:{embeds:[new EmbedBuilder().setDescription(description).setImage(imageUrl||undefined).setColor('Blue')] } });
          msg = await thread.fetchStarterMessage();
        } else {
          const thread = await channel.threads.create({ name:`Hocmai Confession #${num}: ${title}`, autoArchiveDuration:1440 });
          msg = await thread.send({ embeds:[ new EmbedBuilder().setDescription(description).setImage(imageUrl||undefined).setColor('Blue') ] });
        }
        // add reply button
        const replyBtn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`reply:${id}`).setLabel('Trả lời ẩn danh').setStyle(ButtonStyle.Secondary));
        if (msg) await msg.edit({ components:[replyBtn] });
        await markApproved(id);
      }
      return;
    }
    if (action==='reply') {
      const modal = new ModalBuilder().setCustomId(`reply_modal:${id}`).setTitle('Trả lời ẩn danh');
      const txt = new TextInputBuilder().setCustomId('reply_txt').setLabel('Nội dung').setStyle(TextInputStyle.Paragraph).setRequired(true);
      const img = new TextInputBuilder().setCustomId('reply_img').setLabel('URL Hình ảnh (tuỳ chọn)').setStyle(TextInputStyle.Short).setRequired(false);
      modal.addComponents(new ActionRowBuilder().addComponents(txt),new ActionRowBuilder().addComponents(img));
      return interaction.showModal(modal);
    }
  }

  // Handle reply modal submit
  if (interaction.isModalSubmit() && interaction.customId.startsWith('reply_modal:')) {
    const id = interaction.customId.split(':')[1];
    const text = interaction.fields.getTextInputValue('reply_txt');
    const imageUrl = interaction.fields.getTextInputValue('reply_img');
    const embed = new EmbedBuilder().setTitle('Phản hồi ẩn danh').setDescription(text).setColor('Purple');
    if (imageUrl) embed.setImage(imageUrl);
    await interaction.channel.send({ embeds:[embed] });
    return interaction.reply({ content:'Đã gửi phản hồi.', ephemeral:true });
  }
});

client.login(BOT_TOKEN);
