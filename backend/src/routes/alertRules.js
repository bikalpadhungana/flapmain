const express = require('express');
const AlertRule = require('../models/AlertRule');
const Device = require('../models/Device');
const { authenticateUser } = require('../middleware/auth');

const router = express.Router();

// @route   POST /v1/alerts/rules
// @desc    Create a new alert rule for a device
// @access  Private (Dashboard users)
router.post('/', authenticateUser, async (req, res) => {
  const { device_id, condition, action, enabled } = req.body;

  if (!device_id || !condition || !action) {
    return res.status(400).json({ message: 'Please provide device_id, condition, and action specifications' });
  }

  // Validate condition
  const { field, operator, value } = condition;
  if (!field || !operator || !value || !['>', '<', '==', '!='].includes(operator)) {
    return res.status(400).json({ message: 'Invalid condition parameters. Operator must be >, <, ==, or !=' });
  }

  // Validate action
  const { type, target } = action;
  if (!type || !target || !['actuator', 'webhook'].includes(type)) {
    return res.status(400).json({ message: 'Invalid action parameters. Type must be actuator or webhook' });
  }

  try {
    // Check if device exists and belongs to organization
    const device = await Device.findOne({ device_id, org_id: req.org_id });
    if (!device) {
      return res.status(404).json({ message: `Device '${device_id}' not found or unauthorized` });
    }

    const rule = await AlertRule.create({
      device_id,
      org_id: req.org_id,
      condition: { field, operator, value },
      action: { type, target },
      enabled: enabled !== undefined ? enabled : true,
    });

    res.status(201).json(rule);
  } catch (error) {
    console.error('Create alert rule error:', error);
    res.status(500).json({ message: 'Server error creating alert rule' });
  }
});

// @route   GET /v1/alerts/rules
// @desc    List all alert rules for the organization
// @access  Private (Dashboard users)
router.get('/', authenticateUser, async (req, res) => {
  try {
    const rules = await AlertRule.find({ org_id: req.org_id });
    res.json(rules);
  } catch (error) {
    console.error('List alert rules error:', error);
    res.status(500).json({ message: 'Server error fetching alert rules' });
  }
});

// @route   DELETE /v1/alerts/rules/:id
// @desc    Delete an alert rule
// @access  Private (Dashboard users)
router.delete('/:id', authenticateUser, async (req, res) => {
  try {
    const result = await AlertRule.deleteOne({
      _id: req.params.id,
      org_id: req.org_id,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Alert rule not found or unauthorized' });
    }

    res.json({ message: 'Alert rule deleted successfully' });
  } catch (error) {
    console.error('Delete alert rule error:', error);
    res.status(500).json({ message: 'Server error deleting alert rule' });
  }
});

module.exports = router;
