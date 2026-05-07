'use strict';

const axios = require('axios');
const sharp = require('sharp');

/**
 * Professional AI background removal.
 *
 * Supported backends (configure via options.bgRemovalService):
 *
 *   'replicate'  — rembg model via Replicate API (great quality)
 *                  Requires: REPLICATE_API_TOKEN env var
 *                  Cost: ~$0.003 per image. Add credits: https://replicate.com/account/billing
 *                  Falls back to remove.bg automatically if credits run out.
 *
 *   'removebg'   — remove.bg API (reliable, fast)
 *                  Requires: REMOVE_BG_API_KEY env var
 *                  Cost: 50 free/month, then ~$0.10 per image
 *                  https://www.remove.bg/api
 *
 *   'none'       — skip background removal, return image as-is
 *
 * Auto-detection priority: replicate → removebg → none
 * If replicate fails with insufficient credits, automatically falls back to removebg.
 */
class BackgroundRemover {
  constructor(options = {}) {
    this.service = options.bgRemovalService
      || (process.env.REPLICATE_API_TOKEN ? 'replicate' : null)
      || (process.env.REMOVE_BG_API_KEY   ? 'removebg'  : null)
      || 'none';

    this.replicateToken = options.replicateApiToken || process.env.REPLICATE_API_TOKEN;
    this.removeBgKey    = options.removeBgApiKey    || process.env.REMOVE_BG_API_KEY;
    this.timeout        = options.bgRemovalTimeout  || 60000;
  }

  /**
   * Remove background from image buffer.
   * @param {Buffer} inputBuffer  - Raw image (JPEG/PNG/WebP)
   * @returns {Promise<Buffer>}   - PNG buffer with alpha channel
   */
  async remove(inputBuffer) {
    if (this.service === 'replicate') {
      try {
        return await this._removeViaReplicate(inputBuffer);
      } catch (err) {
        // Auto-fallback to remove.bg if Replicate has no credits or is unavailable
        if (this.removeBgKey && (err.message.includes('402') || err.message.includes('credit') || err.message.includes('billing'))) {
          console.log('  [bg-removal] replicate: no credits — falling back to remove.bg');
          return this._removeViaRemoveBg(inputBuffer);
        }
        throw err;
      }
    }
    if (this.service === 'removebg') {
      return this._removeViaRemoveBg(inputBuffer);
    }
    // 'none' — return untouched
    return inputBuffer;
  }

  isEnabled() {
    return this.service !== 'none';
  }

  getServiceName() {
    return this.service;
  }

  // ---------------------------------------------------------------------------
  // Replicate — BRIA RMBG-2.0
  // ---------------------------------------------------------------------------

  async _removeViaReplicate(inputBuffer) {
    if (!this.replicateToken) {
      throw new Error('[BgRemover] REPLICATE_API_TOKEN is not set. Add it to .env');
    }

    const base64 = inputBuffer.toString('base64');
    const meta   = await sharp(inputBuffer).metadata();
    const mime   = meta.format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const dataUrl = `data:${mime};base64,${base64}`;

    let createRes;
    try {
      // Create prediction — cjwbw/rembg (U2Net, solid quality)
      createRes = await axios.post(
        'https://api.replicate.com/v1/predictions',
        {
          version: 'fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003',
          input: { image: dataUrl },
        },
        {
          headers: {
            Authorization: `Bearer ${this.replicateToken}`,
            'Content-Type': 'application/json',
            Prefer: 'wait',
          },
          timeout: this.timeout,
        }
      );
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data?.detail || '';
      if (status === 402 || detail.toLowerCase().includes('credit') || detail.toLowerCase().includes('billing')) {
        throw new Error(`[BgRemover] Replicate 402: insufficient credit — ${detail}`);
      }
      throw err;
    }

    let prediction = createRes.data;

    // If not yet complete (Prefer: wait didn't resolve), poll
    if (prediction.status !== 'succeeded' && prediction.status !== 'failed') {
      prediction = await this._pollReplicate(prediction.urls.get);
    }

    if (prediction.status === 402 || prediction.detail?.toLowerCase().includes('credit')) {
      throw new Error(`[BgRemover] Replicate 402: insufficient credit`);
    }
    if (prediction.status === 'failed') {
      throw new Error(`[BgRemover] Replicate prediction failed: ${prediction.error}`);
    }

    const outputUrl = Array.isArray(prediction.output)
      ? prediction.output[0]
      : prediction.output;

    if (!outputUrl) {
      throw new Error('[BgRemover] Replicate returned no output URL');
    }

    // Download result PNG
    const dlRes = await axios.get(outputUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });

    return Buffer.from(dlRes.data);
  }

  async _pollReplicate(getUrl, maxAttempts = 30, intervalMs = 2000) {
    for (let i = 0; i < maxAttempts; i++) {
      await this._sleep(intervalMs);
      const res = await axios.get(getUrl, {
        headers: { Authorization: `Bearer ${this.replicateToken}` },
        timeout: 10000,
      });
      const p = res.data;
      if (p.status === 'succeeded' || p.status === 'failed') return p;
    }
    throw new Error('[BgRemover] Replicate polling timed out');
  }

  // ---------------------------------------------------------------------------
  // remove.bg
  // ---------------------------------------------------------------------------

  async _removeViaRemoveBg(inputBuffer) {
    if (!this.removeBgKey) {
      throw new Error('[BgRemover] REMOVE_BG_API_KEY is not set. Add it to .env');
    }

    // remove.bg accepts JSON with image_file_b64 (base64-encoded image)
    const base64 = inputBuffer.toString('base64');

    const res = await axios.post(
      'https://api.remove.bg/v1.0/removebg',
      { image_file_b64: base64, size: 'auto' },
      {
        headers: {
          'X-Api-Key': this.removeBgKey,
          'Content-Type': 'application/json',
        },
        responseType: 'arraybuffer',
        timeout: this.timeout,
      }
    );

    if (res.status !== 200) {
      throw new Error(`[BgRemover] remove.bg error ${res.status}`);
    }

    return Buffer.from(res.data);
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = BackgroundRemover;
