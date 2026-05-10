'use strict';

const { Schema, model } = require('mongoose');

const imageGenModelRow = new Schema(
  {
    id: { type: String, required: true },
    slug: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const userPrefsSchema = new Schema(
  {
    userId: { type: Number, required: true, unique: true, index: true },
    imageGenModels: { type: [imageGenModelRow], default: [] },
    activeImageGenModelId: { type: String, default: null },
    imageGenResolutionScale: { type: String, default: '1' },
  },
  { collection: 'user_prefs', timestamps: true },
);

module.exports = model('UserPrefs', userPrefsSchema);
