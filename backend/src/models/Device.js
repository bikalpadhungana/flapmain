const mongoose = require('mongoose');

const DeviceSchema = new mongoose.Schema(
  {
    device_id: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    org_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Org',
      required: true,
    },
    device_type: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    location: {
      type: String,
      default: '',
    },
    api_key_hash: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['online', 'offline'],
      default: 'offline',
    },
    last_seen: {
      type: Date,
      default: null,
    },
    activation_status: {
      type: String,
      enum: ['pending', 'active', 'suspended'],
      default: 'pending',
    },
    node_id: {
      type: Number,
      default: null,
      index: true,
    },
    aliases: {
      type: [String],
      default: [],
    },
    category: {
      type: String,
      default: 'Physical',
    },
    ip_address: {
      type: String,
      default: '',
    },
    min_usage: {
      type: String,
      default: '',
    },
    gateway_id: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
DeviceSchema.index({ org_id: 1 });
DeviceSchema.index({ device_type: 1, node_id: 1 });
DeviceSchema.index({ aliases: 1 });

module.exports = mongoose.model('Device', DeviceSchema);
