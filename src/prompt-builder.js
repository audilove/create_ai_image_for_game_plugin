'use strict';

const { BASE_CONTEXT, TYPE_PROMPTS, ASPECT_RATIOS, DEFAULTS } = require('./config');

/**
 * Builds the full prompt and message payload for the OpenRouter API call.
 */
class PromptBuilder {
  /**
   * @param {object} params
   * @param {string} params.prompt       - Main description of what to generate
   * @param {string} params.type         - Asset type: icon, background, illustration, etc.
   * @param {string} params.aspectRatio  - e.g. "1/1", "16/9"
   * @param {boolean} params.transparent - Whether to generate with transparent background
   * @param {string} [params.context]    - Additional project context (game genre, theme, etc.)
   * @param {string} [params.style]      - Extra style instructions
   * @param {object} [params.extra]      - Any additional prompt modifiers
   * @param {Array}  referenceImages     - Loaded reference image objects
   * @param {string} [customBaseContext] - Override the built-in base context
   */
  build(params, referenceImages = [], customBaseContext = null) {
    const {
      prompt,
      type = DEFAULTS.defaultType,
      aspectRatio = DEFAULTS.defaultAspectRatio,
      transparent = false,
      context = '',
      style = '',
      extra = {},
    } = params;

    const refs = Array.isArray(referenceImages) ? referenceImages : [];

    const dimensions = ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS['1/1'];
    const typeHints = TYPE_PROMPTS[type] || TYPE_PROMPTS['icon'];
    const baseContext = customBaseContext || BASE_CONTEXT;

    const systemText = this._buildSystemText(baseContext, context);
    const userText = this._buildUserText({
      prompt,
      type,
      aspectRatio,
      dimensions,
      transparent,
      typeHints,
      style,
      extra,
      hasReferences: refs.length > 0,
    });

    const contentParts = this._buildContentParts(userText, refs);

    return {
      systemText,
      userText,
      contentParts,
      dimensions,
    };
  }

  _buildSystemText(baseContext, projectContext) {
    let text = baseContext;

    if (projectContext && projectContext.trim()) {
      text += `\n\nPROJECT CONTEXT:\n${projectContext.trim()}`;
    }

    return text;
  }

  _buildUserText({ prompt, type, aspectRatio, dimensions, transparent, typeHints, style, extra, hasReferences = true }) {
    const lines = [];

    lines.push(`TASK: Generate a game asset.`);
    lines.push(`DESCRIPTION: ${prompt}`);
    lines.push(`ASSET TYPE: ${type}`);
    lines.push(`CANVAS SIZE: ${dimensions.width}x${dimensions.height}px (aspect ratio ${aspectRatio})`);
    lines.push(
      `TRANSPARENT BACKGROUND: ${transparent
        ? 'YES — render object on a clean, solid, high-contrast background for best background removal (do NOT blend subject with background)'
        : 'NO — render with appropriate background'}`
    );

    if (typeHints.length > 0) {
      lines.push(`\nTYPE-SPECIFIC REQUIREMENTS:`);
      typeHints.forEach(hint => lines.push(`  - ${hint}`));
    }

    if (style && style.trim()) {
      lines.push(`\nSTYLE NOTES: ${style.trim()}`);
    }

    if (extra && Object.keys(extra).length > 0) {
      lines.push(`\nADDITIONAL PARAMETERS:`);
      Object.entries(extra).forEach(([k, v]) => lines.push(`  - ${k}: ${v}`));
    }

    if (hasReferences) {
      lines.push(`\nCRITICAL: Reference images are mandatory. Use them as the primary visual source and reproduce their style as closely as possible (palette, lighting, materials, rendering, and level of detail).`);
    } else {
      lines.push(`\nNOTE: No reference images are provided. Follow the BASE STYLE rules from the system prompt (Pixar-style 3D, vibrant saturated colors, soft glows, polished materials) and any STYLE NOTES above.`);
    }

    if (transparent) {
      lines.push(`\nCRITICAL: For background-removal workflow, place the ${type} on a flat, contrasting backdrop (for example bright green/blue/magenta opposite to the subject colors). Keep hard separation and avoid haze, shadows, gradients, or color spill into the subject edges.`);
    }

    lines.push(`\nPlease generate the image now following all the rules above and matching the reference images as closely as possible.`);

    return lines.join('\n');
  }

  _buildContentParts(userText, referenceImages) {
    const parts = [];

    if (referenceImages.length > 0) {
      parts.push({
        type: 'text',
        text: `Here are ${referenceImages.length} reference image(s) showing the desired art style. Match this style closely:`,
      });

      referenceImages.forEach((ref, i) => {
        parts.push({
          type: 'image_url',
          image_url: {
            url: `data:${ref.mimeType};base64,${ref.base64}`,
            detail: 'high',
          },
        });
        if (ref.filename) {
          parts.push({
            type: 'text',
            text: `(Reference ${i + 1}: ${ref.filename})`,
          });
        }
      });
    }

    parts.push({
      type: 'text',
      text: userText,
    });

    return parts;
  }
}

module.exports = PromptBuilder;
