'use strict';

const { Input } = require('telegraf');
const sharp = require('sharp');
const crypto = require('crypto');

const BackgroundRemover = require('../../bg-remover');
const texts = require('../texts');
const { escapeHtml } = texts;
const kb = require('../keyboards');
const { persistWebpAndLinkHtml } = require('../cdn-webp-server');
const { safeEdit, safeAnswerCb, downloadTelegramFile } = require('../util');

function register(bot, deps) {
  const { sessions, logger, cdn } = deps;
  const bgRemover = new BackgroundRemover();

  bot.action('menu:remove_bg', async (ctx) => {
    await safeAnswerCb(ctx);
    if (!bgRemover.isEnabled()) {
      await ctx.reply(texts.removeBg.noService, {
        parse_mode: 'HTML',
        ...kb.backToMenu(),
      });
      return;
    }
    sessions.set(ctx.from.id, { mode: 'remove_bg_wait_photo' });
    await safeEdit(ctx, texts.removeBg.askPhoto, {
      parse_mode: 'HTML',
      ...kb.cancelOnly(),
    });
  });

  async function handleIncomingImage(ctx, next) {
    const session = sessions.get(ctx.from.id);
    const mode = session.mode;
    if (mode !== 'remove_bg_wait_photo' && mode !== 'remove_bg_processing') return next();
    if (mode === 'remove_bg_processing') {
      await ctx.reply(texts.removeBg.busy);
      return;
    }

    const photos = ctx.message.photo || [];
    const document = ctx.message.document;
    const fileId = photos.length > 0 ? photos[photos.length - 1].file_id : document?.file_id;
    const isImageDocument = document?.mime_type?.startsWith('image/');
    if (!fileId || (document && !isImageDocument)) {
      await ctx.reply(texts.postActions.photoRequired);
      return;
    }

    let buf;
    try {
      buf = await downloadTelegramFile(ctx.telegram, fileId);
    } catch (err) {
      await ctx.reply(texts.removeBg.downloadFailed(err?.message || err));
      return;
    }

    session.mode = 'remove_bg_processing';

    let processingMsg;
    try {
      processingMsg = await ctx.reply(texts.removeBg.processing);

      let pngBuf;
      try {
        pngBuf = await bgRemover.remove(buf);
      } catch (err) {
        logger?.error?.('removeBg failed', err);
        await ctx.reply(texts.removeBg.failed(err?.message || err), {
          parse_mode: 'HTML',
          ...kb.backToMenu(),
        });
        return;
      }

      try {
        pngBuf = await sharp(pngBuf).png({ compressionLevel: 9 }).toBuffer();
      } catch (err) {
        logger?.warn?.('removeBg: sharp png normalize failed', err);
      }

      let webpBuf;
      try {
        webpBuf = await sharp(pngBuf).webp({ quality: 90, lossless: true }).toBuffer();
      } catch (err) {
        logger?.error?.('removeBg: webp encode failed', err);
        await ctx.reply(texts.removeBg.webpFailed(err?.message || err), {
          parse_mode: 'HTML',
          ...kb.backToMenu(),
        });
        return;
      }

      const userId = ctx.from.id;
      const resultId = crypto.randomBytes(8).toString('hex');
      const webpFilename = `${userId}_${resultId}.webp`;
      const linkSuffix = persistWebpAndLinkHtml({
        serveDir: cdn?.serveDir,
        publicBaseUrl: cdn?.publicBaseUrl || '',
        userId,
        filename: webpFilename,
        webpBuffer: webpBuf,
        escapeHtml,
      });

      const caption =
        `<b>${texts.removeBg.captionTitle}</b>` +
        (linkSuffix || `\n<i>${escapeHtml(texts.removeBg.linkUnavailable)}</i>`);

      await ctx.replyWithDocument(Input.fromBuffer(pngBuf, `no-bg-${resultId}.png`), {
        parse_mode: 'HTML',
        caption,
        ...kb.backToMenu(),
      });
    } finally {
      sessions.reset(ctx.from.id);
      if (processingMsg?.message_id) {
        try {
          await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
        } catch {
          /* ignore */
        }
      }
    }
  }

  bot.on('photo', handleIncomingImage);
  bot.on('document', handleIncomingImage);
}

module.exports = register;
