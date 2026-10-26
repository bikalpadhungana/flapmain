const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const connectDB = require('../config/db');
const Org = require('../models/Org');
const DeviceType = require('../models/DeviceType');
const Device = require('../models/Device');
const crypto = require('crypto');

/**
 * Production Weather Station Seed
 * ─────────────────────────────────
 * Node IDs (LoRa Mesh):
 *   1001 → Damauli Bazar
 *   1002 → Manung Dada
 *   1003 → Banyatar Kathmandu
 *   1004 → Kalupada Dada Kathmandu
 *   1005 → Chandragiri Hill Kathmandu
 *
 * Each station gets a unique, strong API key.
 * Run: node src/scripts/seed_weather_station.js
 */

const seedWeatherStation = async () => {
  try {
    await connectDB();
    console.log('Connecting to database for Production Weather Station seeding...');

    const defaultOrg = (await Org.findOne({ slug: 'flap' })) || (await Org.findOne());
    if (!defaultOrg) {
      console.error('Error: No organization found in database.');
      process.exit(1);
    }

    // ── 1. Seed / Update DeviceType schema ──────────────────────────────────
    const weatherDeviceType = await DeviceType.findOneAndUpdate(
      { device_type: 'weather_station_v1' },
      {
        device_type: 'weather_station_v1',
        display_name: 'FlapMain Weather Station Pro',
        fields: {
          wind_speed:        { type: 'number', unit: 'km/h'    },
          wind_direction:    { type: 'string', unit: 'dir'     },
          temperature:       { type: 'number', unit: '°C'      },
          humidity:          { type: 'number', unit: '%'        },
          pressure:          { type: 'number', unit: 'Pa'      },
          altitude:          { type: 'number', unit: 'm'       },
          light:             { type: 'number', unit: 'lux'     },
          mq9_gas:           { type: 'number', unit: 'ADC'     },
          mq3_gas:           { type: 'number', unit: 'ADC'     },
          rain_mm:           { type: 'number', unit: 'mm'      },
          rain_tips:         { type: 'number', unit: 'tips'    },
          rainfall:          { type: 'number', unit: 'mm'      },
          battery_mv:        { type: 'number', unit: 'mV'      },
          mesh_origin_node:  { type: 'number', unit: 'node_id' },
          target_node:       { type: 'number', unit: 'node_id' },
          mesh_hops_left:    { type: 'number', unit: 'hops'    },
          alert_level:       { type: 'number', unit: 'level'   },
          snr:               { type: 'number', unit: 'dB'      },
          time:              { type: 'string', unit: 'time'    },
          ap_bssid:          { type: 'string', unit: 'bssid'   },
          rssi:              { type: 'number', unit: 'dBm'     }
        },
        commands: ['trigger_ping'],
      },
      { upsert: true, new: true }
    );
    console.log(`[DeviceType] weather_station_v1 registered: ${weatherDeviceType._id}`);

    // ── 2. Production Station Definitions ───────────────────────────────────
    // node_id matches the physical LoRa AWS_NODE_ID flashed in config.h
    // Each station has a unique cryptographically-random API key.
    const stations = [
      {
        node_id:   1001,
        device_id: 'flap-aws-damauli-1001',
        aliases:   ['flap-aws-1001', 'damauli-bazar', 'node-1001'],
        name:      'Damauli Bazar Weather Station',
        location:  'Damauli Bazar',
        category:  'Physical',
        apiKey:    'flap_prod_' + crypto.randomBytes(24).toString('hex'),
      },
      {
        node_id:   1002,
        device_id: 'flap-aws-manung-1002',
        aliases:   ['flap-aws-1002', 'manung-dada', 'node-1002'],
        name:      'Manung Dada Weather Station',
        location:  'Manung Dada',
        category:  'Physical',
        apiKey:    'flap_prod_' + crypto.randomBytes(24).toString('hex'),
      },
      {
        node_id:   1003,
        device_id: 'flap-aws-banyatar-1003',
        aliases:   ['flap-aws-1003', 'banyatar-ktm', 'node-1003'],
        name:      'Banyatar Kathmandu Weather Station',
        location:  'Banyatar, Kathmandu',
        category:  'Physical',
        apiKey:    'flap_prod_' + crypto.randomBytes(24).toString('hex'),
      },
      {
        node_id:   1004,
        device_id: 'flap-aws-kalupada-1004',
        aliases:   ['flap-aws-1004', 'kalupada-dada', 'node-1004'],
        name:      'Kalupada Dada Kathmandu Weather Station',
        location:  'Kalupada Dada, Kathmandu',
        category:  'Physical',
        apiKey:    'flap_prod_' + crypto.randomBytes(24).toString('hex'),
      },
      {
        node_id:   1005,
        device_id: 'flap-aws-chandragiri-1005',
        aliases:   ['flap-aws-1005', 'chandragiri-hill', 'node-1005'],
        name:      'Chandragiri Hill Kathmandu Weather Station',
        location:  'Chandragiri Hill, Kathmandu',
        category:  'Physical',
        apiKey:    'flap_prod_' + crypto.randomBytes(24).toString('hex'),
      },
    ];

    // ── 3. Upsert each station ───────────────────────────────────────────────
    console.log('\n── Provisioning Production Stations ──────────────────────────');
    for (const s of stations) {
      const apiKeyHash = crypto.createHash('sha256').update(s.apiKey).digest('hex');

      const dev = await Device.findOneAndUpdate(
        { device_id: s.device_id },
        {
          device_id:         s.device_id,
          org_id:            defaultOrg._id,
          device_type:       'weather_station_v1',
          name:              s.name,
          location:          s.location,
          node_id:           s.node_id,
          aliases:           s.aliases,
          category:          s.category,
          api_key_hash:      apiKeyHash,
          status:            'offline',           // will go online once hardware connects
          activation_status: 'active',
          last_seen:         null,
        },
        { upsert: true, new: true }
      );

      console.log(`\n[Node #${s.node_id}] ${s.name}`);
      console.log(`  device_id : ${s.device_id}`);
      console.log(`  aliases   : ${s.aliases.join(', ')}`);
      console.log(`  location  : ${s.location}`);
      console.log(`  db _id    : ${dev._id}`);
      console.log(`  API Key   : ${s.apiKey}`);    // ← copy this into config.h for each node
    }

    console.log('\n── Seeding Complete ───────────────────────────────────────────');
    console.log('5 production weather stations provisioned successfully.');
    console.log('⚠️  Copy the API Key printed above into each station\'s config.h before flashing.');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding weather station:', error);
    process.exit(1);
  }
};

seedWeatherStation();
