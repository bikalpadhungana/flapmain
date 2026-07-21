/*
 * =====================================================================
 * FlapMain IoT Platform - ESP8266 Ultrasonic Distance Sensor
 * =====================================================================
 * Target Hardware: ESP8266 (NodeMCU v2/v3, Wemos D1 Mini)
 * Sensor: HC-SR04 Ultrasonic Distance Sensor
 * 
 * Pinout Connections:
 * - HC-SR04 VCC  -> ESP8266 5V / VIN
 * - HC-SR04 GND  -> ESP8266 GND
 * - HC-SR04 TRIG -> ESP8266 D5 (GPIO 14)
 * - HC-SR04 ECHO -> ESP8266 D6 (GPIO 12)
 * 
 * Setup Instructions:
 * 1. Create a "config.h" file in this directory (copied from config.h.example).
 * 2. Fill in Wi-Fi SSID, Password, and your FlapMain Server URL.
 * 3. Paste the generated DEVICE_ID and DEVICE_KEY from FlapMain Dashboard.
 * 4. Select "NodeMCU 1.0 (ESP-12E Module)" in Arduino IDE and Upload.
 * =====================================================================
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <ArduinoJson.h> // ArduinoJson v6
#include "config.h"

// --- Pin Definitions ---
#define TRIG_PIN D5 // GPIO14
#define ECHO_PIN D6 // GPIO12
#define LED_PIN  D4 // Onboard LED indicator (Active LOW)

// --- Tank Dimensions for Water Level Calculation ---
const float TANK_TOTAL_DEPTH_CM = 100.0; // Total height of tank in cm
const float SENSOR_OFFSET_CM     = 5.0;   // Distance from sensor to max fill line

unsigned long lastSendTime = 0;

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n==========================================");
  Serial.println("  FlapMain IoT - ESP8266 Ultrasonic Sensor ");
  Serial.println("==========================================");

  // Configure hardware pins
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(TRIG_PIN, LOW);
  digitalWrite(LED_PIN, HIGH); // Off

  // Connect to Wi-Fi
  connectWiFi();
}

void loop() {
  // Ensure Wi-Fi connection remains active
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  // Trigger telemetry send according to configured interval
  if (millis() - lastSendTime >= TELEMETRY_INTERVAL_MS) {
    lastSendTime = millis();
    measureAndIngest();
  }
}

void connectWiFi() {
  Serial.print("[Wi-Fi] Connecting to SSID: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    digitalWrite(LED_PIN, LOW);  // Flash LED
    delay(250);
    digitalWrite(LED_PIN, HIGH);
    delay(250);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[Wi-Fi] Connected successfully!");
    Serial.print("[Wi-Fi] IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[Wi-Fi] Connection Failed! Will retry next cycle.");
  }
}

void measureAndIngest() {
  // 1. Measure distance via HC-SR04 ultrasonic pulse
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  // Read echo duration (microseconds)
  long duration = pulseIn(ECHO_PIN, HIGH, 30000); // 30ms timeout (~5m range)

  if (duration == 0) {
    Serial.println("[Sensor Warning] Ultrasonic Echo timeout or disconnected.");
    return;
  }

  // Calculate distance in centimeters (speed of sound = 0.0343 cm/us)
  float distanceCm = (duration * 0.0343) / 2.0;

  // Calculate estimated water fill level percentage
  float waterDepthCm = TANK_TOTAL_DEPTH_CM - (distanceCm - SENSOR_OFFSET_CM);
  if (waterDepthCm < 0) waterDepthCm = 0;
  if (waterDepthCm > TANK_TOTAL_DEPTH_CM) waterDepthCm = TANK_TOTAL_DEPTH_CM;
  float waterLevelPercent = (waterDepthCm / TANK_TOTAL_DEPTH_CM) * 100.0;

  Serial.println("\n--- Sensor Measurement ---");
  Serial.print("  Distance: "); Serial.print(distanceCm); Serial.println(" cm");
  Serial.print("  Water Level: "); Serial.print(waterLevelPercent); Serial.println(" %");

  // 2. Prepare JSON payload using ArduinoJson
  StaticJsonDocument<128> doc;
  doc["distance_cm"] = round(distanceCm * 10.0) / 10.0;
  doc["water_level_percent"] = round(waterLevelPercent * 10.0) / 10.0;

  String jsonPayload;
  serializeJson(doc, jsonPayload);

  // 3. Send HTTP POST request to FlapMain API endpoint
  WiFiClient client;
  HTTPClient http;

  String url = String(FLAPMAIN_SERVER) + "/v1/devices/" + String(DEVICE_ID) + "/readings";
  
  Serial.print("[FlapMain HTTP] Posting to: ");
  Serial.println(url);

  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", DEVICE_KEY);

  digitalWrite(LED_PIN, LOW); // Turn LED on during transmit
  int httpResponseCode = http.POST(jsonPayload);
  digitalWrite(LED_PIN, HIGH);

  if (httpResponseCode > 0) {
    String response = http.getString();
    Serial.print("[FlapMain HTTP] Response Code: ");
    Serial.println(httpResponseCode);
    Serial.print("[FlapMain HTTP] Response Body: ");
    Serial.println(response);
  } else {
    Serial.print("[FlapMain HTTP Error] Transmission failed, code: ");
    Serial.println(httpResponseCode);
    Serial.print("  Error String: ");
    Serial.println(http.errorToString(httpResponseCode));
  }

  http.end();
}
