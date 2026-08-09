/*
 * =====================================================================
 * FlapMain IoT — Migration: Ensure device types for scale hardware
 * =====================================================================
 * Run once: node src/scripts/add_height_sensor_type.js
 * Safe to run multiple times (idempotent upserts).
 * Does NOT delete any existing data.
 * =====================================================================
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const connectDB = require('../config/db');
const DeviceType = require('../models/DeviceType');

const migrate = async () => {
  try {
    await connectDB();
    console.log('[Migration] Connected to database.\n');

    // 1. Ensure weight_scale_v1 has BOTH fields (combined single-board device)
    const weightResult = await DeviceType.findOneAndUpdate(
      { device_type: 'weight_scale_v1' },
      {
        $set: {
          display_name: 'Medical Height & Weight Scale',
          fields: new Map([
            ['weight_kg', { type: 'number', unit: 'kg' }],
            ['height_cm', { type: 'number', unit: 'cm' }],
          ]),
        },
      },
      { upsert: true, new: true }
    );
    console.log(`[Migration] weight_scale_v1: ${weightResult ? 'OK (both fields)' : 'FAILED'}`);

    // 2. Also keep height_sensor_v1 available for future 2-board setup
    const heightResult = await DeviceType.findOneAndUpdate(
      { device_type: 'height_sensor_v1' },
      {
        $set: {
          device_type: 'height_sensor_v1',
          display_name: 'Ultrasonic Height Sensor',
          fields: new Map([
            ['height_cm', { type: 'number', unit: 'cm' }],
          ]),
          commands: [],
          version: 1,
        },
      },
      { upsert: true, new: true }
    );
    console.log(`[Migration] height_sensor_v1: ${heightResult ? 'OK' : 'FAILED'}`);

    console.log('\n[Migration] Complete. No data was deleted.');
    process.exit(0);
  } catch (error) {
    console.error(`[Migration Error] ${error.message}`);
    process.exit(1);
  }
};

migrate();
