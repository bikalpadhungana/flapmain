// Helpers for LoRa mesh telemetry arriving through one or more gateways:
// reading time, cross-gateway duplicate detection, "heard by" tracking and
// discovery of unregistered nodes.

const DiscoveredNode = require('../models/DiscoveredNode');
const PendingReading = require('../models/PendingReading');

// ─── Reading time ────────────────────────────────────────────────────────────
// Gateways may send the moment they received the packet (`received_at`, Unix
// seconds/ms or ISO string). Use it when plausible, otherwise server time.
const MAX_PAST_MS = 24 * 3600 * 1000;
const MAX_FUTURE_MS = 2 * 60 * 1000;

const readingTimeFrom = (body, now = Date.now()) => {
  const raw = body && (body.received_at ?? body.receivedAt);
  if (raw === undefined || raw === null || raw === '') return new Date(now);
  let ms;
  if (typeof raw === 'number' || /^\d+(\.\d+)?$/.test(String(raw))) {
    const n = Number(raw);
    ms = n < 1e12 ? n * 1000 : n; // seconds vs milliseconds
  } else {
    ms = Date.parse(raw);
  }
  if (!Number.isFinite(ms) || ms > now + MAX_FUTURE_MS || ms < now - MAX_PAST_MS) return new Date(now);
  return new Date(ms);
};

// ─── Duplicate detection ─────────────────────────────────────────────────────
// The same radio packet can reach several gateways. With a message ID the
// match is exact (10 min window); without one, identical sensor values from
// the same node within a few seconds are treated as the same packet.
const MSGID_WINDOW_MS = 10 * 60 * 1000;
const FINGERPRINT_WINDOW_MS = 4 * 1000;
const MAX_ENTRIES = 5000;
const seen = new Map(); // key -> expiry

// Per-receiver fields that differ between gateways for the same packet.
const RECEIVER_FIELDS = new Set(['rssi', 'snr', 'signal_level', 'mesh_hops_left', 'time', 'gateway_id', 'ap_bssid']);

const fingerprint = (payload) =>
  Object.keys(payload)
    .filter((k) => !RECEIVER_FIELDS.has(k))
    .sort()
    .map((k) => `${k}=${typeof payload[k] === 'object' ? JSON.stringify(payload[k]) : payload[k]}`)
    .join('&');

/**
 * Returns true if this packet was already accepted. Only call for mesh packets.
 * @param {string} nodeKey  stable identity of the sender (device _id or reported id)
 */
const isDuplicatePacket = (nodeKey, msgId, payload, now = Date.now()) => {
  if (seen.size > MAX_ENTRIES) {
    for (const [k, exp] of seen) if (exp <= now) seen.delete(k);
    if (seen.size > MAX_ENTRIES) seen.clear();
  }
  const hasMsgId = msgId !== undefined && msgId !== null && msgId !== '';
  const key = hasMsgId ? `${nodeKey}#m${msgId}` : `${nodeKey}#f${fingerprint(payload)}`;
  const exp = seen.get(key);
  if (exp && exp > now) return true;
  seen.set(key, now + (hasMsgId ? MSGID_WINDOW_MS : FINGERPRINT_WINDOW_MS));
  return false;
};

// ─── Heard-by list ───────────────────────────────────────────────────────────
const mergeHeardBy = (list, gatewayId, rssi, snr, when = new Date()) => {
  if (!gatewayId) return Array.isArray(list) ? list : [];
  const entry = {
    gateway_id: String(gatewayId).slice(0, 64),
    rssi: Number.isFinite(Number(rssi)) ? Number(rssi) : null,
    snr: Number.isFinite(Number(snr)) ? Number(snr) : null,
    last_seen: when,
  };
  const rest = (Array.isArray(list) ? list : []).filter((h) => h && h.gateway_id !== entry.gateway_id);
  return [entry, ...rest].slice(0, 5);
};

// True when this gateway's entry is missing or older than `ms` (throttles DB writes).
const heardByStale = (list, gatewayId, ms = 15 * 1000, now = Date.now()) => {
  if (!gatewayId) return false;
  const h = (Array.isArray(list) ? list : []).find((x) => x && x.gateway_id === String(gatewayId));
  return !h || !h.last_seen || now - new Date(h.last_seen).getTime() > ms;
};

// ─── Discovery ───────────────────────────────────────────────────────────────
const PENDING_MIN_INTERVAL_MS = 30 * 1000; // keep at most one pending reading per 30s per node

/** Record a packet from an unregistered device. Returns the DiscoveredNode. */
const recordDiscovery = async ({ orgId, reportedDeviceId, originNode, typeGuess, payload, gatewayId, rssi, snr, when }) => {
  const existing = await DiscoveredNode.findOne({ org_id: orgId, reported_device_id: reportedDeviceId });
  const lastSeen = existing ? existing.last_seen : null;

  const node = await DiscoveredNode.findOneAndUpdate(
    { org_id: orgId, reported_device_id: reportedDeviceId },
    {
      $set: {
        origin_node: originNode ?? (existing ? existing.origin_node : null),
        device_type_guess: typeGuess || (existing ? existing.device_type_guess : ''),
        last_seen: when,
        last_payload: payload,
        heard_by: mergeHeardBy(existing ? existing.heard_by : [], gatewayId, rssi, snr, when),
      },
      $setOnInsert: { first_seen: when, status: 'new' },
      $inc: { packet_count: 1 },
    },
    { upsert: true, new: true }
  );

  if (!lastSeen || when - lastSeen >= PENDING_MIN_INTERVAL_MS || node.packet_count === 1) {
    await PendingReading.create({ discovered_id: node._id, timestamp: when, payload });
  }
  if (!existing) {
    console.log(`[DISCOVERED DEVICE]: ${reportedDeviceId}${originNode ? ` (LoRa node #${originNode})` : ''} via ${gatewayId || 'direct'}; waiting to be added in the dashboard`);
  }
  return node;
};

module.exports = { readingTimeFrom, isDuplicatePacket, mergeHeardBy, heardByStale, recordDiscovery, fingerprint };
