const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const connectDB = require('../config/db');
const Org = require('../models/Org');
const DeviceType = require('../models/DeviceType');
const Device = require('../models/Device');
const crypto = require('crypto');

const seedCameraDevice = async () => {
  try {
    await connectDB();
    console.log('Connecting to database for ESP32-CAM camera seeding...');

    const defaultOrg = (await Org.findOne({ slug: 'flap' })) || (await Org.findOne());
    if (!defaultOrg) {
      console.error('Error: No organization found in database.');
      process.exit(1);
    }

    // 1. Seed or Update DeviceType: esp32_cam_v1
    const cameraDeviceType = await DeviceType.findOneAndUpdate(
      { device_type: 'esp32_cam_v1' },
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
      { upsert: true, new: true }
    );
    console.log(`[DeviceType] esp32_cam_v1 registered: ${cameraDeviceType._id}`);

    // 2. Provision Device: flap-esp32-cam-001
    const apiKeyRaw = 'flap_dev_c4m_88291a0b3e921d7465f';
    const apiKeyHash = crypto.createHash('sha256').update(apiKeyRaw).digest('hex');

    const cameraDevice = await Device.findOneAndUpdate(
      { device_id: 'flap-esp32-cam-001' },
      {
        device_id: 'flap-esp32-cam-001',
        org_id: defaultOrg._id,
        device_type: 'esp32_cam_v1',
        name: 'Gate 1 Surveillance ESP32-CAM',
        location: 'Clinic Front Gate',
        api_key_hash: apiKeyHash,
        status: 'online',
        activation_status: 'active',
        last_seen: new Date()
      },
      { upsert: true, new: true }
    );
    console.log(`[Device] flap-esp32-cam-001 provisioned successfully: ${cameraDevice._id}`);

    console.log('Camera Device Seeding Completed Successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding camera device:', error);
    process.exit(1);
  }
};

seedCameraDevice();
