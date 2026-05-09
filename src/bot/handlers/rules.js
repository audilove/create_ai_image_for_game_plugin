'use strict';

const texts = require('../texts');
const kb = require('../keyboards');
const { safeEdit, safeAnswerCb } = require('../util');

function register(bot, deps) {
  const { storage, sessions } = deps;

  async function showList(ctx) {
    const user = await storage.getUser(ctx.from.id);
    const text =
      texts.rules.listTitle +
      (user.rules.length === 0 ? `\n\n${texts.rules.empty}` : '');
    await safeEdit(ctx, text, { parse_mode: 'HTML', ...kb.rulesList(user.rules) });
  }

  bot.action('menu:rules', async (ctx) => {
    sessions.reset(ctx.from.id);
    await safeAnswerCb(ctx);
    await showList(ctx);
  });

  bot.action('rule:new', async (ctx) => {
    await safeAnswerCb(ctx);
    sessions.set(ctx.from.id, { mode: 'rule_name', ruleDraft: {} });
    await safeEdit(ctx, texts.rules.askName, {
      parse_mode: 'HTML',
      ...kb.cancelOnly(),
    });
  });

  bot.action(/^rule:open:([a-z0-9]+)$/i, async (ctx) => {
    await safeAnswerCb(ctx);
    const id = ctx.match[1];
    const rule = await storage.getRule(ctx.from.id, id);
    if (!rule) {
      await ctx.reply('Правило не найдено.');
      return;
    }
    const text = `${texts.rules.detailTitle(rule.name)}\n\n<code>${escape(rule.text).slice(0, 3500)}</code>`;
    await safeEdit(ctx, text, { parse_mode: 'HTML', ...kb.ruleDetail(rule.id) });
  });

  bot.action(/^rule:del:([a-z0-9]+)$/i, async (ctx) => {
    await safeAnswerCb(ctx);
    await storage.deleteRule(ctx.from.id, ctx.match[1]);
    await ctx.reply(texts.rules.deleted);
    await showList(ctx);
  });

  // Wizard handlers (text input)
  bot.on('text', async (ctx, next) => {
    const session = sessions.get(ctx.from.id);
    if (session.mode === 'rule_name') {
      const name = (ctx.message.text || '').trim();
      if (!name) return ctx.reply(texts.rules.nameRequired);
      if (name.length > 40) return ctx.reply(texts.rules.nameTooLong);
      session.ruleDraft.name = name;
      session.mode = 'rule_text';
      return ctx.reply(texts.rules.askText, { parse_mode: 'HTML', ...kb.cancelOnly() });
    }
    if (session.mode === 'rule_text') {
      const body = (ctx.message.text || '').trim();
      if (!body) return ctx.reply(texts.rules.textRequired);
      if (body.length > 4000) return ctx.reply(texts.rules.textTooLong);
      const created = await storage.createRule(ctx.from.id, session.ruleDraft.name, body);
      sessions.reset(ctx.from.id);
      await ctx.reply(texts.rules.saved(created.name), { parse_mode: 'HTML' });
      return showList(ctx).catch(() => {});
    }
    return next();
  });

  return { showList };
}

function escape(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = register;
