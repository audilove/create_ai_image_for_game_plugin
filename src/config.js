'use strict';

/**
 * Default configuration for the Game Image Generator plugin.
 * All values can be overridden when instantiating ImageGenerator.
 */

/** Standard dimensions — icons, buttons, characters, UI elements */
const ASPECT_RATIOS = {
  '1/1': { width: 1024, height: 1024 },
  '16/9': { width: 1024, height: 576 },
  '9/16': { width: 576, height: 1024 },
  '4/3': { width: 1024, height: 768 },
  '3/4': { width: 768, height: 1024 },
  '3/2': { width: 1024, height: 682 },
  '2/3': { width: 682, height: 1024 },
  '21/9': { width: 1024, height: 439 },
  '2/1': { width: 1024, height: 512 },
};

/**
 * HD dimensions — backgrounds and full-scene illustrations (1080p base).
 * The model generates at its native resolution; sharp upscales to these targets.
 */
const HD_ASPECT_RATIOS = {
  '1/1': { width: 1080, height: 1080 },
  '16/9': { width: 1920, height: 1080 },
  '9/16': { width: 1080, height: 1920 },
  '4/3': { width: 1440, height: 1080 },
  '3/4': { width: 1080, height: 1440 },
  '3/2': { width: 1620, height: 1080 },
  '2/3': { width: 720, height: 1080 },
  '21/9': { width: 2520, height: 1080 },
  '2/1': { width: 2160, height: 1080 },
};

/** Asset types that should use HD_ASPECT_RATIOS */
const HD_TYPES = new Set(['background', 'illustration', 'prototype_9_16', 'prototype_16_9']);

/** Asset types that should fill the full canvas (cover) instead of contain. */
const FULLBLEED_TYPES = new Set(['background', 'illustration', 'prototype_9_16', 'prototype_16_9']);

/** Locked aspect ratios — for these types the user can't override. */
const LOCKED_ASPECT_RATIOS = {
  prototype_9_16: '9/16',
  prototype_16_9: '16/9',
};

/** Type-specific prompt supplements */
const TYPE_PROMPTS = {
  icon: [
    'single centered isolated object',
    'game icon style',
    'crisp clean edges',
    'no background elements',
    'suitable for UI inventory slot',
  ],
  background: [
    'wide panoramic scene',
    'immersive game environment',
    'atmospheric lighting',
    'rich detailed world',
    'no UI elements, no characters in foreground',
  ],
  illustration: [
    'detailed game illustration',
    'narrative scene',
    'rich composition',
    'cinematic framing',
  ],
  button: [
    'single UI button element',
    'game HUD style',
    'clean simple shape',
    'readable silhouette',
    'suitable for interface',
  ],
  character: [
    'full body or bust game character',
    'clear readable silhouette',
    'game art style proportions',
    'hero/npc pose',
  ],
  item: [
    'collectible game item',
    'single object centered',
    'clear shape and details',
    'suitable for in-game pickup',
  ],
  tile: [
    'seamlessly tileable texture',
    'game tile asset',
    'top-down or side-view perspective',
    'consistent lighting',
  ],
  card: [
    'portrait card layout',
    'game card art',
    'centered subject',
    'suitable for card game UI',
  ],
  effect: [
    'visual effect element',
    'particle or aura style',
    'high contrast against dark background',
    'dynamic energetic look',
  ],
  prototype_9_16: [
    'COMPLETE in-game UX/UI screen mockup in PORTRAIT 9:16 orientation (mobile phone game screen)',
    'fills the entire 9:16 canvas edge-to-edge — NO empty space, NO frames around the screen',
    'realistic in-game interface: top status bar (player avatar, currencies, energy / lives counter, settings cog)',
    'central content area showing the actual gameplay/menu described by the user',
    'bottom navigation or action bar with prominent CTA buttons',
    'visible HUD elements: counters, progress bars, level indicator, badges, notifications',
    'modern game UI design — chunky readable buttons, clear visual hierarchy, generous padding, drop shadows, glow accents',
    'consistent with the reference style; treat references as the visual brand for the game',
    'do NOT generate a single isolated icon or character — generate a FULL game screen with all UI chrome',
  ],
  prototype_16_9: [
    'COMPLETE in-game UX/UI screen mockup in LANDSCAPE 16:9 orientation (desktop / tablet game screen)',
    'fills the entire 16:9 canvas edge-to-edge — NO empty space, NO frames around the screen',
    'realistic in-game interface: top bar with player profile, currencies, settings, and notifications',
    'central content area showing the actual gameplay/menu described by the user',
    'side or bottom panels with action buttons, inventory, and HUD information',
    'visible HUD elements: counters, progress bars, level indicator, badges, mini-map (when relevant)',
    'modern game UI design — chunky readable buttons, clear visual hierarchy, generous padding, drop shadows, glow accents',
    'consistent with the reference style; treat references as the visual brand for the game',
    'do NOT generate a single isolated icon or character — generate a FULL game screen with all UI chrome',
  ],
};

/** Base context injected into every generation request */
const BASE_CONTEXT = `
You are a professional game artist assistant. Your role is to generate high-quality 3D game assets in Pixar animated style for mobile game UI.

VISUAL STYLE:
- Pixar 3D animated style for mobile game UI
- Vibrant luxurious fun aesthetic, rich saturated colors
- Smooth rounded shapes, organic and friendly forms
- Cinematic lighting with soft glows, rim lights, and deep shadows
- Expressive characters and objects with personality
- Premium feel — gold and purple accents where appropriate
- Soft glows, ambient occlusion, and polished surface materials
- High quality 3D render look — NOT flat 2D, NOT photorealistic — stylized 3D

CORE RULES FOR ALL ASSETS:
- Maintain consistent art style matching the provided reference images
- Use clean, readable silhouettes suitable for game use
- Apply game-appropriate color palettes (vibrant, saturated, readable at small sizes)
- Prioritize visual clarity — Pixar-style stylized 3D, not photorealism
- All assets must be production-ready: no watermarks, no text overlays, no borders
- Scale and compose the subject to fill the canvas appropriately for the type
- Lighting should be consistent and stylized (not photographic)

TRANSPARENCY RULES (when transparent=true):
- Generate the subject ONLY — zero background, fully transparent surroundings
- Subject edges must be clean and precise — no fringing, no halos, no anti-alias artifacts bleeding into transparent area
- The subject must be completely opaque itself; transparency applies to background only
- Output must be compatible with PNG alpha channel (RGBA)

STYLE CONSISTENCY:
- Reference images represent the desired visual style — match their color temperature, shading technique, outline style, and level of detail
- Do not mix radically different styles within one asset
- If multiple references are provided, blend them into a cohesive style
`.trim();

const DEFAULTS = {
  model: 'google/gemini-3.1-flash-image-preview',
  layoutDetectionModel: 'google/gemini-3.1-flash-lite',
  /**
   * OpenRouter тарифицирует запрос частично через max_tokens вывода.
   * Без явного значения многие модели подставляют очень высокий лимит (~65536),
   * что при малом балансе приводит к 402 insufficient credits.
   *
   * Переопределение: OPENROUTER_MAX_IMAGE_TOKENS, OPENROUTER_MAX_COMPLETION_TOKENS.
   */
  maxImageOutputTokens: 32000,
  maxCompletionTokens: 8192,
  outputDir: './output',
  referenceDir: './reference',
  outputFormat: 'webp',
  webpQuality: 90,
  defaultAspectRatio: '1/1',
  defaultType: 'icon',
  maxReferenceImages: 4,
  referenceExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
  apiEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
  requestTimeout: 120000,
  maxConcurrentGenerations: 4,
};

module.exports = {
  ASPECT_RATIOS,
  HD_ASPECT_RATIOS,
  HD_TYPES,
  FULLBLEED_TYPES,
  LOCKED_ASPECT_RATIOS,
  TYPE_PROMPTS,
  BASE_CONTEXT,
  DEFAULTS,
};
