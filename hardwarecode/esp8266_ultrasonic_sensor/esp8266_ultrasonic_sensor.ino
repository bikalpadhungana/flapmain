/*
 * =====================================================================
 * FlapMain IoT Platform — ESP8266 Ultrasonic Height Sensor
 * =====================================================================
 * Target Hardware : ESP8266 (NodeMCU v2/v3, Wemos D1 Mini)
 * Sensor          : HC-SR04 Ultrasonic Distance Sensor
 * Purpose         : Standalone height measurement (no weight logic)
 *
 * Pinout:
 *   HC-SR04 TRIG  → GPIO 12 (D6)
 *   HC-SR04 ECHO  → GPIO 14 (D5)
 *   HC-SR04 VCC   → 5 V (VIN / VU)
 *   HC-SR04 GND   → GND
 *
 * Data sent to backend:  { "height_cm": 172.3 }
 * =====================================================================
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <ArduinoJson.h>
#include "config.h"

// =====================================================================
// PIN DEFINITIONS
// =====================================================================
#define TRIG_PIN 12   // GPIO12 (D6)
#define ECHO_PIN 14   // GPIO14 (D5)
#define LED_PIN   0   // Onboard LED (active LOW on most NodeMCU boards)

// =====================================================================
// TUNING PARAMETERS — adjust to match your physical installation
// =====================================================================
const float  SENSOR_HEIGHT_CM          = 190.5;  // Distance from sensor face to floor (cm)
const float  MIN_VALID_HEIGHT_CM       = 50.0;   // Ignore anything shorter than this
const float  HEIGHT_TOLERANCE_CM       = 3.0;    // Max reading-to-reading delta for "stable"
const unsigned long STABILIZATION_MS   = 1500;   // Must stay stable for this long
const unsigned long POLL_INTERVAL_MS   = 100;    // Ultrasonic poll rate

// Median filter window
#define MEDIAN_WINDOW 5

// =====================================================================
// STATE MACHINE
// =====================================================================
enum State { IDLE, DETECTING, LOCKED, WAIT_FOR_LEAVE };

static State         state            = IDLE;
static unsigned long stateStartTime   = 0;
static float         maxStableHeight  = 0.0;
static float         prevHeight       = 0.0;
static float         lockedHeight     = 0.0;
static unsigned long lastPollTime     = 0;

// Median filter buffer
static float medianBuf[MEDIAN_WINDOW];
static int   medianIdx   = 0;
static bool  medianReady = false;

// =====================================================================
// SETUP
// =====================================================================
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println(F("\n=============================================="));
  Serial.println(F("  FlapMain — Ultrasonic Height Sensor v2.0    "));
  Serial.println(F("=============================================="));
  Serial.print(F("  Sensor height : ")); Serial.print(SENSOR_HEIGHT_CM); Serial.println(F(" cm"));
  Serial.print(F("  Device ID     : ")); Serial.println(DEVICE_ID);
  Serial.println();

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(LED_PIN,  OUTPUT);
  digitalWrite(TRIG_PIN, LOW);
  digitalWrite(LED_PIN, HIGH);   // LED off (active low)

  connectWiFi();
}

// =====================================================================
// MAIN LOOP
// =====================================================================
void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  if (millis() - lastPollTime >= POLL_INTERVAL_MS) {
    lastPollTime = millis();
    runHeightStateMachine();
  }
}

// =====================================================================
// ULTRASONIC — single raw reading
// =====================================================================
float readDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);  // 30 ms timeout (~5 m)
  if (duration == 0) return -1.0;

  return (duration * 0.0343f) / 2.0f;
}

// =====================================================================
// MEDIAN FILTER — rejects transient spikes
// =====================================================================
float readFilteredDistance() {
  float raw = readDistanceCm();
  if (raw < 0) return -1.0;

  medianBuf[medianIdx] = raw;
  medianIdx = (medianIdx + 1) % MEDIAN_WINDOW;
  if (medianIdx == 0) medianReady = true;

  if (!medianReady) return raw;  // Not enough samples yet

  // Copy & sort for median
  float sorted[MEDIAN_WINDOW];
  for (int i = 0; i < MEDIAN_WINDOW; i++) sorted[i] = medianBuf[i];
  for (int i = 0; i < MEDIAN_WINDOW - 1; i++) {
    for (int j = i + 1; j < MEDIAN_WINDOW; j++) {
      if (sorted[i] > sorted[j]) {
        float t = sorted[i];
        sorted[i] = sorted[j];
        sorted[j] = t;
      }
    }
  }
  return sorted[MEDIAN_WINDOW / 2];
}

// =====================================================================
// HEIGHT STATE MACHINE
// =====================================================================
void runHeightStateMachine() {
  float dist = readFilteredDistance();
  if (dist < 0) return;

  float height = SENSOR_HEIGHT_CM - dist;

  switch (state) {

    case IDLE:
      if (height >= MIN_VALID_HEIGHT_CM) {
        Serial.print(F("[Height] Person detected — "));
        Serial.print(height, 1); Serial.println(F(" cm"));
        state           = DETECTING;
        stateStartTime  = millis();
        maxStableHeight = height;
        prevHeight      = height;
      }
      break;

    case DETECTING:
      if (height < MIN_VALID_HEIGHT_CM) {
        Serial.println(F("[Height] Person left early → IDLE"));
        state = IDLE;
        break;
      }

      if (height > maxStableHeight) maxStableHeight = height;

      if (abs(height - prevHeight) > HEIGHT_TOLERANCE_CM) {
        // Still moving — restart stabilization window
        stateStartTime  = millis();
        maxStableHeight = height;
      }
      prevHeight = height;

      if (millis() - stateStartTime >= STABILIZATION_MS) {
        lockedHeight = maxStableHeight;
        Serial.print(F("[Height] ✓ Locked → "));
        Serial.print(lockedHeight, 1); Serial.println(F(" cm"));
        state = LOCKED;
      }
      break;

    case LOCKED:
      sendHeightReading(lockedHeight);
      state = WAIT_FOR_LEAVE;
      break;

    case WAIT_FOR_LEAVE:
      if (height < MIN_VALID_HEIGHT_CM) {
        Serial.println(F("[Height] Person left → clearing"));
        sendHeightReading(0.0);
        state = IDLE;
      }
      break;
  }
}

// =====================================================================
// NETWORK — send height-only payload to FlapMain backend
// =====================================================================
void sendHeightReading(float heightCm) {
  Serial.println(F("\n——— Sending Height Reading ———"));
  Serial.print(F("  height_cm : ")); Serial.println(heightCm, 1);

  StaticJsonDocument<64> doc;
  doc["height_cm"] = round(heightCm * 10.0) / 10.0;

  String payload;
  serializeJson(doc, payload);

  WiFiClient client;
  HTTPClient http;
  String url = String(FLAPMAIN_SERVER) + "/api/v1/devices/" + String(DEVICE_ID) + "/readings";

  Serial.print(F("[HTTP] POST → ")); Serial.println(url);

  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", DEVICE_KEY);
  http.setTimeout(5000);

  digitalWrite(LED_PIN, LOW);   // LED on during transmission
  int code = http.POST(payload);
  digitalWrite(LED_PIN, HIGH);  // LED off

  if (code > 0) {
    Serial.print(F("[HTTP] Response ")); Serial.print(code);
    Serial.print(F(" — ")); Serial.println(http.getString());
  } else {
    Serial.print(F("[HTTP] Error: ")); Serial.println(http.errorToString(code));
  }

  http.end();
}

// =====================================================================
// Wi-Fi — connect with retry and LED feedback
// =====================================================================
void connectWiFi() {
  Serial.print(F("[WiFi] Connecting to ")); Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    digitalWrite(LED_PIN, LOW);  delay(250);
    digitalWrite(LED_PIN, HIGH); delay(250);
    Serial.print('.');
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print(F("\n[WiFi] Connected — IP: "));
    Serial.println(WiFi.localIP());
  } else {
    Serial.println(F("\n[WiFi] Failed! Will retry next loop."));
  }
}
