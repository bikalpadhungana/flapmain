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
      {
        device_type: 'esp32_cam_v1',
        display_name: 'ESP32-CAM Live Surveillance Camera',
        fields: {
          stream_url: { type: 'string', unit: 'url' },
          capture_url: { type: 'string', unit: 'url' },
          ip_address: { type: 'string', unit: 'ip' },
          status: { type: 'string', unit: 'status' },
          rssi: { type: 'number', unit: 'dBm' }
        },
        commands: ['toggle_flash', 'take_snapshot', 'set_resolution'],
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
      },
    ];

    for (const dt of deviceTypes) {
      await DeviceType.create(dt);
      console.log(`Seeded device type: ${dt.device_type}`);
    }

    console.log('Seeding demo devices...');
    const hash = (key) => crypto.createHash('sha256').update(key).digest('hex');

    const devicesToSeed = [
      {
        device_id: 'ccc853990e8670ac94ecc4fcfdcb1988',
        org_id: defaultOrg._id,
        device_type: 'nfc_reader',
        name: 'Main Door NFC Reader',
        location: 'Front Gate',
        api_key_hash: hash('flap-key-001'),
        status: 'offline',
        activation_status: 'active',
      },
      {
        device_id: 'scale_hw_001',
        org_id: defaultOrg._id,
        device_type: 'weight_scale_v1',
        name: 'Medical Height & Weight Scale',
        location: 'Clinic Room 101',
        api_key_hash: hash('scale-key-001'),
        status: 'online',
        activation_status: 'active',
      },
      {
        device_id: 'flap-esp32-cam-001',
        org_id: defaultOrg._id,
        device_type: 'esp32_cam_v1',
        name: 'Gate 1 Surveillance ESP32-CAM',
        location: 'Clinic Front Gate',
        api_key_hash: hash('flap_dev_c4m_88291a0b3e921d7465f'),
        status: 'online',
        activation_status: 'active',
      },
      // Weather Station Node #1 (Primary + Short Alias)
      {
        device_id: 'flap-flap-aws-001-7zhj',
        org_id: defaultOrg._id,
        device_type: 'weather_station_v1',
        name: 'FlapMain Weather Station Pro #1 (Primary)',
        location: 'Roof Telemetry Deck',
        api_key_hash: hash('flap_dev_aab35d32a090cf3116ec2fdd83bc063e46ee39faeeffc8ca'),
        status: 'online',
        activation_status: 'active',
      },
      {
        device_id: 'flap-aws-7zhj',
        org_id: defaultOrg._id,
        device_type: 'weather_station_v1',
        name: 'FlapMain Weather Station Pro #1 (Short ID Alias)',
        location: 'Roof Telemetry Deck',
        api_key_hash: hash('flap_dev_aab35d32a090cf3116ec2fdd83bc063e46ee39faeeffc8ca'),
        status: 'online',
        activation_status: 'active',
      },
      // Weather Station Node #2 (Secondary + Short Alias)
      {
        device_id: 'flap-flap-aws-002-node',
        org_id: defaultOrg._id,
        device_type: 'weather_station_v1',
        name: 'FlapMain Weather Station Pro #2 (Secondary)',
        location: 'South Perimeter Field',
        api_key_hash: hash('flap_dev_aab35d32a090cf3116ec2fdd83bc063e46ee39faeeffc8ca'),
        status: 'online',
        activation_status: 'active',
      },
      {
        device_id: 'flap-aws-002',
        org_id: defaultOrg._id,
        device_type: 'weather_station_v1',
        name: 'FlapMain Weather Station Pro #2 (Short ID Alias)',
        location: 'South Perimeter Field',
        api_key_hash: hash('flap_dev_aab35d32a090cf3116ec2fdd83bc063e46ee39faeeffc8ca'),
        status: 'online',
        activation_status: 'active',
      },
      // LoRa Mesh Network Nodes
      {
        device_id: 'esp_gateway_node_01',
        org_id: defaultOrg._id,
        device_type: 'lora_gateway_v1',
        name: 'ESP32 LoRa Gateway Relay (Base Station)',
        location: 'Clinic Network Rack',
        api_key_hash: hash('gateway_key_998231'),
        status: 'online',
        activation_status: 'active',
      },
      {
        device_id: 'nano_repeater_node_01',
        org_id: defaultOrg._id,
        device_type: 'lora_repeater_v1',
        name: 'Arduino Nano LoRa Mesh Repeater #01',
        location: 'Midway Tower Hill',
        api_key_hash: hash('repeater_key_112049'),
        status: 'online',
        activation_status: 'active',
      },
      {
        device_id: 'sos_mesh_node_01',
        org_id: defaultOrg._id,
        device_type: 'lora_sos_v1',
        name: 'Emergency SOS Mesh Trigger Node',
        location: 'Safety Officer Station',
        api_key_hash: hash('sos_key_443219'),
        status: 'online',
        activation_status: 'active',
      },
      {
        device_id: 'flap-walkie-001',
        org_id: defaultOrg._id,
        device_type: 'walkie_talkie_v1',
        name: 'FlapMain LoRa Walkie-Talkie Alpha (Node #101)',
        location: 'Field Responder Alpha',
        api_key_hash: hash('walkie_key_101_alpha'),
        status: 'online',
        activation_status: 'active',
      },
      {
        device_id: 'flap-walkie-002',
        org_id: defaultOrg._id,
        device_type: 'walkie_talkie_v1',
        name: 'FlapMain LoRa Walkie-Talkie Bravo (Node #102)',
        location: 'Field Responder Bravo',
        api_key_hash: hash('walkie_key_102_bravo'),
        status: 'online',
        activation_status: 'active',
      },
      {
        device_id: 'esp8266_walkie_001',
        org_id: defaultOrg._id,
        device_type: 'walkie_talkie_v1',
        name: 'FlapMain ESP8266 LoRa Walkie-Talkie Charlie (Node #103)',
        location: 'Field Command Unit Charlie',
        api_key_hash: hash('walkie_key_103_esp8266'),
        status: 'online',
        activation_status: 'active',
      },
    ];

    for (const dev of devicesToSeed) {
      await Device.create(dev);
      console.log(`Seeded device: ${dev.device_id} (${dev.name})`);
    }

    console.log('Database seeding completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error(`Error seeding database: ${error.message}`);
    process.exit(1);
  }
};

seed();
