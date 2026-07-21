# Development Plan — FlapMain

This is the living record of platform development. **Every update to the platform must be logged here** — new features, fixes, architecture decisions, schema changes, and infra changes — so anyone joining the project can see exactly what's built, what's in progress, and what's next.

---

## How to use this file
- Add an entry under the current phase whenever something changes.
- Format: `- [YYYY-MM-DD] Short description of what changed. (author)`
- Move a phase to "Completed" once everything in it is shipped.
- Don't delete old entries — this is a history, not just a to-do list.

---

## Phase 0 — Foundation
**Status:** Not started

**Planned:**

### Repo & Project Structure
- [ ] Initialize monorepo layout: `backend/`, `frontend/`, `infra/`, `docs/`
- [ ] Set up `.env.example` with all required environment variables
- [ ] Configure ESLint + Prettier for backend and frontend
- [ ] Set up basic npm workspaces or root-level scripts (`dev`, `lint`, `test`)

### Identity & Device Scheme
- [ ] Decide on `device_id` format — e.g. `flap-{type_prefix}-{nanoid}` or extend flapid scheme
- [ ] Document the decision in `docs/device-id-scheme.md`

### MQTT Broker
- [ ] Spin up EMQX via Docker locally (document command in `infra/README.md`)
- [ ] Configure basic MQTT auth (username = `device_id`, password = device API key)
- [ ] Test pub/sub on topic pattern `flap/{org_id}/{device_id}/telemetry`
- [ ] Document broker setup and topic conventions

### MongoDB
- [ ] Create MongoDB Atlas cluster (or local for dev)
- [ ] Define and create collections: `orgs`, `users`, `device_types`, `devices`, `readings`, `api_keys`, `alert_rules`
- [ ] Create `readings` as a time-series collection (`timeField: "timestamp"`, `metaField: "device_id"`)
- [ ] Add indexes: `devices.device_id` (unique), `devices.org_id`, `readings.device_id + timestamp`
- [ ] Seed Schema Registry (`device_types`) with 3 initial device types:
  - `weight_scale_v1`
  - `water_tank_v1`
  - `flap_switch_v1`

### Auth Scaffolding
- [ ] JWT middleware for dashboard user auth (login → access token + refresh token)
- [ ] API key middleware: hash-compare incoming key, attach `org_id` + `scopes` to request
- [ ] Device auth middleware: validate device API key on MQTT connect and REST requests

### CI
- [ ] GitHub Actions: lint + test on every PR to `main`

**Log:**
- _(no entries yet)_

---

## Phase 1 — MVP
**Status:** Not started

**Planned:**

### Ingestion Pipeline
- [ ] Ingestion service: subscribe to `flap/+/+/telemetry`, parse and validate payload against Schema Registry
- [ ] On validation pass: write reading to `readings` time-series collection, update `devices.last_seen` and `devices.status`
- [ ] On validation fail: log error, drop message (no partial writes)
- [ ] REST fallback: `POST /v1/devices/:device_id/readings` (same validation + write)

### REST API (Internal)
- [ ] `POST /v1/devices` — register device
- [ ] `GET /v1/devices` — list devices (org-scoped)
- [ ] `GET /v1/devices/:id` — get device detail
- [ ] `PATCH /v1/devices/:id/deactivate` — deactivate device
- [ ] `GET /v1/devices/:id/readings/latest` — latest telemetry reading
- [ ] `GET /v1/devices/:id/readings` — historical range (query params: `from`, `to`, `limit`)

### Dashboard (Basic)
- [ ] Login page — email/password → JWT
- [ ] Device list page — table with name, type, status, last seen
- [ ] Device detail page — latest value display per field (no charts yet)

**Log:**
- _(no entries yet)_

---

## Phase 2 — Core Product
**Status:** Not started

**Planned:**
- [ ] Historical charts (Recharts or Chart.js) on device detail page
- [ ] Data export: `GET /v1/devices/:id/readings/export?format=csv|json`
- [ ] Actuator command endpoint: `POST /v1/devices/:id/commands` → publish to `flap/{org_id}/{device_id}/cmd`
- [ ] Command validation against Schema Registry `commands` list
- [ ] Alert rules: CRUD via API + evaluation on every ingest
- [ ] Multi-org: org-scoped data isolation enforced at API layer
- [ ] User invite flow (email invite → set password)
- [ ] Role enforcement: `admin` vs `viewer` in dashboard

**Log:**
- _(no entries yet)_

---

## Phase 3 — External API
**Status:** Not started

**Planned:**
- [ ] Scoped API key generation per partner org (scopes: `read:devices`, `read:readings`, `write:commands`)
- [ ] Rate limiting per API key (configurable RPM, default 60)
- [ ] OpenAPI / Swagger docs at `/api/docs`
- [ ] Webhook support: register endpoint per org, push on new reading or alert trigger

**Log:**
- _(no entries yet)_

---

## Phase 4 — Scale-Up
**Status:** Not started

**Planned:**
- [ ] Split ingestion into standalone service if load requires it
- [ ] Evaluate InfluxDB / TimescaleDB migration when readings volume justifies it
- [ ] LoRa / edge gateway support for rural deployments
- [ ] Kafka evaluation if MQTT + Mongo throughput becomes a bottleneck

**Log:**
- _(no entries yet)_

---

## Completed
_(Phases move here once fully shipped)_

---

## Open Questions / Decisions Needed
- [ ] Tie `device_id` to the existing `flapid` scheme, or define a FlapMain-specific format?
- [ ] EMQX cloud-hosted (simplest ops) vs. self-hosted on a VPS (cheapest long-term)?
- [ ] Which MongoDB Atlas tier to start on — M0 free enough for Phase 0–1?
- [ ] Does the ingestion service live inside the main Express app (simpler) or as a separate Node process from day one?
