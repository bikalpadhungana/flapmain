const express = require('express');
const crypto = require('crypto');
const Device = require('../models/Device');
const DeviceType = require('../models/DeviceType');
const Reading = require('../models/Reading');
const { authenticateUser } = require('../middleware/auth');
const mqttIngestion = require('../services/mqttIngestion'); // We can import to get publishing helper

const router = express.Router();

// Helper to hash API keys using SHA-256
const hashKey = (key) => {
  return crypto.createHash('sha256').update(key).digest('hex');
};

// @route   POST /v1/devices
// @desc    Register a new device & generate its API key
// @access  Private (Dashboard user)
router.post('/', authenticateUser, async (req, res) => {
  const { device_id, device_type, name, location } = req.body;

  if (!device_id || !device_type || !name) {
    return res.status(400).json({ message: 'Please provide device_id, device_type, and name' });
  }

  try {
    // Validate if device_type exists in registry
    const dtDoc = await DeviceType.findOne({ device_type: device_type.toLowerCase() });
    if (!dtDoc) {
      return res.status(400).json({ message: `Device type '${device_type}' not registered in Schema Registry` });
    }

    // Check if device_id is already taken
    const existingDevice = await Device.findOne({ device_id });
    if (existingDevice) {
      return res.status(400).json({ message: `Device with ID '${device_id}' already registered` });
    }

    // Generate a fresh plain text API key
    const rawApiKey = 'flap_dev_' + crypto.randomBytes(24).toString('hex');
    const api_key_hash = hashKey(rawApiKey);

    // Create device profile
    const device = await Device.create({
      device_id,
      org_id: req.org_id,
      device_type: device_type.toLowerCase(),
      name,
      location: location || '',
      api_key_hash,
      status: 'offline',
    });

    res.status(201).json({
      message: 'Device registered successfully',
      device: {
        id: device._id,
        device_id: device.device_id,
        device_type: device.device_type,
        name: device.name,
        location: device.location,
        status: device.status,
      },
      apiKey: rawApiKey, // Display once to the user!
    });
  } catch (error) {
    console.error('Device registration error:', error);
    res.status(500).json({ message: 'Server error registering device' });
  }
});

// @route   GET /v1/devices
// @desc    Get all devices scoped to current organization
// @access  Private (Dashboard user)
router.get('/', authenticateUser, async (req, res) => {
  try {
    const devices = await Device.find({ org_id: req.org_id }).select('-api_key_hash');
    res.json(devices);
  } catch (error) {
    console.error('List devices error:', error);
    res.status(500).json({ message: 'Server error fetching devices' });
  }
});

// @route   GET /v1/devices/:device_id
// @desc    Get detailed device details
// @access  Private (Dashboard user)
router.get('/:device_id', authenticateUser, async (req, res) => {
  try {
    const device = await Device.findOne({
      device_id: req.params.device_id,
      org_id: req.org_id,
    }).select('-api_key_hash');

    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    res.json(device);
  } catch (error) {
    console.error('Get device error:', error);
    res.status(500).json({ message: 'Server error fetching device details' });
  }
});

// @route   DELETE /v1/devices/:device_id
// @desc    Deactivate/Delete device registry
// @access  Private (Dashboard user)
router.delete('/:device_id', authenticateUser, async (req, res) => {
  try {
    const result = await Device.deleteOne({
      device_id: req.params.device_id,
      org_id: req.org_id,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Device not found' });
    }

    // Clean up readings associated with this device
    await Reading.deleteMany({ device_id: req.params.device_id, org_id: req.org_id });

    res.json({ message: 'Device and its reading logs deactivated successfully' });
  } catch (error) {
    console.error('Delete device error:', error);
    res.status(500).json({ message: 'Server error deactivating device' });
  }
});

// @route   GET /v1/devices/:device_id/readings/latest
// @desc    Get the latest telemetry reading for a device
// @access  Private (Dashboard user)
router.get('/:device_id/readings/latest', authenticateUser, async (req, res) => {
  try {
    const device = await Device.findOne({ device_id: req.params.device_id, org_id: req.org_id });
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    const latestReading = await Reading.findOne({
      device_id: req.params.device_id,
      org_id: req.org_id,
    }).sort({ timestamp: -1 });

    res.json(latestReading || { message: 'No telemetry data recorded yet' });
  } catch (error) {
    console.error('Get latest reading error:', error);
    res.status(500).json({ message: 'Server error fetching telemetry' });
  }
});

// @route   GET /v1/devices/:device_id/readings
// @desc    Get historical range of telemetry readings
// @access  Private (Dashboard user)
router.get('/:device_id/readings', authenticateUser, async (req, res) => {
  const { from, to, limit } = req.query;
  const queryLimit = parseInt(limit, 10) || 100;

  try {
    const device = await Device.findOne({ device_id: req.params.device_id, org_id: req.org_id });
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    const filter = {
      device_id: req.params.device_id,
      org_id: req.org_id,
    };

    if (from || to) {
      filter.timestamp = {};
      if (from) filter.timestamp.$gte = new Date(from);
      if (to) filter.timestamp.$lte = new Date(to);
    }

    const readings = await Reading.find(filter)
      .sort({ timestamp: -1 })
      .limit(queryLimit);

    res.json(readings);
  } catch (error) {
    console.error('Get readings history error:', error);
    res.status(500).json({ message: 'Server error fetching telemetry logs' });
  }
});

// @route   POST /v1/devices/:device_id/readings
// @desc    REST fallback telemetry ingestion (for hardware clients)
// @access  Public (Device API Key verification inside logic)
router.post('/:device_id/readings', async (req, res) => {
  const { device_id } = req.params;
  const deviceKey = req.headers['x-device-key'];

  if (!deviceKey) {
    return res.status(401).json({ message: 'Device authorization key missing' });
  }

  try {
    // 1. Fetch device registry
    const device = await Device.findOne({ device_id });
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    // 2. Validate device API key
    if (hashKey(deviceKey) !== device.api_key_hash) {
      return res.status(401).json({ message: 'Invalid device authorization key' });
    }

    // 3. Fetch device schema
    const schemaDoc = await DeviceType.findOne({ device_type: device.device_type });
    if (!schemaDoc) {
      return res.status(500).json({ message: 'Device type schema missing in registry' });
    }

    // 4. Validate payload fields
    const payload = req.body;
    const validatedPayload = {};

    for (const [fieldName, fieldDef] of schemaDoc.fields.entries()) {
      const val = payload[fieldName];
      if (val === undefined || val === null) continue;

      if (fieldDef.type === 'number') {
        const num = Number(val);
        if (!isNaN(num)) validatedPayload[fieldName] = num;
      } else if (fieldDef.type === 'boolean') {
        validatedPayload[fieldName] = Boolean(val);
      } else if (fieldDef.type === 'string') {
        validatedPayload[fieldName] = String(val);
      }
    }

    if (Object.keys(validatedPayload).length === 0) {
      return res.status(400).json({ message: 'Payload contains no valid schema fields' });
    }

    // 5. Write to time-series DB
    const reading = await Reading.create({
      timestamp: new Date(),
      device_id,
      org_id: device.org_id,
      device_type: device.device_type,
      payload: validatedPayload,
    });

    // 6. Update device connection stats
    await Device.updateOne(
      { device_id },
      { $set: { status: 'online', last_seen: new Date() } }
    );

    // Trigger alert evaluation hook (mock or evaluated synchronously)
    // In Phase 2: alert eval happens here too
    const AlertRule = require('../models/AlertRule');
    const rules = await AlertRule.find({ device_id, enabled: true });
    for (const rule of rules) {
      const val = validatedPayload[rule.condition.field];
      if (val === undefined) continue;
      
      let triggered = false;
      if (rule.condition.operator === '>') triggered = val > rule.condition.value;
      else if (rule.condition.operator === '<') triggered = val < rule.condition.value;
      else if (rule.condition.operator === '==') triggered = val == rule.condition.value;
      else if (rule.condition.operator === '!=') triggered = val != rule.condition.value;

      if (triggered) {
        console.log(`[ALERT TRIGGERED] Device ${device_id} field ${rule.condition.field} is ${val} (${rule.condition.operator} ${rule.condition.value}). Action target: ${rule.action.target}`);
      }
    }

    res.status(201).json({ message: 'Telemetry reading logged successfully', reading });
  } catch (error) {
    console.error('REST ingestion error:', error);
    res.status(500).json({ message: 'Server error processing telemetry ingestion' });
  }
});

// @route   POST /v1/devices/:device_id/commands
// @desc    Trigger actuator command (dashboard to device via MQTT)
// @access  Private (Dashboard user)
router.post('/:device_id/commands', authenticateUser, async (req, res) => {
  const { device_id } = req.params;
  const { command, payload } = req.body;

  if (!command) {
    return res.status(400).json({ message: 'Please provide actuator command name' });
  }

  try {
    // 1. Verify device exists and belongs to org
    const device = await Device.findOne({ device_id, org_id: req.org_id });
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    // 2. Validate if command exists in registry
    const schemaDoc = await DeviceType.findOne({ device_type: device.device_type });
    if (!schemaDoc || !schemaDoc.commands.includes(command)) {
      return res.status(400).json({ message: `Command '${command}' not supported by schema registry for ${device.device_type}` });
    }

    // 3. Publish to MQTT command topic: flap/{org_id}/{device_id}/cmd
    const published = mqttIngestion.publishMessage(
      `flap/${req.org_id}/${device_id}/cmd`,
      JSON.stringify({ command, payload: payload || {} })
    );

    if (!published) {
      return res.status(503).json({ message: 'MQTT broker disconnected, command could not be sent' });
    }

    res.json({ message: `Command '${command}' sent successfully`, topic: `flap/${req.org_id}/${device_id}/cmd` });
  } catch (error) {
    console.error('Actuator command error:', error);
    res.status(500).json({ message: 'Server error transmitting command' });
  }
});

// @route   GET /v1/devices/:device_id/export
// @desc    Export telemetry logs in JSON or CSV
// @access  Private (Dashboard user)
router.get('/:device_id/export', authenticateUser, async (req, res) => {
  const { format } = req.query;

  try {
    const device = await Device.findOne({ device_id: req.params.device_id, org_id: req.org_id });
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    const readings = await Reading.find({
      device_id: req.params.device_id,
      org_id: req.org_id,
    }).sort({ timestamp: -1 });

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=telemetry-${device.device_id}.csv`);
      
      // Build simple CSV structure
      let csvContent = 'Timestamp,DeviceID,DeviceType';
      // extract keys
      const schemaDoc = await DeviceType.findOne({ device_type: device.device_type });
      const fieldNames = schemaDoc ? Array.from(schemaDoc.fields.keys()) : [];
      
      fieldNames.forEach(f => { csvContent += `,${f}`; });
      csvContent += '\n';

      readings.forEach(r => {
        let row = `${r.timestamp.toISOString()},${r.device_id},${r.device_type}`;
        fieldNames.forEach(f => {
          row += `,${r.payload[f] !== undefined ? r.payload[f] : ''}`;
        });
        csvContent += row + '\n';
      });

      return res.send(csvContent);
    }

    // Default JSON
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=telemetry-${device.device_id}.json`);
    res.json(readings);
  } catch (error) {
    console.error('Export telemetry error:', error);
    res.status(500).json({ message: 'Server error exporting data' });
  }
});

module.exports = router;
