'use strict';

const texts = require('../texts');
const kb = require('../keyboards');
const { safeEdit, safeAnswerCb } = require('../util');

function register(bot, deps) {
  const { storage, sessions, defaultGenModelSlug } = deps;
  const serverLabel = defaultGenModelSlug || texts.imageModels.unknownServerSlug;

  async function showModelsScreen(ctx, asEdit) {
    const uid = ctx.from.id;
    const models = await storage.listImageGenModels(uid);
    const activeSlug = await storage.getActiveImageGenModelSlug(uid);
    const body = texts.imageModels.listTitle({
      activeSlug,
      serverSlug: serverLabel,
    });
    const extra = {
      parse_mode: 'HTML',
      ...kb.imageModelsMenu(models, activeSlug),
    };
    if (asEdit && ctx.callbackQuery?.message) {
      await safeEdit(ctx, body, extra);
    } else {
      await ctx.reply(body, extra);
    }
  }

  bot.action('menu:models', async (ctx) => {
    sessions.reset(ctx.from.id);
    await safeAnswerCb(ctx);
    await showModelsScreen(ctx, true);
  });

  bot.action('model:add', async (ctx) => {
    await safeAnswerCb(ctx);
    sessions.set(ctx.from.id, { mode: 'wiz_image_model_slug' });
    await safeEdit(ctx, texts.imageModels.askSlug, {
      parse_mode: 'HTML',
      ...kb.cancelOnly(),
    });
  });

  bot.action('model:use_default', async (ctx) => {
    await safeAnswerCb(ctx, '⚙️');
    await storage.setActiveImageGenModel(ctx.from.id, null);
    await showModelsScreen(ctx, true);
  });

  bot.action(/^model:set_active:([a-z0-9]+)$/i, async (ctx) => {
    await safeAnswerCb(ctx, '⭐');
    const id = ctx.match[1];
    try {
      await storage.setActiveImageGenModel(ctx.from.id, id);
    } catch {
      await ctx.reply(texts.imageModels.notFound, {
        parse_mode: 'HTML',
        ...kb.backToMenu(),
      });
      return;
    }
    await showModelsScreen(ctx, true);
  });

  bot.action(/^model:del:([a-z0-9]+)$/i, async (ctx) => {
    await safeAnswerCb(ctx, '🗑');
    const ok = await storage.deleteImageGenModel(ctx.from.id, ctx.match[1]);
    if (!ok) {
      await ctx.reply(texts.imageModels.notFound, {
        parse_mode: 'HTML',
        ...kb.backToMenu(),
      });
      return;
    }
    await showModelsScreen(ctx, true);
  });

  bot.on('text', async (ctx, next) => {
    const session = sessions.get(ctx.from.id);
    if (session.mode !== 'wiz_image_model_slug') return next();

    const raw = (ctx.message.text || '').trim();
    if (!raw) {
      return ctx.reply(texts.imageModels.slugEmpty);
    }

    try {
      await storage.addImageGenModel(ctx.from.id, raw);
    } catch (err) {
      const code = String(err.message || '');
      if (code === 'DUPLICATE_SLUG') {
        return ctx.reply(texts.imageModels.duplicate);
      }
      if (code === 'LIMIT') {
        return ctx.reply(texts.imageModels.limit);
      }
      if (code.startsWith('INVALID_SLUG:')) {
        const r = code.slice('INVALID_SLUG:'.length);
        if (r === 'empty') return ctx.reply(texts.imageModels.slugEmpty);
        if (r === 'long') return ctx.reply(texts.imageModels.slugTooLong);
        if (r === 'space') return ctx.reply(texts.imageModels.slugHasSpace);
        if (r === 'chars') return ctx.reply(texts.imageModels.slugBadChars, { parse_mode: 'HTML' });
      }
      throw err;
    }

    sessions.reset(ctx.from.id);
    await ctx.reply(texts.imageModels.added(raw), { parse_mode: 'HTML' });
    await showModelsScreen(ctx, false);
  });
}

module.exports = register;
