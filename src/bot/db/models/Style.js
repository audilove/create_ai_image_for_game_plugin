'use strict';

const { Schema, model } = require('mongoose');

const fileSchema = new Schema(
  {
    filename: { type: String, required: true },
    mimeType: { type: String, default: 'image/jpeg' },
    data: { type: Buffer, required: true },
    size: { type: Number, default: 0 },
  },
  { _id: false },
);

const styleSchema = new Schema(
  {
    userId: { type: Number, required: true, index: true },
    styleId: { type: String, required: true },
    name: { type: String, required: true },
    files: { type: [fileSchema], default: [] },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'styles' },
);

styleSchema.index({ userId: 1, styleId: 1 }, { unique: true });

module.exports = model('Style', styleSchema);
