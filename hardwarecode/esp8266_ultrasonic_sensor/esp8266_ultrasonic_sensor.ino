/*
 * =====================================================================
 * FlapMain IoT Platform - ESP8266 Ultrasonic Distance & Water Level Sensor
 * =====================================================================
 * Target Hardware: ESP8266 (NodeMCU v2/v3, Wemos D1 Mini)
 * Sensor: HC-SR04 Ultrasonic Sensor
 * 
 * Pinout Connections:
 * - HC-SR04 TRIG Pin -> GPIO 12 (D6)
 * - HC-SR04 ECHO Pin -> GPIO 14 (D5)
 * - HC-SR04 VCC      -> 5V (VIN / VU)
 * - HC-SR04 GND      -> GND
 * =====================================================================
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <ArduinoJson.h>
#include "config.h"

// Ultrasonic Sensor Pins (GPIO 12 & GPIO 14)
#define TRIG_PIN 12 // GPIO12 (D6)
#define ECHO_PIN 14 // GPIO14 (D5)
#define LED_PIN  D4 // Onboard LED

// Tank parameters
const float TANK_TOTAL_DEPTH_CM = 100.0;
const float SENSOR_OFFSET_CM     = 5.0;

unsigned long lastSendTime = 0;

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n==============================================");
  Serial.println("  FlapMain IoT - ESP8266 Ultrasonic Sensor   ");
  Serial.println("==============================================");

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(TRIG_PIN, LOW);
  digitalWrite(LED_PIN, HIGH);

  connectWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

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
    digitalWrite(LED_PIN, LOW);
    delay(250);
    digitalWrite(LED_PIN, HIGH);
    delay(250);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[Wi-Fi] Connected!");
    Serial.print("[Wi-Fi] Local IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[Wi-Fi] Connection Failed! Will retry next loop.");
  }
}

void measureAndIngest() {
  // Trigger ultrasonic pulse on GPIO 12
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  // Read echo duration on GPIO 14
  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duration == 0) {
    Serial.println("[Sensor Warning] Ultrasonic Echo timeout.");
    return;
  }

  float distanceCm = (duration * 0.0343) / 2.0;

  float waterDepthCm = TANK_TOTAL_DEPTH_CM - (distanceCm - SENSOR_OFFSET_CM);
  if (waterDepthCm < 0) waterDepthCm = 0;
  if (waterDepthCm > TANK_TOTAL_DEPTH_CM) waterDepthCm = TANK_TOTAL_DEPTH_CM;
  float waterLevelPercent = (waterDepthCm / TANK_TOTAL_DEPTH_CM) * 100.0;

  Serial.println("\n--- Measurement Data ---");
  Serial.print("  Distance: "); Serial.print(distanceCm); Serial.println(" cm");
  Serial.print("  Water Level: "); Serial.print(waterLevelPercent); Serial.println(" %");

  StaticJsonDocument<128> doc;
  doc["distance_cm"] = round(distanceCm * 10.0) / 10.0;
  doc["water_level_percent"] = round(waterLevelPercent * 10.0) / 10.0;

  String jsonPayload;
  serializeJson(doc, jsonPayload);

  WiFiClient client;
  HTTPClient http;
  String url = String(FLAPMAIN_SERVER) + "/v1/devices/" + String(DEVICE_ID) + "/readings";

  Serial.print("[FlapMain HTTP] Posting to: ");
  Serial.println(url);

  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", DEVICE_KEY);

  digitalWrite(LED_PIN, LOW);
  int httpCode = http.POST(jsonPayload);
  digitalWrite(LED_PIN, HIGH);

  if (httpCode > 0) {
    String response = http.getString();
    Serial.print("[FlapMain HTTP] Code: "); Serial.println(httpCode);
    Serial.print("[FlapMain HTTP] Response: "); Serial.println(response);
  } else {
    Serial.print("[FlapMain HTTP Error] Code: "); Serial.println(httpCode);
  }

  http.end();
}
