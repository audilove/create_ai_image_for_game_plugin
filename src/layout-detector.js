'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const DETECTOR_SYSTEM_PROMPT = `
You are a game UI asset extraction planner.
Analyze the screenshot and produce a generation plan for reusable assets.

Return STRICT JSON only (no markdown, no comments) with this exact shape:
{
  "assets": [
    {
      "name": "short asset name",
      "type": "icon|background|illustration|button|character|item|tile|card|effect",
      "description": "what this element is and how it looks",
      "x": 0,
      "y": 0,
      "width": 0,
      "height": 0,
      "aspectRatio": "1/1|16/9|9/16|4/3|3/4|3/2|2/3|21/9|2/1",
      "transparent": true,
      "priority": 1,
      "prompt": "detailed generation prompt for this asset",
      "confidence": 0.0
    }
  ]
}

Rules:
- Coordinates are integers in source pixels.
- x,y are top-left; width,height are box size.
- Include reusable visual assets only (buttons/icons/avatars/cards/panels/background pieces/etc).
- Each asset must have a rich prompt suitable for standalone re-generation.
- Use lower priority value for more important assets.
- If uncertain, still include asset with lower confidence.
`.trim();

const SUPPORTED_TYPES = new Set([
  'icon',
  'background',
  'illustration',
  'button',
  'character',
  'item',
  'tile',
  'card',
  'effect',
]);
const ASPECT_RATIOS = ['1/1', '16/9', '9/16', '4/3', '3/4', '3/2', '2/3', '21/9', '2/1'];

class LayoutDetector {
  constructor(options = {}) {
    if (!options.generator) {
      throw new Error('[LayoutDetector] options.generator is required.');
    }
    if (options.assetGenerator && typeof options.assetGenerator.generate !== 'function') {
      throw new Error('[LayoutDetector] options.assetGenerator must have generate() when provided.');
    }
    this.generator = options.generator;
    this.assetGenerator = options.assetGenerator || null;
    this.outputDir = path.resolve(options.outputDir || './output');
    this.layoutDetectionModel = options.layoutDetectionModel || null;
    this.saveOutputByDefault = options.saveOutput !== false;
  }

  /**
   * Только разбор скриншота → план (без вызова генератора картинок).
   * @returns {Promise<LayoutPlan>}
   */
  async detectPlan(params = {}) {
    const source = await this._resolveSource(params);
    const sourceMeta = await sharp(source.buffer).metadata();
    const sourceWidth = sourceMeta.width || 0;
    const sourceHeight = sourceMeta.height || 0;

    if (!sourceWidth || !sourceHeight) {
      throw new Error('[LayoutDetector] Could not determine screenshot dimensions.');
    }

    const json = await this._requestDetections({
      buffer: source.buffer,
      width: sourceWidth,
      height: sourceHeight,
      hint: params.hint || '',
      maxAssets: Number(params.maxAssets || 60),
    });

    const minAssetSize = Math.max(8, Number(params.minAssetSize || 16));
    const planned = this._normalizeElements(
      Array.isArray(json.assets) ? json.assets : [],
      sourceWidth,
      sourceHeight,
      minAssetSize,
    );

    const sortedPlanned = planned.sort((a, b) => {
      const p = a.priority - b.priority;
      if (p !== 0) return p;
      return b.confidence - a.confidence;
    });
    const maxGenerateAssets = Math.max(1, Number(params.maxGenerateAssets || 12));
    const selected = sortedPlanned.slice(0, maxGenerateAssets);

    const omittedAfterCap = Math.max(0, sortedPlanned.length - selected.length);

    return {
      sourceWidth,
      sourceHeight,
      totalDetected: sortedPlanned.length,
      selectedCount: selected.length,
      omittedAfterCap,
      planned: sortedPlanned,
      selected,
    };
  }

  async detectAndGenerate(params = {}) {
    if (!this.assetGenerator) {
      throw new Error('[LayoutDetector] detectAndGenerate requires assetGenerator.generate().');
    }
    const plan = await this.detectPlan(params);
    const { sourceWidth, sourceHeight, planned, selected } = plan;

    const saveOutput = params.saveOutput !== undefined
      ? params.saveOutput === true
      : this.saveOutputByDefault;
    const outputDir = saveOutput
      ? path.join(this.outputDir, `detected_assets_${Date.now()}`)
      : null;

    if (outputDir) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const source = await this._resolveSource(params);
    const sourceBuffer = source.buffer;

    const generatedAssets = [];
    for (let i = 0; i < selected.length; i += 1) {
      const el = selected[i];
      const cropPng = await sharp(sourceBuffer)
        .extract({
          left: el.x,
          top: el.y,
          width: el.width,
          height: el.height,
        })
        .png()
        .toBuffer();

      const generation = await this.assetGenerator.generate({
        prompt: el.prompt,
        type: el.type,
        aspectRatio: el.aspectRatio,
        transparent: el.transparent,
        context: [
          'Extracted from game UI screenshot; regenerate this as a clean standalone asset.',
          el.description,
        ].filter(Boolean).join('\n'),
        references: [{
          base64: cropPng.toString('base64'),
          mimeType: 'image/png',
          filename: `${slugify(el.name)}_crop.png`,
        }],
        filename: undefined,
      });

      const generatedWebp = Buffer.from(generation.base64, 'base64');
      const filename =
        `${String(i + 1).padStart(3, '0')}_${slugify(el.type)}_${slugify(el.name)}.webp`;
      const filePath = outputDir ? path.join(outputDir, filename) : null;
      if (filePath) await fs.promises.writeFile(filePath, generatedWebp);

      generatedAssets.push({
        id: i + 1,
        type: el.type,
        name: el.name,
        prompt: el.prompt,
        confidence: el.confidence,
        priority: el.priority,
        bbox: { x: el.x, y: el.y, width: el.width, height: el.height },
        width: generation.width,
        height: generation.height,
        mimeType: 'image/webp',
        path: filePath,
        base64: params.includeBase64 === true ? generation.base64 : undefined,
        aspectRatio: generation.aspectRatio,
        transparent: generation.transparent,
      });
    }

    const manifest = {
      detectedAt: new Date().toISOString(),
      source: {
        width: sourceWidth,
        height: sourceHeight,
      },
      totalDetected: planned.length,
      totalGenerated: generatedAssets.length,
      assets: generatedAssets.map((a) => ({
        id: a.id,
        type: a.type,
        name: a.name,
        prompt: a.prompt,
        confidence: a.confidence,
        priority: a.priority,
        bbox: a.bbox,
        aspectRatio: a.aspectRatio,
        transparent: a.transparent,
        path: a.path,
      })),
    };

    let manifestPath = null;
    if (outputDir) {
      manifestPath = path.join(outputDir, 'manifest.json');
      await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    }

    return {
      outputDir,
      manifestPath,
      totalDetected: planned.length,
      totalGenerated: generatedAssets.length,
      sourceWidth,
      sourceHeight,
      assets: generatedAssets,
      manifest,
    };
  }

  async _requestDetections({ buffer, width, height, hint, maxAssets }) {
    const pngBuffer = await sharp(buffer).png().toBuffer();
    const contentParts = [
      {
        type: 'text',
        text:
          `Screenshot size: ${width}x${height}px.\n` +
          `Find up to ${maxAssets} reusable assets and provide generation prompts.\n` +
          (hint ? `Hint: ${hint}\n` : '') +
          'Return strict JSON only.',
      },
      {
        type: 'image_url',
        image_url: {
          url: `data:image/png;base64,${pngBuffer.toString('base64')}`,
          detail: 'high',
        },
      },
    ];

    const raw = await this.generator.completeText(DETECTOR_SYSTEM_PROMPT, contentParts, {
      model: this.layoutDetectionModel || undefined,
    });
    const parsed = parseJsonFromModel(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.assets)) {
      throw new Error('[LayoutDetector] Model did not return valid detection JSON.');
    }
    return parsed;
  }

  async _resolveSource(params) {
    if (params.imageBuffer && Buffer.isBuffer(params.imageBuffer)) {
      return { buffer: params.imageBuffer };
    }
    if (params.imageBase64) {
      return { buffer: Buffer.from(String(params.imageBase64).replace(/\s/g, ''), 'base64') };
    }
    if (params.imagePath) {
      const file = path.resolve(params.imagePath);
      return { buffer: await fs.promises.readFile(file) };
    }
    throw new Error('[LayoutDetector] Provide imageBuffer, imageBase64, or imagePath.');
  }

  _normalizeElements(items, maxWidth, maxHeight, minAssetSize) {
    const out = [];
    for (const item of items) {
      const rawX = toInt(item?.x);
      const rawY = toInt(item?.y);
      const rawW = toInt(item?.width);
      const rawH = toInt(item?.height);
      const type = normalizeType(item?.type);
      const name = String(item?.name || type || 'asset').slice(0, 120);
      const description = String(item?.description || '').slice(0, 600);
      const prompt = String(item?.prompt || '').slice(0, 2000);
      const confidence = toConfidence(item?.confidence);
      const priority = toPriority(item?.priority);
      const aspectRatio = normalizeAspectRatio(item?.aspectRatio, rawW, rawH);
      const transparent = normalizeTransparent(item?.transparent, type);

      if (rawW < minAssetSize || rawH < minAssetSize) continue;

      const x = clamp(rawX, 0, maxWidth - 1);
      const y = clamp(rawY, 0, maxHeight - 1);
      const right = clamp(rawX + rawW, 1, maxWidth);
      const bottom = clamp(rawY + rawH, 1, maxHeight);
      const width = right - x;
      const height = bottom - y;

      if (width < minAssetSize || height < minAssetSize) continue;
      out.push({
        type,
        name,
        description,
        prompt: prompt || buildFallbackPrompt({ name, type, description }),
        x,
        y,
        width,
        height,
        confidence,
        priority,
        aspectRatio,
        transparent,
      });
    }
    return out;
  }
}

function parseJsonFromModel(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    /* fallthrough */
  }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* fallthrough */
    }
  }

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeType(type) {
  const raw = String(type || '').toLowerCase().replace(/[^a-z_]/g, '_');
  if (SUPPORTED_TYPES.has(raw)) return raw;
  if (raw.includes('avatar') || raw.includes('profile')) return 'character';
  if (raw.includes('panel') || raw.includes('navbar') || raw.includes('layout')) return 'illustration';
  if (raw.includes('icon') || raw.includes('badge')) return 'icon';
  if (raw.includes('button')) return 'button';
  if (raw.includes('bg') || raw.includes('back')) return 'background';
  return 'illustration';
}

function slugify(s) {
  return String(s || 'asset')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'asset';
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function toInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function toConfidence(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return clamp(n, 0, 1);
}

function toPriority(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 999;
  return clamp(Math.round(n), 1, 999);
}

function normalizeAspectRatio(ratio, width, height) {
  if (ASPECT_RATIOS.includes(ratio)) return ratio;
  if (width > 0 && height > 0) {
    const target = width / height;
    let best = '1/1';
    let minDiff = Infinity;
    for (const key of ASPECT_RATIOS) {
      const [w, h] = key.split('/').map(Number);
      const diff = Math.abs(target - (w / h));
      if (diff < minDiff) {
        minDiff = diff;
        best = key;
      }
    }
    return best;
  }
  return '1/1';
}

function normalizeTransparent(value, type) {
  if (typeof value === 'boolean') return value;
  return type === 'icon' || type === 'button' || type === 'item' || type === 'effect';
}

function buildFallbackPrompt({ name, type, description }) {
  return [
    `Standalone game UI asset: ${name}.`,
    `Asset type: ${type}.`,
    description ? `Visual description: ${description}.` : '',
    'Clean production-ready render, no text watermark, preserve original style.',
  ].filter(Boolean).join(' ');
}

module.exports = LayoutDetector;
