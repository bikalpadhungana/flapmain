// Over-the-air (OTA) firmware updates.
//
// Dashboard (JWT):
//   GET    /firmware                 uploaded images
//   POST   /firmware?board=&version=&notes=   upload a .bin (body: application/octet-stream)
//   GET    /firmware/builds          ready-made .bin files in FIRMWARE_BUILDS_DIR
//   POST   /firmware/builds/import   { file } add one of them to the library
//   DELETE /firmware/:id
//   GET    /firmware/devices         every device with its reported firmware and OTA state
//   POST   /firmware/:id/deploy      { device_ids: [...], lora_wake: bool }
//   POST   /firmware/cancel          { device_ids: [...] }
//
// Devices (X-Device-Key, see hardwarecode/flap_ota.h):
//   GET    /firmware/check?device_id=&board=&version=&chip=&node=
//   GET    /firmware/download/:id?d=&e=&t=     signed link from /check
//   POST   /firmware/status          { device_id, node, state, message, version }
//
// Flow: dashboard deploys -> device state "pending" -> device checks in (every few
// minutes, at boot, or right away after an "OTA:CHECK" LoRa command) -> gets a signed
// link -> "downloading" -> flashes and reboots -> checks in with the new version ->
// "success". Failures are reported by the device and retried up to MAX_ATTEMPTS times.

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const mongoose = require('mongoose');
const Firmware = require('../models/Firmware');
const Device = require('../models/Device');
const MeshMessage = require('../models/MeshMessage');
const { authenticateUser, checkDeviceKey, extractDeviceKey } = require('../middleware/auth');
const { radioNodeOf } = require('../services/meshText');
const store = require('../services/firmwareStore');

const router = express.Router();
const MAX_ATTEMPTS = 3;
const OTA_WAKE_TEXT = 'OTA:CHECK';

const clean = (v, max = 64) => String(v ?? '').trim().slice(0, max);
const validBoard = (b) => /^[a-z0-9_.-]{2,48}$/i.test(b);
const validVersion = (v) => /^[0-9A-Za-z_.+-]{1,32}$/.test(v);

const toClientFirmware = (fw) => ({
  _id: String(fw._id),
  board: fw.board,
  version: fw.version,
  chip: fw.chip,
  filename: fw.filename,
  size: fw.size,
  md5: fw.md5,
  sha256: fw.sha256,
  notes: fw.notes,
  createdAt: fw.createdAt,
});

const toClientDevice = (d) => ({
  device_id: d.device_id,
  name: d.name,
  device_type: d.device_type,
  status: d.status,
  last_seen: d.last_seen,
  radio_node: radioNodeOf(d),
  firmware: d.firmware || {},
  ota: { ...(d.ota || {}), target: d.ota?.target ? String(d.ota.target) : null },
});

const emitOta = (req, device) => {
  const io = req.app.get('io');
  if (io) io.emit('ota_status', toClientDevice(device));
};

const setOta = async (req, device, fields) => {
  for (const [k, v] of Object.entries({ ...fields, updated_at: new Date() })) device.set(`ota.${k}`, v);
  await device.save();
  emitOta(req, device);
};

// ─── Dashboard ────────────────────────────────────────────────────────────────

router.get('/', authenticateUser, async (req, res) => {
  const list = await Firmware.find({ org_id: req.org_id }).sort({ createdAt: -1 }).lean();
  res.json({ status: 'success', firmware: list.map(toClientFirmware) });
});

/**
 * Validate an image and add it to the org's library. Returns { status, body } for the response.
 * Shared by browser uploads and by importing a ready-made build from FIRMWARE_BUILDS_DIR.
 */
const addFirmware = async ({ req, buf, board, version, notes, filename }) => {
  if (!validBoard(board)) return { status: 400, body: { status: 'error', message: 'Board must be 2-48 letters, digits, _ . or -' } };
  if (!validVersion(version)) return { status: 400, body: { status: 'error', message: 'Version must be 1-32 characters: letters, digits, . _ + -' } };
  if (!Buffer.isBuffer(buf)) {
    return { status: 400, body: { status: 'error', message: 'Send the .bin file as the request body with Content-Type: application/octet-stream' } };
  }
  const info = store.inspectImage(buf);
  if (!info.ok) return { status: 400, body: { status: 'error', message: info.error } };

  if (await Firmware.exists({ org_id: req.org_id, board, version })) {
    return { status: 409, body: { status: 'error', message: `${board} ${version} is already in the library. Bump FLAP_FW_VERSION and rebuild.` } };
  }

  const fw = new Firmware({
    org_id: req.org_id,
    board,
    version,
    chip: info.chip,
    filename: clean(filename, 120),
    size: buf.length,
    md5: crypto.createHash('md5').update(buf).digest('hex'),
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    notes: clean(notes, 500),
    uploaded_by: req.user?._id || null,
  });
  store.saveImage(fw._id, buf);
  await fw.save();
  console.log(`[OTA] Added ${board} ${version} (${buf.length} bytes, ${info.chip}) from ${filename || 'upload'}`);
  return { status: 201, body: { status: 'success', firmware: toClientFirmware(fw) } };
};

router.post('/', authenticateUser, async (req, res) => {
  try {
    const r = await addFirmware({
      req,
      buf: req.body,
      board: clean(req.query.board, 48),
      version: clean(req.query.version, 32),
      notes: req.query.notes,
      filename: req.headers['x-filename'],
    });
    res.status(r.status).json(r.body);
  } catch (err) {
    console.error('[OTA] Upload failed:', err);
    res.status(500).json({ status: 'error', message: 'Upload failed' });
  }
});

// Ready-made builds on the server (FIRMWARE_BUILDS_DIR, default <repo>/firmware_builds),
// named "<board>-<version>.bin", e.g. esp_gateway_node-2.2.0.bin.
router.get('/builds', authenticateUser, async (req, res) => {
  const builds = store.listBuilds();
  const inLibrary = await Firmware.find({ org_id: req.org_id }).select('board version').lean();
  const have = new Set(inLibrary.map((f) => `${f.board}@${f.version}`));
  res.json({
    status: 'success',
    dir: store.FIRMWARE_BUILDS_DIR,
    builds: builds.map((b) => ({ ...b, in_library: have.has(`${b.board}@${b.version}`) })),
  });
});

router.post('/builds/import', authenticateUser, async (req, res) => {
  try {
    const build = store.listBuilds().find((b) => b.file === String(req.body?.file || ''));
    if (!build) return res.status(404).json({ status: 'error', message: 'Build not found' });
    const r = await addFirmware({
      req,
      buf: store.readBuild(build.file),
      board: build.board,
      version: build.version,
      notes: req.body?.notes || 'Imported from firmware_builds',
      filename: build.file,
    });
    res.status(r.status).json(r.body);
  } catch (err) {
    console.error('[OTA] Import failed:', err);
    res.status(500).json({ status: 'error', message: 'Import failed' });
  }
});

router.delete('/:id', authenticateUser, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ status: 'error', message: 'Invalid id' });
  const fw = await Firmware.findOneAndDelete({ _id: req.params.id, org_id: req.org_id });
  if (!fw) return res.status(404).json({ status: 'error', message: 'Firmware not found' });
  store.deleteImage(fw._id);
  await Device.updateMany(
    { org_id: req.org_id, 'ota.target': fw._id, 'ota.state': { $in: ['pending', 'downloading'] } },
    { $set: { 'ota.target': null, 'ota.state': 'idle', 'ota.message': 'Firmware was deleted', 'ota.updated_at': new Date() } }
  );
  res.json({ status: 'success' });
});

router.get('/devices', authenticateUser, async (req, res) => {
  const devices = await Device.find({ org_id: req.org_id })
    .select('device_id name device_type status last_seen node_id aliases firmware ota')
    .sort({ name: 1 })
    .lean();
  res.json({ status: 'success', devices: devices.map(toClientDevice) });
});

router.post('/:id/deploy', authenticateUser, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ status: 'error', message: 'Invalid id' });
    const fw = await Firmware.findOne({ _id: req.params.id, org_id: req.org_id });
    if (!fw || !store.imageExists(fw._id)) return res.status(404).json({ status: 'error', message: 'Firmware not found' });

    const ids = Array.isArray(req.body?.device_ids) ? req.body.device_ids.map((x) => clean(x, 80)).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ status: 'error', message: 'Pick at least one device' });

    const devices = await Device.find({ org_id: req.org_id, device_id: { $in: ids } });
    const results = [];
    for (const d of devices) {
      const reportedBoard = d.firmware?.board;
      if (reportedBoard && reportedBoard !== fw.board) {
        results.push({ device_id: d.device_id, ok: false, message: `Device runs ${reportedBoard}, not ${fw.board}` });
        continue;
      }
      await setOta(req, d, {
        target: fw._id,
        target_version: fw.version,
        state: 'pending',
        attempts: 0,
        message: 'Waiting for the device to check in',
      });

      // LoRa-only boards: ask the node over the radio to check now (it then pulls
      // the image over Wi-Fi; the image itself never goes over LoRa).
      let wake = false;
      const node = radioNodeOf(d);
      if (req.body?.lora_wake && node) {
        await MeshMessage.create({
          direction: 'downlink',
          gateway_id: 'esp_gateway_node_01',
          device_id: 'OTA Manager',
          origin_node: 0,
          target_node: node,
          message_type: 'text',
          kind: 'control',
          text: OTA_WAKE_TEXT,
          alert_level: 0,
          delivered: false,
        });
        wake = true;
      }
      results.push({ device_id: d.device_id, ok: true, lora_wake: wake });
    }
    const missing = ids.filter((id) => !devices.some((d) => d.device_id === id));
    missing.forEach((id) => results.push({ device_id: id, ok: false, message: 'Device not found' }));
    console.log(`[OTA] Deploy ${fw.board} ${fw.version} -> ${results.filter((r) => r.ok).length} device(s)`);
    res.json({ status: 'success', results });
  } catch (err) {
    console.error('[OTA] Deploy failed:', err);
    res.status(500).json({ status: 'error', message: 'Deploy failed' });
  }
});

router.post('/cancel', authenticateUser, async (req, res) => {
  const ids = Array.isArray(req.body?.device_ids) ? req.body.device_ids.map((x) => clean(x, 80)) : [];
  const devices = await Device.find({ org_id: req.org_id, device_id: { $in: ids } });
  for (const d of devices) {
    await setOta(req, d, { target: null, target_version: '', state: 'idle', attempts: 0, message: 'Cancelled' });
  }
  res.json({ status: 'success', cancelled: devices.length });
});

// ─── Devices ──────────────────────────────────────────────────────────────────

/** Find the device a check-in is about: its device_id, an alias, or its LoRa node number. */
const findReportingDevice = async (deviceId, node) => {
  if (deviceId) {
    const d = (await Device.findOne({ device_id: deviceId })) || (await Device.findOne({ aliases: deviceId }));
    if (d) return d;
  }
  const n = Number(node);
  if (Number.isInteger(n) && n >= 1 && n <= 255) {
    return (await Device.findOne({ node_id: n, aliases: `node-${n}` })) ||
      (await Device.findOne({ node_id: n })) ||
      (await Device.findOne({ aliases: `node-${n}` }));
  }
  return null;
};

/**
 * OTA is always strictly authenticated, whatever DEVICE_AUTH_MODE says: the images
 * contain Wi-Fi passwords and device keys. A device may use its own key, or the key
 * of another active device in its org (LoRa nodes have no key of their own and use
 * their gateway's).
 */
const authDevice = async (req, res) => {
  const deviceId = clean(req.query.device_id ?? req.body?.device_id, 80);
  const node = req.query.node ?? req.body?.node;
  const device = await findReportingDevice(deviceId, node);
  if (!device) {
    res.status(404).json({ update: false, message: `Device "${deviceId || `node ${node}`}" is not registered` });
    return null;
  }
  const check = await checkDeviceKey(device, extractDeviceKey(req));
  if (!check.ok) {
    console.warn(`[OTA] Rejected check-in for ${device.device_id} from ${req.ip} (${check.via})`);
    res.status(401).json({ update: false, message: 'Invalid device key' });
    return null;
  }
  return device;
};

router.get('/check', async (req, res) => {
  try {
    const device = await authDevice(req, res);
    if (!device) return;

    const board = clean(req.query.board, 48);
    const version = clean(req.query.version, 32);
    device.firmware = { board, version, chip: clean(req.query.chip, 16), reported_at: new Date() };
    device.last_seen = new Date();

    const ota = device.ota || {};
    if (!ota.target || !['pending', 'downloading'].includes(ota.state)) {
      await device.save();
      return res.json({ update: false });
    }

    const fw = await Firmware.findById(ota.target);
    if (!fw || !store.imageExists(fw._id)) {
      await setOta(req, device, { target: null, state: 'failed', message: 'Firmware image no longer exists' });
      return res.json({ update: false });
    }
    if (board && board !== fw.board) {
      await setOta(req, device, { target: null, state: 'failed', message: `Device runs ${board}; this image is for ${fw.board}` });
      return res.json({ update: false });
    }
    if (version === fw.version) {
      console.log(`[OTA] ${device.device_id} is now running ${board} ${version}`);
      await setOta(req, device, { target: null, state: 'success', message: `Running ${version}`, attempts: 0 });
      return res.json({ update: false });
    }
    if ((ota.attempts || 0) >= MAX_ATTEMPTS) {
      await setOta(req, device, { target: null, state: 'failed', message: `Gave up after ${MAX_ATTEMPTS} attempts. ${ota.message || ''}`.trim() });
      return res.json({ update: false });
    }

    await setOta(req, device, {
      state: 'downloading',
      attempts: (ota.attempts || 0) + 1,
      message: `Downloading ${fw.version} (attempt ${(ota.attempts || 0) + 1})`,
    });
    console.log(`[OTA] ${device.device_id}: ${version || '?'} -> ${fw.version}`);
    res.json({
      update: true,
      version: fw.version,
      size: fw.size,
      md5: fw.md5,
      path: store.signedPath(fw._id, device.device_id),
    });
  } catch (err) {
    console.error('[OTA] Check failed:', err);
    res.status(500).json({ update: false });
  }
});

router.get('/download/:id', async (req, res) => {
  const { id } = req.params;
  const { d, e, t } = req.query;
  if (!mongoose.isValidObjectId(id) || !store.verifyLink(id, d, e, t)) {
    return res.status(403).json({ status: 'error', message: 'Download link is invalid or expired' });
  }
  const fw = await Firmware.findById(id).lean();
  if (!fw || !store.imageExists(id)) return res.status(404).json({ status: 'error', message: 'Firmware not found' });

  res.set({
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(fw.size),
    'Content-Disposition': `attachment; filename="${fw.board}-${fw.version}.bin"`,
    'x-MD5': fw.md5, // the ESP8266/ESP32 updaters verify the image against this
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(store.filePath(id)).pipe(res);
});

router.post('/status', async (req, res) => {
  try {
    const device = await authDevice(req, res);
    if (!device) return;
    const state = clean(req.body?.state, 16);
    const message = clean(req.body?.message, 200);
    if (!['downloading', 'failed', 'success'].includes(state)) {
      return res.status(400).json({ status: 'error', message: 'state must be downloading, failed or success' });
    }
    if (device.ota?.target) {
      // A failure keeps the target so the next check-in retries (up to MAX_ATTEMPTS).
      await setOta(req, device, { state: state === 'failed' ? 'pending' : state, message: state === 'failed' ? `Last attempt failed: ${message}` : message });
    }
    console.log(`[OTA] ${device.device_id} reports ${state}${message ? `: ${message}` : ''}`);
    res.json({ status: 'success' });
  } catch (err) {
    console.error('[OTA] Status failed:', err);
    res.status(500).json({ status: 'error' });
  }
});

module.exports = router;
