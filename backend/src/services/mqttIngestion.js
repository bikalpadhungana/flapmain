const mqtt = require('mqtt');
const Device = require('../models/Device');
const DeviceType = require('../models/DeviceType');
const Reading = require('../models/Reading');
const AlertRule = require('../models/AlertRule');

let mqttClient = null;

const initMqttIngestion = () => {
  const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
  const username = process.env.MQTT_USERNAME;
  const password = process.env.MQTT_PASSWORD;

  console.log(`Connecting to MQTT broker at ${brokerUrl}...`);
  const client = mqtt.connect(brokerUrl, {
    username,
    password,
    clientId: 'flapmain_ingest_service_' + Math.random().toString(16).substring(2, 8),
    clean: true,
    reconnectPeriod: 15000,
    connectTimeout: 3000,
  });


  client.on('connect', () => {
    console.log('Successfully connected to MQTT Broker!');
    // Subscribe to telemetry topic: flap/{org_id}/{device_id}/telemetry
    client.subscribe('flap/+/+/telemetry', (err) => {
      if (err) {
        console.error('Failed to subscribe to telemetry topic:', err);
      } else {
        console.log('Subscribed to topic: flap/+/+/telemetry');
      }
    });

    // Subscribe to status/LWT topic: flap/{org_id}/{device_id}/status
    client.subscribe('flap/+/+/status', (err) => {
      if (err) {
        console.error('Failed to subscribe to status topic:', err);
      } else {
        console.log('Subscribed to topic: flap/+/+/status');
      }
    });
  });

  client.on('message', async (topic, message) => {
    try {
      const topicParts = topic.split('/');
      if (topicParts.length !== 4) return;

      const [prefix, orgId, deviceId, type] = topicParts;
      if (prefix !== 'flap') return;

      const payloadString = message.toString();
      const payload = JSON.parse(payloadString);

      if (type === 'status') {
        // Handle online/offline LWT updates
        const status = payload.status;
        if (status === 'online' || status === 'offline') {
          await Device.updateOne(
            { device_id: deviceId },
            { $set: { status, last_seen: new Date() } }
          );
          console.log(`Device status update: Device ${deviceId} is now ${status}`);
        }
        return;
      }

      if (type === 'telemetry') {
        // Handle device telemetry ingestion
        // 1. Fetch device metadata
        const device = await Device.findOne({ device_id: deviceId });
        if (!device) {
          console.warn(`[Ingest Warning] Received telemetry for unregistered device: ${deviceId}`);
          return;
        }

        // 2. Fetch device type schema
        const deviceTypeDoc = await DeviceType.findOne({ device_type: device.device_type });
        if (!deviceTypeDoc) {
          console.warn(`[Ingest Warning] Unknown device type schema: ${device.device_type}`);
          return;
        }

        // 3. Validate payload against device type schema fields
        const validatedPayload = {};
        const schemaFields = deviceTypeDoc.fields; // Map structure

        for (const [fieldName, fieldDef] of schemaFields.entries()) {
          const val = payload[fieldName];

          if (val === undefined || val === null) {
            continue;
          }

          // Strict type checks
          if (fieldDef.type === 'number') {
            const num = Number(val);
            if (!isNaN(num)) validatedPayload[fieldName] = num;
          } else if (fieldDef.type === 'boolean') {
            validatedPayload[fieldName] = Boolean(val);
          } else if (fieldDef.type === 'string') {
            validatedPayload[fieldName] = String(val);
          }
        }

        if (Object.keys(validatedPayload).length === 0) {
          console.warn(`[Ingest Warning] Drop empty payload from ${deviceId}`);
          return;
        }

        // 4. Save reading to time-series collection
        const reading = await Reading.create({
          timestamp: new Date(),
          device_id: deviceId,
          org_id: device.org_id,
          device_type: device.device_type,
          payload: validatedPayload,
        });

        // 5. Update device last seen & status
        await Device.updateOne(
          { device_id: deviceId },
          { $set: { status: 'online', last_seen: new Date() } }
        );

        console.log(`[Ingest Success] Saved reading for ${deviceId}:`, validatedPayload);

        // 6. Alert Rules Engine Evaluation
        const rules = await AlertRule.find({ device_id: deviceId, enabled: true });
        for (const rule of rules) {
          const val = validatedPayload[rule.condition.field];
          if (val === undefined) continue;

          let triggered = false;
          if (rule.condition.operator === '>') triggered = val > rule.condition.value;
          else if (rule.condition.operator === '<') triggered = val < rule.condition.value;
          else if (rule.condition.operator === '==') triggered = val == rule.condition.value;
          else if (rule.condition.operator === '!=') triggered = val != rule.condition.value;

          if (triggered) {
            console.log(`[ALERT TRIGGERED] Device ${deviceId} field ${rule.condition.field} is ${val} (${rule.condition.operator} ${rule.condition.value}). Action target: ${rule.action.target}`);
            if (rule.action.type === 'actuator') {
              // Automatically trigger command back to the device via MQTT topic
              publishMessage(
                `flap/${device.org_id}/${deviceId}/cmd`,
                JSON.stringify({ command: rule.action.target, payload: { triggered_by: 'alert_rule', rule_id: rule._id } })
              );
            }
          }
        }
      }
    } catch (err) {
      console.error('Error processing MQTT message:', err.message);
    }
  });

  client.on('error', (err) => {
    console.error('MQTT Client Error:', err);
  });

  client.on('close', () => {
    console.warn('MQTT Connection closed.');
  });

  mqttClient = client;
  return client;
};

const publishMessage = (topic, message) => {
  if (mqttClient && mqttClient.connected) {
    mqttClient.publish(topic, message, { qos: 1 });
    console.log(`[MQTT Command Published] ${topic} -> ${message}`);
    return true;
  }
  console.error('[MQTT Publish Failed] Broker not connected');
  return false;
};

module.exports = {
  initMqttIngestion,
  publishMessage,
};
