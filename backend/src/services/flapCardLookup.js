// Cardholder lookup against the Flap Card API (Third-Party Integration Guide):
//   GET https://flaap.me/api/device/external/check-uid/{uid}   (X-API-Key header)
// Returns only the holder's public profile: name, photo, flapid, profileUrl.
//
// Never throws. Result.status is one of:
//   ok         card found and active
//   lost       owner reported the card lost (do not grant access)
//   defective  card flagged defective by Flap
//   unknown    UID not registered / card not activated (404)
//   unverified Flap could not be asked or answered (no key, 401, 5xx, timeout).
//              Per the guide this is "could not verify", NOT "unknown card".

const LOOKUP_URL = (process.env.FLAP_LOOKUP_URL || 'https://flaap.me/api/device/external/check-uid/').replace(/\/?$/, '/');
const TIMEOUT_MS = Number(process.env.FLAP_LOOKUP_TIMEOUT_MS) || 5000;

const lookupKey = () => process.env.FLAP_LOOKUP_API_KEY || process.env.FLAP_SERVER_API_KEY || '';

// Normalise to the guide's canonical form (upper-case hex pairs, colon separated).
const normaliseUid = (uid) => {
  const hex = String(uid || '').replace(/[\s:-]/g, '').toUpperCase();
  if (!hex || !/^[0-9A-F]+$/.test(hex) || hex.length % 2 !== 0) return null;
  return hex.match(/../g).join(':');
};

const pickHolder = (data) => {
  const p = data && (data.profile || data.holder);
  if (!p || typeof p !== 'object') return null;
  return {
    name: p.name || null,
    photo: p.photo || null,
    flapid: p.flapid || null,
    profileUrl: p.profileUrl || null,
    matchType: data.matchType || null,
    cardType: data.cardType || null,
  };
};

let warnedNoKey = false;

const lookupCardHolder = async (rawUid) => {
  const uid = normaliseUid(rawUid);
  if (!uid) return { status: 'unknown', uid: String(rawUid || ''), holder: null, message: 'Invalid UID format' };

  const key = lookupKey();
  if (!key) {
    if (!warnedNoKey) {
      console.warn('[CARD LOOKUP] FLAP_LOOKUP_API_KEY is not set; cardholder lookups are disabled.');
      warnedNoKey = true;
    }
    return { status: 'unverified', uid, holder: null, message: 'Lookup key not configured' };
  }

  let res;
  try {
    res = await fetch(LOOKUP_URL + encodeURIComponent(uid.replace(/:/g, '')), {
      headers: { 'X-API-Key': key, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { status: 'unverified', uid, holder: null, message: 'Could not reach Flap' };
  }

  const data = await res.json().catch(() => null);

  if (res.status === 401) {
    console.warn('[CARD LOOKUP] Flap rejected the API key (401). Check FLAP_LOOKUP_API_KEY.');
    return { status: 'unverified', uid, holder: null, message: 'Lookup key rejected' };
  }
  if (res.status === 404) {
    return { status: 'unknown', uid, holder: null, message: (data && data.message) || 'UID not registered' };
  }
  if (res.status === 400) {
    return { status: 'unknown', uid, holder: null, message: (data && data.message) || 'Invalid UID' };
  }
  if (!res.ok || !data) {
    return { status: 'unverified', uid, holder: null, message: `Flap error (${res.status})` };
  }

  const holder = pickHolder(data);
  if (data.status === 'defective') return { status: 'defective', uid, holder, message: data.message || 'Defective card' };
  if (data.isLost) return { status: 'lost', uid, holder, message: 'Card reported lost' };
  return { status: 'ok', uid: data.uid || uid, holder, message: 'OK' };
};

module.exports = { lookupCardHolder, normaliseUid };
