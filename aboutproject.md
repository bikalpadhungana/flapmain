# About FlapMain

## What This Is
FlapMain is the central IoT platform for Flap's hardware ecosystem. Flap builds diverse IoT devices — medical height/weight sensors, water tank temperature sensors with actuators, Flap switching hardware, and more to come. Each device currently ships data independently. FlapMain unifies this into one system: a central place to register devices, ingest and store their data, view it on an admin dashboard, and expose it via API to external companies/platforms.

This document captures the system design and reasoning. Day-to-day progress and updates are tracked in [`developmentplan.md`](./developmentplan.md).

---

## Why FlapMain
- Every device type today (weight scale, water tank, switch) speaks its own language. Without a common platform, each new device type means new one-off backend code.
- We need one dashboard to see all devices — online/offline status, live data, history — instead of managing each device type separately.
- We want to license/expose data via API to other companies or platforms without exposing raw device internals.
- The system has to be **scalable by design** — new device types should be addable without rewriting the backend, since Flap's hardware line keeps growing (satellites, scooters, masks, wallets, switches, and more). The core insight: every device type is different, but the pipeline is the same — `device → auth → ingest → store → visualize/act → expose via API`. Build the pipeline once; each device type is just a schema definition plugged into it.

---

## Core Design Principle: Schema Registry

Rather than hardcoding each device type's fields into the backend, every device type is defined as a **schema record** (fields it emits + commands it accepts). Adding a new device type — e.g. an air quality sensor — means adding a schema entry, not writing new backend logic. This is the single most important decision for keeping FlapMain scalable without a growing engineering team.

```json
{
  "device_type": "water_tank_v1",
  "display_name": "Water Tank Sensor v1",
  "fields": {
    "temperature_c": { "type": "number", "unit": "°C" },
    "actuator_state": { "type": "boolean" }
  },
  "commands": ["set_actuator"]
}
```

Planned device types at launch:

| `device_type` | Description |
|---|---|
| `weight_scale_v1` | Medical height/weight sensor |
| `water_tank_v1` | Water tank temp sensor + actuator |
| `flap_switch_v1` | Flap switching hardware |

---

## System Architecture (5 Layers)

### 1. Device Layer
Hardware devices (ESP8266/ESP32-class), each provisioned with:
- A unique `device_id` — potentially extending the existing `flapid` identity scheme so one identity system spans NFC cards and IoT devices.
- A `device_type` tag (e.g. `weight_scale_v1`, `water_tank_v1`, `flap_switch_v1`).
- A per-device API key (or cert) used to authenticate every message — no shared secrets.

### 2. Communication Layer
- **MQTT broker** (EMQX preferred — generous free tier, scales better than Mosquitto for multi-tenant) for real-time telemetry. Low bandwidth, tolerant of unreliable connectivity — the right choice for Nepal network conditions.
- **REST/HTTPS** as fallback for devices that can't hold persistent connections, and for all third-party integrations.
- **LoRa** considered for Phase 3+ if rural/off-WiFi deployments (e.g. remote water tanks) increase.

MQTT topic convention:
- Telemetry: `flap/{org_id}/{device_id}/telemetry`
- Commands:  `flap/{org_id}/{device_id}/cmd`

### 3. Ingestion & Storage
- Ingestion service subscribes to MQTT topics, **validates payload against the device type's schema** (from the Schema Registry), and writes to storage.
- **MongoDB** for all structured records: devices, device_types (Schema Registry), users, orgs, API keys, alert rules.
- **MongoDB time-series collections** for telemetry/logs initially — single DB to manage, simplest operational path. Migrate to InfluxDB or TimescaleDB only when volume actually demands it.

### 4. Application / API Layer (Node.js / Express)
- **Device management:** register, view, deactivate.
- **Data query API:** latest reading, historical range, aggregates (min/max/avg over time window).
- **Actuator control endpoints:** send command → device (e.g. toggle water tank actuator). Commands validated against device type's `commands` list.
- **Auth:** JWT for dashboard users; scoped, revocable API keys for external platforms/companies.
- **Alerts / rules engine:** e.g. "temp > X → trigger actuator" or "temp > X → notify webhook". Rules stored per-device, evaluated on ingest.

### 5. Admin Dashboard (React)
- Device list with live status (online/offline, last seen).
- Per-device data view — charts and logs.
- Device provisioning — add device, assign type, generate key.
- API key management for external partners.
- Org/role management — **multi-tenant from day one**, even if Flap is the only tenant right now.

---

## Data Model (MongoDB Collections)

### `orgs`
```json
{ "_id", "name", "slug", "createdAt" }
```

### `users`
```json
{ "_id", "org_id", "email", "password_hash", "role", "createdAt" }
```
Roles: `admin`, `viewer`

### `device_types` (Schema Registry)
```json
{
  "_id", "device_type", "display_name",
  "fields": { "<field_name>": { "type": "number|boolean|string", "unit": "optional" } },
  "commands": ["<command_name>"],
  "version": 1,
  "createdAt"
}
```

### `devices`
```json
{
  "_id", "device_id", "org_id", "device_type",
  "name", "location", "api_key_hash",
  "status": "online|offline",
  "last_seen", "createdAt"
}
```

### `readings` (time-series collection)
```json
{
  "timestamp", "device_id", "org_id", "device_type",
  "payload": { "<field_name>": "<value>" }
}
```
MongoDB time-series: `timeField: "timestamp"`, `metaField: "device_id"`, granularity: `seconds`.

### `api_keys`
```json
{
  "_id", "org_id", "key_hash", "label",
  "scopes": ["read:devices", "read:readings", "write:commands"],
  "rate_limit_rpm", "last_used", "createdAt"
}
```

### `alert_rules`
```json
{
  "_id", "device_id", "org_id",
  "condition": { "field": "temperature_c", "operator": ">", "value": 80 },
  "action": { "type": "actuator|webhook", "target": "..." },
  "enabled", "createdAt"
}
```

---

## Development Plan

### Phase 0 — Foundation (2–3 weeks)
- Define project structure (monorepo: `backend/`, `frontend/`, `infra/`, `docs/`).
- Finalize `device_id` scheme — tie to flapid or define standalone.
- Stand up EMQX broker (Docker locally, then hosted for staging).
- MongoDB Atlas setup — collections, indexes, time-series config.
- Seed Schema Registry with the 3 initial device types.
- Auth scaffolding: JWT (users), API key middleware (devices + external).
- CI: basic linting + test runner in place.

### Phase 1 — MVP (4–6 weeks)
- Device registration + ingestion pipeline (MQTT → validate → store) for all 3 device types.
- REST API: device CRUD, latest reading, simple historical range.
- Basic dashboard: login, device list, live latest-value view.

### Phase 2 — Core Product (4–6 weeks)
- Historical charts, data export (CSV/JSON).
- Actuator command sending (water tank, Flap switches).
- Alerts/thresholds — rule evaluation on ingest.
- Multi-org support: org-scoped data isolation, user invite flow.

### Phase 3 — External API (3–4 weeks)
- Scoped, revocable API keys per partner org.
- Rate limiting per key.
- OpenAPI / Swagger documentation.
- Webhook support for push-based partners.

### Phase 4 — Scale-Up (ongoing, as needed)
- Separate ingestion into its own microservice if load grows.
- Move telemetry to InfluxDB or TimescaleDB.
- Add LoRa / edge gateway support for rural deployments.
- Consider Kafka if MQTT + Mongo starts choking under device count.

---

## Open Assumptions
- Stack: Node/Express + React + MongoDB — matches NirmanLink experience, chosen to ship faster without learning a new stack mid-build. Revisit if this stops fitting.
- EMQX over Mosquitto: better multi-tenancy, built-in auth hooks, free tier is sufficient for Phase 0–2.
- MongoDB time-series over InfluxDB to start: one DB to operate, schema-agnostic enough for the Schema Registry pattern, upgrade path exists.

---

## Tracking Progress
This file describes *what we're building and why*. As work actually happens — features shipped, decisions changed, schema updates — log it in [`developmentplan.md`](./developmentplan.md), not here. Update this file only when the plan itself changes (new phase, new architecture decision, scope change).
