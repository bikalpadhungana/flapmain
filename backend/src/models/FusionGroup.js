const mongoose = require('mongoose');

const FusionGroupSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    org_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Org',
      required: true,
    },
    // Array of device_id strings that belong to this group
    device_ids: {
      type: [String],
      default: [],
    },
    // Optional icon/color for UI display
    color: {
      type: String,
      default: '#6366f1',
    },
    icon: {
      type: String,
      default: 'cpu',
    },
  },
  {
    timestamps: true,
  }
);

FusionGroupSchema.index({ org_id: 1 });

module.exports = mongoose.model('FusionGroup', FusionGroupSchema);
