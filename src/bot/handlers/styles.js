'use strict';

const { Input } = require('telegraf');
const texts = require('../texts');
const kb = require('../keyboards');
const { safeEdit, safeAnswerCb, downloadTelegramFile } = require('../util');

function register(bot, deps) {
  const { storage, sessions } = deps;

  async function showList(ctx) {
    const user = await storage.getUser(ctx.from.id);
    const text =
      texts.styles.listTitle +
      (user.styles.length === 0 ? `\n\n${texts.styles.empty}` : '');
    await safeEdit(ctx, text, { parse_mode: 'HTML', ...kb.stylesList(user.styles) });
  }

  bot.action('menu:styles', async (ctx) => {
    sessions.reset(ctx.from.id);
    await safeAnswerCb(ctx);
    await showList(ctx);
  });

  bot.action('style:new', async (ctx) => {
    await safeAnswerCb(ctx);
    sessions.set(ctx.from.id, {
      mode: 'style_name',
      styleDraft: { name: null, photos: [] },
    });
    await safeEdit(ctx, texts.styles.askName, { parse_mode: 'HTML', ...kb.cancelOnly() });
  });

  bot.action(/^style:open:([a-z0-9]+)$/i, async (ctx) => {
    await safeAnswerCb(ctx);
    const id = ctx.match[1];
    const style = await storage.getStyle(ctx.from.id, id);
    if (!style) {
      await ctx.reply('Стиль не найден.');
      return;
    }
    const text = texts.styles.detailTitle(style.name, style.files.length, style.createdAt);
    await safeEdit(ctx, text, { parse_mode: 'HTML', ...kb.styleDetail(id) });
  });

  bot.action(/^style:show:([a-z0-9]+)$/i, async (ctx) => {
    await safeAnswerCb(ctx);
    const id = ctx.match[1];
    const style = await storage.getStyle(ctx.from.id, id);
    if (!style) return;
    // Read each reference as a buffer (works for both Mongo and JSON
    // backends) and send up to 10 photos as a media group.
    const media = [];
    for (const f of style.files) {
      const buf = await storage.loadStyleReferenceBuffer(ctx.from.id, id, f);
      if (buf) media.push({ type: 'photo', media: Input.fromBuffer(buf, f) });
      if (media.length >= 10) break;
    }
    if (media.length === 0) {
      await ctx.reply('Эталоны не найдены.');
      return;
    }
    if (media.length === 1) {
      await ctx.replyWithPhoto(media[0].media);
    } else {
      await ctx.replyWithMediaGroup(media);
    }
  });

  bot.action(/^style:del:([a-z0-9]+)$/i, async (ctx) => {
    await safeAnswerCb(ctx);
    await storage.deleteStyle(ctx.from.id, ctx.match[1]);
    await ctx.reply(texts.styles.deleted);
    await showList(ctx);
  });

  bot.action('style:save', async (ctx) => {
    await safeAnswerCb(ctx);
    const session = sessions.get(ctx.from.id);
    if (session.mode !== 'style_photos' || !session.styleDraft) return;
    if (!session.styleDraft.photos || session.styleDraft.photos.length === 0) {
      await ctx.reply(texts.styles.photosRequired);
      return;
    }
    const created = await storage.createStyle(ctx.from.id, {
      name: session.styleDraft.name,
      files: session.styleDraft.photos,
    });
    sessions.reset(ctx.from.id);
    await ctx.reply(texts.styles.saved(created.name), { parse_mode: 'HTML' });
    await showList(ctx);
  });

  bot.on('text', async (ctx, next) => {
    const session = sessions.get(ctx.from.id);
    if (session.mode === 'style_name') {
      const name = (ctx.message.text || '').trim();
      if (!name) return ctx.reply(texts.styles.nameRequired);
      if (name.length > 40) return ctx.reply(texts.styles.nameTooLong);
      session.styleDraft.name = name;
      session.mode = 'style_photos';
      session.styleDraft.photos = [];
      return ctx.reply(texts.styles.askPhotos(0), {
        parse_mode: 'HTML',
        ...kb.styleNewProgress(0),
      });
    }
    return next();
  });

  bot.on('photo', async (ctx, next) => {
    const session = sessions.get(ctx.from.id);
    if (session.mode !== 'style_photos') return next();

    if (session.styleDraft.photos.length >= 10) {
      return ctx.reply(texts.styles.maxPhotos);
    }
    const photos = ctx.message.photo;
    const fileId = photos[photos.length - 1].file_id;
    let buf;
    try {
      buf = await downloadTelegramFile(ctx.telegram, fileId);
    } catch (err) {
      return ctx.reply(`⚠️ Не удалось скачать фото: ${err.message || err}`);
    }
    session.styleDraft.photos.push(buf);
    const count = session.styleDraft.photos.length;
    return ctx.reply(texts.styles.askPhotos(count), {
      parse_mode: 'HTML',
      ...kb.styleNewProgress(count),
    });
  });

  return { showList };
}

module.exports = register;
