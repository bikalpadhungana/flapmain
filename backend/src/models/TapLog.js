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
    // Raw device key, kept only when an edge node must pass it through to the
    // legacy VPS. Never returned by queries unless explicitly selected.
    api_key: {
      type: String,
      default: '',
      select: false,
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
    // Cardholder public profile from the Flap Card API (check-uid lookup)
    holder: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    // ok | lost | defective | unknown | unverified
    lookupStatus: {
      type: String,
      default: '',
    },
    lookupMessage: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

TapLogSchema.index({ timestamp: -1 });
// Store-and-forward worker scans for unsynced taps every 10s
TapLogSchema.index({ forwardedMain: 1, timestamp: 1 });

module.exports = mongoose.model('TapLog', TapLogSchema);
