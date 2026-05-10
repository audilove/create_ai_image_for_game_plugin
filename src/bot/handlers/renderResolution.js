'use strict';

const texts = require('../texts');
const kb = require('../keyboards');
const { safeEdit, safeAnswerCb } = require('../util');

function scaleToLabel(s) {
  if (s === '0.5') return texts.resolution.opt05;
  if (s === '2') return texts.resolution.opt2;
  return texts.resolution.opt1;
}

function register(bot, deps) {
  const { storage, sessions } = deps;

  async function showScreen(ctx, asEdit) {
    const uid = ctx.from.id;
    const scale = await storage.getImageGenResolutionScale(uid);
    const body = texts.resolution.title(scaleToLabel(scale));
    const extra = {
      parse_mode: 'HTML',
      ...kb.imageResolutionMenu(scale),
    };
    if (asEdit && ctx.callbackQuery?.message) {
      await safeEdit(ctx, body, extra);
    } else {
      await ctx.reply(body, extra);
    }
  }

  bot.action('menu:resolution', async (ctx) => {
    sessions.reset(ctx.from.id);
    await safeAnswerCb(ctx);
    await showScreen(ctx, true);
  });

  bot.action(/^res:set:(0\.5|1|2)$/i, async (ctx) => {
    await safeAnswerCb(ctx, '📐');
    const raw = ctx.match[1];
    const scale = raw === '0.5' ? '0.5' : raw === '2' ? '2' : '1';
    try {
      await storage.setImageGenResolutionScale(ctx.from.id, scale);
    } catch {
      return;
    }
    await showScreen(ctx, true);
  });
}

module.exports = register;
