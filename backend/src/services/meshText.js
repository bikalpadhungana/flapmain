// Conventions used by the walkie firmware (and the flaap.me app through it) inside the
// 31-byte LoRa text field:
//   "LOC:<lat>,<lon>,<acc>"          shared location
//   "SOS:<TYPE> [<lat>,<lon>,<acc>]" emergency SOS (packet type SOS / alert level 2)
//   "SOS-CANCEL"                     the sender cancelled its SOS
//   "PING HEARTBEAT"                 heartbeat (packet type HEARTBEAT)
// Anything else is a plain text message. Button SOS from older walkies is plain text
// ("SOS FROM NODE #101!") with alert level 2.

const SOS_TYPES = ['GENERAL', 'MEDICAL', 'FIRE', 'ACCIDENT', 'LOST', 'SECURITY'];

// Default names the walkie firmware shows for these node numbers.
const WALKIE_NAMES = { 0: 'Base station', 101: 'Walkie Alpha', 102: 'Walkie Bravo', 103: 'Walkie Charlie', 104: 'Walkie Delta' };

const num = (v) => {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const parseFix = (s) => {
  const [lat, lon, acc] = String(s || '').split(',').map((x) => num(x));
  if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon, acc: acc ?? null };
};

/**
 * @param {string} text            text field from the packet
 * @param {object} opts            { messageType: 'text'|'sos'|'heartbeat', alertLevel }
 * @returns {{kind, sos_type, lat, lon, acc}}
 */
const parseMeshText = (text, { messageType = 'text', alertLevel = 0 } = {}) => {
  const t = String(text || '').trim();
  const out = { kind: 'msg', sos_type: null, lat: null, lon: null, acc: null };

  if (messageType === 'heartbeat' || /^PING HEARTBEAT$/i.test(t)) return { ...out, kind: 'heartbeat' };
  if (/^SOS-CANCEL$/i.test(t)) return { ...out, kind: 'sos_cancel' };

  if (/^LOC:/i.test(t)) {
    const fix = parseFix(t.slice(4));
    if (fix) return { ...out, kind: 'loc', ...fix };
  }

  const sos = t.match(/^SOS:([A-Z]+)(?:\s+(\S+))?/i);
  if (sos) {
    const type = sos[1].toUpperCase();
    const fix = parseFix(sos[2]);
    return { ...out, kind: 'sos', sos_type: SOS_TYPES.includes(type) ? type : 'GENERAL', ...(fix || {}) };
  }

  if (messageType === 'sos' || Number(alertLevel) > 0) return { ...out, kind: 'sos', sos_type: 'GENERAL' };
  return out;
};

/** Cut a string to at most `maxBytes` UTF-8 bytes without splitting a character. */
const utf8Truncate = (str, maxBytes = 31) => {
  let bytes = 0;
  let out = '';
  for (const ch of String(str || '')) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (bytes + n > maxBytes) break;
    out += ch;
    bytes += n;
  }
  return out;
};

/**
 * LoRa node number a device actually transmits as (1..255). Devices registered with a
 * larger node_id (e.g. 1003) get their radio number from a "node-N" alias added when a
 * discovered node was attached to them.
 */
const radioNodeOf = (device) => {
  if (!device) return null;
  const id = Number(device.node_id);
  if (Number.isInteger(id) && id >= 1 && id <= 255) return id;
  for (const a of device.aliases || []) {
    const m = String(a).match(/^node-(\d{1,3})$/);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 255) return Number(m[1]);
  }
  return null;
};

module.exports = { parseMeshText, utf8Truncate, radioNodeOf, SOS_TYPES, WALKIE_NAMES };
