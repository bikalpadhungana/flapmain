const mongoose = require('mongoose');

// Readings from a discovered (not yet claimed) device. Moved into Reading when
// the device is claimed; expire automatically after 7 days otherwise.
const PendingReadingSchema = new mongoose.Schema({
  discovered_id: { type: mongoose.Schema.Types.ObjectId, ref: 'DiscoveredNode', required: true, index: true },
  timestamp: { type: Date, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now, expires: 7 * 24 * 3600 },
});

module.exports = mongoose.model('PendingReading', PendingReadingSchema);
