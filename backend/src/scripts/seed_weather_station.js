const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const connectDB = require('../config/db');
const Org = require('../models/Org');
const DeviceType = require('../models/DeviceType');
const Device = require('../models/Device');
const crypto = require('crypto');

const seedWeatherStation = async () => {
  try {
    await connectDB();
    console.log('Connecting to database for Weather Station seeding...');

    const defaultOrg = (await Org.findOne({ slug: 'flap' })) || (await Org.findOne());
    if (!defaultOrg) {
      console.error('Error: No organization found in database.');
      process.exit(1);
    }

    // 1. Seed or Update DeviceType: weather_station_v1
    const weatherDeviceType = await DeviceType.findOneAndUpdate(
      { device_type: 'weather_station_v1' },
      {
        device_type: 'weather_station_v1',
        display_name: 'FlapMain Weather Station Pro',
        fields: {
          wind_speed: { type: 'number', unit: 'km/h' },
          wind_direction: { type: 'string', unit: 'dir' },
          temperature: { type: 'number', unit: '°C' },
          humidity: { type: 'number', unit: '%' },
          pressure: { type: 'number', unit: 'Pa' },
          altitude: { type: 'number', unit: 'm' },
          light: { type: 'number', unit: 'lux' },
          time: { type: 'string', unit: 'time' },
          ap_bssid: { type: 'string', unit: 'bssid' },
          rssi: { type: 'number', unit: 'dBm' }
        },
        commands: [],
      },
      { upsert: true, new: true }
    );
    console.log(`[DeviceType] weather_station_v1 registered: ${weatherDeviceType._id}`);

    // 2. Provision Device: flap-flap-aws-001-7zhj
    const apiKeyRaw = 'flap_dev_aab35d32a090cf3116ec2fdd83bc063e46ee39faeeffc8ca';
    const apiKeyHash = crypto.createHash('sha256').update(apiKeyRaw).digest('hex');

    const weatherDevice = await Device.findOneAndUpdate(
      { device_id: 'flap-flap-aws-001-7zhj' },
      {
        device_id: 'flap-flap-aws-001-7zhj',
        org_id: defaultOrg._id,
        device_type: 'weather_station_v1',
        name: 'FlapMain Weather Station Pro #1',
        location: 'Roof Telemetry Deck',
        api_key_hash: apiKeyHash,
        status: 'online',
        activation_status: 'active',
        last_seen: new Date()
      },
      { upsert: true, new: true }
    );
    console.log(`[Device] flap-flap-aws-001-7zhj provisioned successfully: ${weatherDevice._id}`);

    console.log('Weather Station Seeding Completed Successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding weather station:', error);
    process.exit(1);
  }
};

seedWeatherStation();
