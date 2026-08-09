const express = require('express');
const DeviceType = require('../models/DeviceType');
const { authenticateUser, authorizeRole } = require('../middleware/auth');

const router = express.Router();

// @route   GET /v1/device-types
// @desc    Get all device schemas registered in the Schema Registry
// @access  Private (Dashboard users)
router.get('/', authenticateUser, async (req, res) => {
  try {
    const schemas = await DeviceType.find({}).sort({ device_type: 1 });
    res.json(schemas);
  } catch (error) {
    console.error('Fetch device schemas error:', error);
    res.status(500).json({ message: 'Server error fetching schema definitions' });
  }
});

// @route   POST /v1/device-types
// @desc    Register a new device type schema in the Schema Registry
// @access  Private (Admin users only)
router.post('/', authenticateUser, authorizeRole('admin'), async (req, res) => {
  const { device_type, display_name, fields, commands } = req.body;

  if (!device_type || !display_name || !fields) {
    return res.status(400).json({ message: 'Please enter device_type, display_name, and fields schema definition' });
  }

  try {
    // Check if device_type already exists
    const existingType = await DeviceType.findOne({ device_type: device_type.toLowerCase() });
    if (existingType) {
      return res.status(400).json({ message: `Device type schema '${device_type}' already registered` });
    }

    // Basic structure validation of fields
    for (const [key, val] of Object.entries(fields)) {
      if (!val.type || !['number', 'boolean', 'string'].includes(val.type)) {
        return res.status(400).json({
          message: `Field '${key}' has invalid definition. 'type' is required and must be 'number', 'boolean', or 'string'`
        });
      }
    }

    const newSchema = await DeviceType.create({
      device_type: device_type.toLowerCase(),
      display_name,
      fields,
      commands: commands || [],
    });

    res.status(201).json(newSchema);
  } catch (error) {
    console.error('Create device schema error:', error);
    res.status(500).json({ message: 'Server error registering device type schema' });
  }
});

// @route   PUT /v1/device-types/:device_type
// @desc    Edit device type schema
// @access  Private (Admin users only)
router.put('/:device_type', authenticateUser, authorizeRole('admin'), async (req, res) => {
  const { display_name, fields, commands } = req.body;

  if (!display_name || !fields) {
    return res.status(400).json({ message: 'Please enter display_name and fields schema definition' });
  }

  try {
    const existingType = await DeviceType.findOne({ device_type: req.params.device_type.toLowerCase() });
    if (!existingType) {
      return res.status(404).json({ message: 'Device type schema not found' });
    }

    // Basic structure validation of fields
    for (const [key, val] of Object.entries(fields)) {
      if (!val.type || !['number', 'boolean', 'string'].includes(val.type)) {
        return res.status(400).json({
          message: `Field '${key}' has invalid definition. 'type' is required and must be 'number', 'boolean', or 'string'`
        });
      }
    }

    existingType.display_name = display_name;
    existingType.fields = fields;
    existingType.commands = commands || [];

    await existingType.save();

    res.json(existingType);
  } catch (error) {
    console.error('Update device schema error:', error);
    res.status(500).json({ message: 'Server error updating device type schema' });
  }
});

module.exports = router;
