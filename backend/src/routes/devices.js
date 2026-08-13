const express = require('express');
const crypto = require('crypto');
const Device = require('../models/Device');
const DeviceType = require('../models/DeviceType');
const Reading = require('../models/Reading');
const TapLog = require('../models/TapLog');
const Org = require('../models/Org');
const FusionGroup = require('../models/FusionGroup');

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
        device = await Device.create({
          device_id,
          org_id: defaultOrg._id,
          device_type: (req.body.device_type || 'weight_scale_v1').toLowerCase(),
          name: `Height & Weight Scale (${device_id})`,
          location: 'Main Terminal',
          api_key_hash: hashKey(keyToHash),
          status: 'online',
          activation_status: 'active',
        });
        console.log(`[AUTO-PROVISIONED HEIGHT/WEIGHT SCALE DEVICE]: ${device_id}`);
      } else {
        return res.status(404).json({ status: 'error', message: 'Device not registered' });
      }
    }

    if (device.activation_status !== 'active') {
      return res.status(403).json({ status: 'error', message: 'Device pending activation' });
    }

    // 2. Fetch device schema
    const schemaDoc = await DeviceType.findOne({ device_type: device.device_type });
    
    // 3. Validate payload fields
    const payload = req.body;
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
      io.emit('new_scale_reading', reading);
      io.emit('new_telemetry', reading);
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

module.exports = router;


