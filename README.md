# GameImageGenerator

AI-powered game asset generator plugin for Node.js. Built for use with AI coding agents — pass a prompt + parameters, get a production-ready WebP game asset.

**Powered by:** OpenRouter + Google Gemini image generation

---

## Features

- WebP output with optional **alpha channel (transparency)**
- **Style reference store** — drop images into `reference/`, the model will match their style automatically
- All aspect ratios: `1/1`, `16/9`, `9/16`, `4/3`, `3/4`, `2/3`, `21/9`, `2/1`, `3/2`
- Asset types: `icon`, `background`, `illustration`, `button`, `character`, `item`, `tile`, `card`, `effect`
- Built-in art rules context injected into every request
- Lightweight, zero-config, easy to embed in any project

---

## Installation

```bash
npm install
cp .env.example .env
# Add your OPENROUTER_API_KEY to .env
# Add REPLICATE_API_TOKEN for AI background removal (recommended)
```

## Background Removal

When `transparent: true`, the plugin uses a professional AI service to remove backgrounds. This gives pixel-perfect results — correct hair, fine details, complex edges.

For best cutout quality, generate the subject on a flat high-contrast background (opposite to subject colors). This minimizes edge artifacts during background removal.

### Option A — Replicate + BRIA-RMBG-2.0 (recommended)

Best quality. Uses a state-of-the-art semantic segmentation model.

1. Get token: https://replicate.com/account/api-tokens
2. Add to `.env`: `REPLICATE_API_TOKEN=r8_...`
3. Cost: ~$0.003 per image

### Option B — remove.bg

Reliable, fast, widely used.

1. Get key: https://www.remove.bg/api
2. Add to `.env`: `REMOVE_BG_API_KEY=...`
3. Cost: 50 free/month

The plugin auto-detects which service to use based on which env var is set. Replicate takes priority if both are present.

---

## Quick Start

```javascript
const GameImageGenerator = require('./src/index');

const gen = new GameImageGenerator({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const result = await gen.generate({
  prompt: 'A glowing health potion bottle with red liquid',
  type: 'icon',
  aspectRatio: '1/1',
  transparent: true,
  context: 'Fantasy RPG mobile game',
});

console.log(result.path);    // ./output/icon_1-1_a-glowing-health-potion_1234567890.webp
console.log(result.base64);  // base64 string for inline use
```

### Batch generation (parallel)

```javascript
const requests = [
  { prompt: 'Magic sword with blue flame', type: 'icon', aspectRatio: '1/1', transparent: true },
  { prompt: 'Ancient shield with runes', type: 'icon', aspectRatio: '1/1', transparent: true },
  { prompt: 'Gold treasure chest', type: 'item', aspectRatio: '1/1', transparent: true },
];

const results = await gen.generateBatch(requests, {
  concurrency: 10,      // process up to 10 requests in parallel
  continueOnError: true // keep processing even if one request fails
});
```

---

## Parameters

| Parameter     | Type    | Default   | Description |
|---------------|---------|-----------|-------------|
| `prompt`      | string  | required  | What to generate |
| `type`        | string  | `icon`    | `icon` \| `background` \| `illustration` \| `button` \| `character` \| `item` \| `tile` \| `card` \| `effect` |
| `aspectRatio` | string  | `1/1`     | `1/1` \| `16/9` \| `9/16` \| `4/3` \| `3/4` \| `3/2` \| `2/3` \| `21/9` \| `2/1` |
| `transparent` | boolean | `false`   | Generate with transparent background (alpha channel) |
| `context`     | string  | —         | Game/project context passed to the model |
| `style`       | string  | —         | Extra style instructions |
| `filename`    | string  | auto      | Custom filename for output (without extension) |
| `extra`       | object  | —         | Any extra key-value prompt modifiers |

Also available:

- `generateBatch(requests, options)` — runs multiple generation requests in parallel.

---

## Style References

Place reference images in the `reference/` folder:

```
reference/
  hero_concept.jpg
  ui_example.png
  background_style.webp
```

The plugin loads up to 4 reference images and sends them to the model with every generation request. The model matches their art style automatically.

References are required for consistent generations, and outputs should stay as close as possible to reference style (lighting, palette, materials, and rendering quality).

Supported formats: `.jpg`, `.jpeg`, `.png`, `.webp`

---

## Constructor Options

```javascript
const gen = new GameImageGenerator({
  apiKey: string,              // OpenRouter API key (or OPENROUTER_API_KEY env var)
  model: string,               // Default: 'google/gemini-2.0-flash-exp:free'
  outputDir: string,           // Default: './output'
  referenceDir: string,        // Default: './reference'
  webpQuality: number,         // 1–100, default: 90
  maxReferenceImages: number,  // Max refs to include, default: 4
  saveOutput: boolean,         // Save to disk, default: true
  baseContext: string,         // Override built-in art context
  requestTimeout: number,      // ms, default: 120000
  maxConcurrentGenerations: number, // default parallel workers for generateBatch(), default: 4
  siteUrl: string,             // Your site for OpenRouter rankings
  siteName: string,            // Your site name
});
```

---

## Examples

```bash
# Run demo (requires .env with OPENROUTER_API_KEY)
node examples/demo.js

# Test API connection
node examples/test-api.js
```

---

## For AI Agents

See [AGENT_INSTRUCTIONS.md](./AGENT_INSTRUCTIONS.md) for detailed usage instructions formatted for AI coding agents.

---

## Output

Generated images are saved to `./output/` with auto-generated filenames:

```
output/
  icon_1-1_health-potion_1748300000000.webp
  background_16-9_enchanted-forest_1748300001000.webp
  warrior_portrait.webp
```

The `generate()` method returns:

```javascript
{
  path: '/absolute/path/output/icon_1-1_...webp',
  base64: '...',
  dataUrl: 'data:image/webp;base64,...',
  mimeType: 'image/webp',
  width: 1024,
  height: 1024,
  transparent: true,
  type: 'icon',
  aspectRatio: '1/1',
  prompt: '...',
  referenceCount: 3,
}
```
