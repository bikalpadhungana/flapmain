const express = require('express');
const crypto = require('crypto');
const Device = require('../models/Device');
const DeviceType = require('../models/DeviceType');
const Reading = require('../models/Reading');
const TapLog = require('../models/TapLog');
const Org = require('../models/Org');
const FusionGroup = require('../models/FusionGroup');
const { authenticateUser } = require('../middleware/auth');

const router = express.Router();

// Helper to hash API keys using SHA-256
const hashKey = (key) => {
  return crypto.createHash('sha256').update(key).digest('hex');
};

// Active card tap & Fusion Group session store for linking NFC Card Taps to Height & Weight Scale readings
const activeFusionSessions = {}; // fusionGroupId -> session
let activeTapSession = null;

// Active device trigger sessions (initiated via ScaleMonitor UI or external platform API triggers)
const activeTriggerSessions = {}; // device_id -> triggerSession


// Telemetry Ingestion Handler (for ESP8266 Height+Weight Hardware and REST Clients)
const processTelemetry = async (req, res) => {
  const device_id = req.params.device_id || req.headers['x-device-id'] || req.headers['device_id'] || req.body.device_id;
  const deviceKey = req.headers['x-device-key'] || req.headers['x-api-key'] || req.body.api_key || req.body.device_key;

  if (!device_id) {
    return res.status(400).json({ status: 'error', message: 'Device ID missing in request' });
  }

  try {
    // 1. Fetch device registry or auto-provision if hardware auto-connects
    let device = await Device.findOne({ device_id });
    if (!device) {
      const defaultOrg = (await Org.findOne({ slug: 'flap' })) || (await Org.findOne());
      if (defaultOrg) {
        const keyToHash = deviceKey || 'flap-key-001';
        let detectedType = (req.body.device_type || '').toLowerCase();
        if (!detectedType) {
          if (req.body.wind_speed !== undefined || req.body.wind_direction !== undefined || device_id.includes('aws') || device_id.includes('weather')) {
            detectedType = 'weather_station_v1';
          } else if (req.body.stream_url !== undefined || device_id.includes('cam')) {
            detectedType = 'esp32_cam_v1';
          } else {
            detectedType = 'weight_scale_v1';
          }
        }
        let displayName = `Height & Weight Scale (${device_id})`;
        if (detectedType === 'weather_station_v1') displayName = `FlapMain Weather Station Pro (${device_id})`;
        if (detectedType === 'esp32_cam_v1') displayName = `ESP32-CAM Live Surveillance (${device_id})`;

        device = await Device.create({
          device_id,
          org_id: defaultOrg._id,
          device_type: detectedType,
          name: displayName,
          location: 'Main Station',
          api_key_hash: hashKey(keyToHash),
          status: 'online',
          activation_status: 'active',
        });
        console.log(`[AUTO-PROVISIONED ${detectedType.toUpperCase()} DEVICE]: ${device_id}`);
      } else {
        return res.status(404).json({ status: 'error', message: 'Device not registered' });
      }
    }

    if (device.activation_status !== 'active') {
      return res.status(403).json({ status: 'error', message: 'Device pending activation' });
    }

    // 2. Fetch device schema
    const schemaDoc = await DeviceType.findOne({ device_type: device.device_type });
    
    // 3. Validate payload fields — unpack both top-level and nested data/payload wrappers
    const rawData = (typeof req.body.data === 'object' && req.body.data !== null) ? req.body.data : {};
    const rawPayload = (typeof req.body.payload === 'object' && req.body.payload !== null) ? req.body.payload : {};
    const payload = { ...rawData, ...rawPayload, ...req.body };
    const validatedPayload = {};

    if (schemaDoc && schemaDoc.fields) {
      for (const [fieldName, fieldDef] of schemaDoc.fields.entries()) {
        const val = payload[fieldName];
        if (val === undefined || val === null) continue;

        if (fieldDef.type === 'number') {
          const num = Number(val);
          if (!isNaN(num)) validatedPayload[fieldName] = num;
        } else if (fieldDef.type === 'boolean') {
          validatedPayload[fieldName] = Boolean(val);
        } else if (fieldDef.type === 'string') {
          validatedPayload[fieldName] = String(val);
        }
      }
    }

    // Direct fallback mapping for height & weight sensors
    if (payload.weight_kg !== undefined) validatedPayload.weight_kg = Number(payload.weight_kg);
    if (payload.height_cm !== undefined) validatedPayload.height_cm = Number(payload.height_cm);

    // Direct fallback mapping for Weather Station sensors
    if (payload.wind_speed !== undefined) validatedPayload.wind_speed = Number(payload.wind_speed);
    if (payload.wind_direction !== undefined) validatedPayload.wind_direction = String(payload.wind_direction);
    if (payload.temperature !== undefined) validatedPayload.temperature = Number(payload.temperature);
    if (payload.humidity !== undefined) validatedPayload.humidity = Number(payload.humidity);
    if (payload.pressure !== undefined) validatedPayload.pressure = Number(payload.pressure);
    if (payload.altitude !== undefined) validatedPayload.altitude = Number(payload.altitude);
    if (payload.light !== undefined) validatedPayload.light = Number(payload.light);
    if (payload.rain_tips !== undefined) validatedPayload.rain_tips = Number(payload.rain_tips);
    if (payload.mq3_gas !== undefined) validatedPayload.mq3_gas = Number(payload.mq3_gas);
    if (payload.mq9_gas !== undefined) validatedPayload.mq9_gas = Number(payload.mq9_gas);
    if (payload.battery_mv !== undefined) validatedPayload.battery_mv = Number(payload.battery_mv);
    if (payload.mesh_origin_node !== undefined) validatedPayload.mesh_origin_node = Number(payload.mesh_origin_node);
    if (payload.target_node !== undefined) validatedPayload.target_node = Number(payload.target_node);
    if (payload.mesh_hops_left !== undefined) validatedPayload.mesh_hops_left = Number(payload.mesh_hops_left);
    if (payload.alert_level !== undefined) validatedPayload.alert_level = Number(payload.alert_level);
    if (payload.text_msg !== undefined) validatedPayload.text_msg = String(payload.text_msg);
    if (payload.snr !== undefined) validatedPayload.snr = Number(payload.snr);
    if (payload.time !== undefined) validatedPayload.time = String(payload.time);
    if (payload.ap_bssid !== undefined) validatedPayload.ap_bssid = String(payload.ap_bssid);

    // Direct fallback mapping for ESP32-CAM Camera devices
    if (payload.stream_url !== undefined) validatedPayload.stream_url = String(payload.stream_url);
    if (payload.capture_url !== undefined) validatedPayload.capture_url = String(payload.capture_url);
    if (payload.ip_address !== undefined) validatedPayload.ip_address = String(payload.ip_address);
    if (payload.status !== undefined) validatedPayload.status = String(payload.status);
    if (payload.rssi !== undefined) validatedPayload.rssi = Number(payload.rssi);

    // =========================================================================
    // MULTI-TIER DATA LEVELING ENGINE (Battery %, RF Signal, Severity & Indices)
    // =========================================================================
    // 1. Battery Voltage Leveling & Percentage (Li-Ion / LiPo curve 3.3V - 4.2V)
    if (validatedPayload.battery_mv !== undefined) {
      const mv = validatedPayload.battery_mv;
      let pct = 0;
      if (mv >= 4200) pct = 100;
      else if (mv <= 3300) pct = 0;
      else pct = Math.round(((mv - 3300) / (4200 - 3300)) * 100);
      validatedPayload.battery_pct = pct;

      if (pct >= 75) validatedPayload.battery_level = 'GOOD';
      else if (pct >= 25) validatedPayload.battery_level = 'NORMAL';
      else if (pct >= 10) validatedPayload.battery_level = 'LOW';
      else validatedPayload.battery_level = 'CRITICAL';
    }

    // 2. RF Signal Quality Leveling (LoRa RSSI)
    if (validatedPayload.rssi !== undefined) {
      const r = validatedPayload.rssi;
      if (r >= -75) validatedPayload.signal_level = 'EXCELLENT';
      else if (r >= -90) validatedPayload.signal_level = 'GOOD';
      else if (r >= -105) validatedPayload.signal_level = 'FAIR';
      else validatedPayload.signal_level = 'POOR';
    }

    // 3. Alert / Severity Level Classification
    const alertLvl = validatedPayload.alert_level !== undefined ? Number(validatedPayload.alert_level) : 0;
    const alertNames = ['NORMAL', 'INFO', 'WARNING', 'CRITICAL', 'SOS'];
    validatedPayload.alert_level_name = alertNames[alertLvl] || 'NORMAL';

    // 4. Wind Speed Beaufort Leveling
    if (validatedPayload.wind_speed !== undefined) {
      const ws = validatedPayload.wind_speed;
      if (ws < 5) validatedPayload.wind_level = 'CALM';
      else if (ws < 20) validatedPayload.wind_level = 'LIGHT';
      else if (ws < 38) validatedPayload.wind_level = 'MODERATE';
      else if (ws < 61) validatedPayload.wind_level = 'STRONG';
      else validatedPayload.wind_level = 'GALE';
    }

    // 5. Air Quality & Gas Hazard Leveling
    if (validatedPayload.mq9_gas !== undefined || validatedPayload.mq3_gas !== undefined) {
      const gas = Math.max(validatedPayload.mq9_gas || 0, validatedPayload.mq3_gas || 0);
      if (gas < 250) validatedPayload.air_quality_level = 'CLEAN';
      else if (gas < 500) validatedPayload.air_quality_level = 'MODERATE';
      else if (gas < 750) validatedPayload.air_quality_level = 'UNHEALTHY';
      else validatedPayload.air_quality_level = 'HAZARDOUS';
    }

    // 6. Heat Index / Feels-like Temperature (°C)
    if (validatedPayload.temperature !== undefined && validatedPayload.humidity !== undefined) {
      const T = validatedPayload.temperature;
      const R = validatedPayload.humidity;
      if (T >= 20) {
        const c1 = -8.78469475556, c2 = 1.61139411, c3 = 2.33854883889;
        const c4 = -0.14611605, c5 = -0.012308094, c6 = -0.0164248277778;
        const c7 = 0.002211732, c8 = 0.00072546, c9 = -0.000003582;
        const hi = c1 + (c2 * T) + (c3 * R) + (c4 * T * R) + (c5 * T * T) + (c6 * R * R) + (c7 * T * T * R) + (c8 * T * R * R) + (c9 * T * T * R * R);
        validatedPayload.heat_index = Number(hi.toFixed(1));
      } else {
        validatedPayload.heat_index = T;
      }
    }

    if (Object.keys(validatedPayload).length === 0) {
      return res.status(400).json({ status: 'error', message: 'Payload contains no valid schema fields' });
    }

    // 4. Link with active card tap session & Fusion Group
    let matchedSession = activeTapSession;
    try {
      const fusionGroup = await FusionGroup.findOne({ device_ids: device_id });
      if (fusionGroup && activeFusionSessions[fusionGroup._id.toString()]) {
        matchedSession = activeFusionSessions[fusionGroup._id.toString()];
      }
    } catch (fErr) {
      console.warn('Error querying Fusion Group for scale telemetry:', fErr.message);
    }

    if (matchedSession && (Date.now() - matchedSession.timestamp < 300000)) {
      validatedPayload.tapped_user_flapid = matchedSession.flapid;
      validatedPayload.tapped_card_uid = matchedSession.uid;
      if (matchedSession.userInfo) {
        validatedPayload.tapped_user_name = matchedSession.userInfo.name || matchedSession.userInfo.username || matchedSession.userInfo.primaryFlapid;
      }
      if (matchedSession.group_id) {
        validatedPayload.fusion_group_id = matchedSession.group_id;
        validatedPayload.fusion_group_name = matchedSession.group_name;
      }

      matchedSession.status = 'completed';
      matchedSession.lastMeasurement = {
        weight_kg: validatedPayload.weight_kg,
        height_cm: validatedPayload.height_cm,
        timestamp: Date.now()
      };

      console.log(`[SENSOR FUSION CORRELATION SUCCESS]: Paired scale measurement (${validatedPayload.weight_kg}kg, ${validatedPayload.height_cm || 0}cm) with user ${validatedPayload.tapped_user_name || matchedSession.flapid} in group '${matchedSession.group_name || 'Workstation'}'`);
    }

    // Check if an active trigger session exists for this device (e.g. initiated from ScaleMonitor or external API)
    const triggerSession = activeTriggerSessions[device_id];
    if (triggerSession && (Date.now() - triggerSession.timestamp < 300000)) {
      validatedPayload.external_user_id = triggerSession.external_user_id;
      if (triggerSession.user_name) {
        validatedPayload.tapped_user_name = triggerSession.user_name;
      }
      validatedPayload.trigger_session_id = triggerSession.session_id;

      triggerSession.status = 'completed';
      triggerSession.lastReading = {
        weight_kg: validatedPayload.weight_kg,
        height_cm: validatedPayload.height_cm,
        timestamp: new Date().toISOString()
      };

      console.log(`[DEVICE TRIGGER MEASUREMENT COMPLETED]: Scale ${device_id} completed reading for user ${triggerSession.external_user_id} (${validatedPayload.weight_kg}kg, ${validatedPayload.height_cm || 0}cm)`);

      // Asynchronously post measurement data to external platform callback URL if configured
      if (triggerSession.callback_url) {
        const callbackUrl = triggerSession.callback_url;
        const callbackPayload = {
          event: 'scale.measurement_completed',
          session_id: triggerSession.session_id,
          device_id,
          external_user_id: triggerSession.external_user_id,
          user_name: triggerSession.user_name || triggerSession.external_user_id,
          weight_kg: validatedPayload.weight_kg,
          height_cm: validatedPayload.height_cm,
          bmi: (validatedPayload.height_cm > 0 && validatedPayload.weight_kg > 0)
            ? Number((validatedPayload.weight_kg / Math.pow(validatedPayload.height_cm / 100, 2)).toFixed(1))
            : null,
          timestamp: new Date().toISOString()
        };

        // Fire-and-forget async fetch call to external platform API
        fetch(callbackUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'FlapMain-IoT-Engine/2.3'
          },
          body: JSON.stringify(callbackPayload)
        }).then(cbRes => {
          console.log(`[EXTERNAL WEBHOOK DELIVERED]: Posted reading to ${callbackUrl} (HTTP ${cbRes.status})`);
        }).catch(cbErr => {
          console.warn(`[EXTERNAL WEBHOOK ERROR]: Failed to post to ${callbackUrl}: ${cbErr.message}`);
        });
      }
    }

    // 5. Write to time-series DB
    const reading = await Reading.create({
      timestamp: new Date(),
      device_id,
      org_id: device.org_id,
      device_type: device.device_type,
      payload: validatedPayload,
    });

    // 6. Update device connection stats
    await Device.updateOne(
      { device_id },
      { $set: { status: 'online', last_seen: new Date() } }
    );

    // Emit Socket.io event for real-time dashboards
    try {
      const io = require('../socket').getIO();
      if (validatedPayload.wind_speed !== undefined || validatedPayload.wind_direction !== undefined || device.device_type === 'weather_station_v1') {
        io.emit('new_weather_reading', reading);
      } else if (validatedPayload.stream_url !== undefined || device.device_type === 'esp32_cam_v1') {
        io.emit('new_camera_reading', reading);
      } else {
        io.emit('new_scale_reading', reading);
      }
      io.emit('new_telemetry', reading);

      // Emit dedicated new_sos_alert if telemetry contains active emergency alert level
      if (validatedPayload.alert_level > 0 || (validatedPayload.text_msg && /sos|emergency/i.test(validatedPayload.text_msg))) {
        io.emit('new_sos_alert', {
          _id: reading._id,
          source: 'telemetry',
          source_type: device.device_type === 'weather_station_v1' ? 'Weather Station AWS' : 'Hardware Node',
          device_id: device.device_id,
          device_name: device.name,
          origin_node: validatedPayload.mesh_origin_node || 1,
          target_node: validatedPayload.target_node || 0,
          alert_level: validatedPayload.alert_level || 2,
          alert_level_name: validatedPayload.alert_level_name || (validatedPayload.alert_level > 1 ? 'EMERGENCY SOS' : 'WARNING'),
          message: validatedPayload.text_msg || `Emergency SOS Alert triggered on ${device.name || device.device_id} (Node #${validatedPayload.mesh_origin_node || 1})`,
          timestamp: reading.timestamp,
          battery_mv: validatedPayload.battery_mv,
          battery_pct: validatedPayload.battery_pct,
          rssi: validatedPayload.rssi,
          snr: validatedPayload.snr,
          temperature: validatedPayload.temperature,
          wind_speed: validatedPayload.wind_speed,
          mq9_gas: validatedPayload.mq9_gas
        });
      }

      if (triggerSession) {
        io.emit('scale_measurement_completed', {
          device_id,
          session_id: triggerSession.session_id,
          external_user_id: triggerSession.external_user_id,
          user_name: triggerSession.user_name,
          reading: validatedPayload,
          external_forwarded: !!triggerSession.callback_url
        });
      }
    } catch (wsErr) {
      console.warn('Could not emit Socket.io event:', wsErr.message);
    }

    res.status(201).json({ status: 'ok', message: 'Telemetry reading logged successfully', reading });
  } catch (error) {
    console.error('REST ingestion error:', error);
    res.status(500).json({ status: 'error', message: 'Server error processing telemetry ingestion' });
  }
};

// @route   GET /ping
// @desc    Ping device health check endpoint
// @access  Public
router.get('/ping', (req, res) => {
  res.json({
    status: 'online',
    message: 'Device interface reachable',
    timestamp: new Date(),
    ip: req.ip,
  });
});

// In-memory Camera Frame Cache, Flash State & MJPEG Stream Subscriber Map
const latestCameraFrames = {};
const cameraStreamSubscribers = {};
const cameraFlashState = {};

// @route   POST /v1/devices/:device_id/control
// @route   POST /api/v1/devices/:device_id/control
// @desc    Control device hardware parameters (e.g. Flash LED ON/OFF)
// @access  Public / Private
router.post('/:device_id/control', async (req, res) => {
  const { device_id } = req.params;
  const variable = req.body.variable || req.body.var || 'flash';
  const val = req.body.val !== undefined ? Number(req.body.val) : (req.body.flash ? 1 : 0);

  if (variable === 'flash' || variable === 'led' || variable === 'led_intensity') {
    cameraFlashState[device_id] = val;
  }

  // Attempt direct local IP HTTP request to device if IP is stored
  try {
    const deviceDoc = await Device.findOne({ device_id });
    const lastTel = await Reading.findOne({ device_id }).sort({ timestamp: -1 });
    const ip = (lastTel && lastTel.payload && lastTel.payload.ip_address) || (deviceDoc && deviceDoc.ip_address);
    if (ip) {
      fetch(`http://${ip}/control?var=${variable}&val=${val}`).catch(() => {});
      fetch(`http://${ip}/control?var=flash&val=${val}`).catch(() => {});
      fetch(`http://${ip}/control?var=led_intensity&val=${val}`).catch(() => {});
    }
  } catch (err) {
    console.warn('Direct camera IP control fetch warning:', err.message);
  }

  try {
    const io = require('../socket').getIO();
    io.emit('camera_control_updated', { device_id, variable, val });
  } catch (e) {}

  res.json({ status: 'ok', message: `Control parameter '${variable}' set to ${val} for ${device_id}`, device_id, variable, val });
});

// @route   POST /v1/devices/camera/upload
// @desc    Direct JPEG image frame upload endpoint for ESP32-CAM and remote clients
// @access  Public (Authenticated via Device Headers or Query)
router.post('/camera/upload', async (req, res) => {
  const device_id = req.headers['x-device-id'] || req.headers['device_id'] || req.query.device_id || (req.body && req.body.device_id) || 'flap-esp32-cam-001';
  let imgBuffer = null;

  if (Buffer.isBuffer(req.body)) {
    imgBuffer = req.body;
  } else if (req.body && req.body.image_base64) {
    const base64Str = req.body.image_base64.replace(/^data:image\/\w+;base64,/, '');
    imgBuffer = Buffer.from(base64Str, 'base64');
  } else if (typeof req.body === 'string') {
    const base64Str = req.body.replace(/^data:image\/\w+;base64,/, '');
    imgBuffer = Buffer.from(base64Str, 'base64');
  }

  if (!imgBuffer || imgBuffer.length === 0) {
    return res.status(400).json({ status: 'error', message: 'No valid JPEG image buffer or Base64 string received' });
  }

  const timestamp = Date.now();
  latestCameraFrames[device_id] = {
    buffer: imgBuffer,
    timestamp
  };

  // 1. Broadcast Base64 frame to frontend Socket.io clients
  try {
    const io = require('../socket').getIO();
    const base64Url = `data:image/jpeg;base64,${imgBuffer.toString('base64')}`;
    io.emit('new_camera_frame', {
      device_id,
      image_base64: base64Url,
      timestamp
    });
  } catch (wsErr) {
    console.warn('Socket.io camera frame broadcast warning:', wsErr.message);
  }

  // 2. Broadcast raw frame to active HTTP MJPEG stream subscribers
  const subscribers = cameraStreamSubscribers[device_id];
  if (subscribers && subscribers.size > 0) {
    for (const clientRes of subscribers) {
      try {
        clientRes.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${imgBuffer.length}\r\n\r\n`);
        clientRes.write(imgBuffer);
        clientRes.write('\r\n');
      } catch (err) {
        subscribers.delete(clientRes);
      }
    }
  }

  const currentFlash = cameraFlashState[device_id] !== undefined ? cameraFlashState[device_id] : 0;
  res.status(200).json({ status: 'ok', message: 'Frame uploaded and broadcasted successfully', bytes: imgBuffer.length, timestamp, flash: currentFlash, flash_on: currentFlash > 0 });
});

// @route   GET /v1/devices/:device_id/camera/stream
// @desc    Global Cloud MJPEG Video Stream Proxy for any browser client
// @access  Public
router.get('/:device_id/camera/stream', (req, res) => {
  const { device_id } = req.params;

  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Connection': 'close',
    'Pragma': 'no-cache'
  });

  if (!cameraStreamSubscribers[device_id]) {
    cameraStreamSubscribers[device_id] = new Set();
  }
  cameraStreamSubscribers[device_id].add(res);

  // If a frame already exists, immediately send current frame to fast-start stream
  if (latestCameraFrames[device_id] && latestCameraFrames[device_id].buffer) {
    const buf = latestCameraFrames[device_id].buffer;
    try {
      res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${buf.length}\r\n\r\n`);
      res.write(buf);
      res.write('\r\n');
    } catch (e) {}
  }

  req.on('close', () => {
    if (cameraStreamSubscribers[device_id]) {
      cameraStreamSubscribers[device_id].delete(res);
    }
  });
});

// @route   GET /v1/devices/:device_id/camera/snapshot
// @desc    Get latest camera snapshot JPEG image buffer
// @access  Public
router.get('/:device_id/camera/snapshot', (req, res) => {
  const { device_id } = req.params;
  const frame = latestCameraFrames[device_id];

  if (!frame || !frame.buffer) {
    return res.status(444).json({ status: 'error', message: 'No frame captured yet for device' });
  }

  res.type('image/jpeg').send(frame.buffer);
});

// @route   POST /v1/devices/data
// @route   POST /v1/devices/telemetry
// @route   POST /v1/devices/:device_id/readings
router.post('/data', processTelemetry);
router.post('/telemetry', processTelemetry);
router.post('/:device_id/readings', processTelemetry);


// @route   POST /v1/devices
// @desc    Register a new device & generate its API key
// @access  Private (Dashboard user)
router.post('/', authenticateUser, async (req, res) => {
  const { device_id, device_type, name, location } = req.body;

  if (!device_id || !device_type || !name) {
    return res.status(400).json({ message: 'Please provide device_id, device_type, and name' });
  }

  try {
    const dtDoc = await DeviceType.findOne({ device_type: device_type.toLowerCase() });
    if (!dtDoc) {
      return res.status(400).json({ message: `Device type '${device_type}' not registered in Schema Registry` });
    }

    const existingDevice = await Device.findOne({ device_id });
    if (existingDevice) {
      return res.status(400).json({ message: `Device with ID '${device_id}' already registered` });
    }

    const rawApiKey = 'flap_dev_' + crypto.randomBytes(24).toString('hex');
    const api_key_hash = hashKey(rawApiKey);

    const device = await Device.create({
      device_id,
      org_id: req.org_id,
      device_type: device_type.toLowerCase(),
      name,
      location: location || '',
      api_key_hash,
      status: 'offline',
      activation_status: 'active',
    });

    res.status(201).json({
      message: 'Device registered successfully',
      device: {
        id: device._id,
        device_id: device.device_id,
        device_type: device.device_type,
        name: device.name,
        location: device.location,
        status: device.status,
      },
      apiKey: rawApiKey,
    });
  } catch (error) {
    console.error('Device registration error:', error);
    res.status(500).json({ message: 'Server error registering device' });
  }
});

// @route   GET /v1/devices
// @desc    Get all devices scoped to current organization
// @access  Private (Dashboard user)
router.get('/', authenticateUser, async (req, res) => {
  try {
    const devices = await Device.find({ org_id: req.org_id }).select('-api_key_hash');
    res.json(devices);
  } catch (error) {
    console.error('List devices error:', error);
    res.status(500).json({ message: 'Server error fetching devices' });
  }
});

// @route   GET /v1/devices/:device_id/readings/latest
// @desc    Get the latest telemetry reading for a device
// @access  Private (Dashboard user)
router.get('/:device_id/readings/latest', authenticateUser, async (req, res) => {
  try {
    const device = await Device.findOne({ device_id: req.params.device_id, org_id: req.org_id });
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    const latestReading = await Reading.findOne({
      device_id: req.params.device_id,
      org_id: req.org_id,
    }).sort({ timestamp: -1 });

    res.json(latestReading || { message: 'No telemetry data recorded yet' });
  } catch (error) {
    console.error('Get latest reading error:', error);
    res.status(500).json({ message: 'Server error fetching telemetry' });
  }
});

// @route   GET /v1/devices/:device_id/readings
// @desc    Get historical range of telemetry readings
// @access  Private (Dashboard user)
router.get('/:device_id/readings', authenticateUser, async (req, res) => {
  const { from, to, limit } = req.query;
  const queryLimit = parseInt(limit, 10) || 100;

  try {
    const device = await Device.findOne({ device_id: req.params.device_id, org_id: req.org_id });
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    const filter = {
      device_id: req.params.device_id,
      org_id: req.org_id,
    };

    if (from || to) {
      filter.timestamp = {};
      if (from) filter.timestamp.$gte = new Date(from);
      if (to) filter.timestamp.$lte = new Date(to);
    }

    const readings = await Reading.find(filter)
      .sort({ timestamp: -1 })
      .limit(queryLimit);

    res.json(readings);
  } catch (error) {
    console.error('Get readings history error:', error);
    res.status(500).json({ message: 'Server error fetching telemetry logs' });
  }
});

// @route   GET /v1/devices/:device_id
// @desc    Get detailed device details
// @access  Private (Dashboard user)
router.get('/:device_id', authenticateUser, async (req, res) => {
  try {
    const device = await Device.findOne({
      device_id: req.params.device_id,
      org_id: req.org_id,
    }).select('-api_key_hash');

    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    res.json(device);
  } catch (error) {
    console.error('Get device error:', error);
    res.status(500).json({ message: 'Server error fetching device details' });
  }
});



// @route   POST /v1/devices/:device_id/commands
// @desc    Trigger actuator command (MQTT disabled on shared hosting)
// @access  Private (Dashboard user)
router.post('/:device_id/commands', authenticateUser, async (req, res) => {
  const { device_id } = req.params;
  const { command, payload } = req.body;

  if (!command) {
    return res.status(400).json({ message: 'Please provide actuator command name' });
  }

  try {
    // 1. Verify device exists and belongs to org
    const device = await Device.findOne({ device_id, org_id: req.org_id });
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    // 2. Validate if command exists in registry
    const schemaDoc = await DeviceType.findOne({ device_type: device.device_type });
    if (!schemaDoc || !schemaDoc.commands.includes(command)) {
      return res.status(400).json({ message: `Command '${command}' not supported by schema registry for ${device.device_type}` });
    }

    // 3. MQTT is disabled on shared hosting — return informative message
    // To re-enable: uncomment mqttIngestion import at top and use publishMessage here
    return res.status(503).json({
      message: 'MQTT command delivery is not available on this server. Devices use HTTP polling for commands.',
      command,
      device_id,
    });
  } catch (error) {
    console.error('Actuator command error:', error);
    res.status(500).json({ message: 'Server error transmitting command' });
  }
});

// @route   GET /v1/devices/:device_id/export
// @desc    Export telemetry logs in JSON or CSV
// @access  Private (Dashboard user)
router.get('/:device_id/export', authenticateUser, async (req, res) => {
  const { format } = req.query;

  try {
    const device = await Device.findOne({ device_id: req.params.device_id, org_id: req.org_id });
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    const readings = await Reading.find({
      device_id: req.params.device_id,
      org_id: req.org_id,
    }).sort({ timestamp: -1 });

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=telemetry-${device.device_id}.csv`);

      // Build simple CSV structure
      let csvContent = 'Timestamp,DeviceID,DeviceType';
      // extract keys
      const schemaDoc = await DeviceType.findOne({ device_type: device.device_type });
      const fieldNames = schemaDoc ? Array.from(schemaDoc.fields.keys()) : [];

      fieldNames.forEach(f => { csvContent += `,${f}`; });
      csvContent += '\n';

      readings.forEach(r => {
        let row = `${r.timestamp.toISOString()},${r.device_id},${r.device_type}`;
        fieldNames.forEach(f => {
          row += `,${r.payload[f] !== undefined ? r.payload[f] : ''}`;
        });
        csvContent += row + '\n';
      });

      return res.send(csvContent);
    }

    // Default JSON
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=telemetry-${device.device_id}.json`);
    res.json(readings);
  } catch (error) {
    console.error('Export telemetry error:', error);
    res.status(500).json({ message: 'Server error exporting data' });
  }
});

// @route   GET /ping
// @desc    Ping device health check endpoint
// @access  Public
router.get('/ping', (req, res) => {
  res.json({
    status: 'online',
    message: 'Device interface reachable',
    timestamp: new Date(),
    ip: req.ip,
  });
});

  // In-memory fallback log store if MongoDB is offline
  const inMemoryTapLogs = [];

  // @route   POST /tap
  // @desc    Process RFID/NFC card tap event, save locally on laptop, & forward to servers
  // @access  Public
  router.post('/tap', async (req, res) => {
    const rawUid = req.body.uid || req.body.tag_uid;

    if (!rawUid) {
      return res.status(400).json({ status: 'error', message: 'Missing tag UID' });
    }

    if (!req.body.device_id) {
      return res.status(400).json({ status: 'error', message: 'Missing device_id in request payload' });
    }

    try {
      const deviceDoc = await Device.findOne({ device_id: req.body.device_id });
      
      // 1. Check if device exists in registry
      if (!deviceDoc) {
        console.warn(`[SECURITY] Blocked tap from unregistered device: ${req.body.device_id}`);
        return res.status(401).json({ status: 'error', message: 'Unauthorized: Device is not registered in the system' });
      }

      // 2. Validate API Key (prevent spoofing)
      if (!req.body.api_key || hashKey(req.body.api_key) !== deviceDoc.api_key_hash) {
        console.warn(`[SECURITY] Blocked tap from device ${req.body.device_id}: Invalid API Key`);
        return res.status(401).json({ status: 'error', message: 'Unauthorized: Invalid API Key' });
      }

      // 3. Check activation status
      if (deviceDoc.activation_status !== 'active') {
        console.warn(`[HTTP] Blocked tap from pending device ${req.body.device_id}`);
        return res.status(403).json({ status: 'error', message: 'Device is registered but pending activation' });
      }
    } catch (err) {
       console.error("Error verifying device activation:", err);
       return res.status(500).json({ status: 'error', message: 'Internal server error during device validation' });
    }

    const uidStr = String(rawUid).toUpperCase();
    const tapPayload = {
      device_id: req.body.device_id,
      api_key: req.body.api_key,
      business_id: req.body.business_id,
      flapid: req.body.flapid,
      uid: uidStr,
      tag_uid: uidStr,
      tag_type: req.body.tag_type || 'MIFARE',
      type: req.body.type || 'checkin',
      timestamp: new Date(),
    };

    console.log('[FLAPMAIN LOCAL TAP INGESTED]:', tapPayload);

    // 1. SAVE TAP RECORD LOCALLY ON LOCAL SYSTEM FIRST
    let savedRecord = null;
    try {
      savedRecord = await TapLog.create({
        uid: uidStr,
        api_key: tapPayload.api_key || '',
        tag_type: tapPayload.tag_type,
        type: tapPayload.type,
        flapid: tapPayload.flapid,
        device_id: tapPayload.device_id,
        business_id: tapPayload.business_id,
        timestamp: tapPayload.timestamp,
      });
      console.log('[SAVED TAP TO LOCAL DB]:', savedRecord._id);
    } catch (dbErr) {
      console.warn('[LOCAL DB SAVE FALLBACK TO MEMORY]:', dbErr.message);
      savedRecord = { _id: Date.now().toString(), ...tapPayload };
      inMemoryTapLogs.unshift(savedRecord);
    }

    // 2. SAVE TO DEVICE TELEMETRY READINGS (for Dashboard UI) & UPDATE LAST SEEN
    try {
      const deviceDoc = await Device.findOne({ device_id: tapPayload.device_id });
      if (deviceDoc) {
        await Reading.create({
          timestamp: tapPayload.timestamp,
          device_id: deviceDoc.device_id,
          org_id: deviceDoc.org_id,
          device_type: deviceDoc.device_type,
          payload: {
            tag_uid: uidStr,
            tag_type: tapPayload.tag_type,
            type: tapPayload.type,
          },
        });
        await Device.updateOne(
          { device_id: deviceDoc.device_id },
          { $set: { status: 'online', last_seen: tapPayload.timestamp } }
        );
        console.log(`[DEVICE DASHBOARD TELEMETRY UPDATED FOR ${deviceDoc.device_id}]`);
      }
    } catch (telemetryErr) {
      console.warn('[DEVICE TELEMETRY SAVE ERROR]:', telemetryErr.message);
    }


    // Target 1: Local Device API (only used in edge/local mode)
    const localTargetUrl = process.env.TAP_DEVICE_TARGET_URL || '';
    // Target 2: Main Flap Company Backend Server (VPS)
    let mainServerUrl = process.env.FLAP_SERVER_URL || 'https://flap.esainnovation.com/api/device/tap';
    if (mainServerUrl.startsWith('http://flap.esainnovation.com')) {
      mainServerUrl = mainServerUrl.replace('http://flap.esainnovation.com', 'https://flap.esainnovation.com');
    }
    if (mainServerUrl.endsWith('/api/tap')) {
      mainServerUrl = mainServerUrl.replace(/\/api\/tap$/, '/api/device/tap');
    }



    let localForwarded = false;
    let localResponse = null;
    let localError = null;

    let mainForwarded = false;
    let mainResponse = null;
    let mainError = null;

    // 2. Forward to Local Device Server (only if URL is configured)
    if (localTargetUrl) {
      try {
        const ctrl1 = new AbortController();
        const t1 = setTimeout(() => ctrl1.abort(), 3000);
        const r1 = await fetch(localTargetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tapPayload),
          signal: ctrl1.signal,
        });
        clearTimeout(t1);
        localResponse = await r1.json().catch(() => null);
        if (r1.ok) localForwarded = true;
      } catch (err) {
        localError = err.message;
      }
    }

    // 3. Forward to Main Flap Company Server (Only if Edge)
    const nodeRole = process.env.NODE_ROLE || 'cloud';
    
    if (nodeRole === 'cloud') {
      // If we are already on the Cloud VPS, we don't need to forward to ourselves!
      mainForwarded = true;
      mainResponse = { status: 'success', message: 'Tap processed directly on Cloud VPS' };
    } else {
      try {
        const ctrl2 = new AbortController();
        const t2 = setTimeout(() => ctrl2.abort(), 4000);
        
        // Translate payload to match legacy VPS expectations, 
        // but use a configurable secure API key for enterprise S2S communication.
        const legacyPayload = {
          ...tapPayload,
          tag_uid: tapPayload.uid,
          // Use a dedicated forwarding key if configured, otherwise pass-through the device's key
          api_key: process.env.FLAP_SERVER_API_KEY || tapPayload.api_key
        };

        const r2 = await fetch(mainServerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(legacyPayload),
          signal: ctrl2.signal,
        });
        clearTimeout(t2);
        mainResponse = await r2.json().catch(() => null);
        if (r2.ok) mainForwarded = true;
      } catch (err) {
        mainError = err.message;
      }
    }

    // 4. UPDATE SAVED LOCAL TAP RECORD WITH FORWARDING STATUS
    try {
      if (savedRecord && savedRecord._id && typeof savedRecord.save === 'function') {
        savedRecord.forwardedLocal = localForwarded;
        savedRecord.forwardedMain = mainForwarded;
        // Store the true VPS response in the database so the System Monitor displays the real result
        savedRecord.targetResponse = mainResponse || localResponse;
        await savedRecord.save();
      }
    } catch (updErr) {
      console.warn('Could not update saved tap record status:', updErr.message);
    }

    // 5. EMIT REAL-TIME WEBSOCKET EVENT TO DASHBOARD
    try {
      const io = require('../socket').getIO();
      io.emit('new_tap', savedRecord || tapPayload);
    } catch (wsErr) {
      console.warn('Could not emit Socket.io event:', wsErr.message);
    }

    // Prioritize VPS response (mainResponse) over localResponse for the final display
    const finalResponse = mainResponse || localResponse || {};

    const userName = (finalResponse.holder && (finalResponse.holder.name || finalResponse.holder.username || finalResponse.holder.primaryFlapid)) ||
                     (finalResponse.data && (finalResponse.data.name || finalResponse.data.username || finalResponse.data.flapid)) ||
                     (finalResponse.user && finalResponse.user.name) ||
                     'Card User';

    // Store active tap session for height & weight scale session correlation
    activeTapSession = {
      uid: uidStr,
      flapid: req.body.flapid || finalResponse.flapid || (finalResponse.holder && finalResponse.holder.primaryFlapid) || (finalResponse.data && finalResponse.data.flapid) || 'FLAP-CARD-USER',
      userInfo: finalResponse.holder || finalResponse.data || finalResponse.user || { name: userName },
      timestamp: Date.now()
    };

    // Check if card reader is part of a Fusion Group (e.g. paired with a weight scale or height sensor)
    try {
      const fusionGroup = await FusionGroup.findOne({ device_ids: req.body.device_id });
      if (fusionGroup) {
        activeTapSession.group_id = fusionGroup._id.toString();
        activeTapSession.group_name = fusionGroup.name;

        activeFusionSessions[fusionGroup._id.toString()] = activeTapSession;

        // Check if Fusion Group has a scale or weighing machine device
        const pairedScale = await Device.findOne({
          device_id: { $in: fusionGroup.device_ids },
          $or: [
            { device_type: /scale/i },
            { device_type: /weight/i },
            { device_type: /height/i },
            { device_type: /weighing/i }
          ]
        });

        if (pairedScale) {
          finalResponse.display = {
            line1: userName.substring(0, 21),
            line2: 'Step on scale!',
            line3: 'Awaiting weight...',
          };
          console.log(`[SENSOR FUSION WORKSTATION]: Card tap on ${req.body.device_id} matched Fusion Group '${fusionGroup.name}' paired with scale '${pairedScale.device_id}'. OLED prompt: Step on scale!`);
        }

        // Broadcast real-time sensor fusion event to dashboard
        try {
          const io = require('../socket').getIO();
          io.emit('sensor_fusion_tap', {
            group_id: fusionGroup._id.toString(),
            group_name: fusionGroup.name,
            device_id: req.body.device_id,
            uid: uidStr,
            user: { name: userName, flapid: activeTapSession.flapid },
            timestamp: new Date()
          });
        } catch (wsErr) {
          console.warn('Could not emit Socket.io fusion event:', wsErr.message);
        }
      }
    } catch (fgErr) {
      console.warn('Error checking Fusion Group for tap:', fgErr.message);
    }

    console.log('[ACTIVE TAP SESSION RECORDED FOR SCALE CORRELATION]:', activeTapSession);

    res.status(200).json({
      status: finalResponse.status || 'success',
      message: finalResponse.message || (mainForwarded ? 'Tap event saved on local system & forwarded' : 'Tap event saved locally and queued for offline sync'),
      display: finalResponse.display || {
        line1: 'Flap System',
        line2: uidStr.substring(0, 21),
        line3: mainForwarded ? 'Saved on Local System' : 'Saved Offline (Queued)',
      },
    });
  });

  // @route   GET /tap/logs
  // @desc    Get all tap records saved locally on this local system
  // @access  Public
  router.get('/tap/logs', async (req, res) => {
    try {
      const dbLogs = await TapLog.find().sort({ timestamp: -1 }).limit(20);
      res.json({
        source: 'MongoDB',
        count: dbLogs.length,
        logs: dbLogs,
      });
    } catch (err) {
      res.json({
        source: 'InMemory',
        count: inMemoryTapLogs.length,
        logs: inMemoryTapLogs,
      });
    }
  });



// @route   POST /tags/lookup
// @route   POST /lookup
// @desc    Lookup tag UID details
// @access  Public
router.post(['/tags/lookup', '/lookup'], (req, res) => {
  const { uid, flapid, type } = req.body;
  res.json({
    status: 'success',
    valid: true,
    uid: uid ? String(uid).toUpperCase() : 'UNKNOWN',
    flapid: flapid || 'bikalpa',
    type: type || 'card',
    accessGranted: true,
    timestamp: new Date(),
  });
});

// @route   POST /api/v1/devices/:device_id/trigger
// @route   POST /api/v1/devices/trigger
// @desc    Initiate scale measurement session for device & register optional external webhook callback
// @access  Public / Authenticated
router.post(['/trigger', '/:device_id/trigger'], async (req, res) => {
  const device_id = req.params.device_id || req.body.device_id;
  const { external_user_id, user_name, callback_url, notes } = req.body;

  if (!device_id) {
    return res.status(400).json({ status: 'error', message: 'Missing device_id in request' });
  }

  try {
    const device = await Device.findOne({ device_id });
    if (!device) {
      return res.status(404).json({ status: 'error', message: `Device '${device_id}' not found in system registry` });
    }

    const sessionId = 'trig_' + Date.now();
    const sessionObj = {
      session_id: sessionId,
      device_id,
      external_user_id: external_user_id || req.body.user_id || 'EXTERNAL_USER',
      user_name: user_name || req.body.name || external_user_id || 'External User',
      callback_url: callback_url || req.body.webhook_url || null,
      notes: notes || '',
      timestamp: Date.now(),
      status: 'initiated'
    };

    activeTriggerSessions[device_id] = sessionObj;

    console.log(`[DEVICE TRIGGER INITIATED]: Device '${device_id}' ready for measurement for user '${sessionObj.external_user_id}'. Callback: ${sessionObj.callback_url || 'None'}`);

    // Emit Socket.io event to notify hardware and dashboards
    try {
      const io = require('../socket').getIO();
      io.emit('device_trigger_initiated', sessionObj);
    } catch (wsErr) {
      console.warn('Could not emit device_trigger_initiated event:', wsErr.message);
    }

    res.status(200).json({
      status: 'success',
      session_id: sessionId,
      device_id,
      external_user_id: sessionObj.external_user_id,
      user_name: sessionObj.user_name,
      message: 'Scale measurement session initiated. Device ready to capture height & weight.',
      callback_url: sessionObj.callback_url,
      display: {
        line1: 'Device Ready!',
        line2: 'Step on scale',
        line3: sessionObj.user_name.substring(0, 21)
      }
    });
  } catch (err) {
    console.error('Error initiating device trigger:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error initiating scale measurement' });
  }
});

// @route   GET /api/v1/devices/:device_id/trigger-status
// @desc    Poll trigger status for scale hardware or external integrations
// @access  Public
router.get(['/:device_id/trigger-status', '/trigger-status'], (req, res) => {
  const device_id = req.params.device_id || req.query.device_id;
  const session = activeTriggerSessions[device_id];

  if (session && (Date.now() - session.timestamp < 300000)) {
    return res.json({
      active: true,
      status: session.status,
      session_id: session.session_id,
      device_id: session.device_id,
      external_user_id: session.external_user_id,
      user_name: session.user_name,
      callback_url: session.callback_url,
      lastReading: session.lastReading || null
    });
  }

  res.json({ active: false, status: 'idle', device_id });
});

// @route   GET /logs/system
// @desc    Get aggregated system activity logs across all devices, taps, telemetry & schemas
// @access  Public / Authenticated
router.get('/logs/system', async (req, res) => {
  const { limit, event_type, device_id, search } = req.query;
  const maxLogs = parseInt(limit, 10) || 100;

  try {
    const devices = await Device.find().select('device_id name device_type status last_seen location');
    const deviceMap = new Map(devices.map(d => [d.device_id, d]));

    // 1. Fetch Telemetry Readings
    const readingsFilter = {};
    if (device_id) readingsFilter.device_id = device_id;
    const readings = await Reading.find(readingsFilter).sort({ timestamp: -1 }).limit(maxLogs);

    // 2. Fetch Tap Logs
    const tapFilter = {};
    if (device_id) tapFilter.device_id = device_id;
    const tapLogs = await TapLog.find(tapFilter).sort({ timestamp: -1 }).limit(maxLogs);

    // 3. Format Telemetry entries
    const telemetryEntries = readings.map(r => {
      const dev = deviceMap.get(r.device_id);
      return {
        id: `reading_${r._id}`,
        timestamp: r.timestamp,
        event_type: 'telemetry',
        device_id: r.device_id,
        device_name: dev?.name || r.device_id,
        device_type: r.device_type || dev?.device_type || 'unknown',
        status: 'online',
        summary: `Ingested ${r.device_type} telemetry feed`,
        payload: r.payload,
        source: 'Sensor Network',
      };
    });

    // 4. Format Tap entries
    const tapEntries = tapLogs.map(t => {
      const dev = deviceMap.get(t.device_id);
      return {
        id: `tap_${t._id}`,
        timestamp: t.timestamp,
        event_type: 'tap',
        device_id: t.device_id,
        device_name: dev?.name || t.device_id,
        device_type: dev?.device_type || 'nfc_reader',
        status: t.forwardedLocal || t.forwardedMain ? 'success' : 'warning',
        summary: `NFC/RFID Card Tap: UID [${t.uid}] (${t.tag_type} ${t.type})`,
        payload: {
          uid: t.uid,
          tag_type: t.tag_type,
          type: t.type,
          flapid: t.flapid,
          business_id: t.business_id,
          targetResponse: t.targetResponse,
        },
        source: 'Tap Controller',
      };
    });

    // 5. Combine and Sort Chronologically
    let combinedLogs = [...telemetryEntries, ...tapEntries];

    // Apply Filter by Event Type if provided
    if (event_type && event_type !== 'all') {
      combinedLogs = combinedLogs.filter(l => l.event_type === event_type);
    }

    // Apply Search Filter if provided
    if (search) {
      const q = search.toLowerCase();
      combinedLogs = combinedLogs.filter(l =>
        l.device_id.toLowerCase().includes(q) ||
        l.device_name.toLowerCase().includes(q) ||
        l.summary.toLowerCase().includes(q) ||
        JSON.stringify(l.payload).toLowerCase().includes(q)
      );
    }

    // Sort Newest First
    combinedLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const resultLogs = combinedLogs.slice(0, maxLogs);

    res.json({
      status: 'success',
      totalCount: resultLogs.length,
      devicesCount: devices.length,
      logs: resultLogs,
    });
  } catch (err) {
    console.error('System logs aggregation error:', err);
    res.status(500).json({ status: 'error', message: 'Failed to aggregate system logs' });
  }
});

// ---- LORA MESH TWO-WAY WALKIE-TALKIE & OUTBOX QUEUE ENDPOINTS ----
let meshOutboxQueue = [];
let meshMessageHistory = [];

/**
 * @route   POST /v1/devices/messages
 * @desc    Uplink endpoint for ESP Gateway to post text/SOS messages from LoRa Mesh walkie-talkies
 */
router.post('/messages', async (req, res) => {
  try {
    const { gateway_id, origin_node, target_node, message_type, text, alert_level, battery_mv, hops_left, rssi, snr } = req.body;
    
    console.log(`[LORA MESH UPLINK MESSAGE]: Node #${origin_node} -> Target #${target_node || 0} (${message_type}): "${text}" (Alert: ${alert_level}, RSSI: ${rssi}dBm)`);

    const msgData = {
      _id: new Date().getTime().toString() + Math.random().toString().substring(2, 6),
      gateway_id: gateway_id || 'esp_gateway_node_01',
      device_id: `flap-walkie-${String(origin_node).padStart(3, '0')}`,
      origin_node: Number(origin_node) || 0,
      target_node: Number(target_node) || 0,
      message_type: message_type || 'text',
      text: String(text || ''),
      alert_level: Number(alert_level) || 0,
      battery_mv: Number(battery_mv) || 0,
      hops_left: Number(hops_left) || 0,
      rssi: Number(rssi) || 0,
      snr: Number(snr) || 0,
      timestamp: new Date().toISOString()
    };

    meshMessageHistory.push(msgData);
    if (meshMessageHistory.length > 100) meshMessageHistory.shift();

    // Broadcast real-time Socket.io events
    const io = req.app.get('io');
    if (io) {
      io.emit('new_mesh_message', msgData);
      io.emit('new_telemetry', {
        device_id: msgData.device_id,
        device_type: 'walkie_talkie_v1',
        timestamp: msgData.timestamp,
        payload: {
          text_msg: msgData.text,
          mesh_origin_node: msgData.origin_node,
          alert_level: msgData.alert_level,
          battery_mv: msgData.battery_mv,
          mesh_hops_left: msgData.hops_left,
          rssi: msgData.rssi,
          snr: msgData.snr
        }
      });

      // Emit dedicated new_sos_alert if walkie uplink is an SOS or has alert_level > 0
      if (msgData.alert_level > 0 || msgData.message_type === 'sos') {
        io.emit('new_sos_alert', {
          _id: msgData._id,
          source: 'mesh_message',
          source_type: 'LoRa Walkie-Talkie',
          device_id: msgData.device_id,
          origin_node: msgData.origin_node,
          target_node: msgData.target_node,
          alert_level: msgData.alert_level || 2,
          alert_level_name: msgData.alert_level === 1 ? 'WARNING' : 'EMERGENCY SOS',
          message: msgData.text,
          timestamp: msgData.timestamp,
          battery_mv: msgData.battery_mv,
          rssi: msgData.rssi,
          snr: msgData.snr,
          hops_left: msgData.hops_left
        });
      }
    }

    res.json({ status: 'success', message: 'Uplink message ingested', msg_id: msgData._id });
  } catch (err) {
    console.error('Error ingesting uplink mesh message:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * @route   POST /v1/devices/send-message
 * @desc    Send a message from FlapMain Cloud web app down to LoRa Mesh walkie-talkie devices
 */
router.post('/send-message', async (req, res) => {
  try {
    const { target_node, text, alert_level, gateway_id } = req.body;
    if (!text || String(text).trim().length === 0) {
      return res.status(400).json({ status: 'error', message: 'Text message cannot be empty' });
    }

    const outboxItem = {
      outbox_id: 'out_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      gateway_id: gateway_id || 'esp_gateway_node_01',
      target_node: Number(target_node) || 0,
      text: String(text).trim().substring(0, 31),
      alert_level: Number(alert_level) || 0,
      delivered: false,
      createdAt: new Date().toISOString()
    };

    meshOutboxQueue.push(outboxItem);
    console.log(`[LORA MESH DOWNLINK QUEUED]: ID ${outboxItem.outbox_id} for Target #${outboxItem.target_node}: "${outboxItem.text}"`);

    const msgData = {
      _id: outboxItem.outbox_id,
      gateway_id: outboxItem.gateway_id,
      device_id: 'Cloud Base Station (Web Dashboard)',
      origin_node: 0,
      target_node: outboxItem.target_node,
      message_type: outboxItem.alert_level > 0 ? 'sos' : 'text',
      text: outboxItem.text,
      alert_level: outboxItem.alert_level,
      is_downlink: true,
      timestamp: outboxItem.createdAt
    };

    meshMessageHistory.push(msgData);
    if (meshMessageHistory.length > 100) meshMessageHistory.shift();

    // Broadcast Socket.io event so web UI displays outgoing chat instantly
    const io = req.app.get('io');
    if (io) {
      io.emit('new_mesh_message', msgData);
      if (msgData.alert_level > 0 || msgData.message_type === 'sos') {
        io.emit('new_sos_alert', {
          _id: msgData._id,
          source: 'mesh_message',
          source_type: 'Base Station Broadcast',
          device_id: 'Cloud Base Station',
          origin_node: 0,
          target_node: msgData.target_node,
          alert_level: msgData.alert_level,
          alert_level_name: msgData.alert_level === 1 ? 'WARNING' : 'EMERGENCY SOS',
          message: msgData.text,
          timestamp: msgData.timestamp
        });
      }
    }

    res.json({ status: 'success', message: 'Message queued for LoRa Mesh transmission', outbox: outboxItem });
  } catch (err) {
    console.error('Error queuing downlink message:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * @route   GET /v1/devices/messages/history
 * @desc    Fetch recent LoRa Mesh chat/text/SOS message history
 */
router.get('/messages/history', (req, res) => {
  res.json({ status: 'success', messages: meshMessageHistory });
});

/**
 * @route   GET /v1/devices/sos/history
 * @desc    Fetch unified Emergency SOS alert history across both Walkies and Weather Station telemetry
 */
router.get('/sos/history', async (req, res) => {
  try {
    // 1. SOS alerts from LoRa Mesh Walkie-Talkies
    const meshSos = meshMessageHistory.filter(m => (m.alert_level && m.alert_level > 0) || m.message_type === 'sos').map(m => ({
      _id: m._id,
      source: 'mesh_message',
      source_type: 'LoRa Walkie-Talkie',
      device_id: m.device_id,
      origin_node: m.origin_node,
      target_node: m.target_node,
      alert_level: m.alert_level || 2,
      alert_level_name: m.alert_level === 1 ? 'WARNING' : 'EMERGENCY SOS',
      message: m.text,
      timestamp: m.timestamp,
      battery_mv: m.battery_mv,
      rssi: m.rssi,
      snr: m.snr,
      hops_left: m.hops_left
    }));

    // 2. SOS alerts from MongoDB Reading collection (Weather Stations & Hardware nodes)
    const telemetrySosDocs = await Reading.find({
      $or: [
        { 'payload.alert_level': { $gt: 0 } },
        { 'payload.text_msg': { $regex: /sos|emergency/i } }
      ]
    }).sort({ timestamp: -1 }).limit(100);

    const telemetrySos = telemetrySosDocs.map(r => {
      const p = r.payload || {};
      return {
        _id: r._id,
        source: 'telemetry',
        source_type: r.device_type === 'weather_station_v1' ? 'Weather Station AWS' : 'Hardware Node',
        device_id: r.device_id,
        origin_node: p.mesh_origin_node !== undefined ? Number(p.mesh_origin_node) : 1,
        target_node: p.target_node !== undefined ? Number(p.target_node) : 0,
        alert_level: p.alert_level !== undefined ? Number(p.alert_level) : 1,
        alert_level_name: p.alert_level_name || (p.alert_level > 1 ? 'EMERGENCY SOS' : 'WARNING'),
        message: p.text_msg || `Emergency SOS Alert on Station Node #${p.mesh_origin_node || 1}`,
        timestamp: r.timestamp,
        battery_mv: p.battery_mv,
        battery_pct: p.battery_pct,
        rssi: p.rssi,
        snr: p.snr,
        temperature: p.temperature,
        wind_speed: p.wind_speed,
        mq9_gas: p.mq9_gas
      };
    });

    const combined = [...meshSos, ...telemetrySos];
    combined.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Deduplicate by origin_node and approximate timestamp (within 2 seconds)
    const seen = new Set();
    const uniqueSos = [];
    for (const item of combined) {
      const key = `${item.origin_node}_${Math.floor(new Date(item.timestamp).getTime() / 2000)}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueSos.push(item);
      }
    }

    res.json({
      status: 'success',
      count: uniqueSos.length,
      alerts: uniqueSos
    });
  } catch (err) {
    console.error('Error fetching SOS history:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * @route   GET /v1/devices/:id/outbox
 * @desc    Poll pending downlink outbox messages for ESP Gateway
 */
router.get('/:id/outbox', (req, res) => {
  const pending = meshOutboxQueue.find(m => !m.delivered);

  if (pending) {
    res.json({
      has_message: true,
      outbox_id: pending.outbox_id,
      target_node: pending.target_node,
      text: pending.text,
      alert_level: pending.alert_level
    });
  } else {
    res.json({ has_message: false });
  }
});

/**
 * @route   POST /v1/devices/outbox/:outboxId/ack
 * @desc    Acknowledge that a queued outbox message was transmitted over 433MHz LoRa
 */
router.post('/outbox/:outboxId/ack', (req, res) => {
  const { outboxId } = req.params;
  meshOutboxQueue = meshOutboxQueue.filter(m => m.outbox_id !== outboxId);
  console.log(`[LORA MESH DOWNLINK ACKNOWLEDGED]: Message ${outboxId} delivered to mesh.`);
  res.json({ status: 'success', message: 'Outbox message acknowledged' });
});

/**
 * @route   GET /v1/devices/telemetry/history
 * @desc    Fetch historical weather & sensor telemetry for graph time ranges (live, 3h, 6h, 12h, 24h, 7d, 30d)
 *          Supports filtering by origin_node (LoRa mesh station ID) and device_id
 */
router.get('/telemetry/history', async (req, res) => {
  try {
    const { range = '3h', device_id, origin_node, start_date, end_date, limit = 1000 } = req.query;

    const filter = {};
    if (device_id && device_id !== 'all') {
      filter.device_id = device_id;
    } else {
      // If fetching weather telemetry across nodes, ensure we only match weather telemetry records
      filter.$or = [
        { device_type: 'weather_station_v1' },
        { 'payload.wind_speed': { $exists: true } },
        { 'payload.temperature': { $exists: true } },
        { 'payload.mesh_origin_node': { $exists: true } }
      ];
    }

    if (origin_node && origin_node !== 'all') {
      filter['payload.mesh_origin_node'] = Number(origin_node);
    }

    if (start_date || end_date) {
      filter.timestamp = {};
      if (start_date) filter.timestamp.$gte = new Date(start_date);
      if (end_date) filter.timestamp.$lte = new Date(end_date);
    } else {
      const now = new Date();
      let startTime = new Date();

      switch (range) {
        case 'live':
          startTime = new Date(now.getTime() - 15 * 60 * 1000); // last 15 mins
          break;
        case '1h':
          startTime = new Date(now.getTime() - 60 * 60 * 1000); // last 1 hr
          break;
        case '3h':
          startTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
          break;
        case '6h':
          startTime = new Date(now.getTime() - 6 * 60 * 60 * 1000);
          break;
        case '12h':
          startTime = new Date(now.getTime() - 12 * 60 * 60 * 1000);
          break;
        case '24h':
        case '1d':
          startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case '7d':
        case '1w':
        case '7w':
          startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
        case '1m':
          startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          startTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
      }

      filter.timestamp = { $gte: startTime };
    }

    const queryLimit = Math.min(Math.max(Number(limit) || 1000, 10), 3000);

    // Fetch latest readings up to limit (newest first, then reverse for chronological graph order)
    const readingsDesc = await Reading.find(filter)
      .sort({ timestamp: -1 })
      .limit(queryLimit);
    const readings = readingsDesc.reverse();

    const formatted = readings.map(r => {
      const ts = new Date(r.timestamp);
      const isLongRange = range === '7d' || range === '1w' || range === '7w' || range === '30d' || range === '1m' || !!start_date;
      const timeLabel = isLongRange
        ? `${ts.getMonth()+1}/${ts.getDate()} ${ts.getHours().toString().padStart(2,'0')}:${ts.getMinutes().toString().padStart(2,'0')}`
        : ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: range === 'live' ? '2-digit' : undefined });

      return {
        _id: r._id,
        timestamp: r.timestamp,
        timeLabel,
        deviceId: r.device_id,
        originNode: r.payload?.mesh_origin_node !== undefined ? Number(r.payload.mesh_origin_node) : 1,
        temp: r.payload?.temperature !== undefined ? Number(r.payload.temperature) : null,
        humidity: r.payload?.humidity !== undefined ? Number(r.payload.humidity) : null,
        windSpeed: r.payload?.wind_speed !== undefined ? Number(r.payload.wind_speed) : null,
        windDirection: r.payload?.wind_direction || 'None',
        mq3Gas: r.payload?.mq3_gas !== undefined ? Number(r.payload.mq3_gas) : (r.payload?.mq9_gas !== undefined ? Number(r.payload.mq9_gas) : null),
        mq9Gas: r.payload?.mq9_gas !== undefined ? Number(r.payload.mq9_gas) : (r.payload?.mq3_gas !== undefined ? Number(r.payload.mq3_gas) : null),
        pressure: r.payload?.pressure !== undefined ? Number(r.payload.pressure) : null,
        altitude: r.payload?.altitude !== undefined ? Number(r.payload.altitude) : (r.payload?.pressure ? Number((44330 * (1 - Math.pow(r.payload.pressure / 101325, 0.1903))).toFixed(1)) : null),
        light: r.payload?.light !== undefined ? Number(r.payload.light) : null,
        batteryMv: r.payload?.battery_mv !== undefined ? Number(r.payload.battery_mv) : null,
        batteryPct: r.payload?.battery_pct !== undefined ? Number(r.payload.battery_pct) : (r.payload?.battery_mv ? Math.max(0, Math.min(100, Math.round(((r.payload.battery_mv - 3300) / 900) * 100))) : null),
        batteryLevel: r.payload?.battery_level || null,
        signalLevel: r.payload?.signal_level || null,
        alertLevel: r.payload?.alert_level !== undefined ? Number(r.payload.alert_level) : 0,
        alertLevelName: r.payload?.alert_level_name || 'NORMAL',
        heatIndex: r.payload?.heat_index !== undefined ? Number(r.payload.heat_index) : (r.payload?.temperature !== undefined ? Number(r.payload.temperature) : null),
        windLevel: r.payload?.wind_level || null,
        airQualityLevel: r.payload?.air_quality_level || null,
        rssi: r.payload?.rssi !== undefined ? Number(r.payload.rssi) : null,
        snr: r.payload?.snr !== undefined ? Number(r.payload.snr) : null,
      };
    });

    // Calculate aggregate statistics for the timeframe
    const validTemps = formatted.map(r => r.temp).filter(v => v !== null && !isNaN(v));
    const validHums = formatted.map(r => r.humidity).filter(v => v !== null && !isNaN(v));
    const validWinds = formatted.map(r => r.windSpeed).filter(v => v !== null && !isNaN(v));
    const validPress = formatted.map(r => r.pressure).filter(v => v !== null && !isNaN(v));
    const validBatts = formatted.map(r => r.batteryMv).filter(v => v !== null && !isNaN(v));

    const stats = {
      temp: validTemps.length ? {
        min: Math.min(...validTemps),
        max: Math.max(...validTemps),
        avg: Number((validTemps.reduce((a, b) => a + b, 0) / validTemps.length).toFixed(1))
      } : null,
      humidity: validHums.length ? {
        min: Math.min(...validHums),
        max: Math.max(...validHums),
        avg: Number((validHums.reduce((a, b) => a + b, 0) / validHums.length).toFixed(1))
      } : null,
      windSpeed: validWinds.length ? {
        max: Math.max(...validWinds),
        avg: Number((validWinds.reduce((a, b) => a + b, 0) / validWinds.length).toFixed(1))
      } : null,
      pressure: validPress.length ? {
        min: Math.min(...validPress),
        max: Math.max(...validPress),
        avg: Math.round(validPress.reduce((a, b) => a + b, 0) / validPress.length)
      } : null,
      batteryMv: validBatts.length ? {
        min: Math.min(...validBatts),
        max: Math.max(...validBatts),
        avg: Math.round(validBatts.reduce((a, b) => a + b, 0) / validBatts.length)
      } : null,
    };

    // Query all distinct active nodes present across the entire time window
    const distinctRaw = await Reading.distinct('payload.mesh_origin_node', filter);
    const activeNodes = Array.from(new Set(
      distinctRaw.filter(n => n !== undefined && n !== null).map(Number)
    )).sort((a, b) => a - b);

    res.json({
      status: 'success',
      range: start_date ? 'custom' : range,
      count: formatted.length,
      activeNodes: activeNodes.length > 0 ? activeNodes : [1],
      stats,
      readings: formatted
    });
  } catch (error) {
    console.error('Error fetching telemetry history:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch telemetry history' });
  }
});

module.exports = router;


