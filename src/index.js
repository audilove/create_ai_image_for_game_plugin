'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const Generator = require('./generator');
const ReferenceLoader = require('./reference-loader');
const PromptBuilder = require('./prompt-builder');
const ImageProcessor = require('./image-processor');
const LayoutDetector = require('./layout-detector');
const {
  DEFAULTS,
  ASPECT_RATIOS,
  HD_ASPECT_RATIOS,
  HD_TYPES,
  TYPE_PROMPTS,
  LOCKED_ASPECT_RATIOS,
} = require('./config');

/**
 * GameImageGenerator — main plugin class.
 *
 * @example
 * const gen = new GameImageGenerator({ apiKey: process.env.OPENROUTER_API_KEY });
 *
 * const result = await gen.generate({
 *   prompt: 'A glowing health potion bottle',
 *   type: 'icon',
 *   aspectRatio: '1/1',
 *   transparent: true,
 * });
 * console.log(result.path);   // path to saved WebP
 * console.log(result.base64); // base64 string for inline use
 */
class GameImageGenerator {
  /**
   * @param {object} options
   * @param {string}  options.apiKey          - OpenRouter API key (or set OPENROUTER_API_KEY env var)
   * @param {string}  [options.model]         - Model to use (default: google/gemini-2.0-flash-exp:free)
   * @param {string}  [options.outputDir]     - Where to save generated images (default: ./output)
   * @param {string}  [options.referenceDir]  - Folder with style reference images (default: ./reference)
   * @param {number}  [options.webpQuality]   - WebP quality 1-100 (default: 90)
   * @param {number}  [options.maxReferenceImages] - Max reference images to send (default: 4)
   * @param {string}  [options.baseContext]   - Override the built-in generation context
   * @param {boolean} [options.saveOutput]    - Whether to save images to disk (default: true)
   * @param {string}  [options.siteUrl]       - Your site URL for OpenRouter rankings
   * @param {string}  [options.siteName]      - Your site name for OpenRouter rankings
   * @param {number}  [options.requestTimeout] - API timeout in ms (default: 120000)
   * @param {number}  [options.maxConcurrentGenerations] - Default max parallel workers for generateBatch() (default: 4)
   */
  constructor(options = {}) {
    const apiKey = options.apiKey || process.env.OPENROUTER_API_KEY;

    this.saveOutput = options.saveOutput !== false;
    this.outputDir = path.resolve(options.outputDir || DEFAULTS.outputDir);
    this.baseContext = options.baseContext || null;
    this.layoutDetectionModel =
      options.layoutDetectionModel ||
      process.env.OPENROUTER_LAYOUT_DETECTION_MODEL ||
      DEFAULTS.layoutDetectionModel;
    this.maxConcurrentGenerations = Math.max(
      1,
      Number(options.maxConcurrentGenerations || DEFAULTS.maxConcurrentGenerations || 4)
    );
    this._requestCounter = 0;

    this._generator = new Generator(apiKey, options);
    this._referenceLoader = new ReferenceLoader(options.referenceDir, options);
    this._promptBuilder = new PromptBuilder();
    this._processor = new ImageProcessor(options);
    this._layoutDetector = new LayoutDetector({
      generator: this._generator,
      assetGenerator: this,
      outputDir: this.outputDir,
      saveOutput: this.saveOutput,
      layoutDetectionModel: this.layoutDetectionModel,
    });

    if (this.saveOutput) {
      this._ensureOutputDir();
    }
  }

  /**
   * Generate a game image asset.
   *
   * @param {object} params
   * @param {string}  params.prompt        - What to generate (required)
   * @param {string}  [params.type]        - Asset type: icon | background | illustration | button | character | item | tile | card | effect
   * @param {string}  [params.aspectRatio] - Canvas ratio: 1/1 | 16/9 | 9/16 | 4/3 | 3/4 | 3/2 | 2/3 | 21/9 | 2/1
   * @param {boolean} [params.transparent] - Generate with transparent background (alpha channel)
   * @param {string}  [params.context]     - Project/game context (genre, theme, mood)
   * @param {string}  [params.style]       - Extra style instructions
   * @param {string}  [params.filename]    - Custom output filename (without extension)
   * @param {object}  [params.extra]       - Any additional key-value prompt modifiers
   *
   * @returns {Promise<GenerationResult>}
   */
  async generate(params) {
    if (!params || !params.prompt) {
      throw new Error('[GameImageGen] params.prompt is required.');
    }

    const type = params.type || DEFAULTS.defaultType;
    // Some types (UI prototypes) lock their aspect ratio to make sure the
    // model produces a real screen mockup at the right shape regardless of
    // what the caller passes.
    const aspectRatio =
      LOCKED_ASPECT_RATIOS[type] || params.aspectRatio || DEFAULTS.defaultAspectRatio;
    const transparent = params.transparent === true;
    const isHD = HD_TYPES.has(type);

    // Reference image resolution:
    //   1. params.references — explicit list ({base64, mimeType, filename?}[]).
    //   2. params.referenceDir — load from a custom directory.
    //   3. fallback to the constructor-configured reference directory.
    let referenceImages;
    if (Array.isArray(params.references) && params.references.length > 0) {
      referenceImages = params.references;
    } else if (params.referenceDir) {
      const adhoc = new ReferenceLoader(params.referenceDir, {
        maxReferenceImages: this._referenceLoader.maxImages,
        referenceExtensions: this._referenceLoader.extensions,
      });
      referenceImages = adhoc.load();
    } else {
      referenceImages = this._referenceLoader.load();
    }

    // Build prompt — always use model-native dimensions for generation prompt
    const { systemText, contentParts, dimensions } = this._promptBuilder.build(
      { ...params, type, aspectRatio, transparent },
      referenceImages,
      this.baseContext
    );

    // Target output dimensions: HD for backgrounds/illustrations, standard for everything else
    const outputDimensions = isHD
      ? (HD_ASPECT_RATIOS[aspectRatio] || HD_ASPECT_RATIOS['1/1'])
      : dimensions;

    // Call API
    const { base64, mimeType } = await this._generator.generate(systemText, contentParts);

    // Process image (convert to WebP, handle transparency, resize to target)
    const rawBuffer = this._processor.base64ToBuffer(base64);
    const webpBuffer = await this._processor.process(rawBuffer, {
      transparent,
      width: outputDimensions.width,
      height: outputDimensions.height,
      type,
    });

    const webpBase64 = webpBuffer.toString('base64');

    // Save to disk
    let savedPath = null;
    if (this.saveOutput) {
      const filename = params.filename
        ? `${params.filename}.webp`
        : this._generateFilename(params);
      savedPath = path.join(this.outputDir, filename);
      await fs.promises.writeFile(savedPath, webpBuffer);
    }

    return {
      path: savedPath,
      base64: webpBase64,
      dataUrl: `data:image/webp;base64,${webpBase64}`,
      mimeType: 'image/webp',
      width: outputDimensions.width,
      height: outputDimensions.height,
      transparent,
      type,
      aspectRatio,
      prompt: params.prompt,
      referenceCount: referenceImages.length,
    };
  }

  /**
   * Generate multiple assets concurrently with optional concurrency limit.
   *
   * @param {Array<object>} requests
   * @param {object} [options]
   * @param {number} [options.concurrency] - Max parallel generations (default: instance maxConcurrentGenerations)
   * @param {boolean} [options.continueOnError] - If true, returns per-item errors instead of failing whole batch
   * @returns {Promise<Array<GenerationResult|{error: string, index: number, params: object}>>}
   */
  async generateBatch(requests, options = {}) {
    if (!Array.isArray(requests) || requests.length === 0) {
      throw new Error('[GameImageGen] requests must be a non-empty array.');
    }

    const concurrency = Math.max(
      1,
      Number(options.concurrency || this.maxConcurrentGenerations || 1)
    );
    const continueOnError = options.continueOnError === true;
    const results = new Array(requests.length);
    let nextIndex = 0;

    const worker = async () => {
      while (true) {
        const currentIndex = nextIndex++;
        if (currentIndex >= requests.length) return;

        const params = requests[currentIndex];

        try {
          results[currentIndex] = await this.generate(params);
        } catch (err) {
          if (!continueOnError) {
            throw err;
          }
          results[currentIndex] = {
            error: err.message || String(err),
            index: currentIndex,
            params,
          };
        }
      }
    };

    const workerCount = Math.min(concurrency, requests.length);
    const workers = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workers);

    return results;
  }

  /**
   * Detect UI elements on a screenshot and export them as separate files.
   *
   * @param {object} params
   * @param {string} [params.imagePath]      - Absolute or relative path to source screenshot.
   * @param {Buffer} [params.imageBuffer]    - Raw screenshot buffer.
   * @param {string} [params.imageBase64]    - Base64 encoded screenshot.
   * @param {string} [params.hint]           - Optional instructions for detector.
   * @param {number} [params.maxAssets=120]  - Upper bound of detected elements.
   * @param {number} [params.minAssetSize=12]- Drop very small detections.
   * @param {boolean}[params.includeBase64]  - Include base64 in response for each asset.
   * @param {boolean}[params.saveOutput]     - Override constructor saveOutput for this call.
   *
   * @returns {Promise<DetectionResult>}
   */
  async detectLayoutAssets(params = {}) {
    return this._layoutDetector.detectAndGenerate(params);
  }

  /** Только план ассетов по скриншоту (без генерации). Для бота: подтверждение перед generate. */
  async detectLayoutPlan(params = {}) {
    return this._layoutDetector.detectPlan(params);
  }

  /**
   * Reload reference images from disk (clears cache).
   */
  reloadReferences() {
    this._referenceLoader.clearCache();
  }

  /**
   * Returns information about the current configuration.
   */
  info() {
    const refs = this._referenceLoader.load();
    return {
      model: this._generator.model,
      outputDir: this.outputDir,
      referenceDir: this._referenceLoader.getReferenceDir(),
      referenceImagesLoaded: refs.length,
      referenceImages: refs.map(r => r.filename),
      supportedAspectRatios: Object.keys(ASPECT_RATIOS),
      supportedTypes: Object.keys(TYPE_PROMPTS),
      maxConcurrentGenerations: this.maxConcurrentGenerations,
      layoutDetectionModel: this.layoutDetectionModel,
    };
  }

  _ensureOutputDir() {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  _generateFilename(params) {
    const type = (params.type || 'asset').replace(/[^a-z0-9]/gi, '-');
    const ratio = (params.aspectRatio || '1-1').replace('/', '-');
    const slug = params.prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 40)
      .replace(/-+$/, '');
    const ts = Date.now();
    this._requestCounter += 1;
    const seq = this._requestCounter.toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `${type}_${ratio}_${slug}_${ts}_${seq}_${rand}.webp`;
  }
}

// Named exports for convenience
module.exports = GameImageGenerator;
module.exports.GameImageGenerator = GameImageGenerator;
module.exports.ASPECT_RATIOS = ASPECT_RATIOS;
module.exports.TYPE_PROMPTS = TYPE_PROMPTS;

/**
 * @typedef {object} GenerationResult
 * @property {string|null} path        - Absolute path to saved WebP file (null if saveOutput=false)
 * @property {string}      base64      - Base64-encoded WebP image data
 * @property {string}      dataUrl     - Full data URL: "data:image/webp;base64,..."
 * @property {string}      mimeType    - Always "image/webp"
 * @property {number}      width       - Image width in pixels
 * @property {number}      height      - Image height in pixels
 * @property {boolean}     transparent - Whether transparent background was applied
 * @property {string}      type        - Asset type used
 * @property {string}      aspectRatio - Aspect ratio used
 * @property {string}      prompt      - Original prompt used
 * @property {number}      referenceCount - Number of reference images used
 */

/**
 * @typedef {object} DetectionResult
 * @property {string|null} outputDir
 * @property {string|null} manifestPath
 * @property {number} totalDetected
 * @property {number} totalGenerated
 * @property {number} sourceWidth
 * @property {number} sourceHeight
 * @property {Array<object>} assets
 * @property {object} manifest
 */
