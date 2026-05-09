'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * JSON-backed fallback storage. Used when MONGO_URI is not configured.
 *
 * Public API (matches MongoStorage so handlers stay backend-agnostic):
 *   getUser(userId)
 *   listStyles(userId), createStyle, deleteStyle, getStyle,
 *   loadStyleReferences(userId, styleId)
 *   loadStyleReferenceBuffer(userId, styleId, filename)
 *   listRules(userId), createRule, deleteRule, getRule
 *   saveResult(userId, { params, webpBuffer })
 *   getResult(userId, resultId)
 *   loadResultBuffer(userId, resultId)
 *   saveIncoming(userId, buffer) → { id }
 *   loadIncoming(userId, id) → Buffer | null
 *   removeIncoming(userId, id)
 *   saveLayoutDraft(userId, planObject) → { id }
 *   loadLayoutDraft(userId, id) → object | null
 *   removeLayoutDraft(userId, id)
 */
class JsonStorage {
  constructor(rootDir) {
    this.kind = 'json';
    this.rootDir = path.resolve(rootDir);
    this.usersFile = path.join(this.rootDir, 'users.json');
    this.stylesDir = path.join(this.rootDir, 'styles');
    this.resultsDir = path.join(this.rootDir, 'results');
    this.incomingDir = path.join(this.rootDir, 'incoming');
    this.layoutDraftsDir = path.join(this.rootDir, 'layout_drafts');
    this._userLocks = new Map();

    fs.mkdirSync(this.rootDir, { recursive: true });
    fs.mkdirSync(this.stylesDir, { recursive: true });
    fs.mkdirSync(this.resultsDir, { recursive: true });
    fs.mkdirSync(this.incomingDir, { recursive: true });
    fs.mkdirSync(this.layoutDraftsDir, { recursive: true });
    if (!fs.existsSync(this.usersFile)) {
      fs.writeFileSync(this.usersFile, '{}', 'utf-8');
    }
  }

  async connect() { /* no-op */ }
  async disconnect() { /* no-op */ }

  /* ─── low-level user record ──────────────────────────────────────── */

  async _withUser(userId, fn) {
    const key = String(userId);
    const previous = this._userLocks.get(key) || Promise.resolve();
    let release;
    const next = new Promise((r) => (release = r));
    this._userLocks.set(key, previous.then(() => next));
    try {
      await previous;
      const all = this._readAll();
      const user = all[key] || this._emptyUser();
      const result = await fn(user);
      all[key] = user;
      this._writeAll(all);
      return result;
    } finally {
      release();
      if (this._userLocks.get(key) === next) {
        this._userLocks.delete(key);
      }
    }
  }

  _emptyUser() {
    return { styles: [], rules: [], results: [] };
  }

  _readAll() {
    try {
      return JSON.parse(fs.readFileSync(this.usersFile, 'utf-8') || '{}');
    } catch {
      return {};
    }
  }

  _writeAll(data) {
    const tmp = this.usersFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, this.usersFile);
  }

  async getUser(userId) {
    const all = this._readAll();
    const u = all[String(userId)] || this._emptyUser();
    return {
      styles: u.styles.map(stripStyle),
      rules: u.rules.map(stripRule),
    };
  }

  /* ─── styles ─────────────────────────────────────────────────────── */

  async listStyles(userId) {
    const u = await this.getUser(userId);
    return u.styles;
  }

  async getStyle(userId, styleId) {
    const u = await this.getUser(userId);
    return u.styles.find((s) => s.id === styleId) || null;
  }

  async createStyle(userId, payload) {
    const id = shortId();
    const userStylesDir = path.join(this.stylesDir, String(userId), id);
    fs.mkdirSync(userStylesDir, { recursive: true });
    const stored = [];
    for (let i = 0; i < payload.files.length && i < 10; i += 1) {
      const fname = `${String(i + 1).padStart(3, '0')}.jpg`;
      fs.writeFileSync(path.join(userStylesDir, fname), payload.files[i]);
      stored.push(fname);
    }

    return this._withUser(userId, (user) => {
      const style = {
        id,
        name: String(payload.name).slice(0, 80),
        files: stored,
        createdAt: new Date().toISOString(),
      };
      user.styles.push(style);
      return style;
    });
  }

  async deleteStyle(userId, styleId) {
    const dir = path.join(this.stylesDir, String(userId), styleId);
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    return this._withUser(userId, (user) => {
      const before = user.styles.length;
      user.styles = user.styles.filter((s) => s.id !== styleId);
      return user.styles.length !== before;
    });
  }

  async loadStyleReferences(userId, styleId) {
    const style = await this.getStyle(userId, styleId);
    if (!style) return [];
    const dir = path.join(this.stylesDir, String(userId), styleId);
    const out = [];
    for (const f of style.files) {
      const full = path.join(dir, f);
      if (!fs.existsSync(full)) continue;
      const ext = path.extname(f).toLowerCase().replace('.', '');
      const mimeType =
        ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      out.push({
        base64: fs.readFileSync(full).toString('base64'),
        mimeType,
        filename: f,
      });
    }
    return out;
  }

  async loadStyleReferenceBuffer(userId, styleId, filename) {
    const full = path.join(this.stylesDir, String(userId), styleId, filename);
    if (!fs.existsSync(full)) return null;
    return fs.readFileSync(full);
  }

  /* ─── rules ──────────────────────────────────────────────────────── */

  async listRules(userId) {
    const u = await this.getUser(userId);
    return u.rules;
  }

  async getRule(userId, ruleId) {
    const u = await this.getUser(userId);
    return u.rules.find((r) => r.id === ruleId) || null;
  }

  async createRule(userId, name, text) {
    return this._withUser(userId, (user) => {
      const rule = {
        id: shortId(),
        name: String(name).slice(0, 80),
        text: String(text).slice(0, 4000),
        createdAt: new Date().toISOString(),
      };
      user.rules.push(rule);
      return rule;
    });
  }

  async deleteRule(userId, ruleId) {
    return this._withUser(userId, (user) => {
      const before = user.rules.length;
      user.rules = user.rules.filter((r) => r.id !== ruleId);
      return user.rules.length !== before;
    });
  }

  /* ─── results ────────────────────────────────────────────────────── */

  async saveResult(userId, { params, webpBuffer }) {
    const id = shortId();
    const userResultsDir = path.join(this.resultsDir, String(userId));
    fs.mkdirSync(userResultsDir, { recursive: true });
    const filePath = path.join(userResultsDir, `${id}.webp`);
    fs.writeFileSync(filePath, webpBuffer);

    const meta = {
      id,
      params: sanitizeParamsForStorage(params),
      createdAt: new Date().toISOString(),
    };

    await this._withUser(userId, (user) => {
      user.results.push({ ...meta, filePath });
      const maxKeep = 100;
      while (user.results.length > maxKeep) {
        const evicted = user.results.shift();
        try {
          if (evicted?.filePath && fs.existsSync(evicted.filePath)) fs.unlinkSync(evicted.filePath);
        } catch {
          /* ignore */
        }
      }
    });

    return meta;
  }

  async getResult(userId, resultId) {
    const all = this._readAll();
    const u = all[String(userId)];
    const r = u?.results?.find((x) => x.id === resultId);
    if (!r) return null;
    return { id: r.id, params: r.params, createdAt: r.createdAt };
  }

  async loadResultBuffer(userId, resultId) {
    const all = this._readAll();
    const u = all[String(userId)];
    const r = u?.results?.find((x) => x.id === resultId);
    if (!r || !r.filePath) return null;
    if (!fs.existsSync(r.filePath)) return null;
    return fs.readFileSync(r.filePath);
  }

  /* ─── transient uploads ──────────────────────────────────────────── */

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

  /* ─── ephemeral layout-draft JSON (waiting for user confirmation) ─ */

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
      const raw = fs.readFileSync(file, 'utf-8');
      return JSON.parse(raw);
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

function shortId() {
  return crypto.randomBytes(4).toString('hex');
}

function stripStyle(s) {
  return { id: s.id, name: s.name, files: s.files, createdAt: s.createdAt };
}

function stripRule(r) {
  return { id: r.id, name: r.name, text: r.text, createdAt: r.createdAt };
}

function sanitizeParamsForStorage(params) {
  return {
    prompt: params.prompt,
    type: params.type,
    aspectRatio: params.aspectRatio,
    transparent: params.transparent === true,
    contextId: params.contextId || null,
    contextLabel: params.contextLabel || null,
    contextText: params.contextText || null,
    styleId: params.styleId || null,
    styleLabel: params.styleLabel || null,
  };
}

module.exports = JsonStorage;
module.exports.JsonStorage = JsonStorage;
module.exports.shortId = shortId;
module.exports.sanitizeParamsForStorage = sanitizeParamsForStorage;
