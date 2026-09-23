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
          mq9_gas: { type: 'number', unit: 'ADC' },
          mq3_gas: { type: 'number', unit: 'ADC' },
          battery_mv: { type: 'number', unit: 'mV' },
          mesh_origin_node: { type: 'number', unit: 'node_id' },
          target_node: { type: 'number', unit: 'node_id' },
          mesh_hops_left: { type: 'number', unit: 'hops' },
          alert_level: { type: 'number', unit: 'level' },
          snr: { type: 'number', unit: 'dB' },
          time: { type: 'string', unit: 'time' },
          ap_bssid: { type: 'string', unit: 'bssid' },
          rssi: { type: 'number', unit: 'dBm' }
        },
        commands: ['trigger_ping'],
      },
      { upsert: true, new: true }
    );
    console.log(`[DeviceType] weather_station_v1 registered: ${weatherDeviceType._id}`);

    // 2. Provision AWS Stations: Node #1 & Node #2
    const stations = [
      {
        device_id: 'flap-flap-aws-001-7zhj',
        name: 'FlapMain Weather Station Pro #1 (Primary)',
        location: 'Roof Telemetry Deck',
        apiKey: 'flap_dev_aab35d32a090cf3116ec2fdd83bc063e46ee39faeeffc8ca'
      },
      {
        device_id: 'flap-aws-7zhj',
        name: 'FlapMain Weather Station Pro #1 (Short ID Alias)',
        location: 'Roof Telemetry Deck',
        apiKey: 'flap_dev_aab35d32a090cf3116ec2fdd83bc063e46ee39faeeffc8ca'
      },
      {
        device_id: 'flap-flap-aws-002-node',
        name: 'FlapMain Weather Station Pro #2 (Secondary)',
        location: 'South Perimeter Field',
        apiKey: 'flap_dev_aws_node_02_key_884192'
      },
      {
        device_id: 'flap-aws-002',
        name: 'FlapMain Weather Station Pro #2 (Short ID Alias)',
        location: 'South Perimeter Field',
        apiKey: 'flap_dev_aws_node_02_key_884192'
      }
    ];

    for (const s of stations) {
      const apiKeyHash = crypto.createHash('sha256').update(s.apiKey).digest('hex');
      const dev = await Device.findOneAndUpdate(
        { device_id: s.device_id },
        {
          device_id: s.device_id,
          org_id: defaultOrg._id,
          device_type: 'weather_station_v1',
          name: s.name,
          location: s.location,
          api_key_hash: apiKeyHash,
          status: 'online',
          activation_status: 'active',
          last_seen: new Date()
        },
        { upsert: true, new: true }
      );
      console.log(`[Device] ${s.device_id} provisioned successfully: ${dev._id}`);
    }

    console.log('Weather Station Seeding Completed Successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding weather station:', error);
    process.exit(1);
  }
};

seedWeatherStation();
