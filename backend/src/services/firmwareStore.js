// Disk storage and signed download links for OTA firmware images.
//
// Images are kept in FIRMWARE_DIR (default backend/firmware_store, git-ignored).
// Compiled firmware contains Wi-Fi passwords and device keys, so a download needs
// a short-lived HMAC-signed link that the server hands out only to a device that
// authenticated with its key on /firmware/check.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getJwtSecret } = require('../config/security');

const FIRMWARE_DIR = process.env.FIRMWARE_DIR || path.join(__dirname, '../../firmware_store');
const MAX_FIRMWARE_BYTES = 4 * 1024 * 1024; // largest ESP32 app partition in common schemes
const LINK_TTL_S = 15 * 60;

const ensureDir = () => fs.mkdirSync(FIRMWARE_DIR, { recursive: true });
const filePath = (id) => path.join(FIRMWARE_DIR, `${String(id).replace(/[^a-f0-9]/gi, '')}.bin`);

/**
 * Validate an uploaded image. ESP8266 and ESP32 app images start with 0xE9; the
 * ESP8266 updater also accepts gzip-compressed images (.bin.gz).
 * The chip is read from the ESP32 extended header (byte 12-13 = chip id).
 */
const inspectImage = (buf) => {
  if (!Buffer.isBuffer(buf) || buf.length < 256) return { ok: false, error: 'File is empty or too small to be firmware' };
  if (buf.length > MAX_FIRMWARE_BYTES) return { ok: false, error: `File is larger than ${MAX_FIRMWARE_BYTES / 1048576} MB` };
  if (buf[0] === 0x1f && buf[1] === 0x8b) return { ok: true, chip: 'esp8266', gzip: true };
  if (buf[0] !== 0xe9) {
    return { ok: false, error: 'Not an ESP firmware image. Upload the app .bin (Sketch -> Export Compiled Binary), not .bootloader.bin, .partitions.bin or .merged.bin' };
  }
  // ESP32-family images have a 16-byte extended header at byte 8 whose first byte
  // (wp_pin) is 0xEE. ESP8266 images start their first segment there instead
  // (a load address such as 0x40100000).
  return { ok: true, chip: buf[8] === 0xee ? 'esp32' : 'esp8266' };
};

const saveImage = (id, buf) => {
  ensureDir();
  fs.writeFileSync(filePath(id), buf);
};

const deleteImage = (id) => {
  try { fs.unlinkSync(filePath(id)); } catch (_) { /* already gone */ }
};

const imageExists = (id) => fs.existsSync(filePath(id));

const secret = () => process.env.OTA_LINK_SECRET || getJwtSecret();

const sign = (fwId, deviceId, exp) =>
  crypto.createHmac('sha256', secret()).update(`${fwId}.${deviceId}.${exp}`).digest('hex').slice(0, 40);

/** Path (relative to the API root) the device downloads from. */
const signedPath = (fwId, deviceId) => {
  const exp = Math.floor(Date.now() / 1000) + LINK_TTL_S;
  const q = new URLSearchParams({ d: deviceId, e: String(exp), t: sign(String(fwId), deviceId, exp) });
  return `/v1/firmware/download/${fwId}?${q.toString()}`;
};

const verifyLink = (fwId, deviceId, exp, token) => {
  const e = Number(exp);
  if (!deviceId || !token || !Number.isFinite(e) || e < Date.now() / 1000) return false;
  const expected = Buffer.from(sign(String(fwId), String(deviceId), e));
  const given = Buffer.from(String(token));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
};

module.exports = {
  FIRMWARE_DIR,
  MAX_FIRMWARE_BYTES,
  inspectImage,
  saveImage,
  deleteImage,
  imageExists,
  filePath,
  signedPath,
  verifyLink,
};
