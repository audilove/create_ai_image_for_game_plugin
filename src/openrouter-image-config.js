'use strict';

/**
 * Параметры верхнего уровня OpenRouter `image_config` для экономии токенов / разрешения.
 * @see https://openrouter.ai/docs/features/multimodal/image-generation
 */

const SCALE_TO_IMAGE_SIZE = {
  '0.5': '0.5K',
  '1': '1K',
  '2': '2K',
};

/** Соотношение в формате «16/9» → значение OpenRouter «16:9». */
const SLASH_TO_OPENROUTER = new Map([
  ['1/1', '1:1'],
  ['16/9', '16:9'],
  ['9/16', '9:16'],
  ['4/3', '4:3'],
  ['3/4', '3:4'],
  ['3/2', '3:2'],
  ['2/3', '2:3'],
  ['21/9', '21:9'],
  // 2/1 в доке OpenRouter как отдельное поле не указано — не передаём aspect_ratio
]);

/**
 * @param {string} aspectRatio - например '16/9'
 * @param {string} [resolutionScale='1'] - '0.5' | '1' | '2'
 * @returns {{ aspect_ratio?: string, image_size: string }}
 */
function buildOpenRouterImageConfig(aspectRatio, resolutionScale = '1') {
  const scale =
    resolutionScale === undefined || resolutionScale === null || resolutionScale === ''
      ? '1'
      : String(resolutionScale);
  const imageSize = SCALE_TO_IMAGE_SIZE[scale] || '1K';

  const cfg = { image_size: imageSize };
  const ar = aspectRatio ? SLASH_TO_OPENROUTER.get(aspectRatio) : null;
  if (ar) cfg.aspect_ratio = ar;
  return cfg;
}

module.exports = {
  buildOpenRouterImageConfig,
};
