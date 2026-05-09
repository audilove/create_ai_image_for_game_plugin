'use strict';

const mongoose = require('mongoose');

mongoose.set('strictQuery', true);

let connectPromise = null;

async function connect(uri, options = {}) {
  if (!uri) throw new Error('[bot/db] MONGO_URI is required.');
  if (connectPromise) return connectPromise;
  // Pull our own non-mongo options out before forwarding to mongoose,
  // otherwise mongoose 8 rejects unknown driver options.
  const { logger: _logger, ...mongoOptions } = options;
  const logger = _logger || console;
  connectPromise = mongoose
    .connect(uri, {
      serverSelectionTimeoutMS: 10_000,
      ...mongoOptions,
    })
    .then((m) => {
      logger.log?.(`[bot/db] connected: ${describe(uri)}`);
      m.connection.on('error', (err) => logger.error?.('[bot/db] error', err));
      m.connection.on('disconnected', () => logger.warn?.('[bot/db] disconnected'));
      return m;
    })
    .catch((err) => {
      connectPromise = null;
      throw err;
    });
  return connectPromise;
}

async function disconnect() {
  if (!connectPromise) return;
  try {
    await mongoose.disconnect();
  } finally {
    connectPromise = null;
  }
}

function isReady() {
  return mongoose.connection?.readyState === 1;
}

function describe(uri) {
  try {
    const u = new URL(uri);
    return `${u.protocol}//${u.host}${u.pathname || ''}`;
  } catch {
    return 'mongo';
  }
}

module.exports = { connect, disconnect, isReady, mongoose };
