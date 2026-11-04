// Alert rule evaluation for the HTTP ingestion path.
// (The original evaluator lived only in mqttIngestion.js, which is disabled,
// so rules created in the dashboard never fired.)
const AlertRule = require('../models/AlertRule');
const { postJson } = require('./outboundUrl');

const RULE_CACHE_TTL_MS = 30 * 1000;
const COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS) || 5 * 60 * 1000;

const ruleCache = new Map(); // device_id -> { rules, exp }
const lastFired = new Map(); // rule_id -> timestamp

const getRules = async (deviceId) => {
  const hit = ruleCache.get(deviceId);
  if (hit && hit.exp > Date.now()) return hit.rules;
  const rules = await AlertRule.find({ device_id: deviceId, enabled: true }).lean();
  ruleCache.set(deviceId, { rules, exp: Date.now() + RULE_CACHE_TTL_MS });
  return rules;
};

const invalidateRuleCache = (deviceId) => {
  if (deviceId) ruleCache.delete(deviceId);
  else ruleCache.clear();
};

const compare = (actual, operator, expected) => {
  const a = Number(actual);
  const e = Number(expected);
  const numeric = !Number.isNaN(a) && !Number.isNaN(e) && actual !== '' && expected !== '';
  const l = numeric ? a : String(actual);
  const r = numeric ? e : String(expected);
  switch (operator) {
    case '>': return l > r;
    case '<': return l < r;
    case '==': return l === r;
    case '!=': return l !== r;
    default: return false;
  }
};

/**
 * Evaluate enabled rules for a device against a validated payload.
 * Fire-and-forget: never throws, never blocks the ingestion response.
 */
const evaluateAlertRules = async (device, payload, io) => {
  try {
    const rules = await getRules(device.device_id);
    for (const rule of rules) {
      const val = payload[rule.condition.field];
      if (val === undefined || !compare(val, rule.condition.operator, rule.condition.value)) continue;

      const id = String(rule._id);
      const now = Date.now();
      if (lastFired.has(id) && now - lastFired.get(id) < COOLDOWN_MS) continue;
      lastFired.set(id, now);

      const event = {
        rule_id: id,
        device_id: device.device_id,
        device_name: device.name,
        field: rule.condition.field,
        operator: rule.condition.operator,
        threshold: rule.condition.value,
        value: val,
        action: rule.action,
        timestamp: new Date().toISOString(),
      };
      console.log(`[ALERT TRIGGERED] ${device.device_id}: ${event.field}=${val} ${event.operator} ${event.threshold} -> ${rule.action.type}:${rule.action.target}`);

      if (io) io.emit('alert_triggered', event);

      if (rule.action.type === 'webhook') {
        postJson(rule.action.target, { event: 'alert.triggered', ...event }).then((r) => {
          if (!r.ok) console.warn(`[ALERT WEBHOOK] ${rule.action.target} failed: ${r.error || r.status}`);
        });
      } else if (rule.action.type === 'actuator') {
        // MQTT command delivery is disabled on this deployment; surface it instead of silently dropping.
        console.warn(`[ALERT ACTUATOR] Command '${rule.action.target}' for ${device.device_id} not delivered: MQTT disabled.`);
      }
    }
  } catch (err) {
    console.warn('[ALERT ENGINE] Evaluation error:', err.message);
  }
};

module.exports = { evaluateAlertRules, invalidateRuleCache, compare };
