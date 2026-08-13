/*
 * FlapMain IoT — Height + Weight Scale
 * Local Web Dashboard + Live Local Server Upload
 * Local Server: http://192.168.1.69:5051/api
 * Calibration : 28355.4
 */

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <HX711.h>
#include "config.h"

// ===================== CALIBRATION & MECHANICS =====================
const float SCALE_CALIBRATION  = 28355.4;
const float SENSOR_HEIGHT_CM   = 198.5;   // distance from ultrasonic to standing plate

// ===================== PINS =====================
#define TRIG_PIN        12   // D6
#define ECHO_PIN        14   // D5
#define HX711_DOUT_PIN  4    // D2
#define HX711_SCK_PIN   5    // D1
#define LED_PIN         0    // onboard LED (active LOW)

// ===================== TIMING =====================
const unsigned long MEASURE_INTERVAL     = 600;    // local reading interval (ms)
const unsigned long SERVER_SEND_INTERVAL = 3000;   // how often to send to server (ms)
const unsigned long STABILITY_TIME_MS    = 1800;   // must be stable this long before lock

// ===================== WEIGHT STATE MACHINE =====================
enum WeightState { IDLE, MEASURING, LOCKED };
WeightState weightState = IDLE;

float currentWeightKg = 0.0;
float lockedWeightKg  = 0.0;
float currentHeightCm = 0.0;

float lastStableWeight = 0.0;
unsigned long stableSince = 0;
unsigned long lastMeasure = 0;
unsigned long lastServerSend = 0;

const float STEP_ON_THRESHOLD_KG   = 3.0;
const float STEP_OFF_THRESHOLD_KG  = 1.5;
const float STABILITY_THRESHOLD_KG  = 1.2;   // tolerate metal-plate noise

// ===================== OBJECTS =====================
HX711 scale;
ESP8266WebServer server(80);
WiFiClientSecure secureClient;

// ===================== SENSOR HELPERS =====================
float readHeightCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duration == 0) return -1.0;

  float distance = duration * 0.0343 / 2.0;
  float height = SENSOR_HEIGHT_CM - distance;
  if (height < 0) height = 0;
  return height;
}

float readWeightKg(int samples = 10) {
  if (!scale.is_ready()) return currentWeightKg;
  return scale.get_units(samples);
}

// ===================== SERVER UPLOAD =====================
bool sendToServer(float weight, float height) {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClient client;
  HTTPClient http;

  String url = String(FLAPMAIN_SERVER) + "/v1/devices/data";

  if (String(FLAPMAIN_SERVER).startsWith("https")) {
    secureClient.setInsecure(); // required for HTTPS
    http.begin(secureClient, url);
  } else {
    http.begin(client, url);
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Id", FLAPMAIN_DEVICE_ID);
  http.addHeader("X-Device-Key", FLAPMAIN_DEVICE_KEY);
  http.setTimeout(8000);

  StaticJsonDocument<256> doc;
  doc["device_id"]   = FLAPMAIN_DEVICE_ID;
  doc["weight_kg"]   = serialized(String(weight, 2));
  doc["height_cm"]   = serialized(String(height, 1));
  doc["device_type"] = "weight_scale_v1";

  String body;
  serializeJson(doc, body);

  Serial.print("POST ");
  Serial.println(url);
  Serial.println(body);

  int code = http.POST(body);
  String response = http.getString();
  http.end();

  Serial.print("HTTP ");
  Serial.print(code);
  Serial.print(" → ");
  Serial.println(response);

  return (code >= 200 && code < 300);
}

// ===================== LOCAL WEB DASHBOARD =====================
void handleRoot() {
  String html = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FlapMain Height & Weight Scale</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;text-align:center;margin:0;padding:20px}
    .card{background:#1e293b;border-radius:16px;padding:24px;max-width:420px;margin:20px auto;box-shadow:0 10px 25px rgba(0,0,0,.4)}
    h1{margin:0 0 8px;font-size:1.5rem}
    .label{color:#94a3b8;font-size:.95rem;margin-top:18px}
    .value{font-size:2.6rem;font-weight:700;margin:6px 0}
    .unit{font-size:1.1rem;color:#94a3b8}
    .footer{margin-top:22px;font-size:.85rem;color:#64748b}
    .state{font-size:.9rem;color:#38bdf8;margin-top:10px}
  </style>
</head>
<body>
  <div class="card">
    <h1>FlapMain Scale</h1>
    <div class="label">Weight</div>
    <div class="value" id="weight">--</div>
    <div class="unit">kg</div>
    <div class="label">Height</div>
    <div class="value" id="height">--</div>
    <div class="unit">cm</div>
    <div class="state" id="state">—</div>
    <div class="footer" id="status">Connecting...</div>
  </div>
  <script>
    async function update(){
      try{
        const r = await fetch('/data');
        const j = await r.json();
        document.getElementById('weight').textContent = j.weight.toFixed(2);
        document.getElementById('height').textContent = j.height.toFixed(1);
        document.getElementById('state').textContent  = j.state;
        document.getElementById('status').textContent = 'Live • ' + new Date().toLocaleTimeString();
      }catch(e){
        document.getElementById('status').textContent = 'Connection error';
      }
    }
    update();
    setInterval(update, 1000);
  </script>
</body>
</html>
)rawliteral";
  server.send(200, "text/html", html);
}

void handleData() {
  String stateStr = "IDLE";
  if (weightState == MEASURING) stateStr = "MEASURING";
  if (weightState == LOCKED)    stateStr = "LOCKED";

  String json = "{";
  json += "\"weight\":" + String(currentWeightKg, 2) + ",";
  json += "\"height\":" + String(currentHeightCm, 1) + ",";
  json += "\"locked\":" + String(lockedWeightKg, 2) + ",";
  json += "\"state\":\"" + stateStr + "\"";
  json += "}";
  server.send(200, "application/json", json);
}

// ===================== SETUP =====================
void setup() {
  Serial.begin(115200);
  delay(800);
  Serial.println("\n\n=== FlapMain Height+Weight Scale (Local System) ===");

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);

  // HX711 Load Cell
  Serial.print("HX711 init");
  scale.begin(HX711_DOUT_PIN, HX711_SCK_PIN);
  unsigned long t0 = millis();
  while (!scale.is_ready() && millis() - t0 < 10000) {
    delay(200);
    Serial.print(".");
  }
  if (scale.is_ready()) {
    Serial.println(" OK");
    scale.set_scale(SCALE_CALIBRATION);
    scale.tare(20);
    Serial.println("Tare complete (platform must be empty)");
  } else {
    Serial.println(" FAILED");
  }

  // WiFi Connection
  Serial.print("WiFi connecting");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) {
    delay(400);
    Serial.print(".");
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
  }

  if (WiFi.status() == WL_CONNECTED) {
    digitalWrite(LED_PIN, LOW);
    Serial.println("\nWiFi OK");
    Serial.print("Local dashboard: http://");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nWiFi FAILED");
  }

  // Web server
  server.on("/", handleRoot);
  server.on("/data", handleData);
  server.on("/trigger", handleTriggerLocal);
  server.begin();
  Serial.println("Local web server started");
}

void handleTriggerLocal() {
  server.send(200, "application/json", "{\"status\":\"success\",\"message\":\"Scale measurement initiated. Device ready for reading.\"}");
  digitalWrite(LED_PIN, LOW); // Blink onboard LED to indicate readiness
  delay(150);
  digitalWrite(LED_PIN, HIGH);
  Serial.println("[HARDWARE] Measurement initiated via trigger API");
}

// ===================== LOOP =====================
void loop() {
  server.handleClient();

  if (millis() - lastMeasure < MEASURE_INTERVAL) return;
  lastMeasure = millis();

  // --- Read sensors ---
  currentWeightKg = readWeightKg(12);
  if (currentWeightKg < 0.4) currentWeightKg = 0.0;

  float h = readHeightCm();
  if (h > 40.0 && h < 230.0) currentHeightCm = h;

  // --- Weight state machine (only send settled values) ---
  switch (weightState) {
    case IDLE:
      if (currentWeightKg >= STEP_ON_THRESHOLD_KG) {
        weightState = MEASURING;
        lastStableWeight = currentWeightKg;
        stableSince = millis();
        Serial.println("→ MEASURING");
      }
      lockedWeightKg = 0.0;
      break;

    case MEASURING:
      if (currentWeightKg < STEP_OFF_THRESHOLD_KG) {
        weightState = IDLE;
        Serial.println("→ IDLE (stepped off early)");
        break;
      }
      if (abs(currentWeightKg - lastStableWeight) <= STABILITY_THRESHOLD_KG) {
        if (millis() - stableSince >= STABILITY_TIME_MS) {
          lockedWeightKg = currentWeightKg;
          weightState = LOCKED;
          Serial.print("→ LOCKED @ ");
          Serial.print(lockedWeightKg, 2);
          Serial.println(" kg");
        }
      } else {
        lastStableWeight = currentWeightKg;
        stableSince = millis();
      }
      break;

    case LOCKED:
      if (currentWeightKg < STEP_OFF_THRESHOLD_KG) {
        weightState = IDLE;
        lockedWeightKg = 0.0;
        Serial.println("→ IDLE (stepped off)");
      }
      break;
  }

  // --- Send to live server only when locked ---
  if (weightState == LOCKED &&
      (millis() - lastServerSend >= SERVER_SEND_INTERVAL)) {

    bool ok = sendToServer(lockedWeightKg, currentHeightCm);
    if (ok) {
      lastServerSend = millis();
    }
  }

  // Debug output
  Serial.print("W:");
  Serial.print(currentWeightKg, 1);
  Serial.print("  H:");
  Serial.print(currentHeightCm, 0);
  Serial.print("  State:");
  Serial.println(weightState == IDLE ? "IDLE" : weightState == MEASURING ? "MEAS" : "LOCK");
}
