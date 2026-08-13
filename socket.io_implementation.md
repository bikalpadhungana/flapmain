# Socket.io Real-Time Implementation Guide

This document outlines the Phase 4 architectural upgrade implemented in the FlapMain project. We have replaced the legacy 3-second HTTP polling loop with a persistent, bidirectional WebSocket connection using `socket.io`. 

## Architecture Overview

1. **Backend (`backend/src/socket.js` & `backend/src/app.js`)**
   - The Express application is now wrapped in a native Node `http` server.
   - `Socket.io` is initialized as a singleton in `socket.js` to prevent circular dependencies between route files.
   - The server actively listens for incoming WebSocket connections from dashboards on port `5051`.

2. **Global Telemetry Broadcaster**
   - When a hardware tap is processed via the legacy **HTTP POST** (`routes/devices.js`), the backend emits a `new_tap` event globally.
   - When a hardware tap is processed via the new **MQTT Broker** (`mqtt/broker.js`), the exact same `new_tap` event is emitted.
   - This ensures that all dashboards receive data simultaneously, regardless of which protocol the hardware device used to communicate with the gateway.

3. **Frontend Dashboard (`frontend/src/pages/SystemMonitor.jsx`)**
   - We removed the `setInterval` polling loop, drastically reducing network overhead.
   - The UI now connects to the backend using `socket.io-client`.
   - When the `new_tap` event is received, the React state prepends the new log to the list instantly (`setLogs(prev => [newLog, ...prev])`), achieving a "Zero-Latency" display.

## How to Test

1. Ensure the backend is running (`npm run dev`).
2. Open the React frontend dashboard and navigate to the **System Monitor**.
3. You will see the UI indicator in the top right corner display **"Live Stream Active"**.
4. Use the physical NFC hardware to tap a card (or trigger an HTTP POST manually).
5. The payload will flash onto the screen instantly without needing a page refresh or waiting for a polling tick.

## WebSocket Events Reference

| Event Name | Emitted By | Listened By | Payload Description |
| :--- | :--- | :--- | :--- |
| `new_tap` | `devices.js`, `broker.js` | `SystemMonitor.jsx`, `Dashboard.jsx` | Broadcasts new NFC card tap events globally |
| `new_scale_reading` | `devices.js` | `ScaleMonitor.jsx`, `SensorFusion.jsx` | Broadcasts live height & weight scale telemetry |
| `device_trigger_initiated` | `devices.js` | `ScaleMonitor.jsx`, Hardware Scale | Signals device readiness for measurement session |
| `scale_measurement_completed` | `devices.js` | `ScaleMonitor.jsx`, External APIs | Emits completed scale reading with external webhook delivery status |
| `sensor_fusion_tap` | `devices.js` | `SensorFusion.jsx` | Workstation session event pairing Card Reader to Scale |

---

# Enterprise Resilience & Environment Roles

In addition to the WebSockets upgrade, the entire backend pipeline was upgraded to handle offline scenarios and deploy seamlessly to both local edge hardware and cloud VPS environments.

## 1. Store-and-Forward Sync Daemon
The legacy HTTP polling was highly vulnerable to internet outages. The new system acts as a true proxy:
- **Zero Data Loss:** When hardware sends telemetry, it is instantly saved to the local MongoDB `TapLog` before attempting to forward to the VPS.
- **Background Sync:** `backend/src/workers/vpsSyncWorker.js` runs continuously. If the internet drops, it queues the taps. When the internet returns, it batches them and pushes them to the VPS automatically.
- **Smart 4xx Handling:** The Sync Worker intelligently parses HTTP status codes. If the VPS rejects a tap (e.g., `401 Unauthorized` due to a bad `api_key`), the worker permanently flags it as rejected rather than blindly retrying in an infinite loop.
- **Flood Protection:** A safety mechanism was introduced. If the worker hits 5 consecutive 4xx rejections, it instantly breaks the batch loop to protect the server logs from flooding.

## 2. Environment Roles (Edge vs Cloud)
Because the exact same Node.js codebase is used for both the local hospital network and the main DigitalOcean/AWS VPS, a `NODE_ROLE` environment variable was introduced in `app.js` and `routes/devices.js`.

### `NODE_ROLE=edge` (Default)
When running on the local network:
- The backend attempts to fetch the VPS instantly to update the hardware LCD screen.
- The `vpsSyncWorker` daemon is actively running to sync offline logs.

### `NODE_ROLE=cloud`
When deploying to the main internet-facing VPS, add this line to your `.env` file.
- The backend will **disable** the `vpsSyncWorker` daemon so the VPS doesn't try to sync data to itself.
- In the `/tap` route, it recognizes it is already the final destination, skipping the proxy fetch and saving milliseconds of latency.
