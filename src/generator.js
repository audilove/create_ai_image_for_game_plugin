'use strict';

const axios = require('axios');
const { DEFAULTS } = require('./config');

/**
 * Handles communication with OpenRouter API for image generation.
 */
function parsePositiveTokens(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(200000, Math.floor(n));
}

class Generator {
  constructor(apiKey, options = {}) {
    if (!apiKey) throw new Error('[GameImageGen] apiKey is required. Set OPENROUTER_API_KEY env var or pass it in options.');

    this.apiKey = apiKey;
    this.model = options.model || DEFAULTS.model;
    this.apiEndpoint = options.apiEndpoint || DEFAULTS.apiEndpoint;
    this.timeout = options.requestTimeout || DEFAULTS.requestTimeout;
    this.siteUrl = options.siteUrl || '';
    this.siteName = options.siteName || 'GameImageGenerator';
    const defaultImg = DEFAULTS.maxImageOutputTokens ?? 32000;
    const defaultCompletion = DEFAULTS.maxCompletionTokens ?? 8192;
    this.maxImageOutputTokens = parsePositiveTokens(
      options.maxImageOutputTokens ?? process.env.OPENROUTER_MAX_IMAGE_TOKENS,
      defaultImg,
    );
    this.maxCompletionTokens = parsePositiveTokens(
      options.maxCompletionTokens ?? process.env.OPENROUTER_MAX_COMPLETION_TOKENS,
      defaultCompletion,
    );
  }

  /**
   * Generate an image via OpenRouter.
   * @param {string} systemText  - System instructions
   * @param {Array}  contentParts - Array of message content parts (text + images)
   * @returns {Promise<{base64: string, mimeType: string}>}
   */
  async generate(systemText, contentParts) {
    const messages = [];

    if (systemText && systemText.trim()) {
      messages.push({
        role: 'system',
        content: systemText,
      });
    }

    messages.push({
      role: 'user',
      content: contentParts,
    });

    const requestBody = {
      model: this.model,
      messages,
      // Required for Gemini image generation models to return image output
      modalities: ['image', 'text'],
      max_tokens: this.maxImageOutputTokens,
    };

    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    if (this.siteUrl) headers['HTTP-Referer'] = this.siteUrl;
    if (this.siteName) headers['X-Title'] = this.siteName;

    try {
      const response = await axios.post(this.apiEndpoint, requestBody, {
        headers,
        timeout: this.timeout,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      return this._extractImage(response.data);
    } catch (err) {
      if (err.response) {
        const status = err.response.status;
        const data = err.response.data;
        const detail = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);
        throw new Error(`[GameImageGen] API error ${status}: ${detail}`);
      }
      if (err.code === 'ECONNABORTED') {
        throw new Error(`[GameImageGen] Request timed out after ${this.timeout}ms. Try increasing requestTimeout.`);
      }
      throw err;
    }
  }

  /**
   * Run a text-only multimodal completion.
   * Useful for analysis tasks (for example, layout detection from screenshot)
   * where we need structured JSON, not an image.
   *
   * @param {string} systemText
   * @param {Array} contentParts
   * @returns {Promise<string>} model text response
   */
  async completeText(systemText, contentParts, options = {}) {
    const messages = [];

    if (systemText && systemText.trim()) {
      messages.push({
        role: 'system',
        content: systemText,
      });
    }

    messages.push({
      role: 'user',
      content: contentParts,
    });

    const requestBody = {
      model: options.model || this.model,
      messages,
      modalities: ['text'],
      max_tokens: options.maxTokens ?? this.maxCompletionTokens,
    };

    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    if (this.siteUrl) headers['HTTP-Referer'] = this.siteUrl;
    if (this.siteName) headers['X-Title'] = this.siteName;

    try {
      const response = await axios.post(this.apiEndpoint, requestBody, {
        headers,
        timeout: this.timeout,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      return this._extractText(response.data);
    } catch (err) {
      if (err.response) {
        const status = err.response.status;
        const data = err.response.data;
        const detail = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);
        throw new Error(`[GameImageGen] API error ${status}: ${detail}`);
      }
      if (err.code === 'ECONNABORTED') {
        throw new Error(`[GameImageGen] Request timed out after ${this.timeout}ms. Try increasing requestTimeout.`);
      }
      throw err;
    }
  }

  /**
   * Extracts base64 image data from various OpenRouter/Gemini response formats.
   */
  _extractImage(data) {
    const choice = data?.choices?.[0];
    if (!choice) {
      throw new Error(`[GameImageGen] Unexpected API response shape: ${JSON.stringify(data).slice(0, 300)}`);
    }

    const message = choice.message || choice.delta || {};

    // Format 1: message.images — OpenRouter Gemini image generation (primary format)
    if (Array.isArray(message.images) && message.images.length > 0) {
      for (const img of message.images) {
        const result = this._tryExtractFromPart(img);
        if (result) return result;
      }
    }

    const content = message.content;

    // Format 2: content is an array of parts (multimodal)
    if (Array.isArray(content)) {
      for (const part of content) {
        const result = this._tryExtractFromPart(part);
        if (result) return result;
      }
    }

    // Format 3: content is a string (possibly data URL embedded)
    if (typeof content === 'string') {
      const result = this._tryExtractFromDataUrl(content);
      if (result) return result;
    }

    // Format 4: Gemini native inline_data in candidates
    if (data?.candidates?.[0]?.content?.parts) {
      for (const part of data.candidates[0].content.parts) {
        if (part.inline_data?.data) {
          return {
            base64: part.inline_data.data,
            mimeType: part.inline_data.mime_type || 'image/png',
          };
        }
      }
    }

    throw new Error(
      `[GameImageGen] Could not extract image from response. ` +
      `Raw response: ${JSON.stringify(data).slice(0, 500)}`
    );
  }

  _tryExtractFromPart(part) {
    // image_url type
    if (part.type === 'image_url' && part.image_url?.url) {
      return this._tryExtractFromDataUrl(part.image_url.url);
    }
    // image type (some providers)
    if (part.type === 'image' && part.image_url?.url) {
      return this._tryExtractFromDataUrl(part.image_url.url);
    }
    // inline_data (Gemini native)
    if (part.inline_data?.data) {
      return {
        base64: part.inline_data.data,
        mimeType: part.inline_data.mime_type || 'image/png',
      };
    }
    return null;
  }

  _tryExtractFromDataUrl(str) {
    const match = str.match(/^data:(image\/\w+);base64,(.+)$/s);
    if (match) {
      return { mimeType: match[1], base64: match[2].trim() };
    }
    // Bare base64 without prefix
    if (/^[A-Za-z0-9+/]+=*$/.test(str.trim()) && str.trim().length > 100) {
      return { mimeType: 'image/png', base64: str.trim() };
    }
    return null;
  }

  _extractText(data) {
    const choice = data?.choices?.[0];
    if (!choice) {
      throw new Error(`[GameImageGen] Unexpected API response shape: ${JSON.stringify(data).slice(0, 300)}`);
    }
    const message = choice.message || choice.delta || {};
    const content = message.content;

    if (typeof content === 'string' && content.trim()) {
      return content.trim();
    }

    if (Array.isArray(content)) {
      const chunks = content
        .map((part) => {
          if (typeof part?.text === 'string') return part.text;
          if (typeof part === 'string') return part;
          return '';
        })
        .filter(Boolean);
      if (chunks.length) return chunks.join('\n').trim();
    }

    if (data?.candidates?.[0]?.content?.parts) {
      const chunks = data.candidates[0].content.parts
        .map((p) => p?.text || '')
        .filter(Boolean);
      if (chunks.length) return chunks.join('\n').trim();
    }

    throw new Error(
      `[GameImageGen] Could not extract text from response. ` +
      `Raw response: ${JSON.stringify(data).slice(0, 500)}`
    );
  }
}

module.exports = Generator;
