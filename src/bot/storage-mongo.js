'use strict';

const fs = require('fs');
const path = require('path');

const { connect, disconnect, isReady } = require('./db/connection');
const Style = require('./db/models/Style');
const Rule = require('./db/models/Rule');
const Result = require('./db/models/Result');
const { shortId, sanitizeParamsForStorage } = require('./storage');

const MAX_RESULTS_PER_USER = 100;
const MAX_FILES_PER_STYLE = 10;

/**
 * MongoDB-backed storage. API mirrors {@link JsonStorage} so the bot is
 * agnostic to the underlying backend.
 */
class MongoStorage {
  /**
   * @param {object} options
   * @param {string} options.uri              Mongo connection string.
   * @param {string} [options.dbName]         Override DB name (otherwise read from URI).
   * @param {string} [options.incomingDir]    Where transient combine-flow uploads are kept.
   * @param {object} [options.logger]         console-compatible logger.
   */
  constructor(options) {
    if (!options || !options.uri) {
      throw new Error('[MongoStorage] options.uri is required.');
    }
    this.kind = 'mongo';
    this.uri = options.uri;
    this.dbName = options.dbName;
    this.logger = options.logger || console;
    this.incomingDir = path.resolve(options.incomingDir || './data/incoming');
    fs.mkdirSync(this.incomingDir, { recursive: true });
    this.layoutDraftsDir = path.join(path.dirname(this.incomingDir), 'layout_drafts');
    fs.mkdirSync(this.layoutDraftsDir, { recursive: true });
  }

  async connect() {
    if (isReady()) return;
    const opts = {};
    if (this.dbName) opts.dbName = this.dbName;
    opts.logger = this.logger;
    await connect(this.uri, opts);
  }

  async disconnect() {
    await disconnect();
  }

  /* ─── user (composite shape, matches JsonStorage.getUser) ────────── */

  async getUser(userId) {
    const [styles, rules] = await Promise.all([
      this.listStyles(userId),
      this.listRules(userId),
    ]);
    return { styles, rules };
  }

  /* ─── styles ─────────────────────────────────────────────────────── */

  async listStyles(userId) {
    const docs = await Style.find({ userId: Number(userId) })
      .sort({ createdAt: 1 })
      .lean();
    return docs.map(toStyleView);
  }

  async getStyle(userId, styleId) {
    const doc = await Style.findOne({
      userId: Number(userId),
      styleId,
    }).lean();
    return doc ? toStyleView(doc) : null;
  }

  async createStyle(userId, payload) {
    const styleId = shortId();
    const files = (payload.files || [])
      .slice(0, MAX_FILES_PER_STYLE)
      .map((buf, i) => ({
        filename: `${String(i + 1).padStart(3, '0')}.jpg`,
        mimeType: 'image/jpeg',
        data: buf,
        size: buf.length,
      }));

    const doc = await Style.create({
      userId: Number(userId),
      styleId,
      name: String(payload.name || '').slice(0, 80),
      files,
    });
    return toStyleView(doc.toObject());
  }

  async deleteStyle(userId, styleId) {
    const res = await Style.deleteOne({
      userId: Number(userId),
      styleId,
    });
    return res.deletedCount > 0;
  }

  async loadStyleReferences(userId, styleId) {
    const doc = await Style.findOne(
      { userId: Number(userId), styleId },
      { files: 1 },
    ).lean();
    if (!doc) return [];
    return (doc.files || []).map((f) => ({
      base64: Buffer.from(f.data.buffer || f.data).toString('base64'),
      mimeType: f.mimeType || 'image/jpeg',
      filename: f.filename,
    }));
  }

  async loadStyleReferenceBuffer(userId, styleId, filename) {
    const doc = await Style.findOne(
      {
        userId: Number(userId),
        styleId,
        'files.filename': filename,
      },
      { 'files.$': 1 },
    ).lean();
    const f = doc?.files?.[0];
    if (!f?.data) return null;
    return Buffer.from(f.data.buffer || f.data);
  }

  /* ─── rules ──────────────────────────────────────────────────────── */

  async listRules(userId) {
    const docs = await Rule.find({ userId: Number(userId) })
      .sort({ createdAt: 1 })
      .lean();
    return docs.map(toRuleView);
  }

  async getRule(userId, ruleId) {
    const doc = await Rule.findOne({ userId: Number(userId), ruleId }).lean();
    return doc ? toRuleView(doc) : null;
  }

  async createRule(userId, name, text) {
    const doc = await Rule.create({
      userId: Number(userId),
      ruleId: shortId(),
      name: String(name).slice(0, 80),
      text: String(text).slice(0, 4000),
    });
    return toRuleView(doc.toObject());
  }

  async deleteRule(userId, ruleId) {
    const res = await Rule.deleteOne({ userId: Number(userId), ruleId });
    return res.deletedCount > 0;
  }

  /* ─── results ────────────────────────────────────────────────────── */

  async saveResult(userId, { params, webpBuffer }) {
    const resultId = shortId();
    const doc = await Result.create({
      userId: Number(userId),
      resultId,
      params: sanitizeParamsForStorage(params),
      fileData: webpBuffer,
      mimeType: 'image/webp',
      size: webpBuffer.length,
    });

    // Prune oldest entries beyond the cap. We always keep the latest 100 per
    // user — older results are dropped together with their image bytes.
    const overflow = await Result.countDocuments({ userId: Number(userId) }) - MAX_RESULTS_PER_USER;
    if (overflow > 0) {
      const oldest = await Result.find({ userId: Number(userId) })
        .sort({ createdAt: 1 })
        .limit(overflow)
        .select('_id')
        .lean();
      const ids = oldest.map((d) => d._id);
      if (ids.length) await Result.deleteMany({ _id: { $in: ids } });
    }

    return {
      id: resultId,
      params: doc.params,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  async getResult(userId, resultId) {
    const doc = await Result.findOne(
      { userId: Number(userId), resultId },
      { fileData: 0 },
    ).lean();
    if (!doc) return null;
    return {
      id: doc.resultId,
      params: doc.params,
      createdAt: doc.createdAt?.toISOString?.() || null,
    };
  }

  async loadResultBuffer(userId, resultId) {
    const doc = await Result.findOne(
      { userId: Number(userId), resultId },
      { fileData: 1 },
    ).lean();
    if (!doc?.fileData) return null;
    return Buffer.from(doc.fileData.buffer || doc.fileData);
  }

  /* ─── transient uploads (combine flow) ───────────────────────────── */

  async saveIncoming(userId, buffer) {
    const id = shortId();
    const dir = path.join(this.incomingDir, String(userId));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.jpg`), buffer);
    return { id };
  }

  async loadIncoming(userId, id) {
    const file = path.join(this.incomingDir, String(userId), `${id}.jpg`);
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file);
  }

  async removeIncoming(userId, id) {
    if (!id) return;
    const file = path.join(this.incomingDir, String(userId), `${id}.jpg`);
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
  }

  async saveLayoutDraft(userId, data) {
    const id = shortId();
    const dir = path.join(this.layoutDraftsDir, String(userId));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(data, null, 2), 'utf-8');
    return { id };
  }

  async loadLayoutDraft(userId, id) {
    if (!id) return null;
    const file = path.join(this.layoutDraftsDir, String(userId), `${id}.json`);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
      return null;
    }
  }

  async removeLayoutDraft(userId, id) {
    if (!id) return;
    const file = path.join(this.layoutDraftsDir, String(userId), `${id}.json`);
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
}

function toStyleView(doc) {
  return {
    id: doc.styleId,
    name: doc.name,
    files: (doc.files || []).map((f) => f.filename),
    createdAt: doc.createdAt?.toISOString?.() || doc.createdAt || null,
  };
}

function toRuleView(doc) {
  return {
    id: doc.ruleId,
    name: doc.name,
    text: doc.text,
    createdAt: doc.createdAt?.toISOString?.() || doc.createdAt || null,
  };
}

module.exports = MongoStorage;
module.exports.MongoStorage = MongoStorage;
