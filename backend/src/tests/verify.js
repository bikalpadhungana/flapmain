const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Org = require('../models/Org');
const User = require('../models/User');
const DeviceType = require('../models/DeviceType');
const Device = require('../models/Device');
const { hashApiKey } = require('../middleware/auth');

const runVerification = async () => {
  console.log('--- Starting FlapMain System Verification ---');
  try {
    // 1. Database Connection
    console.log('1. Connecting to database...');
    await connectDB();

    // 2. Fetch seeded organization
    console.log('2. Verifying seeded Organization...');
    const org = await Org.findOne({ slug: 'flap' });
    if (!org) {
      throw new Error('Seeded organization (slug: "flap") not found. Please run seed script first: npm run seed --workspace=backend');
    }
    console.log(`✓ Org found: ${org.name} (${org._id})`);

    // 3. Fetch seeded admin user
    console.log('3. Verifying seeded Admin user...');
    const user = await User.findOne({ email: 'admin@flap.com' });
    if (!user) {
      throw new Error('Seeded admin user not found.');
    }
    console.log(`✓ Admin user found: ${user.email} (Role: ${user.role})`);

    // 4. Check device types in Schema Registry
    console.log('4. Verifying seeded Device Types...');
    const deviceTypes = await DeviceType.find({});
    if (deviceTypes.length < 3) {
      throw new Error(`Seeded device types count is low: ${deviceTypes.length}/3`);
    }
    console.log(`✓ Found ${deviceTypes.length} schemas in registry:`);
    deviceTypes.forEach((dt) => {
      console.log(`   - ${dt.device_type} (${dt.display_name})`);
    });

    // 5. Test key hashing functionality
    console.log('5. Testing API key hashing...');
    const rawKey = 'flap_dev_testkey123';
    const keyHash = hashApiKey(rawKey);
    if (!keyHash || keyHash.length !== 64) {
      throw new Error('API key hashing returned invalid hash length');
    }
    console.log('✓ API Key hashing is functioning correctly');

    console.log('\n--- FlapMain Core Scaffold Verification Successful! ---');
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Verification Failed:', error.message);
    process.exit(1);
  }
};

runVerification();
