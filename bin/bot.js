#!/usr/bin/env node
'use strict';

require('dotenv').config();

const path = require('path');
const GameImageGenerator = require('../src/index');
const createBot = require('../src/bot');
const { startCdnWebpServer } = require('../src/bot/cdn-webp-server');

function parseAllowedIds(raw) {
  if (!raw) return null;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('[bot] TELEGRAM_BOT_TOKEN is not set in env. Aborting.');
    process.exit(1);
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('[bot] OPENROUTER_API_KEY is not set in env. Aborting.');
    process.exit(1);
  }

  const dataDir = path.resolve(process.env.BOT_DATA_DIR || './data');
  const mongoUri = (process.env.MONGO_URI || '').trim();
  const mongoDbName = (process.env.MONGO_DB_NAME || '').trim() || undefined;

  const cdnServeDir = path.join(dataDir, 'cdn-webp');
  const cdnPort = Number(process.env.CDN_SERVE_PORT || 5000);
  if (String(process.env.CDN_SERVE_DISABLED || '').trim() !== '1') {
    startCdnWebpServer({ serveDir: cdnServeDir, port: cdnPort, logger: console });
  }

  const generator = new GameImageGenerator({
    apiKey,
    saveOutput: false,
    referenceDir: path.join(dataDir, 'styles', '__noop__'),
    requestTimeout: Number(process.env.IMAGE_REQUEST_TIMEOUT_MS) || 180_000,
  });

  const { bot, storage, generationQueue } = createBot({
    token,
    generator,
    dataDir,
    mongoUri: mongoUri || undefined,
    mongoDbName,
    queueConcurrency: Number(process.env.GENERATION_QUEUE_CONCURRENCY) || 2,
    allowedUserIds: parseAllowedIds(process.env.TELEGRAM_ALLOWED_USER_IDS),
    logger: console,
    cdn: {
      serveDir: cdnServeDir,
      publicBaseUrl: String(process.env.CDN_PUBLIC_BASE_URL || '').trim(),
    },
  });

  if (mongoUri) {
    console.log('[bot] storage: mongodb');
    try {
      await storage.connect();
    } catch (err) {
      console.error('[bot] failed to connect to MongoDB:', err.message || err);
      process.exit(1);
    }
  } else {
    console.log('[bot] storage: json (set MONGO_URI in .env for persistent storage)');
  }

  console.log('[bot] launching…');
  await bot.launch({
    dropPendingUpdates: process.env.TELEGRAM_DROP_PENDING === '1',
  });
  console.log('[bot] running. Press Ctrl-C to stop.');

  const shutdown = async (signal) => {
    console.log(`[bot] ${signal} received, stopping…`);
    bot.stop(signal);
    try {
      await storage.disconnect?.();
    } catch {
      /* ignore */
    }
    try {
      await generationQueue.close?.();
    } catch {
      /* ignore */
    }
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[bot] fatal error:', err);
  process.exit(1);
});
