const mongoose = require('mongoose');

// A device that sent data but is not registered yet. Shown in the dashboard
// under "Discovered devices" until an admin claims (adds) or ignores it.
const DiscoveredNodeSchema = new mongoose.Schema(
  {
    org_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Org', required: true },
    // device_id the sender used (for LoRa nodes the gateway derives it from the node number)
    reported_device_id: { type: String, required: true, trim: true },
    origin_node: { type: Number, default: null },
    device_type_guess: { type: String, default: '' },
    status: { type: String, enum: ['new', 'ignored'], default: 'new' },
    first_seen: { type: Date, default: Date.now },
    last_seen: { type: Date, default: Date.now },
    packet_count: { type: Number, default: 0 },
    last_payload: { type: mongoose.Schema.Types.Mixed, default: null },
    heard_by: {
      type: [{ _id: false, gateway_id: String, rssi: Number, snr: Number, last_seen: Date }],
      default: [],
    },
  },
  { timestamps: true }
);

DiscoveredNodeSchema.index({ org_id: 1, reported_device_id: 1 }, { unique: true });
DiscoveredNodeSchema.index({ org_id: 1, status: 1, last_seen: -1 });

module.exports = mongoose.model('DiscoveredNode', DiscoveredNodeSchema);
