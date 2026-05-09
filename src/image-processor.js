'use strict';

const sharp = require('sharp');
const BackgroundRemover = require('./bg-remover');
const { DEFAULTS, FULLBLEED_TYPES } = require('./config');

/**
 * Converts raw image data to WebP.
 * When transparent=true, delegates background removal to BackgroundRemover
 * which uses a professional AI service (Replicate BRIA-RMBG-2.0 or remove.bg).
 */
class ImageProcessor {
  constructor(options = {}) {
    this.quality    = options.webpQuality || DEFAULTS.webpQuality;
    this.bgRemover  = new BackgroundRemover(options);
  }

  /**
   * Process raw image buffer to final WebP.
   * @param {Buffer} inputBuffer
   * @param {object} options
   * @param {boolean} options.transparent
   * @param {number}  options.width
   * @param {number}  options.height
   * @returns {Promise<Buffer>} WebP buffer
   */
  async process(inputBuffer, options = {}) {
    const { transparent = false, width, height, type = 'icon' } = options;
    // Backgrounds, illustrations and full-screen prototypes fill the canvas
    // edge-to-edge (cover). Icons, characters, buttons etc. fit inside
    // without cropping (contain).
    const resizeFit = FULLBLEED_TYPES.has(type) ? 'cover' : 'contain';

    let workingBuffer = inputBuffer;

    if (transparent) {
      if (this.bgRemover.isEnabled()) {
        console.log(`  [bg-removal] using ${this.bgRemover.getServiceName()}...`);
        workingBuffer = await this.bgRemover.remove(inputBuffer);
      }
    }

    let pipeline = sharp(workingBuffer);
    const meta   = await pipeline.metadata();

    if (!transparent && meta.hasAlpha) {
      pipeline = pipeline.flatten({ background: { r: 0, g: 0, b: 0 } });
    }

    if (transparent && !meta.hasAlpha) {
      // Service returned image without alpha — ensure it at least has the channel
      pipeline = pipeline.ensureAlpha();
    }

    if (width && height) {
      const needsResize = meta.width !== width || meta.height !== height;
      if (needsResize) {
        pipeline = pipeline.resize(width, height, {
          fit: resizeFit,
          kernel: sharp.kernel.lanczos3, // highest quality upscaling
          background: transparent
            ? { r: 0, g: 0, b: 0, alpha: 0 }
            : { r: 0, g: 0, b: 0 },
        });
      }
    }

    // lossless=true for transparent WebP preserves crisp alpha edges
    return pipeline
      .webp({ quality: this.quality, lossless: transparent })
      .toBuffer();
  }

  /** Decode base64 string to Buffer. */
  base64ToBuffer(base64) {
    return Buffer.from(base64.replace(/\s/g, ''), 'base64');
  }
}

module.exports = ImageProcessor;
