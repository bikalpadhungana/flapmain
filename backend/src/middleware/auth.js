const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const ApiKey = require('../models/ApiKey');
const Device = require('../models/Device');
const { getJwtSecret, deviceAuthMode } = require('../config/security');

// Hash helper for API keys
const hashApiKey = (key) => {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
};

const verifyJwtUser = async (token) => {
  const decoded = jwt.verify(token, getJwtSecret());
  return User.findById(decoded.id).select('-password');
};

// Middleware: Authenticate User via JWT
const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Authentication token missing or invalid' });
    }

    const user = await verifyJwtUser(authHeader.split(' ')[1]);
    if (!user) {
      return res.status(401).json({ message: 'User no longer exists' });
    }

    req.user = user;
    req.org_id = user.org_id; // For multi-tenant scoping
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Middleware: Authenticate External API Key
const authenticateApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(401).json({ message: 'API key missing' });
    }

    const keyDoc = await ApiKey.findOne({ key_hash: hashApiKey(apiKey) });
    if (!keyDoc) {
      return res.status(401).json({ message: 'Invalid API key' });
    }

    req.apiKey = keyDoc;
    req.org_id = keyDoc.org_id;

    ApiKey.updateOne({ _id: keyDoc._id }, { $set: { last_used: new Date() } }).catch((err) =>
      console.error('Error updating last_used for API key:', err)
    );

    next();
  } catch (error) {
    return res.status(500).json({ message: 'Server error during API key validation' });
  }
};

// Middleware: dashboard JWT *or* partner API key (for third-party integration endpoints)
const authenticateUserOrApiKey = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) return authenticateUser(req, res, next);
  if (req.headers['x-api-key']) return authenticateApiKey(req, res, next);
  return res.status(401).json({ message: 'Authentication required (Bearer token or x-api-key)' });
};

// Role authorization helper
const authorizeRole = (requiredRole) => {
  return (req, res, next) => {
    if (!req.user || req.user.role !== requiredRole) {
      return res.status(403).json({ message: 'Access denied: insufficient permissions' });
    }
    next();
  };
};

// Scope authorization helper for API keys
const authorizeScope = (requiredScope) => {
  return (req, res, next) => {
    if (!req.apiKey || !req.apiKey.scopes.includes(requiredScope)) {
      return res.status(403).json({ message: `Access denied: scope '${requiredScope}' required` });
    }
    next();
  };
};

// ============================================================
// DEVICE CREDENTIALS
// ============================================================

// Short-lived cache: key hash -> active device owning that key (or null).
// Avoids a DB round trip per telemetry packet; 60s staleness is acceptable
// for revocation of a device key.
const KEY_CACHE_TTL_MS = 60 * 1000;
const keyOwnerCache = new Map();

const findActiveKeyOwner = async (keyHash) => {
  const hit = keyOwnerCache.get(keyHash);
  if (hit && hit.exp > Date.now()) return hit.owner;

  const owner = await Device.findOne({ api_key_hash: keyHash, activation_status: 'active' })
    .select('device_id org_id')
    .lean();
  keyOwnerCache.set(keyHash, { owner, exp: Date.now() + KEY_CACHE_TTL_MS });
  if (keyOwnerCache.size > 5000) keyOwnerCache.clear();
  return owner;
};

const extractDeviceKey = (req) =>
  req.headers['x-device-key'] ||
  req.headers['x-api-key'] ||
  (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) && (req.body.api_key || req.body.device_key)) ||
  null;

/**
 * Decide whether `rawKey` may submit data for `device`.
 * Accepted when the key is the device's own key, or the key of another
 * *active* device in the same org (a trusted relay — e.g. the LoRa gateway
 * forwards every mesh node's packets using its own key).
 * When `device` is null (not yet provisioned), any active relay key is accepted.
 * Returns { ok, via, relay }.
 */
const checkDeviceKey = async (device, rawKey) => {
  if (!rawKey) return { ok: false, via: 'missing-key' };
  const keyHash = hashApiKey(rawKey);
  if (device && keyHash === device.api_key_hash) return { ok: true, via: 'own-key' };

  const relay = await findActiveKeyOwner(keyHash);
  if (!relay) return { ok: false, via: 'unknown-key' };
  if (device && String(relay.org_id) !== String(device.org_id)) return { ok: false, via: 'cross-org-key' };
  return { ok: true, via: 'relay-key', relay };
};

/**
 * Apply DEVICE_AUTH_MODE to a check result. Returns true if the request may
 * continue; otherwise it has already sent a 401.
 */
const enforceDeviceAuth = (req, res, result, label) => {
  if (result.ok) return true;
  const mode = deviceAuthMode();
  if (mode === 'off') return true;
  console.warn(`[DEVICE AUTH ${mode.toUpperCase()}] ${label} from ${req.ip} rejected (${result.via})`);
  if (mode === 'warn') return true;
  res.status(401).json({ status: 'error', message: 'Unauthorized: invalid or missing device key' });
  return false;
};

/**
 * Middleware for device-facing endpoints that don't resolve a single target
 * device (gateway uplink/outbox, camera upload). Accepts a dashboard JWT or
 * any active device key.
 */
const requireDeviceOrUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const user = await verifyJwtUser(authHeader.split(' ')[1]);
        if (user) {
          req.user = user;
          req.org_id = user.org_id;
          return next();
        }
      } catch (_) { /* fall through to device key */ }
    }

    const result = await checkDeviceKey(null, extractDeviceKey(req));
    if (result.relay) {
      req.authDevice = result.relay;
      req.org_id = result.relay.org_id;
    }
    if (enforceDeviceAuth(req, res, result, `${req.method} ${req.originalUrl}`)) next();
  } catch (err) {
    console.error('Device auth error:', err);
    res.status(500).json({ status: 'error', message: 'Server error during device authentication' });
  }
};

module.exports = {
  authenticateUser,
  authenticateApiKey,
  authenticateUserOrApiKey,
  authorizeRole,
  authorizeScope,
  hashApiKey,
  checkDeviceKey,
  enforceDeviceAuth,
  extractDeviceKey,
  requireDeviceOrUser,
  verifyJwtUser,
};
