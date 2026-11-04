// ============================================================
// Central security configuration.
//
// Auth modes let us roll out stricter checks without bricking deployed
// hardware: run in `warn` first, watch the logs for rejected devices,
// fix their keys, then switch to `enforce`.
//   off     -> no check (legacy behaviour)
//   warn    -> check and log failures, but let the request through
//   enforce -> reject failures with 401
// ============================================================

const KNOWN_WEAK_SECRETS = new Set([
  'supersecretjwtkeychangeitinproduction',
  'secret',
  'changeme',
]);

let warnedWeakSecret = false;

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set. Refusing to sign/verify tokens with a hardcoded fallback.');
  }
  if (!warnedWeakSecret && (KNOWN_WEAK_SECRETS.has(secret) || secret.length < 32)) {
    warnedWeakSecret = true;
    console.error(
      '[SECURITY] JWT_SECRET is a known default or too short. Anyone with the source can forge login tokens. ' +
      'Rotate it now: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
    );
  }
  return secret;
};

const readMode = (envName, fallback) => {
  const v = String(process.env[envName] || fallback).toLowerCase();
  return ['off', 'warn', 'enforce'].includes(v) ? v : fallback;
};

const deviceAuthMode = () => readMode('DEVICE_AUTH_MODE', 'warn');
const socketAuthMode = () => readMode('SOCKET_AUTH_MODE', 'warn');

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ||
  'http://localhost:5173,https://localhost:5173,http://localhost:5174,https://localhost:5174,https://main.flap.com.np,https://main.esainnovation.com')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

module.exports = {
  getJwtSecret,
  deviceAuthMode,
  socketAuthMode,
  ALLOWED_ORIGINS,
};
