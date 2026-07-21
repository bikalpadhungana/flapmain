const express = require('express');
const crypto = require('crypto');
const ApiKey = require('../models/ApiKey');
const { authenticateUser } = require('../middleware/auth');

const router = express.Router();

// Helper to hash API keys using SHA-256
const hashKey = (key) => {
  return crypto.createHash('sha256').update(key).digest('hex');
};

// @route   POST /v1/api-keys
// @desc    Generate a new API key for external platform integration
// @access  Private (Dashboard users)
router.post('/', authenticateUser, async (req, res) => {
  const { label, scopes, rate_limit_rpm } = req.body;

  if (!label) {
    return res.status(400).json({ message: 'Please provide a label for this API key' });
  }

  try {
    // Generate raw key
    const rawKey = 'flap_partner_' + crypto.randomBytes(24).toString('hex');
    const keyHash = hashKey(rawKey);

    const apiKey = await ApiKey.create({
      org_id: req.org_id,
      key_hash: keyHash,
      label,
      scopes: scopes || ['read:devices', 'read:readings'],
      rate_limit_rpm: rate_limit_rpm || 60,
    });

    res.status(201).json({
      message: 'API Key generated successfully. Please copy it now as it won\'t be shown again!',
      apiKey: rawKey,
      details: {
        id: apiKey._id,
        label: apiKey.label,
        scopes: apiKey.scopes,
        rate_limit_rpm: apiKey.rate_limit_rpm,
        createdAt: apiKey.createdAt,
      },
    });
  } catch (error) {
    console.error('Generate API Key error:', error);
    res.status(500).json({ message: 'Server error generating API Key' });
  }
});

// @route   GET /v1/api-keys
// @desc    List all API keys scoped to the user's organization
// @access  Private (Dashboard users)
router.get('/', authenticateUser, async (req, res) => {
  try {
    const keys = await ApiKey.find({ org_id: req.org_id }).select('-key_hash');
    res.json(keys);
  } catch (error) {
    console.error('List API Keys error:', error);
    res.status(500).json({ message: 'Server error fetching API Keys' });
  }
});

// @route   DELETE /v1/api-keys/:id
// @desc    Revoke/Delete an API key
// @access  Private (Dashboard users)
router.delete('/:id', authenticateUser, async (req, res) => {
  try {
    const result = await ApiKey.deleteOne({
      _id: req.params.id,
      org_id: req.org_id,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'API Key not found or unauthorized' });
    }

    res.json({ message: 'API Key revoked successfully' });
  } catch (error) {
    console.error('Revoke API Key error:', error);
    res.status(500).json({ message: 'Server error revoking API Key' });
  }
});

module.exports = router;
