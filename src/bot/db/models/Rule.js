'use strict';

const { Schema, model } = require('mongoose');

const ruleSchema = new Schema(
  {
    userId: { type: Number, required: true, index: true },
    ruleId: { type: String, required: true },
    name: { type: String, required: true },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'rules' },
);

ruleSchema.index({ userId: 1, ruleId: 1 }, { unique: true });

module.exports = model('Rule', ruleSchema);
