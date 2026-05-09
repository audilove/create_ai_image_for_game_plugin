'use strict';

const { Schema, model } = require('mongoose');

const paramsSchema = new Schema(
  {
    prompt: { type: String, required: true },
    type: { type: String, required: true },
    aspectRatio: { type: String, required: true },
    transparent: { type: Boolean, default: false },
    contextId: { type: String, default: null },
    contextLabel: { type: String, default: null },
    contextText: { type: String, default: null },
    styleId: { type: String, default: null },
    styleLabel: { type: String, default: null },
  },
  { _id: false },
);

const resultSchema = new Schema(
  {
    userId: { type: Number, required: true, index: true },
    resultId: { type: String, required: true },
    params: { type: paramsSchema, required: true },
    fileData: { type: Buffer, required: true },
    mimeType: { type: String, default: 'image/webp' },
    size: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'results' },
);

resultSchema.index({ userId: 1, resultId: 1 }, { unique: true });
resultSchema.index({ userId: 1, createdAt: -1 });

module.exports = model('Result', resultSchema);
