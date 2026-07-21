const mongoose = require('mongoose');

const ApiKeySchema = new mongoose.Schema(
  {
    org_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Org',
      required: true,
    },
    key_hash: {
      type: String,
      required: true,
      unique: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    scopes: {
      type: [String],
      enum: ['read:devices', 'read:readings', 'write:commands'],
      default: ['read:devices', 'read:readings'],
    },
    rate_limit_rpm: {
      type: Number,
      default: 60,
    },
    last_used: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

ApiKeySchema.index({ org_id: 1 });

module.exports = mongoose.model('ApiKey', ApiKeySchema);
