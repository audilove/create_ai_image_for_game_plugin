'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * Download a Telegram-hosted file as a Buffer.
 * `bot.telegram.getFileLink(fileId)` returns a URL we can plain-fetch.
 */
async function downloadTelegramFile(telegram, fileId) {
  const link = await telegram.getFileLink(fileId);
  return fetchBuffer(link.toString());
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get(u, (res) => {
      if (res.statusCode && (res.statusCode >= 300 && res.statusCode < 400) && res.headers.location) {
        return resolve(fetchBuffer(new URL(res.headers.location, u).toString()));
      }
      if (!res.statusCode || res.statusCode >= 400) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} fetching ${u.host}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(60_000, () => req.destroy(new Error('Telegram file download timeout')));
  });
}

function safeAnswerCb(ctx, text) {
  try {
    return ctx.answerCbQuery(text);
  } catch {
    return Promise.resolve();
  }
}

async function safeEdit(ctx, text, extra) {
  try {
    return await ctx.editMessageText(text, extra);
  } catch {
    return ctx.reply(text, extra);
  }
}

/** Auto-pick a sensible aspect ratio per asset type. */
function defaultAspectRatioForType(type) {
  switch (type) {
    case 'prototype_9_16':
      return '9/16';
    case 'prototype_16_9':
    case 'background':
      return '16/9';
    case 'illustration':
      return '1/1';
    case 'character':
    case 'card':
      return '3/4';
    case 'tile':
    case 'icon':
    case 'button':
    case 'item':
    case 'effect':
    default:
      return '1/1';
  }
}

function defaultTransparentForType(type) {
  return type === 'icon' || type === 'illustration';
}

function isPrototypeType(type) {
  return type === 'prototype_9_16' || type === 'prototype_16_9';
}

/** Bot-facing labels (with emoji). Order here also drives wizard layout. */
const TYPE_LABELS = {
  icon: '🟢 Иконка',
  background: '🌄 Фон',
  illustration: '🖼 Иллюстрация',
  button: '🔘 Кнопка',
  character: '👤 Персонаж',
  item: '⚔️ Предмет',
  tile: '🧱 Тайл',
  card: '🎴 Карта',
  effect: '✨ Эффект',
  prototype_9_16: '📱 Прототип 9/16',
  prototype_16_9: '🖥 Прототип 16/9',
};

/** Plain labels for captions. */
const TYPE_LABELS_PLAIN = {
  icon: 'Иконка',
  background: 'Фон',
  illustration: 'Иллюстрация',
  button: 'Кнопка',
  character: 'Персонаж',
  item: 'Предмет',
  tile: 'Тайл',
  card: 'Карта',
  effect: 'Эффект',
  prototype_9_16: 'Прототип экрана 9/16',
  prototype_16_9: 'Прототип экрана 16/9',
};

module.exports = {
  downloadTelegramFile,
  fetchBuffer,
  safeAnswerCb,
  safeEdit,
  defaultAspectRatioForType,
  isPrototypeType,
  defaultTransparentForType,
  TYPE_LABELS,
  TYPE_LABELS_PLAIN,
};
