/*
 * =====================================================================
 * FlapMain IoT Platform - ESP8266 Medical Weight & Height Scale
 * =====================================================================
 * Target Hardware: ESP8266 (NodeMCU v2/v3, Wemos D1 Mini)
 * Sensors: HX711 Load Cell Amplifier + Ultrasonic Height Sensor
 * 
 * Pinout Connections:
 * - Ultrasonic TRIG Pin -> GPIO 12 (D6)
 * - Ultrasonic ECHO Pin -> GPIO 14 (D5)
 * - HX711 Load Cell DOUT -> GPIO 4  (D2)
 * - HX711 Load Cell SCK  -> GPIO 5  (D1)
 * =====================================================================
 */

#include <ESP8266Wi
#include <ESP8266HTTPClient.h>
#include <ArduinoJson.h>
#include "config.h"

// Height Sensor Pins (GPIO 12 & GPIO 14)
#define HEIGHT_TRIG_PIN 12 // GPIO12 (D6)
#define HEIGHT_ECHO_PIN 14 // GPIO14 (D5)

// HX711 Load Cell Pins
#define HX711_DOUT_PIN 4  // GPIO4 (D2)
#define HX711_SCK_PIN  5  // GPIO5 (D1)

// Onboard LED status
#define LED_PIN D4

unsigned long lastSendTime = 0;

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n==============================================");
  Serial.println("  FlapMain IoT - Medical Height & Weight Scale  ");
  Serial.println("==============================================");

  pinMode(HEIGHT_TRIG_PIN, OUTPUT);
  pinMode(HEIGHT_ECHO_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(HEIGHT_TRIG_PIN, LOW);
  digitalWrite(LED_PIN, HIGH); // LED Off

  connectWiFi();
}

void loop() {
  // Auto-reconnect if Wi-Fi drops
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  // Measure and send telemetry according to TELEMETRY_INTERVAL_MS
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
    digitalWrite(LED_PIN, LOW); // Flash LED
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
    Serial.println("\n[Wi-Fi] Connection Failed! Will retry next loop cycle.");
  }
}

void measureAndIngest() {
  // 1. Measure height via ultrasonic sensor (GPIO 12 & GPIO 14)
  digitalWrite(HEIGHT_TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(HEIGHT_TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(HEIGHT_TRIG_PIN, LOW);

  long duration = pulseIn(HEIGHT_ECHO_PIN, HIGH, 30000); // 30ms timeout
  float rawDistCm = (duration * 0.0343) / 2.0;

  // Assuming sensor mounted on ceiling frame at 210cm total height
  float heightCm = 210.0 - rawDistCm;
  if (heightCm < 0 || duration == 0) heightCm = 0.0;

  // 2. Measure weight (mock / HX711 scale read)
  float weightKg = 72.5; // Load cell reading

  Serial.println("\n--- Measurement Data ---");
  Serial.print("  Weight: "); Serial.print(weightKg); Serial.println(" kg");
  Serial.print("  Height: "); Serial.print(heightCm); Serial.println(" cm");

  // 3. Serialize JSON payload for FlapMain API
  StaticJsonDocument<128> doc;
  doc["weight_kg"] = round(weightKg * 10.0) / 10.0;
  doc["height_cm"] = round(heightCm * 10.0) / 10.0;

  String jsonPayload;
  serializeJson(doc, jsonPayload);

  // 4. HTTP POST to FlapMain REST API endpoint
  WiFiClient client;
  HTTPClient http;
  String url = String(FLAPMAIN_SERVER) + "/v1/devices/" + String(DEVICE_ID) + "/readings";

  Serial.print("[FlapMain HTTP] Ingesting to: ");
  Serial.println(url);

  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", DEVICE_KEY);

  digitalWrite(LED_PIN, LOW); // LED ON during transmission
  int httpCode = http.POST(jsonPayload);
  digitalWrite(LED_PIN, HIGH);

  if (httpCode > 0) {
    String response = http.getString();
    Serial.print("[FlapMain HTTP] Status Code: ");
    Serial.println(httpCode);
    Serial.print("[FlapMain HTTP] Response: ");
    Serial.println(response);
  } else {
    Serial.print("[FlapMain HTTP Error] Transmission failed, error: ");
    Serial.println(http.errorToString(httpCode));
  }

  http.end();
}
