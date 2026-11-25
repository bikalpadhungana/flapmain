// Door locks (hardwarecode/esp8266_door_lock).
//
// The lock has no open port: it polls the server every ~1.5 s for a command.
//
// Dashboard (JWT):
//   GET  /locks                       locks with state and online status
//   POST /locks/:device_id/unlock     { duration_s }  queue an unlock (expires in 30 s)
//   POST /locks/:device_id/lock       queue "lock now"
//   GET  /locks/:device_id/events     audit log
//
// Lock (X-Device-Key = the lock's OWN key; gateway / relay keys are refused):
//   GET  /locks/poll?device_id=       -> { command: null } | { command: { id, action, duration_ms } }
//   POST /locks/event                 { device_id, event: unlocked|locked|boot, source, command_id }
//
// Safety: a command that the lock has not picked up within COMMAND_TTL_MS is dropped,
// so a lock that comes back online never opens the door for an old click.

const express = require('express');
const crypto = require('crypto');
const Device = require('../models/Device');
const DeviceType = require('../models/DeviceType');
const LockEvent = require('../models/LockEvent');
const { authenticateUser, checkDeviceKey, extractDeviceKey } = require('../middleware/auth');

const router = express.Router();

const LOCK_TYPE = 'door_lock';
const COMMAND_TTL_MS = 30 * 1000;
const ONLINE_MS = 15 * 1000;          // polled within this time = online
const MAX_UNLOCK_S = 60;
const DEFAULT_UNLOCK_S = 5;

/** Register the door_lock device type once (the Devices page lists types from the registry). */
const ensureLockType = async () => {
  await DeviceType.updateOne(
    { device_type: LOCK_TYPE },
    {
      $setOnInsert: {
        device_type: LOCK_TYPE,
        display_name: 'Door Lock',
        fields: { lock_state: { type: 'string', unit: '' }, rssi: { type: 'number', unit: 'dBm' } },
        commands: ['unlock', 'lock'],
      },
    },
    { upsert: true }
  );
};

const emit = (req, name, data) => {
  const io = req.app.get('io');
  if (io) io.emit(name, data);
};

const toClientLock = (d) => {
  const lastPoll = d.lock?.last_poll ? new Date(d.lock.last_poll) : null;
  const pending = d.lock?.pending?.action && d.lock.pending.expires_at > new Date() ? d.lock.pending : null;
  return {
    device_id: d.device_id,
    name: d.name,
    location: d.location,
    state: d.lock?.state || 'unknown',
    changed_at: d.lock?.changed_at || null,
    last_poll: lastPoll,
    online: !!lastPoll && Date.now() - lastPoll.getTime() < ONLINE_MS,
    pending: pending ? { action: pending.action, by: pending.by, expires_at: pending.expires_at } : null,
    firmware: d.firmware?.version || '',
  };
};

const logEvent = async (req, device, fields) => {
  const ev = await LockEvent.create({ org_id: device.org_id, device_id: device.device_id, ...fields });
  emit(req, 'lock_event', { ...ev.toObject(), lock: toClientLock(device) });
  return ev;
};

const userName = (u) => (u && (u.name || u.username || u.email)) || 'dashboard';

// ─── Dashboard ────────────────────────────────────────────────────────────────

router.get('/', authenticateUser, async (req, res) => {
  const locks = await Device.find({ org_id: req.org_id, device_type: LOCK_TYPE }).sort({ name: 1 }).lean();
  res.json({ status: 'success', locks: locks.map(toClientLock) });
});

const queueCommand = (action) => async (req, res) => {
  try {
    const device = await Device.findOne({ org_id: req.org_id, device_id: req.params.device_id, device_type: LOCK_TYPE });
    if (!device) return res.status(404).json({ status: 'error', message: 'Lock not found' });
    if (device.activation_status !== 'active') {
      return res.status(409).json({ status: 'error', message: 'Lock is not active. Activate it on the Devices page.' });
    }

    let seconds = 0;
    if (action === 'unlock') {
      seconds = Math.round(Number(req.body?.duration_s ?? DEFAULT_UNLOCK_S));
      if (!Number.isFinite(seconds) || seconds < 1 || seconds > MAX_UNLOCK_S) {
        return res.status(400).json({ status: 'error', message: `Unlock time must be 1-${MAX_UNLOCK_S} seconds` });
      }
    }

    const cmd = {
      id: crypto.randomBytes(6).toString('hex'),
      action,
      duration_ms: seconds * 1000,
      by: userName(req.user),
      expires_at: new Date(Date.now() + COMMAND_TTL_MS),
    };
    device.set('lock.pending', cmd);
    await device.save();
    await logEvent(req, device, { event: 'requested', action, source: 'dashboard', by: cmd.by, command_id: cmd.id,
      message: action === 'unlock' ? `Unlock for ${seconds}s` : 'Lock now' });

    const lock = toClientLock(device);
    const note = lock.online ? '' : ' The lock is offline; the command is dropped if it does not come back within 30 s.';
    res.json({ status: 'success', message: `${action === 'unlock' ? 'Unlock' : 'Lock'} sent.${note}`, lock });
  } catch (err) {
    console.error('[LOCK] Command failed:', err);
    res.status(500).json({ status: 'error', message: 'Could not send the command' });
  }
};

router.post('/:device_id/unlock', authenticateUser, queueCommand('unlock'));
router.post('/:device_id/lock', authenticateUser, queueCommand('lock'));

router.get('/:device_id/events', authenticateUser, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const events = await LockEvent.find({ org_id: req.org_id, device_id: req.params.device_id })
    .sort({ timestamp: -1 }).limit(limit).lean();
  res.json({ status: 'success', events });
});

// ─── Lock hardware ────────────────────────────────────────────────────────────

/** Locks must use their own key (no relay keys) and be active. Always enforced. */
const authLock = async (req, res) => {
  const deviceId = String(req.query.device_id ?? req.body?.device_id ?? '').slice(0, 80);
  const device = deviceId ? await Device.findOne({ device_id: deviceId, device_type: LOCK_TYPE }) : null;
  if (!device) {
    res.status(404).json({ status: 'error', message: `Lock "${deviceId}" is not registered as a door_lock` });
    return null;
  }
  const check = await checkDeviceKey(device, extractDeviceKey(req));
  if (!check.ok || check.via !== 'own-key') {
    console.warn(`[LOCK] Rejected ${req.method} ${req.path} for ${deviceId} from ${req.ip} (${check.via})`);
    res.status(401).json({ status: 'error', message: 'Invalid device key' });
    return null;
  }
  if (device.activation_status !== 'active') {
    res.status(403).json({ status: 'error', message: 'Lock is not active' });
    return null;
  }
  return device;
};

router.get('/poll', async (req, res) => {
  try {
    const device = await authLock(req, res);
    if (!device) return;
    const wasOffline = !toClientLock(device).online;
    device.set('lock.last_poll', new Date());
    device.last_seen = new Date();
    device.status = 'online';

    const p = device.lock?.pending;
    let command = null;
    if (p?.action) {
      if (p.expires_at && p.expires_at > new Date()) {
        command = { id: p.id, action: p.action, duration_ms: p.duration_ms };
      } else {
        await logEvent(req, device, { event: 'expired', action: p.action, source: 'dashboard', by: p.by, command_id: p.id,
          message: 'The lock did not pick the command up within 30 s' });
      }
      // Hand a command out once; the lock reports what it did via /event.
      device.set('lock.pending', { id: '', action: '', duration_ms: 0, by: '', expires_at: null });
    }
    await device.save();
    if (wasOffline) emit(req, 'lock_status', toClientLock(device));
    res.json({ command });
  } catch (err) {
    console.error('[LOCK] Poll failed:', err);
    res.status(500).json({ command: null });
  }
});

router.post('/event', async (req, res) => {
  try {
    const device = await authLock(req, res);
    if (!device) return;
    const event = String(req.body?.event || '');
    if (!['unlocked', 'locked', 'boot'].includes(event)) {
      return res.status(400).json({ status: 'error', message: 'event must be unlocked, locked or boot' });
    }
    const source = String(req.body?.source || '').slice(0, 20);
    const state = event === 'unlocked' ? 'unlocked' : 'locked'; // a lock always boots locked
    device.set('lock.state', state);
    device.set('lock.changed_at', new Date());
    device.set('lock.last_poll', new Date());
    device.last_seen = new Date();
    await device.save();
    await logEvent(req, device, {
      event,
      source,
      command_id: String(req.body?.command_id || '').slice(0, 24),
      message: String(req.body?.message || '').slice(0, 120),
    });
    console.log(`[LOCK] ${device.device_id} ${event} (${source || 'unknown source'})`);
    res.json({ status: 'success' });
  } catch (err) {
    console.error('[LOCK] Event failed:', err);
    res.status(500).json({ status: 'error' });
  }
});

module.exports = router;
module.exports.ensureLockType = ensureLockType;
