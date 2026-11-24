const mongoose = require('mongoose');

// Persistent store for LoRa mesh traffic. Previously these lived in in-memory
// arrays, so SOS history and queued downlinks were lost on every restart and
// could not be shared between server instances.
const MeshMessageSchema = new mongoose.Schema(
  {
    direction: { type: String, enum: ['uplink', 'downlink'], required: true },
    gateway_id: { type: String, default: '' },
    device_id: { type: String, default: '' },
    origin_node: { type: Number, default: 0 },
    target_node: { type: Number, default: 0 },
    message_type: { type: String, default: 'text' },
    text: { type: String, default: '' },
    alert_level: { type: Number, default: 0 },
    battery_mv: { type: Number, default: 0 },
    hops_left: { type: Number, default: 0 },
    rssi: { type: Number, default: 0 },
    snr: { type: Number, default: 0 },
    // Parsed from the text conventions (see services/meshText.js)
    kind: { type: String, enum: ['msg', 'loc', 'sos', 'sos_cancel', 'heartbeat'], default: 'msg' },
    sos_type: { type: String, default: null },
    lat: { type: Number, default: null },
    lon: { type: Number, default: null },
    acc: { type: Number, default: null },
    // Downlink outbox state: delivered = the gateway transmitted it over LoRa;
    // confirmed = the target walkie sent an ACK back (direct messages only)
    delivered: { type: Boolean, default: false },
    delivery_attempts: { type: Number, default: 0 },
    confirmed: { type: Boolean, default: false },
    confirmed_by: { type: Number, default: null },
    confirmed_at: { type: Date, default: null },
    timestamp: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

MeshMessageSchema.index({ timestamp: -1 });
MeshMessageSchema.index({ direction: 1, delivered: 1, timestamp: 1 });
MeshMessageSchema.index({ origin_node: 1, timestamp: -1 });
// Keep 90 days of mesh traffic
MeshMessageSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

module.exports = mongoose.model('MeshMessage', MeshMessageSchema);
