const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const connectDB = require('../config/db');
const Org = require('../models/Org');
const DeviceType = require('../models/DeviceType');
const Device = require('../models/Device');
const crypto = require('crypto');

const seedLoraMeshDevices = async () => {
  try {
    await connectDB();
    console.log('Connecting to database for LoRa Mesh Node seeding...');

    let defaultOrg = (await Org.findOne({ slug: 'flap' })) || (await Org.findOne());
    if (!defaultOrg) {
      defaultOrg = await Org.create({
        name: 'Flap Org',
        slug: 'flap',
      });
      console.log(`Created organization: ${defaultOrg.name}`);
    }

    // 1. Ensure Device Types exist for LoRa Mesh Nodes
    const meshDeviceTypes = [
      {
        device_type: 'weather_station_v1',
        display_name: 'FlapMain Weather Station Pro (LoRa Mesh)',
        fields: {
          wind_speed: { type: 'number', unit: 'km/h' },
          wind_direction: { type: 'string', unit: 'dir' },
          temperature: { type: 'number', unit: '°C' },
          humidity: { type: 'number', unit: '%' },
          pressure: { type: 'number', unit: 'Pa' },
          altitude: { type: 'number', unit: 'm' },
          light: { type: 'number', unit: 'lux' },
          mq3_gas: { type: 'number', unit: 'ADC' },
          time: { type: 'string', unit: 'time' },
          ap_bssid: { type: 'string', unit: 'bssid' },
          rssi: { type: 'number', unit: 'dBm' }
        },
        commands: ['trigger_ping'],
      },
      {
        device_type: 'lora_gateway_v1',
        display_name: 'ESP32 SX1278 LoRa Gateway Relay',
        fields: {
          packets_received: { type: 'number', unit: 'count' },
          gateway_ip: { type: 'string', unit: 'ip' },
          wifi_rssi: { type: 'number', unit: 'dBm' },
        },
        commands: ['restart_gateway', 'clear_cache'],
      },
      {
        device_type: 'lora_repeater_v1',
        display_name: 'Arduino Nano SX1278 Mesh Repeater Node',
        fields: {
          packets_relayed: { type: 'number', unit: 'count' },
          battery_mv: { type: 'number', unit: 'mV' },
        },
        commands: [],
      },
      {
        device_type: 'lora_sos_v1',
        display_name: 'LoRa Mesh Emergency SOS Node',
        fields: {
          alert_level: { type: 'number', unit: 'level' },
          sos_triggered: { type: 'boolean' },
          battery_mv: { type: 'number', unit: 'mV' },
        },
        commands: ['cancel_sos'],
      },
      {
        device_type: 'walkie_talkie_v1',
        display_name: 'FlapMain LoRa Walkie-Talkie & Emergency SOS Communicator',
        fields: {
          text_msg: { type: 'string', unit: 'text' },
          alert_level: { type: 'number', unit: 'level' },
          battery_mv: { type: 'number', unit: 'mV' },
          mesh_origin_node: { type: 'number', unit: 'node_id' },
          mesh_hops_left: { type: 'number', unit: 'hops' },
          rssi: { type: 'number', unit: 'dBm' },
          snr: { type: 'number', unit: 'dB' },
        },
        commands: ['broadcast_sos', 'send_text'],
      }
    ];

    for (const dt of meshDeviceTypes) {
      await DeviceType.findOneAndUpdate(
        { device_type: dt.device_type },
        dt,
        { upsert: true, new: true }
      );
      console.log(`[DeviceType] Configured: ${dt.device_type}`);
    }

    // 2. Pre-provision hardware devices with hashed API Keys & Node IDs
    const loraDevices = [
      {
        device_id: 'flap-flap-aws-001-7zhj',
        device_type: 'weather_station_v1',
        name: 'AWS Weather Station Node #01 (LoRa 433MHz)',
        location: 'Roof Telemetry Deck',
        apiKey: 'flap_dev_aab35d32a090cf3116ec2fdd83bc063e46ee39faeeffc8ca',
      },
      {
        device_id: 'esp_gateway_node_01',
        device_type: 'lora_gateway_v1',
        name: 'ESP32 LoRa Gateway Relay (Base Station)',
        location: 'Clinic Network Rack',
        apiKey: 'gateway_key_998231',
      },
      {
        device_id: 'nano_repeater_node_01',
        device_type: 'lora_repeater_v1',
        name: 'Arduino Nano LoRa Mesh Repeater #01',
        location: 'Midway Tower Hill',
        apiKey: 'repeater_key_112049',
      },
      {
        device_id: 'sos_mesh_node_01',
        device_type: 'lora_sos_v1',
        name: 'Emergency SOS Mesh Trigger Node',
        location: 'Safety Officer Station',
        apiKey: 'sos_key_443219',
      },
      {
        device_id: 'flap-walkie-001',
        device_type: 'walkie_talkie_v1',
        name: 'FlapMain LoRa Walkie-Talkie Alpha (Node #101)',
        location: 'Field Responder Alpha',
        apiKey: 'walkie_key_101_alpha',
      },
      {
        device_id: 'flap-walkie-002',
        device_type: 'walkie_talkie_v1',
        name: 'FlapMain LoRa Walkie-Talkie Bravo (Node #102)',
        location: 'Field Responder Bravo',
        apiKey: 'walkie_key_102_bravo',
      },
      {
        device_id: 'esp8266_walkie_001',
        device_type: 'walkie_talkie_v1',
        name: 'FlapMain ESP8266 LoRa Walkie-Talkie Charlie (Node #103)',
        location: 'Field Command Unit Charlie',
        apiKey: 'walkie_key_103_esp8266',
      }
    ];

    for (const d of loraDevices) {
      const apiKeyHash = crypto.createHash('sha256').update(d.apiKey).digest('hex');
      await Device.findOneAndUpdate(
        { device_id: d.device_id },
        {
          device_id: d.device_id,
          org_id: defaultOrg._id,
          device_type: d.device_type,
          name: d.name,
          location: d.location,
          api_key_hash: apiKeyHash,
          status: 'online',
          activation_status: 'active',
          last_seen: new Date()
        },
        { upsert: true, new: true }
      );
      console.log(`[Device] Provisioned LoRa Node: ${d.device_id} (${d.name})`);
    }

    console.log('✅ All LoRa Mesh Hardware Nodes Seeded Successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding LoRa mesh devices:', error);
    process.exit(1);
  }
};

seedLoraMeshDevices();
