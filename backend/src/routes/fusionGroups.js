const express = require('express');
const mongoose = require('mongoose');
const FusionGroup = require('../models/FusionGroup');
const Device = require('../models/Device');
const Reading = require('../models/Reading');
const TapLog = require('../models/TapLog');
const { authenticateUser } = require('../middleware/auth');

const router = express.Router();

const UPDATABLE_FIELDS = ['name', 'description', 'device_ids', 'color', 'icon'];

// Only devices that belong to the caller's org may be placed in a group.
const filterOrgDeviceIds = async (deviceIds, orgId) => {
  if (!Array.isArray(deviceIds)) return [];
  const ids = deviceIds.map(String);
  const owned = await Device.find({ device_id: { $in: ids }, org_id: orgId }).select('device_id').lean();
  const ownedSet = new Set(owned.map((d) => d.device_id));
  return ids.filter((id) => ownedSet.has(id));
};

// Latest data for each device in a group, scoped to the org.
const loadGroupDevices = async (deviceIds, orgId) => {
  const devices = await Device.find({ device_id: { $in: deviceIds }, org_id: orgId })
    .select('device_id name device_type status last_seen')
    .lean();
  return Promise.all(
    devices.map(async (device) => {
      const t = (device.device_type || '').toLowerCase();
      const isReader = t.includes('card') || t.includes('nfc') || t.includes('reader');
      const latestData = isReader
        ? await TapLog.findOne({ device_id: device.device_id }).sort({ timestamp: -1 }).lean()
        : await Reading.findOne({ device_id: device.device_id }).sort({ timestamp: -1 }).lean();
      return { ...device, latest_data: latestData };
    })
  );
};

// ─── GET /api/v1/fusion-groups ─────────────────────────────────────────────
// List all fusion groups for the authenticated user's org
router.get('/', authenticateUser, async (req, res) => {
  try {
    const groups = await FusionGroup.find({ org_id: req.org_id }).sort({ createdAt: -1 });
    res.json(groups);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ─── POST /api/v1/fusion-groups ────────────────────────────────────────────
// Create a new fusion group
router.post('/', authenticateUser, async (req, res) => {
  const { name, description, device_ids, color, icon } = req.body;
  if (!name) {
    return res.status(400).json({ message: 'Group name is required' });
  }
  try {
    const group = await FusionGroup.create({
      name,
      description: description || '',
      org_id: req.org_id,
      device_ids: await filterOrgDeviceIds(device_ids || [], req.org_id),
      color: color || '#6366f1',
      icon: icon || 'cpu',
    });
    res.status(201).json(group);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ─── PUT /api/v1/fusion-groups/:id ─────────────────────────────────────────
// Update a fusion group (rename, add/remove devices)
router.put('/:id', authenticateUser, async (req, res) => {
  try {
    const update = {};
    for (const f of UPDATABLE_FIELDS) {
      if (req.body[f] !== undefined) update[f] = req.body[f];
    }
    if (update.device_ids !== undefined) {
      update.device_ids = await filterOrgDeviceIds(update.device_ids, req.org_id);
    }
    const group = await FusionGroup.findOneAndUpdate(
      { _id: req.params.id, org_id: req.org_id },
      { $set: update },
      { new: true }
    );
    if (!group) return res.status(404).json({ message: 'Fusion group not found' });
    res.json(group);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ─── DELETE /api/v1/fusion-groups/:id ──────────────────────────────────────
// Delete a fusion group
router.delete('/:id', authenticateUser, async (req, res) => {
  try {
    const group = await FusionGroup.findOneAndDelete({ _id: req.params.id, org_id: req.org_id });
    if (!group) return res.status(404).json({ message: 'Fusion group not found' });
    res.json({ message: 'Fusion group deleted', id: req.params.id });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ─── GET /api/v1/fusion-groups/:id/live ────────────────────────────────────
// Return latest telemetry from all devices in the group for the live monitor
router.get('/:id/live', authenticateUser, async (req, res, next) => {
  // '/all/live' is declared below; without this, '/:id/live' captured it and
  // failed casting 'all' to an ObjectId (500 on the SensorFusion page).
  if (!mongoose.isValidObjectId(req.params.id)) return next();
  try {
    const group = await FusionGroup.findOne({ _id: req.params.id, org_id: req.org_id });
    if (!group) return res.status(404).json({ message: 'Fusion group not found' });

    const deviceData = await loadGroupDevices(group.device_ids, req.org_id);

    res.json({
      group,
      devices: deviceData.filter(Boolean),
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ─── GET /api/v1/fusion-groups/all-with-live ───────────────────────────────
// Return all groups with their latest device data (for the dashboard monitor)
router.get('/all/live', authenticateUser, async (req, res) => {
  try {
    const groups = await FusionGroup.find({ org_id: req.org_id });

    const result = await Promise.all(
      groups.map(async (group) => ({
        ...group.toObject(),
        devices: await loadGroupDevices(group.device_ids, req.org_id),
      }))
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
