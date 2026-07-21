const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const ApiKey = require('../models/ApiKey');

// Hash helper for API keys
const hashApiKey = (key) => {
  return crypto.createHash('sha256').update(key).digest('hex');
};

// Middleware: Authenticate User via JWT
const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Authentication token missing or invalid' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'supersecretjwtkeychangeitinproduction');

    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({ message: 'User no longer exists' });
    }

    req.user = user;
    req.org_id = user.org_id; // For multi-tenant scoping
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Middleware: Authenticate External API Key
const authenticateApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(401).json({ message: 'API key missing' });
    }

    const keyHash = hashApiKey(apiKey);
    const keyDoc = await ApiKey.findOne({ key_hash: keyHash });

    if (!keyDoc) {
      return res.status(401).json({ message: 'Invalid API key' });
    }

    // Attach info to request
    req.apiKey = keyDoc;
    req.org_id = keyDoc.org_id;

    // Update last used asynchronously
    ApiKey.updateOne({ _id: keyDoc._id }, { $set: { last_used: new Date() } }).catch((err) =>
      console.error('Error updating last_used for API key:', err)
    );

    next();
  } catch (error) {
    return res.status(500).json({ message: 'Server error during API key validation' });
  }
};

// Role authorization helper
const authorizeRole = (requiredRole) => {
  return (req, res, next) => {
    if (!req.user || req.user.role !== requiredRole) {
      return res.status(403).json({ message: 'Access denied: insufficient permissions' });
    }
    next();
  }
};

// Scope authorization helper for API keys
const authorizeScope = (requiredScope) => {
  return (req, res, next) => {
    if (!req.apiKey || !req.apiKey.scopes.includes(requiredScope)) {
      return res.status(403).json({ message: `Access denied: scope '${requiredScope}' required` });
    }
    next();
  };
};

module.exports = {
  authenticateUser,
  authenticateApiKey,
  authorizeRole,
  authorizeScope,
  hashApiKey,
};
