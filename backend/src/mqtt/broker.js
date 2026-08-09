const { Aedes } = require('aedes');
const aedes = new Aedes();
const net = require('net');
const TapLog = require('../models/TapLog');

const PORT = 1883;

// A basic authentication handler. Real production systems will verify the JWT or API key.
aedes.authenticate = function (client, username, password, callback) {
  // Pass authentication for now to allow simple integration testing.
  // We can add strict API key checks against the database here later.
  callback(null, true);
};

// Start the broker server
const startBroker = () => {
  const server = net.createServer(aedes.handle);
  
  server.listen(PORT, function () {
    console.log(`[MQTT] Native Aedes Broker started and listening on port ${PORT}`);
  });

  aedes.on('client', function (client) {
    console.log(`[MQTT] Client connected: ${client.id}`);
  });

  aedes.on('clientDisconnect', function (client) {
    console.log(`[MQTT] Client disconnected: ${client.id}`);
  });

  aedes.on('publish', async function (packet, client) {
    if (!client) return; // Internal messages don't have a client

    // Listen to telemetry topics: flapmain/telemetry/{device_id}
    if (packet.topic.startsWith('flapmain/telemetry/')) {
      const device_id = packet.topic.split('/')[2];
      try {
        const payload = JSON.parse(packet.payload.toString());
        console.log(`[MQTT] Telemetry received from ${device_id}:`, payload);
        
        // 1. Fetch Device from DB to determine type
        const Device = require('../models/Device');
        const Reading = require('../models/Reading');
        const device = await Device.findOne({ device_id });
        
        if (!device) {
           console.warn(`[MQTT] Device ${device_id} not found in registry. Dropping payload.`);
           return;
        }

        if (device.activation_status !== 'active') {
           console.warn(`[MQTT] Device ${device_id} is ${device.activation_status}. Dropping payload until activated by admin.`);
           return;
        }

        // 2. Route payload based on device_type
        if (device.device_type === 'nfc_reader') {
          // Legacy check-in logic
          const savedRecord = await TapLog.create({
            uid: payload.uid || payload.tag_uid,
            tag_type: payload.tag_type || 'MIFARE',
            type: payload.type || 'checkin',
            flapid: payload.flapid,
            device_id: device_id,
            business_id: payload.business_id,
            timestamp: new Date(),
            forwardedMain: false, // Flagged for the Sync Worker
          });
          
          console.log(`[MQTT] NFC Tap queued for device ${device_id}`);

          try {
            const io = require('../socket').getIO();
            io.emit('new_tap', savedRecord);
          } catch (wsErr) {
            console.warn('Could not emit Socket.io event:', wsErr.message);
          }
        } else if (device.device_type === 'weight_scale_v1' || device.device_type === 'height_sensor_v1') {
          // Medical Sensor reading (weight or height)
          const payloadData = {};
          if (payload.height_cm !== undefined) payloadData.height_cm = Number(payload.height_cm);
          if (payload.weight_kg !== undefined) payloadData.weight_kg = Number(payload.weight_kg);

          const reading = await Reading.create({
            timestamp: new Date(),
            device_id: device.device_id,
            org_id: device.org_id,
            device_type: device.device_type,
            payload: payloadData,
          });

          console.log(`[MQTT] Medical Sensor Reading saved for device ${device_id} (${device.device_type})`);

          try {
            const io = require('../socket').getIO();
            io.emit('new_scale_reading', reading);
          } catch (wsErr) {
            console.warn('Could not emit Socket.io event:', wsErr.message);
          }
        } else {
           console.warn(`[MQTT] Unknown device type ${device.device_type} for telemetry routing.`);
        }
      } catch (err) {
        console.error(`[MQTT] Error processing telemetry from ${device_id}:`, err.message);
      }
    }
  });
};

module.exports = { startBroker, aedes };
