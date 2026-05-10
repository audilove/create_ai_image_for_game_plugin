'use strict';

const fs = require('fs');
const path = require('path');

const { connect, disconnect, isReady } = require('./db/connection');
const Style = require('./db/models/Style');
const Rule = require('./db/models/Rule');
const Result = require('./db/models/Result');
const UserPrefs = require('./db/models/UserPrefs');
const { shortId, sanitizeParamsForStorage, normalizeImageGenSlug } = require('./storage');

const MAX_RESULTS_PER_USER = 100;
const MAX_FILES_PER_STYLE = 10;
const MAX_IMAGE_GEN_MODELS_PER_USER = 40;

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

  /* ─── image generation models (OpenRouter slugs) ─────────────────── */

  async listImageGenModels(userId) {
    const doc = await UserPrefs.findOne({ userId: Number(userId) }, { imageGenModels: 1 }).lean();
    const arr = doc?.imageGenModels || [];
    return [...arr].sort((a, b) =>
      String(a.createdAt || '').localeCompare(String(b.createdAt || '')),
    );
  }

  async getActiveImageGenModelSlug(userId) {
    const doc = await UserPrefs.findOne(
      { userId: Number(userId) },
      { imageGenModels: 1, activeImageGenModelId: 1 },
    ).lean();
    if (!doc?.activeImageGenModelId) return null;
    const m = (doc.imageGenModels || []).find((x) => x.id === doc.activeImageGenModelId);
    return m?.slug || null;
  }

  /** @returns {Promise<'0.5'|'1'|'2'>} */
  async getImageGenResolutionScale(userId) {
    const doc = await UserPrefs.findOne({ userId: Number(userId) }, { imageGenResolutionScale: 1 }).lean();
    const s = doc?.imageGenResolutionScale;
    return s === '0.5' || s === '1' || s === '2' ? s : '1';
  }

  async setImageGenResolutionScale(userId, scale) {
    const s = String(scale || '');
    if (s !== '0.5' && s !== '1' && s !== '2') {
      throw new Error('INVALID_RESOLUTION_SCALE');
    }
    await UserPrefs.updateOne(
      { userId: Number(userId) },
      {
        $set: { imageGenResolutionScale: s },
        $setOnInsert: {
          userId: Number(userId),
          imageGenModels: [],
          activeImageGenModelId: null,
        },
      },
      { upsert: true },
    );
  }

  async addImageGenModel(userId, rawSlug) {
    const norm = normalizeImageGenSlug(rawSlug);
    if (!norm.ok) throw new Error(`INVALID_SLUG:${norm.reason}`);
    const slug = norm.slug;
    let doc = await UserPrefs.findOne({ userId: Number(userId) });
    if (!doc) {
      doc = new UserPrefs({
        userId: Number(userId),
        imageGenModels: [],
        activeImageGenModelId: null,
      });
    }
    const arr = doc.imageGenModels || [];
    if (arr.length >= MAX_IMAGE_GEN_MODELS_PER_USER) throw new Error('LIMIT');
    if (arr.some((m) => m.slug === slug)) throw new Error('DUPLICATE_SLUG');
    const mid = shortId();
    doc.imageGenModels.push({ id: mid, slug, createdAt: new Date() });
    doc.activeImageGenModelId = mid;
    await doc.save();
    const row = doc.imageGenModels[doc.imageGenModels.length - 1];
    return {
      id: row.id,
      slug: row.slug,
      createdAt: row.createdAt?.toISOString?.() || new Date().toISOString(),
    };
  }

  async setActiveImageGenModel(userId, modelIdOrNull) {
    if (modelIdOrNull == null || modelIdOrNull === '') {
      await UserPrefs.findOneAndUpdate(
        { userId: Number(userId) },
        { $set: { activeImageGenModelId: null } },
      );
      return;
    }
    const doc = await UserPrefs.findOne({ userId: Number(userId) });
    if (!doc) throw new Error('NOT_FOUND');
    const hit = (doc.imageGenModels || []).some((x) => x.id === modelIdOrNull);
    if (!hit) throw new Error('NOT_FOUND');
    doc.activeImageGenModelId = modelIdOrNull;
    await doc.save();
  }

  async deleteImageGenModel(userId, modelId) {
    const doc = await UserPrefs.findOne({ userId: Number(userId) });
    if (!doc) return false;
    const before = (doc.imageGenModels || []).length;
    doc.imageGenModels = (doc.imageGenModels || []).filter((m) => m.id !== modelId);
    if (doc.imageGenModels.length === before) return false;
    if (doc.activeImageGenModelId === modelId) {
      doc.activeImageGenModelId = doc.imageGenModels[0]?.id || null;
    }
    await doc.save();
    return true;
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
