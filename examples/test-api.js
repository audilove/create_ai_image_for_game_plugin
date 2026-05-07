'use strict';

/**
 * Minimal API connectivity test.
 * Verifies the API key works before running a full generation.
 * Run: node examples/test-api.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');

async function testConnection() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('ERROR: OPENROUTER_API_KEY not set');
    process.exit(1);
  }

  console.log('Testing OpenRouter API connection...');

  try {
    const res = await axios.get('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 10000,
    });

    const models = res.data?.data || [];
    const imageModels = models.filter(m =>
      m.id.includes('gemini') || m.id.includes('image') || m.id.includes('dall')
    );

    console.log('✓ API connection successful');
    console.log(`  Total models available: ${models.length}`);
    console.log('  Image-related models:');
    imageModels.slice(0, 10).forEach(m => console.log(`    - ${m.id}`));
  } catch (err) {
    if (err.response?.status === 401) {
      console.error('✗ Invalid API key. Check OPENROUTER_API_KEY');
    } else {
      console.error('✗ Connection failed:', err.message);
    }
    process.exit(1);
  }
}

testConnection().catch(console.error);
