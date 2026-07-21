const mongoose = require('mongoose');

const ReadingSchema = new mongoose.Schema(
  {
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
    },
    device_id: {
      type: String,
      required: true,
    },
    org_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Org',
      required: true,
    },
    device_type: {
      type: String,
      required: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
  },
  {
    timeseries: {
      timeField: 'timestamp',
      metaField: 'device_id',
      granularity: 'seconds',
    },
    autoCreate: true, // Crucial for auto-creating timeseries collection if it doesn't exist
  }
);

// We can add compound indexes to speed up historical ranges for specific devices and orgs
ReadingSchema.index({ org_id: 1, timestamp: -1 });

module.exports = mongoose.model('Reading', ReadingSchema);
