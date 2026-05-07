'use strict';

/**
 * Demo — generates a player profile icon.
 * Run: node examples/demo.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const GameImageGenerator = require('../src/index');

async function run() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('ERROR: Set OPENROUTER_API_KEY in .env file');
    process.exit(1);
  }

  const gen = new GameImageGenerator({
    apiKey,
    outputDir: './output',
    referenceDir: './reference',
    webpQuality: 92,
  });

  const info = gen.info();
  console.log('\n=== GameImageGenerator ===');
  console.log('Model          :', info.model);
  console.log('References     :', info.referenceImagesLoaded, info.referenceImages.join(', ') || '(none)');
  console.log('Output dir     :', info.outputDir);
  console.log('=========================\n');

  console.log('Generating profile icon...');

  const result = await gen.generate({
    prompt:
      'Friendly male game character avatar, young hero with spiky hair, ' +
      'wearing a purple and gold fantasy hood/cape, confident smile, ' +
      'glowing amber eyes, framed inside a circular portrait border with golden ornate details, ' +
      'soft purple background with bokeh glow',
    type: 'icon',
    aspectRatio: '1/1',
    transparent: true,
    context: 'Mobile RPG — player profile picture shown in the HUD top-left corner',
    filename: 'profile_icon_demo',
  });

  console.log('✓ Done!');
  console.log('  Saved to :', result.path);
  console.log('  Size     :', result.width, '×', result.height);
  console.log('  Format   :', result.mimeType);
  console.log('  Refs used:', result.referenceCount);
}

run().catch(err => {
  console.error('Generation failed:', err.message);
  process.exit(1);
});
