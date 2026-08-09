const express = require('express');
const FusionGroup = require('../models/FusionGroup');
const Device = require('../models/Device');
const Reading = require('../models/Reading');
const TapLog = require('../models/TapLog');
const { authenticateUser } = require('../middleware/auth');

const router = express.Router();

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
      device_ids: device_ids || [],
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
    const group = await FusionGroup.findOneAndUpdate(
      { _id: req.params.id, org_id: req.org_id },
      { $set: req.body },
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
router.get('/:id/live', authenticateUser, async (req, res) => {
  try {
    const group = await FusionGroup.findOne({ _id: req.params.id, org_id: req.org_id });
    if (!group) return res.status(404).json({ message: 'Fusion group not found' });

    // For each device, get its type and latest data point
    const deviceData = await Promise.all(
      group.device_ids.map(async (device_id) => {
        const device = await Device.findOne({ device_id });
        if (!device) return null;

        let latestData = null;
        const deviceTypeLower = (device.device_type || '').toLowerCase();

        // Card readers — fetch latest tap log
        if (deviceTypeLower.includes('card') || deviceTypeLower.includes('nfc') || deviceTypeLower.includes('reader')) {
          latestData = await TapLog.findOne({ device_id }).sort({ timestamp: -1 }).limit(1);
        } else {
          // All others (scales, weather stations, generic sensors) — fetch latest reading
          latestData = await Reading.findOne({ device_id }).sort({ timestamp: -1 }).limit(1);
        }

        return {
          device_id: device.device_id,
          name: device.name,
          device_type: device.device_type,
          status: device.status,
          last_seen: device.last_seen,
          latest_data: latestData,
        };
      })
    );

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
      groups.map(async (group) => {
        const deviceData = await Promise.all(
          group.device_ids.map(async (device_id) => {
            const device = await Device.findOne({ device_id });
            if (!device) return null;
            const deviceTypeLower = (device.device_type || '').toLowerCase();
            let latestData = null;
            if (deviceTypeLower.includes('card') || deviceTypeLower.includes('nfc') || deviceTypeLower.includes('reader')) {
              latestData = await TapLog.findOne({ device_id }).sort({ timestamp: -1 });
            } else {
              latestData = await Reading.findOne({ device_id }).sort({ timestamp: -1 });
            }
            return {
              device_id: device.device_id,
              name: device.name,
              device_type: device.device_type,
              status: device.status,
              last_seen: device.last_seen,
              latest_data: latestData,
            };
          })
        );
        return { ...group.toObject(), devices: deviceData.filter(Boolean) };
      })
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
