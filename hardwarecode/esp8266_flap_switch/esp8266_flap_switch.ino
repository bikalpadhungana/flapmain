/*
 * =====================================================================
 * FlapMain IoT Platform - ESP8266 Flap Switch Hardware
 * =====================================================================
 * Target Hardware: ESP8266 (NodeMCU v2/v3, Wemos D1 Mini)
 * Actuator: Relay / Optocoupled Switch
 * =====================================================================
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <ArduinoJson.h>
#include "config.h"

#define SWITCH_PIN D1 // GPIO5 Relay Control

bool switchState = false;
unsigned long lastSendTime = 0;

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n--- FlapMain Switch Hardware ---");
  pinMode(SWITCH_PIN, OUTPUT);
  digitalWrite(SWITCH_PIN, switchState ? HIGH : LOW);

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
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n[Wi-Fi] Connected!");
}

void measureAndIngest() {
  StaticJsonDocument<128> doc;
  doc["switch_state"] = switchState;

  String jsonPayload;
  serializeJson(doc, jsonPayload);

  WiFiClient client;
  HTTPClient http;
  String url = String(FLAPMAIN_SERVER) + "/v1/devices/" + String(DEVICE_ID) + "/readings";

  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", DEVICE_KEY);

  int httpCode = http.POST(jsonPayload);
  Serial.print("[HTTP Ingest Code]: "); Serial.println(httpCode);
  http.end();
}
