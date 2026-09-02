/*
 * =================================================================================
 * UNIFIED FLAPMAIN WEATHER STATION FIRMWARE (ESP8266)
 * Integrates: Multi-Direction Hall Sensors, Interrupt-Driven Anemometer, 
 * DHT22 Temperature/Humidity, BMP085 Pressure/Altitude, LDR Light Sensor,
 * NTP Time Synchronization, Local Cinematic Web Dashboard, and Cloud API Telemetry.
 * =================================================================================
 */

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <DHT.h>
#include <NTPClient.h>
#include <WiFiUdp.h>
#include <Adafruit_BMP085.h>
#include <Wire.h>
#include "config.h"

// --- Pin Allocations (Optimized to prevent I2C & Interrupt conflicts) ---
// I2C Bus (BMP085): SDA = GPIO4 (D2), SCL = GPIO5 (D1)
const int northPin     = 16;  // D0
const int eastPin      = 15;  // D8
const int southPin     = 14;  // D5
const int westPin      = 12;  // D6
const int windSpeedPin = 13;  // D7 (Interrupt capable)

#define DHTPIN         0      // GPIO0 (D3)
#define DHTTYPE        DHT22
#define STATUS_LED     2      // Built-in LED (GPIO2 / D4)
#define LDR_PIN        A0     // Analog Light Sensor

// --- Sensor & Telemetry Variables ---
volatile unsigned long pulseCount = 0;
unsigned long lastTime = 0;
unsigned long lastRead = 0;
const unsigned long readInterval = 60000; // Cloud upload interval (60s)

float currentSpeed = 0.0;
const float CALIBRATION_K = 2.4; // km/h per rotation/second
const int MEASURE_INTERVAL = 2000; // 2 seconds calculation window

float temperature = 0.0;
float humidity = 0.0;
int light = 0;
int pressure = 0;
float altitude = 0.0;

// --- Network & Server Instances ---
ESP8266WebServer server(80);
WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP, "pool.ntp.org", 19800, 60000); // UTC+5:30 offset
DHT dht(DHTPIN, DHTTYPE);
Adafruit_BMP085 bmp;
WiFiClientSecure secureClient;

// --- Interrupt Service Routine for Wind Speed ---
void IRAM_ATTR countPulse() {
  pulseCount++;
}

// --- Wind Direction Logic (Active LOW Hall Sensors) ---
String readDirection() {
  bool n = (digitalRead(northPin) == LOW);
  bool e = (digitalRead(eastPin) == LOW);
  bool s = (digitalRead(southPin) == LOW);
  bool w = (digitalRead(westPin) == LOW);
  
  if (n && e) return "NE";
  if (n && w) return "NW";
  if (s && e) return "SE";
  if (s && w) return "SW";
  if (n) return "North";
  if (e) return "East";
  if (s) return "South";
  if (w) return "West";
  return "None";
}

// --- Cinematic HTML Local Web Dashboard ---
String getHTML() {
  return R"rawliteral(
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FlapMain Weather Station Pro</title>
  <style>
    :root { --accent: #00ffaa; --alert: #ff3366; --bg: #0f1626; }
    body { font-family: 'Segoe UI', sans-serif; text-align:center; background: var(--bg); color:white; padding:20px; margin:0; }
    .container { max-width: 450px; margin: auto; padding: 25px; background: rgba(26, 35, 56, 0.9); border-radius: 35px; box-shadow: 0 20px 60px rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.05); margin-top: 20px; }
    
    .compass { width:220px; height:220px; border:3px solid var(--accent); border-radius:50%; margin:20px auto; position:relative; background: radial-gradient(circle, #1a2338 0%, #0f1626 100%); box-shadow: 0 0 30px rgba(0, 255, 170, 0.15); }
    .needle { position:absolute; width:6px; height:95px; background: linear-gradient(to top, var(--alert), #ff6699); left:calc(50% - 3px); top:15px; transform-origin: center 95px; transition: transform 1.2s cubic-bezier(0.34, 1.56, 0.64, 1); border-radius:10px; z-index: 2; }
    .needle::after { content:""; position:absolute; width:14px; height:14px; background: var(--bg); border: 3px solid var(--alert); border-radius:50%; bottom:-7px; left:-7px; }
    
    .label { position: absolute; font-size: 1.2em; font-weight: bold; color: var(--accent); opacity: 0.8; width: 30px; text-align: center; }
    .n { top: 10px; left: calc(50% - 15px); }
    .s { bottom: 10px; left: calc(50% - 15px); }
    .e { right: 10px; top: calc(50% - 13px); }
    .w { left: 10px; top: calc(50% - 13px); }
    
    .speed-box { font-size: 2.5em; font-weight: 800; margin: 10px 0; color: #fff; }
    .unit { font-size: 0.35em; color: var(--accent); letter-spacing: 1px; }
    .dir-text { font-size: 1.5em; color: var(--alert); text-shadow: 0 0 15px rgba(255, 51, 102, 0.4); font-weight: bold; letter-spacing: 1px; }
    
    .metrics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 20px; text-align: left; font-size: 0.9em; background: rgba(15,22,38,0.5); padding: 15px; border-radius: 15px; }
    .metric-item { padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .metric-label { opacity: 0.6; font-size: 0.8em; display: block; }
    .metric-val { font-weight: bold; color: var(--accent); }
  </style>
</head>
<body>
  <div class="container">
    <div style="font-size: 0.8em; letter-spacing: 3px; opacity: 0.5; margin-bottom: 5px;">LIVE TELEMETRY</div>
    <div style="font-size: 0.7em; opacity: 0.4; margin-bottom: 10px;">ID: FLAPMAIN-AWS-001</div>
    
    <div class="compass">
      <div class="label n">N</div>
      <div class="label s">S</div>
      <div class="label e">E</div>
      <div class="label w">W</div>
      <div id="needle" class="needle" style="transform: rotate(0deg);"></div>
    </div>
    
    <div class="dir-text" id="direction">CONNECTING</div>
    <div class="speed-box">
      <span id="speed">0.0</span><span class="unit"> KM/H</span>
    </div>

    <div class="metrics-grid">
      <div class="metric-item"><span class="metric-label">Temperature</span><span class="metric-val" id="temp">--</span></div>
      <div class="metric-item"><span class="metric-label">Humidity</span><span class="metric-val" id="hum">--</span></div>
      <div class="metric-item"><span class="metric-label">Pressure</span><span class="metric-val" id="press">--</span></div>
      <div class="metric-item"><span class="metric-label">Altitude</span><span class="metric-val" id="alt">--</span></div>
      <div class="metric-item"><span class="metric-label">Ambient Light</span><span class="metric-val" id="light">--</span></div>
      <div class="metric-item"><span class="metric-label">System Time</span><span class="metric-val" id="time">--</span></div>
    </div>
  </div>

  <script>
    const angles = {'North':0,'NE':45,'East':90,'SE':135,'South':180,'SW':225,'West':270,'NW':315,'None':0};
    let currentAngle = 0;
    
    function updateData() {
      fetch('/data').then(r => r.json()).then(data => {
        const targetDir = data.direction;
        const targetAngle = angles[targetDir] || 0;
        
        document.getElementById('direction').innerText = targetDir == "None" ? "CALM" : targetDir.toUpperCase();
        document.getElementById('speed').innerText = parseFloat(data.speed).toFixed(1);
        document.getElementById('temp').innerText = data.temperature + " °C";
        document.getElementById('hum').innerText = data.humidity + " %";
        document.getElementById('press').innerText = data.pressure + " Pa";
        document.getElementById('alt').innerText = data.altitude + " m";
        document.getElementById('light').innerText = data.light;
        document.getElementById('time').innerText = data.time;
        
        let diff = targetAngle - (currentAngle % 360);
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        currentAngle += diff;
        document.getElementById('needle').style.transform = `rotate(${currentAngle}deg)`;
      }).catch(()=>{}); 
    }
    setInterval(updateData, 1000);
  </script>
</body>
</html>
)rawliteral";
}

// Forward Declaration
void sendCloudData();

// --- Setup Routine ---
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== FlapMain Weather Station Initializing ===");

  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, LOW);

  // Pin Configuration with Internal Pullups
  pinMode(northPin, INPUT_PULLUP);
  pinMode(eastPin, INPUT_PULLUP);
  pinMode(southPin, INPUT_PULLUP);
  pinMode(westPin, INPUT_PULLUP);
  pinMode(windSpeedPin, INPUT_PULLUP);

  // Anemometer Interrupt Setup
  attachInterrupt(digitalPinToInterrupt(windSpeedPin), countPulse, FALLING);

  // Initialize Sensors
  dht.begin();
  delay(2000); // Stabilization delay for DHT22

  Wire.begin(); // SDA = GPIO4 (D2), SCL = GPIO5 (D1)
  if (!bmp.begin()) {
    Serial.println("Warning: BMP085 Pressure Sensor initialization failed!");
  }

  // WiFi Connection Sequence (Station Mode with 15s SoftAP Fallback)
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi network: ");
  Serial.print(WIFI_SSID);
  
  unsigned long wifiStart = millis();
  bool isConnected = false;
  while (millis() - wifiStart < 15000) {
    if (WiFi.status() == WL_CONNECTED) {
      isConnected = true;
      break;
    }
    delay(400);
    Serial.print(".");
    digitalWrite(STATUS_LED, !digitalRead(STATUS_LED));
  }

  if (isConnected) {
    digitalWrite(STATUS_LED, LOW); // Active LOW LED ON
    Serial.println("\nWiFi Connected Successfully!");
    Serial.print("Local IP Address: http://");
    Serial.println(WiFi.localIP());
    
    // Start NTP Client
    timeClient.begin();
    timeClient.update();
  } else {
    Serial.println("\nWiFi Connection Timeout. Switching to Hotspot AP Mode...");
    WiFi.mode(WIFI_AP_STA);
    WiFi.softAP(AP_SSID, AP_PASSWORD);

    Serial.println("=========================================");
    Serial.print("  Hotspot AP SSID    : ");
    Serial.println(AP_SSID);
    Serial.print("  Hotspot Password   : ");
    Serial.println(AP_PASSWORD);
    Serial.print("  Hotspot Dashboard  : http://");
    Serial.println(WiFi.softAPIP());
    Serial.println("=========================================");
  }

  // Web Server Route Bindings
  server.on("/", []() {
    server.send(200, "text/html", getHTML());
  });

  server.on("/data", []() {
    bool connected = (WiFi.status() == WL_CONNECTED);
    String json = "{";
    json += "\"speed\":" + String(currentSpeed, 1) + ",";
    json += "\"direction\":\"" + readDirection() + "\",";
    json += "\"temperature\":" + String(temperature, 2) + ",";
    json += "\"humidity\":" + String(humidity, 2) + ",";
    json += "\"pressure\":" + String(pressure) + ",";
    json += "\"altitude\":" + String(altitude, 2) + ",";
    json += "\"light\":" + String(light) + ",";
    json += "\"time\":\"" + timeClient.getFormattedTime() + "\",";
    json += "\"wifi_mode\":\"" + String(connected ? "STATION" : "HOTSPOT_AP") + "\",";
    json += "\"ap_bssid\":\"" + WiFi.BSSIDstr() + "\",";
    json += "\"rssi\":" + String(WiFi.RSSI());
    json += "}";
    server.send(200, "application/json", json);
  });

  server.begin();
  Serial.println("Local Web Server Online.");
  lastTime = millis();
  lastRead = millis();
}

// --- Main Program Execution Loop ---
void loop() {
  server.handleClient();

  unsigned long currentMillis = millis();

  // 1. Wind Speed Calculation Interval (Every 2 Seconds)
  if (currentMillis - lastTime >= MEASURE_INTERVAL) {
    noInterrupts();
    unsigned long count = pulseCount;
    pulseCount = 0;
    interrupts();

    float elapsedSeconds = (float)(currentMillis - lastTime) / 1000.0;
    if (count > 0 && elapsedSeconds > 0) {
      currentSpeed = ((float)count / elapsedSeconds) * CALIBRATION_K;
    } else {
      currentSpeed = 0.0;
    }
    lastTime = currentMillis;
  }

  // 2. Comprehensive Environmental Sensor Polling & Cloud Transmission (Every 60 Seconds)
  if (currentMillis - lastRead >= readInterval) {
    lastRead = currentMillis;
    digitalWrite(STATUS_LED, HIGH);

    if (WiFi.status() == WL_CONNECTED) {
      timeClient.update();
    }

    // Allow stabilization time for DHT22
    delay(2000);
    humidity = dht.readHumidity();
    temperature = dht.readTemperature();
    light = analogRead(LDR_PIN);
    
    if (bmp.begin()) {
      pressure = bmp.readPressure();
      altitude = bmp.readAltitude();
    }

    if (isnan(temperature) || isnan(humidity)) {
      Serial.println("Error: DHT22 sensor read failed (NaN detected).");
      digitalWrite(STATUS_LED, LOW);
      return;
    }

    // Serial Debug Printout
    Serial.println("----------------------------------------");
    Serial.println("Telemetry Update:");
    Serial.printf("Wind Dir: %s | Speed: %.1f km/h\n", readDirection().c_str(), currentSpeed);
    Serial.printf("Temp: %.2f °C | Humidity: %.2f %%\n", temperature, humidity);
    Serial.printf("Pressure: %d Pa | Altitude: %.2f m\n", pressure, altitude);
    Serial.printf("Light Intensity: %d | Time: %s\n", light, timeClient.getFormattedTime().c_str());
    Serial.println("----------------------------------------");

    // Transmit Data to Server API if Connected
    if (WiFi.status() == WL_CONNECTED) {
      sendCloudData();
    }

    digitalWrite(STATUS_LED, LOW);
  }
}

// --- Cloud HTTP POST Telemetry Sync ---
void sendCloudData() {
  WiFiClient client;
  HTTPClient http;

  String url = String(FLAPMAIN_SERVER) + "/v1/devices/data";

  if (String(FLAPMAIN_SERVER).startsWith("https")) {
    secureClient.setInsecure(); // SSL verification bypass for cloud endpoints
    http.begin(secureClient, url);
  } else {
    http.begin(client, url);
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Id", FLAPMAIN_DEVICE_ID);
  http.addHeader("X-Device-Key", FLAPMAIN_DEVICE_KEY);
  http.setTimeout(8000);

  String postData = "{";
  postData += "\"device_id\":\"" + String(FLAPMAIN_DEVICE_ID) + "\",";
  postData += "\"device_type\":\"weather_station_v1\",";
  postData += "\"wind_speed\":" + String(currentSpeed, 1) + ",";
  postData += "\"wind_direction\":\"" + readDirection() + "\",";
  postData += "\"temperature\":" + String(temperature, 2) + ",";
  postData += "\"humidity\":" + String(humidity, 2) + ",";
  postData += "\"light\":" + String(light) + ",";
  postData += "\"pressure\":" + String(pressure) + ",";
  postData += "\"altitude\":" + String(altitude, 2) + ",";
  postData += "\"time\":\"" + timeClient.getFormattedTime() + "\",";
  postData += "\"ap_bssid\":\"" + WiFi.BSSIDstr() + "\",";
  postData += "\"rssi\":" + String(WiFi.RSSI());
  postData += "}";

  Serial.print("POST ");
  Serial.println(url);
  Serial.println(postData);

  int httpResponseCode = http.POST(postData);

  if (httpResponseCode > 0) {
    Serial.printf("Cloud Sync Success | HTTP Response Code: %d\n", httpResponseCode);
  } else {
    Serial.printf("Cloud Sync Failed | Error Code: %s\n", http.errorToString(httpResponseCode).c_str());
  }

  http.end();
}
