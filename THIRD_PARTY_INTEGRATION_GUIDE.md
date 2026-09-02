# FlapMain IoT & Telemetry — Third-Party API Integration Guide

This document provides complete instructions on how external software platforms (Hospital EMRs, Clinic Management SaaS, FlapCard, custom enterprise web/mobile applications) can integrate with the **FlapMain IoT & Sensor Telemetry System**.

---

## 1. System Endpoints & Environment Base URLs

| Environment | Base URL | API Base | WebSocket Stream (Socket.io) |
| :--- | :--- | :--- | :--- |
| **Live Production Server** | `https://main.esainnovation.com` | `https://main.esainnovation.com/api` | `wss://main.esainnovation.com` |
| **Local Gateway / Edge Server** | `http://<edge-ip>:5051` | `http://<edge-ip>:5051/api` | `ws://<edge-ip>:5051` |

---

## 2. Authentication & Authorization

FlapMain supports two security authentication schemes depending on the calling entity:

### A. Bearer Token (User / External System API Access)
Add the JWT token in the HTTP Authorization header:
```http
Authorization: Bearer <YOUR_JWT_TOKEN>
```

### B. Device Credentials (IoT Hardware & Gateway Ingestion)
Hardware devices and gateway proxies authenticate via custom HTTP headers:
```http
X-Device-Id: <FLAPMAIN_DEVICE_ID>
X-Device-Key: <FLAPMAIN_DEVICE_KEY>
```

---

## 3. Scale Measurement Trigger API (Initiate Device Reading)

Third-party applications can initiate a weight & height measurement session for any scale device registered in FlapMain. This prepares the hardware device and binds incoming sensor telemetry directly to your external patient or user identifier.

### Endpoint: Initiate Scale Measurement
- **HTTP Method:** `POST`
- **URL Path:** `/v1/devices/:device_id/trigger` (or `/v1/devices/trigger`)
- **Full Production URL:** `https://main.esainnovation.com/api/v1/devices/:device_id/trigger`

#### Request Headers
```http
Content-Type: application/json
Authorization: Bearer <YOUR_JWT_TOKEN>
```

#### Request Body (JSON)
```json
{
  "device_id": "flap-weight and height sensor-yftb",
  "external_user_id": "PATIENT-1042",
  "user_name": "John Doe",
  "callback_url": "https://your-platform.com/api/v1/webhooks/scale-readings",
  "notes": "Annual health assessment"
}
```

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `device_id` | `String` | **Yes** | Target scale device ID (e.g. `scale_hw_001` or `flap-weight and height sensor-yftb`) |
| `external_user_id` | `String` | **Yes** | Patient / User ID from your third-party system |
| `user_name` | `String` | Optional | Display name of the user / patient |
| `callback_url` | `String` | Optional | Webhook URL to automatically receive the completed measurement data |
| `notes` | `String` | Optional | Additional metadata notes attached to this measurement session |

#### Successful Response (`200 OK`)
```json
{
  "status": "success",
  "session_id": "trig_1723600000000",
  "device_id": "flap-weight and height sensor-yftb",
  "external_user_id": "PATIENT-1042",
  "user_name": "John Doe",
  "callback_url": "https://your-platform.com/api/v1/webhooks/scale-readings",
  "message": "Device trigger session initiated successfully. Scale ready for measurement."
}
```

---

### Endpoint: Poll Device Trigger Status
- **HTTP Method:** `GET`
- **URL Path:** `/v1/devices/:device_id/trigger-status`
- **Full Production URL:** `https://main.esainnovation.com/api/v1/devices/:device_id/trigger-status`

#### Successful Response (`200 OK`)
```json
{
  "device_id": "flap-weight and height sensor-yftb",
  "active_trigger": {
    "session_id": "trig_1723600000000",
    "external_user_id": "PATIENT-1042",
    "user_name": "John Doe",
    "status": "ready",
    "timestamp": "2026-08-14T16:15:00.000Z"
  },
  "latest_reading": {
    "weight_kg": 72.5,
    "height_cm": 175.0,
    "bmi": 23.67,
    "timestamp": "2026-08-14T16:15:20.000Z"
  }
}
```

---

## 4. Automatic Webhook Push Delivery

When a user steps on the scale and the weight/height measurement settles, FlapMain automatically executes an **HTTP POST request** to the `callback_url` specified during trigger initiation.

### Webhook Event: `scale.measurement_completed`
#### Request Sent to Third-Party `callback_url`:
```http
POST https://your-platform.com/api/v1/webhooks/scale-readings
Content-Type: application/json
User-Agent: FlapMain-Webhook-Dispatcher/1.0
```

#### Webhook Payload (JSON Body)
```json
{
  "event": "scale.measurement_completed",
  "session_id": "trig_1723600000000",
  "device_id": "flap-weight and height sensor-yftb",
  "external_user_id": "PATIENT-1042",
  "user_name": "John Doe",
  "reading": {
    "weight_kg": 72.5,
    "height_cm": 175.0,
    "bmi": 23.67,
    "raw_payload": {
      "weight_kg": 72.5,
      "height_cm": 175.0,
      "device_type": "weight_scale_v1"
    }
  },
  "timestamp": "2026-08-14T16:15:20.000Z"
}
```

---

## 5. Card Reader & NFC Tag Verification API

External systems can verify card taps or look up cardholder identity via FlapMain's Tag Lookup API.

### Endpoint: NFC Tag Lookup
- **HTTP Method:** `POST`
- **URL Path:** `/tags/lookup` (or `/v1/devices/tap`)
- **Full Production URL:** `https://main.esainnovation.com/api/tags/lookup`

#### Request Body
```json
{
  "uid": "04:A1:B2:C3:D4:E5:F6"
}
```

#### Successful Response (`200 OK`)
```json
{
  "status": "success",
  "user": {
    "flapid": "FLAP-USER-8A9K",
    "name": "Bikalpa Dhungana",
    "organization": "ESA Innovation"
  },
  "display": {
    "line1": "Bikalpa Dhungana",
    "line2": "Step on scale!",
    "line3": "Awaiting weight..."
  }
}
```

---

## 6. Real-Time WebSockets Telemetry (Socket.io)

For dashboards requiring zero-latency telemetry streaming, connect using `socket.io-client`:

```javascript
import { io } from 'socket.io-client';

const socket = io('https://main.esainnovation.com');

socket.on('connect', () => {
  console.log('[Socket.io] Connected to FlapMain Telemetry Stream');
});

// Event 1: Scale Trigger Initiated
socket.on('device_trigger_initiated', (data) => {
  console.log('Scale Ready for User:', data.external_user_id);
});

// Event 2: Scale Measurement Completed (with Webhook delivery state)
socket.on('scale_measurement_completed', (data) => {
  console.log('Measurement Completed:', data.reading.weight_kg, 'kg');
});

// Event 3: Global Scale Telemetry Packet
socket.on('new_scale_reading', (reading) => {
  console.log('Live Scale Packet:', reading);
});

// Event 4: Live Weather Station Telemetry Packet
socket.on('new_weather_reading', (reading) => {
  console.log('Live Weather Packet:', reading.payload.wind_speed, 'km/h,', reading.payload.temperature, '°C');
});

// Event 5: Real-Time ESP32-CAM Image Frame Packet
socket.on('new_camera_frame', (frameData) => {
  console.log('Live Camera Frame Received:', frameData.device_id, frameData.timestamp);
});

// Event 6: Hardware Control State Updated (e.g. Flash LED ON/OFF)
socket.on('camera_control_updated', (data) => {
  console.log('Camera Control State Changed:', data.device_id, data.variable, '=', data.val);
});
```

---

## 6.1 Direct Camera Frame Upload & MJPEG Cloud Proxy Stream API

External applications and cameras can push image frames directly to FlapMain cloud:

### Endpoint: Upload Camera JPEG Frame
- **HTTP Method:** `POST`
- **Full Production URL:** `https://main.esainnovation.com/api/v1/devices/camera/upload`
- **Headers:** `Content-Type: image/jpeg` or `application/json`, `X-Device-Id: flap-esp32-cam-001`, `X-Device-Key: <DEVICE_KEY>`

### Endpoint: Global Cloud MJPEG Stream Proxy
- **HTTP Method:** `GET`
- **Full Production URL:** `https://main.esainnovation.com/api/v1/devices/:device_id/camera/stream`
- **Description:** Produces a live `multipart/x-mixed-replace` HTTP MJPEG video stream accessible from any browser or application worldwide.

### Endpoint: Remote Camera Hardware Parameter Control
- **HTTP Method:** `POST`
- **Full Production URL:** `https://main.esainnovation.com/api/v1/devices/:device_id/control`
- **Request Body (JSON):**
  ```json
  {
    "variable": "flash",
    "val": 1
  }
  ```

---

## 7. Integration Code Examples

### A. cURL Example (Trigger Scale Measurement)
```bash
curl -X POST "https://main.esainnovation.com/api/v1/devices/flap-weight%20and%20height%20sensor-yftb/trigger" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "flap-weight and height sensor-yftb",
    "external_user_id": "PATIENT-1042",
    "user_name": "John Doe",
    "callback_url": "https://myclinic.com/api/webhooks/scale"
  }'
```

### B. Node.js / JavaScript Example
```javascript
const axios = require('axios');

const FLAPMAIN_HOST = 'https://main.esainnovation.com';

async function triggerScaleReading(deviceId, externalUserId, userName, webhookUrl) {
  try {
    const response = await axios.post(`${FLAPMAIN_HOST}/api/v1/devices/${encodeURIComponent(deviceId)}/trigger`, {
      device_id: deviceId,
      external_user_id: externalUserId,
      user_name: userName,
      callback_url: webhookUrl
    });

    console.log('Trigger Session Created:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error triggering scale:', error.response?.data || error.message);
  }
}

// Example usage with active test device
triggerScaleReading(
  'flap-weight and height sensor-yftb',
  'PATIENT-1042',
  'John Doe',
  'https://myclinic.com/api/webhooks/scale'
);
```

### C. Python Example
```python
import requests

FLAPMAIN_HOST = "https://main.esainnovation.com"

def trigger_scale_measurement(device_id, external_user_id, user_name, callback_url=None):
    url = f"{FLAPMAIN_HOST}/api/v1/devices/{device_id}/trigger"
    payload = {
        "device_id": device_id,
        "external_user_id": external_user_id,
        "user_name": user_name,
        "callback_url": callback_url
    }
    
    response = requests.post(url, json=payload)
    if response.status_code == 200:
        print("Scale Triggered:", response.json())
        return response.json()
        
    print("Trigger Error:", response.status_code, response.text)
    return None

# Example usage with active test device
trigger_scale_measurement("flap-weight and height sensor-yftb", "PATIENT-1042", "John Doe", "https://myclinic.com/api/webhooks/scale")
```

---

## 8. Summary of Webhook Event Payloads

```json
{
  "event": "scale.measurement_completed",
  "session_id": "trig_1723600000000",
  "device_id": "flap-weight and height sensor-yftb",
  "external_user_id": "PATIENT-1042",
  "user_name": "John Doe",
  "reading": {
    "weight_kg": 72.5,
    "height_cm": 175.0,
    "bmi": 23.67
  },
  "timestamp": "2026-08-14T16:15:20.000Z"
}
```
