const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getJwtSecret } = require('../config/security');

const router = express.Router();

// Simple in-memory brute-force guard: max 10 failed attempts per IP+email per 15 min.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const loginFailures = new Map();

const failureKey = (req, email) => `${req.ip}|${String(email).toLowerCase()}`;
const isLockedOut = (key) => {
  const entry = loginFailures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > LOGIN_WINDOW_MS) {
    loginFailures.delete(key);
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILURES;
};
const recordFailure = (key) => {
  const entry = loginFailures.get(key);
  if (!entry || Date.now() - entry.first > LOGIN_WINDOW_MS) {
    loginFailures.set(key, { count: 1, first: Date.now() });
  } else {
    entry.count += 1;
  }
  if (loginFailures.size > 10000) loginFailures.clear();
};

// @route   POST /v1/auth/login
// @desc    Authenticate user & get token
// @access  Public
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Please enter email and password' });
  }

  const key = failureKey(req, email);
  if (isLockedOut(key)) {
    return res.status(429).json({ message: 'Too many failed login attempts. Try again later.' });
  }

  try {
    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    const isMatch = user ? await user.comparePassword(String(password)) : false;
    if (!isMatch) {
      recordFailure(key);
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    loginFailures.delete(key);

    const token = jwt.sign(
      { id: user._id, role: user.role },
      getJwtSecret(),
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        org_id: user.org_id,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
