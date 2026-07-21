/*
 * =====================================================================
 * FlapMain IoT Platform - ESP8266 Water Tank Temperature & Actuator
 * =====================================================================
 * Target Hardware: ESP8266 (NodeMCU v2/v3, Wemos D1 Mini)
 * Sensor: DS18B20 OneWire Temperature Sensor
 * Actuator: 5V Relay Module (Control water pump/heater)
 * 
 * Pinout Connections:
 * - DS18B20 DATA -> ESP8266 D4 (GPIO 2) [with 4.7k pull-up resistor]
 * - RELAY IN     -> ESP8266 D1 (GPIO 5)
 * =====================================================================
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <ArduinoJson.h>
#include "config.h"

#define ONE_WIRE_BUS D4 // GPIO2
#define RELAY_PIN    D1 // GPIO5

OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature sensors(&oneWire);

bool currentActuatorState = false;
unsigned long lastSendTime = 0;

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n--- FlapMain Water Tank Temperature & Actuator ---");

  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW); // Relay off

  sensors.begin();
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
  sensors.requestTemperatures();
  float tempC = sensors.getTempCByIndex(0);

  if (tempC == DEVICE_DISCONNECTED_C) {
    Serial.println("[Sensor Warning] DS18B20 disconnected!");
    return;
  }

  Serial.print("Temperature: "); Serial.print(tempC); Serial.println(" °C");

  StaticJsonDocument<128> doc;
  doc["temperature_c"] = round(tempC * 10.0) / 10.0;
  doc["actuator_state"] = currentActuatorState;

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
