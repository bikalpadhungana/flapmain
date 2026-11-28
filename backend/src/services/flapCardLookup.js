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

// Phones used as a Flap card have no fixed UID. The reader sends the phone's signed answer
// to its random challenge, which Flap checks:
//   POST https://flaap.me/api/device/external/check-phone   (X-API-Key header)
//   body { pid, challenge, ctr, mac }
// Extra result status: denied — bad signature or a replayed tap (do not grant access).
const PHONE_LOOKUP_URL = process.env.FLAP_PHONE_LOOKUP_URL
  || LOOKUP_URL.replace(/check-uid\/$/, 'check-phone');

const HEX32 = /^[0-9a-f]{32}$/i;

/** Only the four fields Flap needs, validated, so nothing else is passed along or stored. */
const cleanPhoneAuth = (p) => {
  if (!p || typeof p !== 'object') return null;
  const out = { pid: String(p.pid || ''), challenge: String(p.challenge || '').toLowerCase(), ctr: Number(p.ctr), mac: String(p.mac || '').toLowerCase() };
  if (!/^[A-Za-z0-9]{8,16}$/.test(out.pid) || !HEX32.test(out.challenge) || !HEX32.test(out.mac) || !Number.isInteger(out.ctr) || out.ctr < 1) return null;
  return out;
};

const lookupPhoneHolder = async (rawAuth) => {
  const auth = cleanPhoneAuth(rawAuth);
  if (!auth) return { status: 'denied', uid: 'PHONE', holder: null, message: 'Malformed phone tap' };
  const uid = `PHONE:${auth.pid}`;

  const key = lookupKey();
  if (!key) return { status: 'unverified', uid, holder: null, message: 'Lookup key not configured' };

  let res;
  try {
    res = await fetch(PHONE_LOOKUP_URL, {
      method: 'POST',
      headers: { 'X-API-Key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(auth),
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
  if (res.status === 404 && data && data.code === 'not_found') return { status: 'unknown', uid, holder: null, message: data.message || 'Phone not registered' };
  if (res.status === 404) return { status: 'unverified', uid, holder: null, message: 'Flap server does not support phone taps yet' };
  if (res.status === 403 || res.status === 400) {
    return { status: 'denied', uid, holder: null, message: (data && data.code === 'replayed_tap') ? 'Tap already used' : 'Phone not verified' };
  }
  if (!res.ok || !data) return { status: 'unverified', uid, holder: null, message: `Flap error (${res.status})` };

  const holder = pickHolder(data);
  if (data.isLost) return { status: 'lost', uid, holder, message: 'Phone switched off by owner', phone: true };
  return { status: 'ok', uid, holder, message: 'OK', phone: true };
};

module.exports = { lookupCardHolder, lookupPhoneHolder, cleanPhoneAuth, normaliseUid };
