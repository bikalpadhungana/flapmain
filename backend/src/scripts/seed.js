const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const connectDB = require('../config/db');
const Org = require('../models/Org');
const User = require('../models/User');
const DeviceType = require('../models/DeviceType');
const Device = require('../models/Device');
const crypto = require('crypto');

const seed = async () => {
  try {
    await connectDB();

    console.log('Clearing database...');
    await Org.deleteMany({});
    await User.deleteMany({});
    await DeviceType.deleteMany({});
    await Device.deleteMany({});

    console.log('Creating default organization (Flap)...');
    const defaultOrg = await Org.create({
      name: 'Flap Org',
      slug: 'flap',
    });
    console.log(`Organization created: ${defaultOrg.name} (${defaultOrg._id})`);

    console.log('Creating default admin user...');
    // The password will be automatically hashed by the User Schema pre-save hook
    const adminUser = await User.create({
      org_id: defaultOrg._id,
      email: 'admin@flap.com',
      password: 'adminpassword123',
      role: 'admin',
    });
    console.log(`Admin user created: ${adminUser.email}`);

    console.log('Seeding device type schemas...');
    const deviceTypes = [
      {
        device_type: 'weight_scale_v1',
        display_name: 'Medical Height & Weight Scale',
        fields: {
          weight_kg: { type: 'number', unit: 'kg' },
          height_cm: { type: 'number', unit: 'cm' },
        },
        commands: [],
      },
      {
        device_type: 'height_sensor_v1',
        display_name: 'Ultrasonic Height Sensor',
        fields: {
          height_cm: { type: 'number', unit: 'cm' },
        },
        commands: [],
      },
      {
        device_type: 'nfc_reader',
        display_name: 'NFC Card Reader Terminal',
        fields: {
          tag_uid: { type: 'string', unit: 'uid' },
          tag_type: { type: 'string', unit: 'type' },
          type: { type: 'string', unit: 'action' },
        },
        commands: [],
      },
      {
        device_type: 'water_tank_v1',
        display_name: 'Water Tank Temperature & Actuator',
        fields: {
          temperature_c: { type: 'number', unit: '°C' },
          actuator_state: { type: 'boolean' },
        },
        commands: ['set_actuator'],
      },
      {
        device_type: 'flap_switch_v1',
        display_name: 'Flap Switching Hardware',
        fields: {
          switch_state: { type: 'boolean' },
        },
        commands: ['toggle_switch', 'set_switch'],
      },
      {
        device_type: 'ultrasonic_distance_v1',
        display_name: 'ESP8266 Ultrasonic Distance Sensor',
        fields: {
          distance_cm: { type: 'number', unit: 'cm' },
          water_level_percent: { type: 'number', unit: '%' },
        },
        commands: ['trigger_ping'],
      },
    ];

    for (const dt of deviceTypes) {
      await DeviceType.create(dt);
      console.log(`Seeded device type: ${dt.device_type}`);
    }

    console.log('Seeding demo devices...');
    const api_key_hash = crypto.createHash('sha256').update('flap-key-001').digest('hex');
    const scale_api_key_hash = crypto.createHash('sha256').update('scale-key-001').digest('hex');

    await Device.create({
      device_id: 'ccc853990e8670ac94ecc4fcfdcb1988',
      org_id: defaultOrg._id,
      device_type: 'nfc_reader',
      name: 'Main Door NFC Reader',
      location: 'Front Gate',
      api_key_hash,
      status: 'offline',
      activation_status: 'active',
    });

    await Device.create({
      device_id: 'scale_hw_001',
      org_id: defaultOrg._id,
      device_type: 'weight_scale_v1',
      name: 'Medical Height & Weight Scale',
      location: 'Clinic Room 101',
      api_key_hash: scale_api_key_hash,
      status: 'online',
      activation_status: 'active',
    });
    console.log('Demo NFC reader and Height & Weight scale device seeded successfully.');


    console.log('Database seeding completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error(`Error seeding database: ${error.message}`);
    process.exit(1);
  }
};

seed();
