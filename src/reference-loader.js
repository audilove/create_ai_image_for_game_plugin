'use strict';

const fs = require('fs');
const path = require('path');
const { DEFAULTS } = require('./config');

/**
 * Loads reference images from a directory as base64 strings.
 * These are passed to the model as style examples.
 */
class ReferenceLoader {
  constructor(referenceDir, options = {}) {
    this.referenceDir = path.resolve(referenceDir || DEFAULTS.referenceDir);
    this.maxImages = options.maxReferenceImages || DEFAULTS.maxReferenceImages;
    this.extensions = options.referenceExtensions || DEFAULTS.referenceExtensions;
    this._cache = null;
  }

  /**
   * Returns array of { base64, mimeType, filename } objects.
   * Results are cached until clearCache() is called.
   */
  load() {
    if (this._cache) return this._cache;

    if (!fs.existsSync(this.referenceDir)) {
      return [];
    }

    const files = fs.readdirSync(this.referenceDir)
      .filter(f => this.extensions.includes(path.extname(f).toLowerCase()))
      .slice(0, this.maxImages);

    if (files.length === 0) return [];

    this._cache = files.map(filename => {
      const fullPath = path.join(this.referenceDir, filename);
      const ext = path.extname(filename).toLowerCase().replace('.', '');
      const mimeType = this._getMimeType(ext);
      const base64 = fs.readFileSync(fullPath).toString('base64');
      return { base64, mimeType, filename };
    });

    return this._cache;
  }

  clearCache() {
    this._cache = null;
  }

  getReferenceDir() {
    return this.referenceDir;
  }

  _getMimeType(ext) {
    const map = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif',
    };
    return map[ext] || 'image/jpeg';
  }
}

module.exports = ReferenceLoader;
