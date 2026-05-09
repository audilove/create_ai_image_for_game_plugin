'use strict';

const { Input } = require('telegraf');
const sharp = require('sharp');
const texts = require('../texts');
const { escapeHtml } = texts;
const kb = require('../keyboards');
const { persistWebpAndLinkHtml } = require('../cdn-webp-server');
const crypto = require('crypto');
const {
  safeEdit,
  safeAnswerCb,
  defaultAspectRatioForType,
  defaultTransparentForType,
  isPrototypeType,
  TYPE_LABELS,
  TYPE_LABELS_PLAIN,
  downloadTelegramFile,
} = require('../util');

/**
 * 5-step wizard:
 *   1. prompt
 *   2. context (rule pick or skip)
 *   3. style (style pick — required)
 *   4. type (asset type buttons)
 *   5. (for background only) choose orientation 16/9 or 9/16
 * → confirm → generate → send as document with post-action keyboard.
 */
function register(bot, deps) {
  const { storage, sessions, generator, generationQueue, logger, cdn } = deps;
  const DETECT_MAX_FILES_TO_SEND = 30;
  const loaderTimers = new Map();
  const loaderFrames = [
    '⏳ Генерирую изображение',
    '⏳ Генерирую изображение.',
    '⏳ Генерирую изображение..',
    '⏳ Генерирую изображение...',
  ];
  const ASPECT_RATIO_KEYS = ['1/1', '16/9', '9/16', '4/3', '3/4', '3/2', '2/3', '21/9', '2/1'];

  generationQueue
    .start(async (jobName, data) => {
      await processGenerationJob(jobName, data);
    })
    .catch((err) => logger?.error?.('generation queue failed to start', err));

  /* ─── shared helpers ──────────────────────────────────────────────── */

  function startWizard(userId) {
    sessions.set(userId, {
      mode: 'wiz_prompt',
      wiz: {
        prompt: null,
        contextId: null,
        contextLabel: null,
        contextText: null,
        styleId: null,
        styleLabel: null,
        type: null,
        aspectRatio: null,
        transparent: null,
      },
    });
  }

  async function showStepStyle(ctx) {
    const styles = await storage.listStyles(ctx.from.id);
    const text =
      texts.wizard.step3Style +
      (styles.length === 0 ? `\n\n${texts.wizard.noStylesHint}` : '');
    await safeEdit(ctx, text, {
      parse_mode: 'HTML',
      ...kb.pickStyle(styles, 'wiz:style'),
    });
  }

  async function showStepType(ctx) {
    await safeEdit(ctx, texts.wizard.step4Type, {
      parse_mode: 'HTML',
      ...kb.pickType('wiz:type'),
    });
  }

  async function showStepRatio(ctx) {
    await safeEdit(ctx, texts.wizard.step5Ratio, {
      parse_mode: 'HTML',
      ...kb.pickAspectRatio(),
    });
  }

  async function showSummary(ctx) {
    const session = sessions.get(ctx.from.id);
    const w = session.wiz;
    const aspectRatio = w.aspectRatio || defaultAspectRatioForType(w.type);
    const summary = texts.wizard.summary({
      prompt: w.prompt,
      contextLabel: w.contextLabel,
      styleLabel: w.styleLabel,
      type: TYPE_LABELS[w.type] || w.type,
      aspectRatio,
      transparent: w.transparent,
      isPrototype: isPrototypeType(w.type),
    });
    await safeEdit(ctx, summary, {
      parse_mode: 'HTML',
      ...kb.confirmGenerate(),
    });
  }

  async function captionFor(params) {
    return texts.postActions.caption({
      prompt: params.prompt,
      type: TYPE_LABELS_PLAIN[params.type] || params.type,
      aspectRatio: params.aspectRatio,
      transparent: params.transparent,
    });
  }

  function pickClosestAspectRatio(width, height) {
    if (!width || !height) return '1/1';
    const target = width / height;
    let closest = '1/1';
    let minDiff = Infinity;
    for (const key of ASPECT_RATIO_KEYS) {
      const [w, h] = key.split('/').map(Number);
      const ratio = w / h;
      const diff = Math.abs(ratio - target);
      if (diff < minDiff) {
        minDiff = diff;
        closest = key;
      }
    }
    return closest;
  }

  function loaderKey(chatId, messageId) {
    return `${chatId}:${messageId}`;
  }

  async function startLoader(chatId) {
    let frameIndex = 0;
    const msg = await bot.telegram.sendMessage(chatId, loaderFrames[frameIndex]);
    const key = loaderKey(chatId, msg.message_id);
    const timer = setInterval(async () => {
      frameIndex = (frameIndex + 1) % loaderFrames.length;
      try {
        await bot.telegram.editMessageText(
          chatId,
          msg.message_id,
          undefined,
          loaderFrames[frameIndex],
        );
      } catch {
        /* ignore */
      }
    }, 3000);
    loaderTimers.set(key, timer);
    return { messageId: msg.message_id };
  }

  async function stopLoader(chatId, messageId) {
    if (!chatId || !messageId) return;
    const key = loaderKey(chatId, messageId);
    const timer = loaderTimers.get(key);
    if (timer) {
      clearInterval(timer);
      loaderTimers.delete(key);
    }
    try {
      await bot.telegram.deleteMessage(chatId, messageId);
    } catch {
      /* ignore */
    }
  }

  async function sendResultDocumentByChat({ userId, chatId, meta }) {
    const buf = await storage.loadResultBuffer(userId, meta.id);
    if (!buf) {
      await bot.telegram.sendMessage(chatId, texts.postActions.sourceLost);
      return;
    }
    // Telegram treats .webp documents as stickers, even via sendDocument.
    // Re-encode to PNG for delivery so the client always shows a regular file.
    let pngBuf;
    try {
      pngBuf = await sharp(buf).png({ compressionLevel: 9 }).toBuffer();
    } catch (err) {
      logger?.warn?.('webp→png conversion failed, sending original', err);
      pngBuf = buf;
    }

    let caption = await captionFor(meta.params);
    const linkSuffix = persistWebpAndLinkHtml({
      serveDir: cdn?.serveDir,
      publicBaseUrl: cdn?.publicBaseUrl || '',
      userId,
      filename: `${userId}_${meta.id}.webp`,
      webpBuffer: buf,
      escapeHtml,
    });
    caption += linkSuffix;

    await bot.telegram.sendDocument(
      chatId,
      Input.fromBuffer(pngBuf, `${meta.id}.png`),
      {
        caption,
        parse_mode: 'HTML',
        ...kb.postActions(meta.id),
      },
    );
  }

  async function enqueueGeneration(ctx, jobName, payload, options = {}) {
    let loader = null;
    const useLoader = options.withLoader !== false;
    try {
      if (useLoader) {
        loader = await startLoader(ctx.chat.id);
      }
      const job = await generationQueue.enqueue(jobName, {
        ...payload,
        statusMessageId: loader?.messageId,
      });
      return job;
    } catch (err) {
      if (useLoader) await stopLoader(ctx.chat.id, loader?.messageId);
      logger?.error?.('failed to enqueue generation job', err);
      await ctx.reply(texts.wizard.queueUnavailable, {
        parse_mode: 'HTML',
        ...kb.backToMenu(),
      });
      throw err;
    }
  }

  async function processGenerationJob(jobName, payload) {
    try {
      switch (jobName) {
        case 'generate:create':
          await processCreateJob(payload);
          return;
        case 'generate:edit':
          await processEditJob(payload);
          return;
        case 'generate:edit_uploaded':
          await processUploadEditJob(payload);
          return;
        case 'generate:detect_layout_plan':
          await processDetectLayoutPlanJob(payload);
          return;
        case 'generate:layout_assets':
          await processLayoutAssetsJob(payload);
          return;
        case 'generate:combine':
          await processCombineJob(payload);
          return;
        case 'generate:regen':
          await processRegenJob(payload);
          return;
        default:
          throw new Error(`Unknown generation job: ${jobName}`);
      }
    } finally {
      if (payload.statusMessageId != null && payload.statusMessageId !== '') {
        await stopLoader(payload.chatId, payload.statusMessageId);
      }
    }
  }

  async function sendQueueFailure(chatId, err) {
    const text = texts.wizard.generationFailed(err.message || String(err));
    await bot.telegram.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      ...kb.backToMenu(),
    });
  }

  async function processCreateJob(payload) {
    const { userId, chatId, wiz } = payload;
    try {
      const refs = wiz.styleId
        ? await storage.loadStyleReferences(userId, wiz.styleId)
        : [];

      const result = await generator.generate({
        prompt: wiz.prompt,
        type: wiz.type,
        aspectRatio: wiz.aspectRatio || defaultAspectRatioForType(wiz.type),
        transparent: wiz.transparent === true,
        context: wiz.contextText || '',
        references: refs,
        filename: undefined,
      });

      const webpBuffer = Buffer.from(result.base64, 'base64');
      const meta = await storage.saveResult(userId, {
        params: {
          prompt: wiz.prompt,
          type: wiz.type,
          aspectRatio: wiz.aspectRatio || defaultAspectRatioForType(wiz.type),
          transparent: wiz.transparent === true,
          contextId: wiz.contextId,
          contextLabel: wiz.contextLabel,
          contextText: wiz.contextText,
          styleId: wiz.styleId,
          styleLabel: wiz.styleLabel,
        },
        webpBuffer,
      });

      await sendResultDocumentByChat({ userId, chatId, meta });
    } catch (err) {
      logger?.error?.('generate failed', err);
      await sendQueueFailure(chatId, err);
      throw err;
    }
  }

  async function processEditJob(payload) {
    const { userId, chatId, flow } = payload;
    try {
      const meta = await storage.getResult(userId, flow.resultId);
      const originalBuf = meta ? await storage.loadResultBuffer(userId, meta.id) : null;
      if (!meta || !originalBuf) {
        await bot.telegram.sendMessage(chatId, texts.postActions.sourceLost);
        return;
      }

      const styleRefs = meta.params.styleId
        ? await storage.loadStyleReferences(userId, meta.params.styleId)
        : [];
      const originalRef = {
        base64: originalBuf.toString('base64'),
        mimeType: 'image/webp',
        filename: 'original.webp',
      };
      const refs = [originalRef, ...styleRefs];

      const editPrompt =
        `Edit the FIRST attached image (original). Apply the following change while ` +
        `preserving everything else: ${flow.instruction}\n\nOriginal request: ${meta.params.prompt}`;

      const generationContext = [meta.params.contextText, flow.contextText]
        .filter(Boolean)
        .join('\n\n---\n\n');

      const result = await generator.generate({
        prompt: editPrompt,
        type: meta.params.type,
        aspectRatio: meta.params.aspectRatio,
        transparent: meta.params.transparent === true,
        context: generationContext,
        references: refs,
      });

      const webpBuffer = Buffer.from(result.base64, 'base64');
      const newMeta = await storage.saveResult(userId, {
        params: {
          ...meta.params,
          prompt: `${meta.params.prompt} | edit: ${flow.instruction}`,
          contextId: flow.contextId || meta.params.contextId,
          contextLabel: flow.contextLabel || meta.params.contextLabel,
          contextText: generationContext,
        },
        webpBuffer,
      });

      await sendResultDocumentByChat({ userId, chatId, meta: newMeta });
    } catch (err) {
      logger?.error?.('edit flow failed', err);
      await sendQueueFailure(chatId, err);
      throw err;
    }
  }

  async function processUploadEditJob(payload) {
    const { userId, chatId, flow } = payload;
    try {
      const sourceBuf = flow.sourceImageId
        ? await storage.loadIncoming(userId, flow.sourceImageId)
        : null;
      if (!sourceBuf) {
        await bot.telegram.sendMessage(chatId, texts.postActions.photoRequired);
        return;
      }

      let aspectRatio = '1/1';
      try {
        const meta = await sharp(sourceBuf).metadata();
        aspectRatio = pickClosestAspectRatio(meta.width, meta.height);
      } catch (err) {
        logger?.warn?.('failed to detect uploaded image ratio, fallback to 1/1', err);
      }

      const refs = [{
        base64: sourceBuf.toString('base64'),
        mimeType: 'image/jpeg',
        filename: 'uploaded_base.jpg',
      }];

      let editPrompt =
        `Edit the FIRST attached image (uploaded by user). Apply the following change while ` +
        `preserving everything else: ${flow.instruction}`;

      if (flow.addImageId) {
        const addBuf = await storage.loadIncoming(userId, flow.addImageId);
        if (addBuf) {
          refs.push({
            base64: addBuf.toString('base64'),
            mimeType: 'image/jpeg',
            filename: 'uploaded_element.jpg',
          });
          editPrompt =
            `Edit the FIRST attached image (user base image). Place, blend, or integrate the SECOND attached image ` +
            `into the base following the instruction. Match perspective, lighting, and art style of the base. ` +
            `Keep the rest of the base coherent unless the instruction says otherwise.\n\nInstruction: ${flow.instruction}`;
        }
      }

      const result = await generator.generate({
        prompt: editPrompt,
        type: 'illustration',
        aspectRatio,
        transparent: false,
        context: flow.contextText || '',
        references: refs,
      });

      const webpBuffer = Buffer.from(result.base64, 'base64');
      const newMeta = await storage.saveResult(userId, {
        params: {
          prompt: `uploaded edit: ${flow.instruction}` + (flow.addImageId ? ' [+ extra image]' : ''),
          type: 'illustration',
          aspectRatio,
          transparent: false,
          contextId: flow.contextId || null,
          contextLabel: flow.contextLabel || null,
          contextText: flow.contextText || null,
          styleId: null,
          styleLabel: null,
        },
        webpBuffer,
      });

      await sendResultDocumentByChat({ userId, chatId, meta: newMeta });
    } catch (err) {
      logger?.error?.('uploaded edit flow failed', err);
      await sendQueueFailure(chatId, err);
      throw err;
    } finally {
      if (flow.sourceImageId) {
        await storage.removeIncoming(userId, flow.sourceImageId);
      }
      if (flow.addImageId) {
        await storage.removeIncoming(userId, flow.addImageId);
      }
    }
  }

  function formatLayoutDraftItemsText(selected, maxChars = 3600) {
    const lines = [];
    let used = 0;
    selected.forEach((el, idx) => {
      const label = TYPE_LABELS[el.type] || el.type;
      const name = escapeHtml((el.name || `элемент ${idx + 1}`).slice(0, 80));
      const snippet = escapeHtml((el.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 160));
      const line =
        `<b>${idx + 1}.</b> ${escapeHtml(label)} · <i>${name}</i>\n` +
        `   <code>${el.aspectRatio || '?'}</code> · фон: ` +
        `<b>${el.transparent ? 'прозр.' : 'есть'}</b> · ` +
        `conf ${(el.confidence * 100).toFixed(0)}%\n` +
        (snippet ? `   <i>${snippet}</i>` : '');
      if (used + line.length > maxChars) return;
      lines.push(line);
      used += line.length + 1;
    });
    if (lines.length < selected.length) {
      lines.push(`\n… и ещё <b>${selected.length - lines.length}</b> (см. после генерации в подписях к файлам).`);
    }
    return lines.join('\n\n');
  }

  async function processDetectLayoutPlanJob(payload) {
    const { userId, chatId, flow } = payload;
    let cleanupIncoming = !!flow.sourceImageId;
    try {
      const sourceBuf = flow.sourceImageId
        ? await storage.loadIncoming(userId, flow.sourceImageId)
        : null;
      if (!sourceBuf) {
        await bot.telegram.sendMessage(chatId, texts.postActions.photoRequired);
        return;
      }

      const plan = await generator.detectLayoutPlan({
        imageBuffer: sourceBuf,
        maxAssets: 80,
        minAssetSize: 12,
        maxGenerateAssets: DETECT_MAX_FILES_TO_SEND,
      });

      const selected = plan.selected || [];
      if (!selected.length) {
        await bot.telegram.sendMessage(chatId, texts.postActions.detectNoAssets, {
          parse_mode: 'HTML',
          ...kb.backToMenu(),
        });
        return;
      }

      const draftDoc = {
        version: 1,
        sourceImageId: flow.sourceImageId,
        sourceWidth: plan.sourceWidth,
        sourceHeight: plan.sourceHeight,
        totalDetected: plan.totalDetected,
        omittedAfterCap: plan.omittedAfterCap,
        selected,
      };
      const { id: draftId } = await storage.saveLayoutDraft(userId, draftDoc);

      cleanupIncoming = false;

      const body = texts.postActions.layoutDraftPlan({
        totalDetected: plan.totalDetected,
        willGenerate: selected.length,
        omittedAfterCap: plan.omittedAfterCap,
        screenW: plan.sourceWidth,
        screenH: plan.sourceHeight,
        itemsText: formatLayoutDraftItemsText(selected),
      });

      await bot.telegram.sendMessage(chatId, body, {
        parse_mode: 'HTML',
        ...kb.confirmLayoutDraft(draftId),
      });
    } catch (err) {
      logger?.error?.('detect layout plan failed', err);
      await sendQueueFailure(chatId, err);
      throw err;
    } finally {
      if (cleanupIncoming && flow.sourceImageId) {
        await storage.removeIncoming(userId, flow.sourceImageId);
      }
    }
  }

  async function processLayoutAssetsJob(payload) {
    const { userId, chatId, draftId } = payload;
    let progressMsgId = null;
    let snapshot = null;
    try {
      const draft = await storage.loadLayoutDraft(userId, draftId);
      if (!draft || !Array.isArray(draft.selected) || draft.selected.length === 0) {
        await bot.telegram.sendMessage(chatId, texts.postActions.layoutDraftStale, {
          parse_mode: 'HTML',
          ...kb.backToMenu(),
        });
        return;
      }

      snapshot = {
        sourceImageId: draft.sourceImageId,
        selected: draft.selected,
      };
      await storage.removeLayoutDraft(userId, draftId);

      const sourceBuf = snapshot.sourceImageId
        ? await storage.loadIncoming(userId, snapshot.sourceImageId)
        : null;
      if (!sourceBuf) {
        await bot.telegram.sendMessage(chatId, texts.postActions.layoutDraftStale, {
          parse_mode: 'HTML',
          ...kb.backToMenu(),
        });
        return;
      }

      const progressText = await bot.telegram.sendMessage(
        chatId,
        texts.postActions.layoutDraftGenerating,
        { parse_mode: 'HTML' },
      );
      progressMsgId = progressText.message_id;

      const n = snapshot.selected.length;
      let sent = 0;
      for (let i = 0; i < n; i += 1) {
        const el = snapshot.selected[i];
        try {
          await bot.telegram.editMessageText(
            chatId,
            progressMsgId,
            undefined,
            `⏳ Генерация <b>${i + 1}</b> / <b>${n}</b>: ${escapeHtml((el.name || el.type).slice(0, 120))}`,
            { parse_mode: 'HTML' },
          );
        } catch {
          /* ignore */
        }

        const cropPng = await sharp(sourceBuf)
          .extract({
            left: el.x,
            top: el.y,
            width: el.width,
            height: el.height,
          })
          .png()
          .toBuffer();

        const generation = await generator.generate({
          prompt: el.prompt,
          type: el.type,
          aspectRatio: el.aspectRatio,
          transparent: el.transparent,
          context: [
            'Extracted from game UI screenshot; regenerate this as a clean standalone asset.',
            el.description,
          ].filter(Boolean).join('\n'),
          references: [{
            base64: cropPng.toString('base64'),
            mimeType: 'image/png',
            filename: `${slugify(el.name)}_crop.png`,
          }],
          filename: undefined,
        });

        const webpBuf = Buffer.from(generation.base64, 'base64');
        let pngBuf;
        try {
          pngBuf = await sharp(webpBuf).png({ compressionLevel: 9 }).toBuffer();
        } catch (err) {
          logger?.warn?.('layout asset webp→png failed, sending webp', err);
          pngBuf = webpBuf;
        }
        const filename = `${String(i + 1).padStart(3, '0')}_${slugify(el.type)}_${slugify(el.name)}.png`;
        const typeLabel = TYPE_LABELS[el.type] || el.type;
        const webpToken = crypto.randomBytes(4).toString('hex');
        const webpFileKey = `${userId}_${webpToken}.webp`;
        let cap =
          `${escapeHtml(typeLabel)} · ${generation.aspectRatio} · ` +
          `${generation.transparent ? 'без фона' : 'с фоном'}\n` +
          `<i>${escapeHtml((el.prompt || '').slice(0, 220))}</i>`;
        const linkSuffix = persistWebpAndLinkHtml({
          serveDir: cdn?.serveDir,
          publicBaseUrl: cdn?.publicBaseUrl || '',
          userId,
          filename: webpFileKey,
          webpBuffer: webpBuf,
          escapeHtml,
        });
        cap += linkSuffix;
        await bot.telegram.sendDocument(chatId, Input.fromBuffer(pngBuf, filename), {
          caption: cap,
          parse_mode: 'HTML',
        });
        sent += 1;
      }

      try {
        await bot.telegram.deleteMessage(chatId, progressMsgId);
      } catch {
        /* ignore */
      }
      progressMsgId = null;

      await bot.telegram.sendMessage(chatId, texts.postActions.layoutDraftDone(sent), {
        parse_mode: 'HTML',
        ...kb.backToMenu(),
      });
    } catch (err) {
      logger?.error?.('layout assets batch failed', err);
      await sendQueueFailure(chatId, err);
      throw err;
    } finally {
      if (progressMsgId) {
        try {
          await bot.telegram.deleteMessage(chatId, progressMsgId);
        } catch {
          /* ignore */
        }
      }
      if (snapshot?.sourceImageId) {
        await storage.removeIncoming(userId, snapshot.sourceImageId);
      }
    }
  }

  async function processCombineJob(payload) {
    const { userId, chatId, flow } = payload;
    try {
      const meta = await storage.getResult(userId, flow.resultId);
      const originalBuf = meta ? await storage.loadResultBuffer(userId, meta.id) : null;
      if (!meta || !originalBuf) {
        await bot.telegram.sendMessage(chatId, texts.postActions.sourceLost);
        return;
      }

      const styleRefs = meta.params.styleId
        ? await storage.loadStyleReferences(userId, meta.params.styleId)
        : [];
      const original = {
        base64: originalBuf.toString('base64'),
        mimeType: 'image/webp',
        filename: 'original.webp',
      };
      const addBuf = flow.addImageId
        ? await storage.loadIncoming(userId, flow.addImageId)
        : null;
      const addImage = addBuf
        ? { base64: addBuf.toString('base64'), mimeType: 'image/jpeg', filename: 'add.jpg' }
        : null;
      const refs = [original];
      if (addImage) refs.push(addImage);
      refs.push(...styleRefs);

      const combinePrompt =
        `Combine the FIRST attached image (original) with the SECOND attached image. ` +
        `Goal: ${flow.instruction}\n\nKeep the original style. Original request: ${meta.params.prompt}`;

      const generationContext = [meta.params.contextText, flow.contextText]
        .filter(Boolean)
        .join('\n\n---\n\n');

      const result = await generator.generate({
        prompt: combinePrompt,
        type: meta.params.type,
        aspectRatio: meta.params.aspectRatio,
        transparent: meta.params.transparent === true,
        context: generationContext,
        references: refs,
      });

      const webpBuffer = Buffer.from(result.base64, 'base64');
      const newMeta = await storage.saveResult(userId, {
        params: {
          ...meta.params,
          prompt: `${meta.params.prompt} | combine: ${flow.instruction}`,
          contextId: flow.contextId || meta.params.contextId,
          contextLabel: flow.contextLabel || meta.params.contextLabel,
          contextText: generationContext,
        },
        webpBuffer,
      });

      await sendResultDocumentByChat({ userId, chatId, meta: newMeta });
    } catch (err) {
      logger?.error?.('combine flow failed', err);
      await sendQueueFailure(chatId, err);
      throw err;
    } finally {
      if (flow.addImageId) {
        await storage.removeIncoming(userId, flow.addImageId);
      }
    }
  }

  async function processRegenJob(payload) {
    const { userId, chatId, resultId } = payload;
    try {
      const meta = await storage.getResult(userId, resultId);
      if (!meta) {
        await bot.telegram.sendMessage(chatId, texts.postActions.sourceLost);
        return;
      }

      const refs = meta.params.styleId
        ? await storage.loadStyleReferences(userId, meta.params.styleId)
        : [];
      if (meta.params.styleId && refs.length === 0) {
        throw new Error('Стиль из исходной генерации был удалён.');
      }

      const result = await generator.generate({
        prompt: meta.params.prompt,
        type: meta.params.type,
        aspectRatio: meta.params.aspectRatio,
        transparent: meta.params.transparent === true,
        context: meta.params.contextText || '',
        references: refs,
      });

      const webpBuffer = Buffer.from(result.base64, 'base64');
      const newMeta = await storage.saveResult(userId, {
        params: meta.params,
        webpBuffer,
      });

      await sendResultDocumentByChat({ userId, chatId, meta: newMeta });
    } catch (err) {
      logger?.error?.('regen failed', err);
      await sendQueueFailure(chatId, err);
      throw err;
    }
  }

  /* ─── entry / cancel / start over ─────────────────────────────────── */

  bot.action('menu:create', async (ctx) => {
    await safeAnswerCb(ctx);
    startWizard(ctx.from.id);
    await safeEdit(ctx, texts.wizard.step1Prompt, {
      parse_mode: 'HTML',
      ...kb.cancelOnly(),
    });
  });

  bot.action('menu:detect_layout', async (ctx) => {
    await safeAnswerCb(ctx);
    sessions.set(ctx.from.id, {
      mode: 'wiz_detect_layout_image',
      detectFlow: {
        sourceImageId: null,
      },
    });
    await safeEdit(ctx, texts.postActions.askDetectLayoutImage, {
      parse_mode: 'HTML',
      ...kb.cancelOnly(),
    });
  });

  bot.action('menu:upload_edit', async (ctx) => {
    await safeAnswerCb(ctx);
    sessions.set(ctx.from.id, {
      mode: 'wiz_upload_edit_image',
      uploadEditFlow: {
        sourceImageId: null,
        addImageId: null,
        instruction: null,
        contextId: null,
        contextLabel: null,
        contextText: null,
      },
    });
    await safeEdit(ctx, texts.postActions.askUploadEditImage, {
      parse_mode: 'HTML',
      ...kb.cancelOnly(),
    });
  });

  bot.action('act:new', async (ctx) => {
    await safeAnswerCb(ctx);
    startWizard(ctx.from.id);
    await ctx.reply(texts.wizard.step1Prompt, { parse_mode: 'HTML', ...kb.cancelOnly() });
  });

  bot.action('wiz:cancel', async (ctx) => {
    await safeAnswerCb(ctx);
    const session = sessions.get(ctx.from.id);
    if (session.combineFlow?.addImageId) {
      await storage.removeIncoming(ctx.from.id, session.combineFlow.addImageId);
    }
    if (session.uploadEditFlow?.sourceImageId) {
      await storage.removeIncoming(ctx.from.id, session.uploadEditFlow.sourceImageId);
    }
    if (session.uploadEditFlow?.addImageId) {
      await storage.removeIncoming(ctx.from.id, session.uploadEditFlow.addImageId);
    }
    if (session.detectFlow?.sourceImageId) {
      await storage.removeIncoming(ctx.from.id, session.detectFlow.sourceImageId);
    }
    sessions.reset(ctx.from.id);
    await safeEdit(ctx, texts.greeting, { parse_mode: 'HTML', ...kb.mainMenu() });
  });

  /* ─── step 1: prompt (text input) ─────────────────────────────────── */

  bot.on('text', async (ctx, next) => {
    const session = sessions.get(ctx.from.id);
    if (session.mode === 'wiz_prompt') {
      const text = (ctx.message.text || '').trim();
      if (!text) return ctx.reply(texts.wizard.promptRequired);
      if (text.length > 1500) return ctx.reply(texts.wizard.promptTooLong);
      session.wiz.prompt = text;
      session.mode = 'wiz_context';
      const rules = await storage.listRules(ctx.from.id);
      const reply =
        texts.wizard.step2Context +
        (rules.length === 0 ? `\n\n${texts.wizard.noRules}` : '');
      return ctx.reply(reply, {
        parse_mode: 'HTML',
        ...kb.pickContext(rules, 'wiz:ctx'),
      });
    }
    if (session.mode === 'wiz_edit_instruction') {
      const text = (ctx.message.text || '').trim();
      if (!text) return ctx.reply(texts.postActions.instructionRequired);
      if (text.length > 1500) return ctx.reply(texts.postActions.instructionTooLong);
      session.editFlow.instruction = text;
      session.mode = 'wiz_edit_context';
      const rules = await storage.listRules(ctx.from.id);
      return ctx.reply(texts.postActions.askEditContext, {
        parse_mode: 'HTML',
        ...kb.pickContext(rules, 'wiz:edit_ctx'),
      });
    }
    if (session.mode === 'wiz_upload_edit_instruction') {
      const text = (ctx.message.text || '').trim();
      if (!text) return ctx.reply(texts.postActions.instructionRequired);
      if (text.length > 1500) return ctx.reply(texts.postActions.instructionTooLong);
      session.uploadEditFlow.instruction = text;
      session.mode = 'wiz_upload_edit_context';
      const rules = await storage.listRules(ctx.from.id);
      return ctx.reply(texts.postActions.askUploadEditContext, {
        parse_mode: 'HTML',
        ...kb.pickContext(rules, 'wiz:upload_edit_ctx'),
      });
    }
    if (session.mode === 'wiz_combine_instruction') {
      const text = (ctx.message.text || '').trim();
      if (!text) return ctx.reply(texts.postActions.instructionRequired);
      if (text.length > 1500) return ctx.reply(texts.postActions.instructionTooLong);
      session.combineFlow.instruction = text;
      session.mode = 'wiz_combine_context';
      const rules = await storage.listRules(ctx.from.id);
      return ctx.reply(texts.postActions.askCombineContext, {
        parse_mode: 'HTML',
        ...kb.pickContext(rules, 'wiz:combine_ctx'),
      });
    }
    return next();
  });

  /* ─── step 2: context picker ─────────────────────────────────────── */

  bot.action(/^wiz:ctx:(none|[a-z0-9]+)$/i, async (ctx) => {
    await safeAnswerCb(ctx);
    const session = sessions.get(ctx.from.id);
    if (session.mode !== 'wiz_context') return;
    const id = ctx.match[1];
    if (id !== 'none') {
      const rule = await storage.getRule(ctx.from.id, id);
      if (rule) {
        session.wiz.contextId = rule.id;
        session.wiz.contextLabel = rule.name;
        session.wiz.contextText = rule.text;
      }
    }
    session.mode = 'wiz_style';
    await showStepStyle(ctx);
  });

  /* ─── step 3: style picker (style is OPTIONAL) ───────────────────── */

  bot.action(/^wiz:style:(none|[a-z0-9]+)$/i, async (ctx) => {
    await safeAnswerCb(ctx);
    const session = sessions.get(ctx.from.id);
    if (session.mode !== 'wiz_style') return;
    const id = ctx.match[1];
    if (id === 'none') {
      session.wiz.styleId = null;
      session.wiz.styleLabel = null;
    } else {
      const style = await storage.getStyle(ctx.from.id, id);
      if (!style) return;
      session.wiz.styleId = style.id;
      session.wiz.styleLabel = style.name;
    }
    session.mode = 'wiz_type';
    await showStepType(ctx);
  });

  /* ─── step 4: type picker ────────────────────────────────────────── */

  bot.action(/^wiz:type:([a-z0-9_]+)$/i, async (ctx) => {
    await safeAnswerCb(ctx);
    const session = sessions.get(ctx.from.id);
    if (session.mode !== 'wiz_type') return;
    const t = ctx.match[1];
    if (!TYPE_LABELS[t]) return;
    session.wiz.type = t;
    session.wiz.aspectRatio = defaultAspectRatioForType(t);
    // Transparency is determined by asset type defaults.
    session.wiz.transparent = defaultTransparentForType(t);
    if (isPrototypeType(t)) {
      session.mode = 'wiz_confirm';
      return showSummary(ctx);
    }
    if (t === 'background') {
      session.mode = 'wiz_ratio';
      return showStepRatio(ctx);
    }
    session.mode = 'wiz_confirm';
    await showSummary(ctx);
  });

  /* ─── step 5: aspect ratio for backgrounds ──────────────────────── */

  bot.action(/^wiz:ratio:(16\/9|9\/16)$/i, async (ctx) => {
    await safeAnswerCb(ctx);
    const session = sessions.get(ctx.from.id);
    if (session.mode !== 'wiz_ratio') return;
    session.wiz.aspectRatio = ctx.match[1];
    session.mode = 'wiz_confirm';
    await showSummary(ctx);
  });

  /* ─── confirm + run generation ───────────────────────────────────── */

  bot.action('wiz:go', async (ctx) => {
    await safeAnswerCb(ctx, '🧾');
    const session = sessions.get(ctx.from.id);
    if (session.mode !== 'wiz_confirm') return;
    const w = session.wiz;
    if (!w.prompt || !w.type) return;

    try {
      await enqueueGeneration(ctx, 'generate:create', {
        userId: ctx.from.id,
        chatId: ctx.chat.id,
        wiz: {
          ...w,
          aspectRatio: w.aspectRatio || defaultAspectRatioForType(w.type),
        },
      });
      sessions.reset(ctx.from.id);
      await safeEdit(ctx, texts.wizard.queued, {
        parse_mode: 'HTML',
        ...kb.backToMenu(),
      });
    } catch (err) {
      logger?.error?.('generate enqueue failed', err);
    }
  });

  /* ─── EDIT flow ──────────────────────────────────────────────────── */

  bot.action(/^act:edit:([a-z0-9]+)$/i, async (ctx) => {
    await safeAnswerCb(ctx);
    const meta = await storage.getResult(ctx.from.id, ctx.match[1]);
    const buf = meta ? await storage.loadResultBuffer(ctx.from.id, meta.id) : null;
    if (!meta || !buf) {
      return ctx.reply(texts.postActions.sourceLost);
    }
    sessions.set(ctx.from.id, {
      mode: 'wiz_edit_instruction',
      editFlow: {
        resultId: meta.id,
        instruction: null,
        contextId: null,
        contextLabel: null,
        contextText: null,
      },
    });
    await ctx.reply(texts.postActions.askEditInstruction, {
      parse_mode: 'HTML',
      ...kb.cancelOnly(),
    });
  });

  bot.action(/^wiz:edit_ctx:(none|[a-z0-9]+)$/i, async (ctx) => {
    await safeAnswerCb(ctx, '🧾');
    const session = sessions.get(ctx.from.id);
    if (session.mode !== 'wiz_edit_context' || !session.editFlow) return;
    const id = ctx.match[1];
    if (id !== 'none') {
      const rule = await storage.getRule(ctx.from.id, id);
      if (rule) {
        session.editFlow.contextId = rule.id;
        session.editFlow.contextLabel = rule.name;
        session.editFlow.contextText = rule.text;
      }
    }
    if (!session.editFlow?.resultId) {
      sessions.reset(ctx.from.id);
      await ctx.reply(texts.postActions.sourceLost);
      return;
    }
    await enqueueGeneration(ctx, 'generate:edit', {
      userId: ctx.from.id,
      chatId: ctx.chat.id,
      flow: { ...session.editFlow },
    });
    sessions.reset(ctx.from.id);
    await ctx.reply(texts.wizard.queued, {
      parse_mode: 'HTML',
      ...kb.backToMenu(),
    });
  });

  bot.action('wiz:upload_edit_addon_skip', async (ctx) => {
    await safeAnswerCb(ctx);
    const session = sessions.get(ctx.from.id);
    if (session.mode !== 'wiz_upload_edit_addon_image' || !session.uploadEditFlow?.sourceImageId) return;
    session.mode = 'wiz_upload_edit_instruction';
    await ctx.reply(texts.postActions.askUploadEditInstruction, {
      parse_mode: 'HTML',
      ...kb.cancelOnly(),
    });
  });

  bot.action(/^wiz:upload_edit_ctx:(none|[a-z0-9]+)$/i, async (ctx) => {
    await safeAnswerCb(ctx, '🧾');
    const session = sessions.get(ctx.from.id);
    if (session.mode !== 'wiz_upload_edit_context' || !session.uploadEditFlow) return;
    const id = ctx.match[1];
    if (id !== 'none') {
      const rule = await storage.getRule(ctx.from.id, id);
      if (rule) {
        session.uploadEditFlow.contextId = rule.id;
        session.uploadEditFlow.contextLabel = rule.name;
        session.uploadEditFlow.contextText = rule.text;
      }
    }
    if (!session.uploadEditFlow?.sourceImageId || !session.uploadEditFlow?.instruction) {
      sessions.reset(ctx.from.id);
      await ctx.reply(texts.postActions.photoRequired);
      return;
    }
    await enqueueGeneration(ctx, 'generate:edit_uploaded', {
      userId: ctx.from.id,
      chatId: ctx.chat.id,
      flow: { ...session.uploadEditFlow },
    });
    sessions.reset(ctx.from.id);
    await ctx.reply(texts.wizard.queued, {
      parse_mode: 'HTML',
      ...kb.backToMenu(),
    });
  });

  bot.action(/^wiz:layout_go:([a-f0-9]+)$/i, async (ctx) => {
    await safeAnswerCb(ctx, '⚙️');
    const draftId = ctx.match[1];
    const draft = await storage.loadLayoutDraft(ctx.from.id, draftId);
    if (!draft?.selected?.length) {
      await ctx.reply(texts.postActions.layoutDraftStale, {
        parse_mode: 'HTML',
        ...kb.backToMenu(),
      });
      return;
    }
    try {
      await generationQueue.enqueue('generate:layout_assets', {
        userId: ctx.from.id,
        chatId: ctx.chat.id,
        draftId,
      });
    } catch (err) {
      logger?.error?.('layout assets enqueue failed', err);
      await ctx.reply(texts.wizard.queueUnavailable, {
        parse_mode: 'HTML',
        ...kb.backToMenu(),
      });
      return;
    }
  });

  bot.action(/^wiz:layout_cancel:([a-f0-9]+)$/i, async (ctx) => {
    await safeAnswerCb(ctx);
    const draftId = ctx.match[1];
    const draft = await storage.loadLayoutDraft(ctx.from.id, draftId);
    await storage.removeLayoutDraft(ctx.from.id, draftId);
    if (draft?.sourceImageId) {
      await storage.removeIncoming(ctx.from.id, draft.sourceImageId);
    }
    await ctx.reply(texts.greeting, { parse_mode: 'HTML', ...kb.mainMenu() });
  });

  /* ─── COMBINE flow ───────────────────────────────────────────────── */

  bot.action(/^act:combine:([a-z0-9]+)$/i, async (ctx) => {
    await safeAnswerCb(ctx);
    const meta = await storage.getResult(ctx.from.id, ctx.match[1]);
    const buf = meta ? await storage.loadResultBuffer(ctx.from.id, meta.id) : null;
    if (!meta || !buf) {
      return ctx.reply(texts.postActions.sourceLost);
    }
    sessions.set(ctx.from.id, {
      mode: 'wiz_combine_image',
      combineFlow: {
        resultId: meta.id,
        addImageId: null,
        instruction: null,
        contextId: null,
        contextLabel: null,
        contextText: null,
      },
    });
    await ctx.reply(texts.postActions.askCombineImage, {
      parse_mode: 'HTML',
      ...kb.cancelOnly(),
    });
  });

  async function handleIncomingImageMessage(ctx, next) {
    const session = sessions.get(ctx.from.id);
    const mode = session.mode;
    if (
      mode !== 'wiz_combine_image' &&
      mode !== 'wiz_upload_edit_image' &&
      mode !== 'wiz_upload_edit_addon_image' &&
      mode !== 'wiz_detect_layout_image'
    ) return next();
    const photos = ctx.message.photo || [];
    const document = ctx.message.document;
    const fileId = photos.length > 0 ? photos[photos.length - 1].file_id : document?.file_id;
    const isImageDocument = document?.mime_type?.startsWith('image/');
    if (!fileId || (document && !isImageDocument)) {
      return ctx.reply(texts.postActions.photoRequired);
    }
    let buf;
    try {
      buf = await downloadTelegramFile(ctx.telegram, fileId);
    } catch (err) {
      return ctx.reply(`⚠️ Не удалось скачать фото: ${err.message || err}`);
    }
    const incoming = await storage.saveIncoming(ctx.from.id, buf);
    if (mode === 'wiz_combine_image') {
      session.combineFlow.addImageId = incoming.id;
      session.mode = 'wiz_combine_instruction';
      return ctx.reply(texts.postActions.askCombineInstruction, {
        parse_mode: 'HTML',
        ...kb.cancelOnly(),
      });
    }
    if (mode === 'wiz_detect_layout_image') {
      session.detectFlow.sourceImageId = incoming.id;
      try {
        await enqueueGeneration(ctx, 'generate:detect_layout_plan', {
          userId: ctx.from.id,
          chatId: ctx.chat.id,
          flow: { ...session.detectFlow },
        });
        sessions.reset(ctx.from.id);
        return ctx.reply(texts.postActions.layoutDraftAnalyzingQueued, {
          parse_mode: 'HTML',
          ...kb.backToMenu(),
        });
      } catch {
        await storage.removeIncoming(ctx.from.id, incoming.id);
        sessions.reset(ctx.from.id);
        return;
      }
    }
    if (mode === 'wiz_upload_edit_addon_image') {
      session.uploadEditFlow.addImageId = incoming.id;
      session.mode = 'wiz_upload_edit_instruction';
      return ctx.reply(texts.postActions.askUploadEditInstruction, {
        parse_mode: 'HTML',
        ...kb.cancelOnly(),
      });
    }
    session.uploadEditFlow.sourceImageId = incoming.id;
    session.mode = 'wiz_upload_edit_addon_image';
    return ctx.reply(texts.postActions.askUploadEditAddonImage, {
      parse_mode: 'HTML',
      ...kb.uploadEditAddonSkip(),
    });
  }

  bot.on('photo', handleIncomingImageMessage);
  bot.on('document', handleIncomingImageMessage);

  bot.action(/^wiz:combine_ctx:(none|[a-z0-9]+)$/i, async (ctx) => {
    await safeAnswerCb(ctx, '🧾');
    const session = sessions.get(ctx.from.id);
    if (session.mode !== 'wiz_combine_context' || !session.combineFlow) return;
    const id = ctx.match[1];
    if (id !== 'none') {
      const rule = await storage.getRule(ctx.from.id, id);
      if (rule) {
        session.combineFlow.contextId = rule.id;
        session.combineFlow.contextLabel = rule.name;
        session.combineFlow.contextText = rule.text;
      }
    }
    if (!session.combineFlow?.resultId || !session.combineFlow?.addImageId) {
      sessions.reset(ctx.from.id);
      await ctx.reply(texts.postActions.photoRequired);
      return;
    }
    await enqueueGeneration(ctx, 'generate:combine', {
      userId: ctx.from.id,
      chatId: ctx.chat.id,
      flow: { ...session.combineFlow },
    });
    sessions.reset(ctx.from.id);
    await ctx.reply(texts.wizard.queued, {
      parse_mode: 'HTML',
      ...kb.backToMenu(),
    });
  });

  /* ─── REGENERATE flow ────────────────────────────────────────────── */

  bot.action(/^act:regen:([a-z0-9]+)$/i, async (ctx) => {
    await safeAnswerCb(ctx, '🧾');
    const meta = await storage.getResult(ctx.from.id, ctx.match[1]);
    if (!meta) return ctx.reply(texts.postActions.sourceLost);

    try {
      await enqueueGeneration(ctx, 'generate:regen', {
        userId: ctx.from.id,
        chatId: ctx.chat.id,
        resultId: meta.id,
      });
      await ctx.reply(texts.wizard.queued, {
        parse_mode: 'HTML',
        ...kb.backToMenu(),
      });
    } catch (err) {
      logger?.error?.('regen enqueue failed', err);
    }
  });
}

function slugify(value) {
  return String(value || 'asset')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'asset';
}

module.exports = register;
