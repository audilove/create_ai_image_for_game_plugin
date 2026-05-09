# GameImageGenerator

AI-powered game asset generator plugin for Node.js. Built for use with AI coding agents — pass a prompt + parameters, get a production-ready WebP game asset.

**Powered by:** OpenRouter + Google Gemini image generation

---

## Features

- WebP output with optional **alpha channel (transparency)**
- **Style reference store** — drop images into `reference/`, the model will match their style automatically
- All aspect ratios: `1/1`, `16/9`, `9/16`, `4/3`, `3/4`, `2/3`, `21/9`, `2/1`, `3/2`
- Asset types: `icon`, `background`, `illustration`, `button`, `character`, `item`, `tile`, `card`, `effect`
- Screenshot-to-assets pipeline: model detects UI elements, classifies types, writes prompts, then regenerates standalone assets
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
| `type`        | string  | `icon`    | `icon` \| `background` \| `illustration` \| `button` \| `character` \| `item` \| `tile` \| `card` \| `effect` \| `prototype_9_16` \| `prototype_16_9` |
| `aspectRatio` | string  | `1/1`     | `1/1` \| `16/9` \| `9/16` \| `4/3` \| `3/4` \| `3/2` \| `2/3` \| `21/9` \| `2/1` (locked to `9/16` for `prototype_9_16` and `16/9` for `prototype_16_9`) |
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

References are **strongly recommended** for consistent generations — outputs should stay as close as possible to reference style (lighting, palette, materials, and rendering quality). They are **not required**: if no references are provided (empty `reference/` folder, empty `params.references`, or `params.references: []`), the plugin falls back to the BASE_CONTEXT art rules only and the model produces a generic Pixar-style asset.

Supported formats: `.jpg`, `.jpeg`, `.png`, `.webp`

---

## Constructor Options

```javascript
const gen = new GameImageGenerator({
  apiKey: string,              // OpenRouter API key (or OPENROUTER_API_KEY env var)
  model: string,               // Default: 'google/gemini-2.0-flash-exp:free'
  layoutDetectionModel: string,// Default: 'google/gemini-2.5-flash'
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

You can also override detection model via env:
- `OPENROUTER_LAYOUT_DETECTION_MODEL=<model-id>`

---

## Examples

```bash
# Run demo (requires .env with OPENROUTER_API_KEY)
node examples/demo.js

# Test API connection
node examples/test-api.js
```

### UI layout detection (screenshot -> detected plan -> regenerated assets)

```javascript
const GameImageGenerator = require('./src/index');

const gen = new GameImageGenerator({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const detected = await gen.detectLayoutAssets({
  imagePath: './input/prototype-screen.png',
  hint: 'Mobile game shop screen. Extract all reusable UI elements.',
  maxAssets: 80,          // upper bound for detection planning
  maxGenerateAssets: 12,  // how many assets to regenerate
  minAssetSize: 12,
});

console.log(detected.totalDetected);
console.log(detected.totalGenerated);
console.log(detected.outputDir);     // output/detected_assets_<timestamp>
console.log(detected.manifestPath);  // output/detected_assets_<timestamp>/manifest.json
console.log(detected.assets[0]);     // first generated asset metadata
```

Result:
- The model returns a structured plan (asset types, prompts, bounding boxes).
- The plugin regenerates each asset directly via `generate()`.
- A `manifest.json` is generated with full list, prompts and metadata.

---

## For AI Agents

See [AGENT_INSTRUCTIONS.md](./AGENT_INSTRUCTIONS.md) for detailed usage instructions formatted for AI coding agents.

---

## Telegram Bot

Run the same plugin as a Telegram bot — useful for non-developer users (designers / game-designers) who just want to generate assets via chat.

### Setup

```bash
cp .env.example .env
# Set OPENROUTER_API_KEY, REPLICATE_API_TOKEN (optional for transparent BG),
# TELEGRAM_BOT_TOKEN — from @BotFather, and REDIS_URL for job queue.
# Optionally restrict access via TELEGRAM_ALLOWED_USER_IDS=123,456
npm run bot
```

### What's inside

- **🖼 Создать изображение** — wizard: prompt → context (rule, optional) → style (optional, can pick «🚫 Без стиля») → asset type → (for `background`: choose `16/9` or `9/16`) → (background transparency for non-prototype types). Result is sent **as a file** (`.webp`) so Telegram doesn't recompress it.
- **🎨 Мои стили** — create named styles by uploading up to 10 reference images each. The wizard uses one style as the visual reference, but you can also generate without any style.
- **📜 Правила для генерации** — saved text contexts (game world / brief / restrictions) injected into the prompt.

### Asset types

Standalone game assets:
- `🟢 icon` · `🌄 background` · `🖼 illustration` · `🔘 button` · `👤 character` · `⚔️ item` · `🧱 tile` · `🎴 card` · `✨ effect`

For `🌄 background`, the wizard now asks for orientation:
- `🖥 16/9` — landscape scene.
- `📱 9/16` — portrait mobile scene.

UX/UI screen prototypes (full game screens with HUD):
- `📱 Прототип 9/16` — portrait mobile screen (locked to 9:16, HD 1080×1920).
- `🖥 Прототип 16/9` — landscape / desktop screen (locked to 16:9, HD 1920×1080).

Prototype types render a **complete in-game screen** with all UI chrome (top bar, currencies, energy/lives, action buttons, HUD), based on the user's description. They never use background-removal — the wizard automatically skips the «with/without background» step.

### Buttons under every generated image

- **✏️ Изменить** — describe what to change → re-generate keeping the original asset type, aspect ratio, transparency and style. The previous image is fed back as the primary reference.
- **🧩 Объединить с картинкой** — upload an extra image, describe how to merge it. Both images plus the saved style are passed as references.
- **🔁 Перегенерировать** — re-run with the exact same params.
- **🆕 Генерировать новое** — start the 5-step wizard again.

### Storage

The bot supports two storage backends; pick one via `.env`.

#### MongoDB (recommended)

Set `MONGO_URI` in `.env` (e.g. `mongodb://localhost:27017/game-image-bot` or an Atlas URI). Collections:
- `styles` — `{ userId, styleId, name, files: [{ filename, mimeType, data: Buffer, size }], createdAt }`
- `rules` — `{ userId, ruleId, name, text, createdAt }`
- `results` — `{ userId, resultId, params, fileData: Buffer, mimeType, size, createdAt }` (image bytes inline; capped to last 100 per user)

Indexes:
- `(userId, styleId)` unique on `styles`
- `(userId, ruleId)` unique on `rules`
- `(userId, resultId)` unique + `(userId, createdAt)` on `results`

Spin up local Mongo (any way you like):

```bash
docker run -d --name mongo -p 27017:27017 -v mongo_data:/data/db mongo:7
```

#### JSON file (fallback / dev)

If `MONGO_URI` is empty, the bot falls back to JSON+filesystem storage under `./data/`:
- `data/users.json` — styles, rules and image metadata.
- `data/styles/<userId>/<styleId>/*.jpg` — reference images.
- `data/results/<userId>/<resultId>.webp` — generated WebP files.

Useful for local dev or tiny single-user deployments. Not recommended for production.

In both modes, `data/incoming/<userId>/*.jpg` keeps transient uploads from the «Combine» flow (cleaned automatically when the flow completes or the user cancels). Override the directory via `BOT_DATA_DIR=/path/to/data` in `.env`.

### Redis queue (async generation)

Image generation for Telegram flows runs through Redis-backed BullMQ jobs, so bot update handlers return immediately and do not wait for OpenRouter image completion.

Required env vars:
- `REDIS_URL` (default `redis://127.0.0.1:6379`)
- `GENERATION_QUEUE_NAME` (default `image-generation`)
- `GENERATION_QUEUE_CONCURRENCY` (default `2`)

### Embedding programmatically

```javascript
const GameImageGenerator = require('./src/index');
const createBot = require('./src/bot');

const generator = new GameImageGenerator({ apiKey: process.env.OPENROUTER_API_KEY, saveOutput: false });
const { bot } = createBot({
  token: process.env.TELEGRAM_BOT_TOKEN,
  generator,
  dataDir: './data',
  allowedUserIds: ['123456789'],
});

await bot.launch();
```

### New `generate()` parameters

The plugin's `generate()` now accepts two new optional parameters used by the bot — they're equally useful for any caller that wants per-request reference images instead of the global `reference/` folder:

| Parameter      | Type     | Description |
|----------------|----------|-------------|
| `references`   | `Array`  | Explicit reference list `[{ base64, mimeType, filename? }]`. When provided, the global `reference/` folder is ignored for this call. |
| `referenceDir` | `string` | Per-call directory of reference images. Loaded via the same `ReferenceLoader`. |

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
