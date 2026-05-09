'use strict';

/**
 * In-memory per-user wizard state. A session is just a plain object — we
 * intentionally don't persist it: if the bot restarts mid-flow the user just
 * pings /start and starts over. Long-lived data (styles, rules, results)
 * lives in Storage on disk.
 */
class SessionStore {
  constructor() {
    this._map = new Map();
  }

  get(userId) {
    const key = String(userId);
    let s = this._map.get(key);
    if (!s) {
      s = { mode: 'idle' };
      this._map.set(key, s);
    }
    return s;
  }

  reset(userId) {
    this._map.set(String(userId), { mode: 'idle' });
  }

  set(userId, patch) {
    const s = this.get(userId);
    Object.assign(s, patch);
    return s;
  }
}

module.exports = SessionStore;
