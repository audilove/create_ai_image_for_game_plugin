'use strict';

const path = require('path');
const { Telegraf } = require('telegraf');

const JsonStorage = require('./storage');
const MongoStorage = require('./storage-mongo');
const GenerationQueue = require('./generation-queue');
const SessionStore = require('./sessions');
const texts = require('./texts');
const kb = require('./keyboards');

const registerMainMenu = require('./handlers/mainMenu');
const registerRules = require('./handlers/rules');
const registerStyles = require('./handlers/styles');
const registerCreateImage = require('./handlers/createImage');

/**
 * Build a Telegram bot that exposes the GameImageGenerator plugin to end
 * users.
 *
 * Required:
 *   - options.token       Telegram bot token
 *   - options.generator   GameImageGenerator instance (already configured)
 *
 * Optional:
 *   - options.dataDir            Where to keep transient uploads (and the
 *                                JSON fallback if Mongo isn't configured).
 *   - options.mongoUri           If set, the bot uses MongoDB for persistent
 *                                storage instead of the JSON file fallback.
 *   - options.mongoDbName        Optional override for Mongo DB name.
 *   - options.storage            Pre-built storage instance (advanced use).
 *   - options.generationQueue    Pre-built Redis queue instance.
 *   - options.queueConcurrency   Worker concurrency for generation queue.
 *   - options.allowedUserIds     Iterable of allowed Telegram user ids (whitelist).
 *   - options.logger             console-like logger (info / warn / error).
 *   - options.cdn                  { serveDir, publicBaseUrl } для ссылок WebP (опционально).
 */
function createBot(options) {
  if (!options || !options.token) {
    throw new Error('[GameImageBot] options.token is required.');
  }
  if (!options.generator) {
    throw new Error('[GameImageBot] options.generator is required.');
  }

  const logger = options.logger || console;
  const dataDir = path.resolve(options.dataDir || './data');

  let storage = options.storage;
  if (!storage) {
    if (options.mongoUri) {
      storage = new MongoStorage({
        uri: options.mongoUri,
        dbName: options.mongoDbName,
        incomingDir: path.join(dataDir, 'incoming'),
        logger,
      });
    } else {
      storage = new JsonStorage(dataDir);
    }
  }
  const sessions = new SessionStore();
  const generationQueue = options.generationQueue || new GenerationQueue({
    concurrency: options.queueConcurrency,
  });

  const allowedUserIds = options.allowedUserIds
    ? new Set([...options.allowedUserIds].map((x) => String(x)))
    : null;

  const bot = new Telegraf(options.token);

  // ─── access control ────────────────────────────────────────────
  bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    if (allowedUserIds && !allowedUserIds.has(String(ctx.from.id))) {
      try {
        if (ctx.callbackQuery) await ctx.answerCbQuery(texts.errors.notAllowed);
        else await ctx.reply(texts.errors.notAllowed);
      } catch {
        /* ignore */
      }
      return;
    }
    return next();
  });

  // ─── global error handler so a single failing update doesn't crash bot ───
  bot.catch((err, ctx) => {
    logger.error?.('bot update failed', { update: ctx.update?.update_id, err });
    try {
      ctx.reply(texts.errors.internal).catch(() => {});
    } catch {
      /* ignore */
    }
  });

  const deps = {
    storage,
    sessions,
    generator: options.generator,
    generationQueue,
    logger,
    bot,
    cdn: options.cdn && typeof options.cdn === 'object'
      ? {
        serveDir: options.cdn.serveDir || '',
        publicBaseUrl: String(options.cdn.publicBaseUrl || '').trim().replace(/\/$/, ''),
      }
      : { serveDir: '', publicBaseUrl: '' },
  };

  // Order matters for shared `text` / `photo` listeners — each handler must
  // call next() when it doesn't recognise the current session mode.
  registerMainMenu(bot, deps);
  registerRules(bot, deps);
  registerStyles(bot, deps);
  registerCreateImage(bot, deps);

  // Fallback for unrelated text / unknown callbacks
  bot.on('text', async (ctx) => {
    await ctx.reply(texts.errors.sessionLost, kb.mainMenu());
  });

  bot.telegram.setMyCommands([{ command: 'start', description: 'Начать' }]).catch((err) => {
    logger.warn?.('[GameImageBot] setMyCommands failed:', err.message || err);
  });

  return { bot, storage, sessions, dataDir, generationQueue };
}

module.exports = createBot;
module.exports.createBot = createBot;
