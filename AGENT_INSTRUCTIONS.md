# Game Image Generator — Agent Instructions

> **READ THIS FIRST.** This document tells you (the AI agent) exactly how to use the `GameImageGenerator` plugin to produce game assets. Follow these instructions precisely for best results.

---

## 1. What This Plugin Does

`GameImageGenerator` generates production-ready game assets using AI (Google Gemini via OpenRouter). You pass a description + parameters, and receive a saved `.webp` file you can immediately use in the game.

The plugin automatically:
- Loads style reference images from the `reference/` folder and sends them to the model on every request
- Injects a base Pixar-3D art style context into every generation
- Removes backgrounds via professional AI service (remove.bg or Replicate) when `transparent: true`
- Outputs **1080p WebP** for backgrounds and illustrations, **1024px WebP** for icons and UI elements
- Returns the saved file path + base64 for immediate use

---

## 2. Setup (One Time)

```bash
npm install
```

Required `.env` variables:

```
# Image generation (required)
OPENROUTER_API_KEY=sk-or-...

# Background removal — choose one (required for transparent: true)
REPLICATE_API_TOKEN=r8_...       # Replicate RMBG (best quality, ~$0.003/image)
REMOVE_BG_API_KEY=...            # remove.bg (50 free/month, fallback)
```

The plugin auto-detects which removal service to use: Replicate → remove.bg → none.

---

## 3. Quick Reference — All Parameters

```javascript
const result = await gen.generate({
  // REQUIRED
  prompt: string,         // Describe what to generate in detail

  // OPTIONAL
  type: string,           // Asset type (see §4)
  aspectRatio: string,    // Canvas ratio (see §5)
  transparent: boolean,   // true = remove background, alpha channel (default: false)
  context: string,        // Game context: genre, theme, mood
  style: string,          // Extra style modifiers
  filename: string,       // Custom filename (no extension, saved as .webp)
  extra: object,          // Any extra key-value hints passed into prompt
});
```

### Return value

```javascript
{
  path: '/absolute/path/to/output/file.webp',
  base64: '...',              // Base64-encoded WebP
  dataUrl: 'data:image/webp;base64,...',
  mimeType: 'image/webp',
  width: 1920,                // 1920×1080 for background 16/9; 1024×1024 for icon 1/1
  height: 1080,
  transparent: false,
  type: 'background',
  aspectRatio: '16/9',
  prompt: '...',
  referenceCount: 3,
}
```

---

## 4. Asset Types (`type`)

| Value           | Output size      | Use Case |
|-----------------|------------------|----------|
| `icon`          | 1024 × 1024      | Inventory items, skills, buffs — small isolated objects |
| `background`    | **1080p HD**     | Level backgrounds, menu screens, parallax layers |
| `illustration`  | **1080p HD**     | Story scenes, cutscenes, loading screens |
| `button`        | 1024 × 1024      | UI buttons, menu elements |
| `character`     | 682 × 1024       | Player, NPC, enemy portraits or full body |
| `item`          | 1024 × 1024      | In-world pickups, collectibles |
| `tile`          | 1024 × 1024      | Repeating terrain/environment tiles |
| `card`          | 768 × 1024       | Card game art, collectible card face |
| `effect`        | 1024 × 1024      | Particle effects, auras, spells |

> `background` and `illustration` are automatically upscaled to 1080p using Lanczos3 and `cover` fit (fills the entire frame, no letterboxing).

**Rule:** Always specify `type`. It changes dimensions, composition hints, and style instructions.

---

## 5. Aspect Ratios (`aspectRatio`)

### Standard types (icon, button, character, item, tile, card, effect)

| Value   | Pixels        | Use Case |
|---------|---------------|----------|
| `1/1`   | 1024 × 1024   | Icons, cards, avatars |
| `16/9`  | 1024 × 576    | Wide UI panels |
| `9/16`  | 576 × 1024    | Portrait UI |
| `4/3`   | 1024 × 768    | Classic screen |
| `3/4`   | 768 × 1024    | Tall cards |
| `2/3`   | 682 × 1024    | Character portraits |
| `2/1`   | 1024 × 512    | Wide banners |

### HD types (background, illustration) — 1080p output

| Value   | Pixels         | Use Case |
|---------|----------------|----------|
| `1/1`   | 1080 × 1080    | Square scene |
| `16/9`  | **1920 × 1080**| Standard widescreen background |
| `9/16`  | **1080 × 1920**| Mobile portrait background |
| `4/3`   | 1440 × 1080    | Classic game screen |
| `3/4`   | 1080 × 1440    | Tall portrait scene |
| `21/9`  | 2520 × 1080    | Ultra-wide panorama |
| `2/1`   | 2160 × 1080    | Super-wide banner |

---

## 6. Transparency (`transparent`)

- `transparent: false` *(default)* — solid background
- `transparent: true` — AI removes background, returns WebP with alpha channel

Background removal uses a professional AI service automatically. If both API keys are present, Replicate takes priority and falls back to remove.bg on insufficient credits.

**When to use transparent:**

| Type | transparent |
|------|-------------|
| `icon` | **always true** |
| `button` | **always true** |
| `effect` | **always true** |
| `character` | usually true |
| `item` | usually true |
| `card` | depends |
| `background` | **always false** |
| `illustration` | **always false** |
| `tile` | false |

---

## 7. Writing Good Prompts

### Structure:
```
[SUBJECT] + [VISUAL DETAILS] + [MOOD/ATMOSPHERE]
```

### Examples by type:

**Icon — health potion:**
```javascript
{
  prompt: "A round glass bottle filled with glowing crimson liquid, golden cork stopper, magical sparkles floating around it, warm red glow",
  type: "icon",
  aspectRatio: "1/1",
  transparent: true,
}
```

**Background — forest level:**
```javascript
{
  prompt: "Ancient enchanted forest at dusk, massive twisted oak trees with glowing purple runes, bioluminescent mushrooms, cinematic god rays through canopy",
  type: "background",
  aspectRatio: "16/9",
  transparent: false,
  context: "2D side-scrolling platformer, dark fantasy",
  style: "painterly, cinematic lighting, rich depth",
}
```

**Character — warrior:**
```javascript
{
  prompt: "Female warrior in dark plate armor with golden trim, battle-worn, fierce expression, holding a rune-etched sword, neutral standing pose",
  type: "character",
  aspectRatio: "2/3",
  transparent: true,
  context: "Mobile RPG, stylized anime-adjacent art",
}
```

**UI Button — attack:**
```javascript
{
  prompt: "Shield-shaped attack button, red gem in center, metallic border with engravings, slight glow effect",
  type: "button",
  aspectRatio: "1/1",
  transparent: true,
}
```

**Illustration — story cutscene:**
```javascript
{
  prompt: "Hero standing at the gates of a ruined ancient city, dramatic sunset behind, silhouette composition, epic scale",
  type: "illustration",
  aspectRatio: "16/9",
  transparent: false,
  style: "cinematic, high contrast, movie poster feel",
}
```

### Prompt Best Practices:
- Be **specific** about materials, colors, and mood
- Mention **lighting**: "warm orange torchlight", "cold moonlight", "top-down directional light"
- Mention **camera/view**: "top-down", "isometric", "side view", "front-facing", "3/4 angle"
- Use **art style adjectives**: "smooth 3D render", "Pixar-style", "cel-shaded"
- For items: specify **size impression** — "small thumb-sized bottle" vs "massive ornate chest"
- For backgrounds: mention **depth layers** — "foreground, midground, background"

---

## 8. Using Context and Style

```javascript
// context: describes the game world — helps the model stay on-brand
context: "Dark fantasy mobile RPG, inspired by Diablo. Gritty but colorful, premium Pixar-style 3D."

// style: direct art direction on top of references
style: "cel-shaded outlines, high saturation, smooth 3D materials, gold accent highlights"
```

---

## 9. Reference Images

Place style reference images in the `reference/` folder. Supported: `.jpg`, `.jpeg`, `.png`, `.webp`

The plugin automatically loads up to 4 reference images and sends them to the model with every generation request. The model matches their color palette, shading technique, and detail level.

**Best practices:**
- Use 2–4 images from the same game or art direction
- Mix subjects (character + item + background) so the model learns the **style**, not the content
- Prefer clean images without UI overlays or watermarks
- Call `gen.reloadReferences()` after adding new files to clear the cache

---

## 10. Programmatic Usage

### Basic usage

```javascript
const GameImageGenerator = require('./src/index');

const gen = new GameImageGenerator({
  apiKey: process.env.OPENROUTER_API_KEY,
  outputDir: './assets/generated',
  referenceDir: './reference',
  webpQuality: 90,
});

const result = await gen.generate({
  prompt: 'A glowing magical sword with blue flames',
  type: 'icon',
  aspectRatio: '1/1',
  transparent: true,
  context: 'Fantasy RPG mobile game',
});

console.log('Saved to:', result.path);
console.log('Size:', result.width, 'x', result.height);
```

### Check plugin status

```javascript
console.log(gen.info());
// {
//   model: 'google/gemini-3.1-flash-image-preview',
//   outputDir: '/absolute/path/output',
//   referenceDir: '/absolute/path/reference',
//   referenceImagesLoaded: 3,
//   referenceImages: ['ref1.jpg', 'ref2.png', 'ref3.webp'],
//   supportedAspectRatios: ['1/1', '16/9', ...],
//   supportedTypes: ['icon', 'background', ...]
// }
```

---

## 11. Constructor Options

```javascript
new GameImageGenerator({
  apiKey: string,              // OpenRouter key (or OPENROUTER_API_KEY env var)
  model: string,               // Default: 'google/gemini-3.1-flash-image-preview'
  outputDir: string,           // Default: './output'
  referenceDir: string,        // Default: './reference'
  webpQuality: number,         // 1–100, default: 90
  maxReferenceImages: number,  // Max refs to include, default: 4
  saveOutput: boolean,         // Save to disk, default: true
  baseContext: string,         // Override built-in Pixar-3D art context
  requestTimeout: number,      // ms, default: 120000
  // Background removal:
  bgRemovalService: string,    // 'replicate' | 'removebg' | 'none' (auto-detected)
  replicateApiToken: string,   // Override REPLICATE_API_TOKEN env var
  removeBgApiKey: string,      // Override REMOVE_BG_API_KEY env var
  bgRemovalTimeout: number,    // ms, default: 60000
})
```

---

## 12. Integrating Into a Game Project

1. Copy the `CreateImage/` folder into your project
2. `npm install` inside it
3. Add API keys to `.env`
4. Add style references to `reference/`
5. `require('./CreateImage/src/index')` and call `gen.generate(...)`
6. Use `result.path` directly in your asset manifest or copy step

---

## 13. Common Mistakes to Avoid

| Mistake | Fix |
|---------|-----|
| `transparent: true` for backgrounds | Backgrounds are **always** `transparent: false` |
| Vague prompts like "a sword" | Be specific: "fantasy broadsword, runic engravings, glowing blue edge, golden hilt" |
| Wrong type for the asset | Always set `type` — it controls dimensions and composition |
| Not setting `context` | Always add game genre/theme for consistent style |
| `transparent: true` without a removal API key | Add `REPLICATE_API_TOKEN` or `REMOVE_BG_API_KEY` to `.env` |
| Generating many assets in parallel | Generate **sequentially** — APIs have rate limits |

---

## 14. Output Dimensions Reference

| type | aspectRatio | Output |
|------|-------------|--------|
| background | 16/9 | 1920 × 1080 |
| background | 9/16 | 1080 × 1920 |
| background | 4/3 | 1440 × 1080 |
| background | 1/1 | 1080 × 1080 |
| illustration | 16/9 | 1920 × 1080 |
| illustration | 4/3 | 1440 × 1080 |
| icon | 1/1 | 1024 × 1024 |
| character | 2/3 | 682 × 1024 |
| button | 1/1 | 1024 × 1024 |

---

## 15. Error Handling

```javascript
try {
  const result = await gen.generate({ prompt: '...' });
} catch (err) {
  if (err.message.includes('API error 401'))
    // Check OPENROUTER_API_KEY
  if (err.message.includes('timed out'))
    // Increase requestTimeout option
  if (err.message.includes('Could not extract image'))
    // Model returned no image — retry or rephrase prompt
  if (err.message.includes('REPLICATE_API_TOKEN') || err.message.includes('REMOVE_BG_API_KEY'))
    // Background removal API key missing — add to .env
}
```

---

*This plugin is designed for AI-assisted game development. The agent reading this document should use it to autonomously generate all game assets matching the project's art direction.*
