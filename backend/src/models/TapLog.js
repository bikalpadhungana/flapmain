const mongoose = require('mongoose');

const TapLogSchema = new mongoose.Schema(
  {
    timestamp: {
      type: Date,
      default: Date.now,
    },
    uid: {
      type: String,
      required: true,
      index: true,
    },
    api_key: {
      type: String,
      default: '',
    },
    tag_type: {
      type: String,
      default: 'MIFARE',
    },
    type: {
      type: String,
      default: 'checkin',
    },
    flapid: {
      type: String,
      default: '',
    },
    device_id: {
      type: String,
      required: true,
      index: true,
    },
    business_id: {
      type: String,
      default: '',
    },
    forwardedLocal: {
      type: Boolean,
      default: false,
    },
    forwardedMain: {
      type: Boolean,
      default: false,
    },
    targetResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

TapLogSchema.index({ timestamp: -1 });

module.exports = mongoose.model('TapLog', TapLogSchema);
