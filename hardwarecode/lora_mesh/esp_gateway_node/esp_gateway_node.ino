/*
 * =================================================================================
 * UNIFIED FLAPMAIN LORA MESH GATEWAY FIRMWARE (ESP8266 / ESP32 + SX1278)
 * Receives LoRa mesh packets (AWS Weather Telemetry & SOS Alerts), deduplicates using
 * ring buffer cache, syncs NTP time, serves local cinematic HTML dashboard, and
 * forwards JSON telemetry directly to FlapMain Cloud API endpoints.
 * =================================================================================
 */

#if defined(ESP8266)
  #include <ESP8266WiFi.h>
  #include <ESP8266WebServer.h>
  #include <ESP8266HTTPClient.h>
  #define LORA_SS_PIN   15 // D8 (GPIO15)
  #define LORA_RST_PIN  0  // D3 (GPIO0)
  #define LORA_DIO0_PIN 4  // D2 (GPIO4)
  #define STATUS_LED    2  // D4 (GPIO2 Built-in LED)
  typedef ESP8266WebServer WebServerType;
#elif defined(ESP32)
  #include <WiFi.h>
  #include <WebServer.h>
  #include <HTTPClient.h>
  #define LORA_SS_PIN   5
  #define LORA_RST_PIN  14
  #define LORA_DIO0_PIN 2
  #define STATUS_LED    2
  typedef WebServer WebServerType;
#else
  #error "Unsupported hardware platform! Use ESP8266 or ESP32."
#endif

#include <SPI.h>
#include <LoRa.h>
#include <WiFiClientSecure.h>
#include <NTPClient.h>
#include <WiFiUdp.h>
#include "lora_mesh_protocol.h"

// Include local configuration (or fallback defaults if config.h not present)
#if __has_include("config.h")
  #include "config.h"
#else
  #define WIFI_SSID       "Your_WiFi_SSID"
  #define WIFI_PASSWORD   "Your_WiFi_Password"
  #define AP_SSID         "FlapMain-LoRaGateway-AP"
  #define AP_PASSWORD     "12345678"
  #define FLAPMAIN_SERVER "http://192.168.1.67:5051"
  #define FLAPMAIN_DEVICE_ID "flap-flap-aws-001-7zhj"
  #define FLAPMAIN_DEVICE_KEY "flap_dev_aab35d32a090cf3116ec2fdd83bc063e46ee39faeeffc8ca"
#endif

// ---- Global Network & State Instances ----
WebServerType server(80);
WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP, "pool.ntp.org", 19800, 60000); // UTC+5:30 offset
WiFiClientSecure secureClient;
MeshDedup dedupCache;

// Latest received mesh telemetry state
LoRaMeshPacket latestPkt;
bool hasTelemetry = false;
int lastRssi = 0;
float lastSnr = 0.0;
unsigned long lastPacketReceivedTime = 0;
uint32_t gatewayReceivedCount = 0;

// ---- Forward Declarations ----
String sanitizeJsonString(const char* input);
void forwardToCloudApi(const LoRaMeshPacket &pkt, int rssi, float snr);
void forwardMessageToCloudApi(const LoRaMeshPacket &pkt, int rssi, float snr);
void handleUplinkPacket(const LoRaMeshPacket &pkt, int rssi, float snr);
void pollOutboxAndRelay();
void acknowledgeOutboxDelivered(const String &outboxId);
String extractJsonString(const String &body, const String &key);
int extractJsonInt(const String &body, const String &key);

// ---- Cinematic HTML Local Web Dashboard ----
String getHTML() {
  return R"rawliteral(
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FlapMain LoRa Mesh Gateway Pro</title>
  <style>
    :root { --accent: #00ffaa; --alert: #ff3366; --bg: #0f1626; --card: #1a2338; }
    body { font-family: 'Segoe UI', sans-serif; text-align:center; background: var(--bg); color:white; padding:20px; margin:0; }
    .container { max-width: 480px; margin: auto; padding: 25px; background: rgba(26, 35, 56, 0.95); border-radius: 35px; box-shadow: 0 20px 60px rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.05); }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 0.75em; font-weight: bold; background: rgba(0, 255, 170, 0.15); color: var(--accent); border: 1px solid var(--accent); margin-bottom: 15px; }
    .sos-badge { background: rgba(255, 51, 102, 0.2); color: var(--alert); border-color: var(--alert); animation: pulse 1.5s infinite; }
    @keyframes pulse { 0% { opacity: 0.6; } 50% { opacity: 1; } 100% { opacity: 0.6; } }

    .compass { width:200px; height:200px; border:3px solid var(--accent); border-radius:50%; margin:20px auto; position:relative; background: radial-gradient(circle, #1a2338 0%, #0f1626 100%); box-shadow: 0 0 30px rgba(0, 255, 170, 0.15); }
    .needle { position:absolute; width:6px; height:85px; background: linear-gradient(to top, var(--alert), #ff6699); left:calc(50% - 3px); top:15px; transform-origin: center 85px; transition: transform 1.2s cubic-bezier(0.34, 1.56, 0.64, 1); border-radius:10px; z-index: 2; }
    .label { position: absolute; font-size: 1.1em; font-weight: bold; color: var(--accent); opacity: 0.8; width: 30px; text-align: center; }
    .n { top: 8px; left: calc(50% - 15px); } .s { bottom: 8px; left: calc(50% - 15px); }
    .e { right: 8px; top: calc(50% - 12px); } .w { left: 8px; top: calc(50% - 12px); }

    .speed-box { font-size: 2.3em; font-weight: 800; margin: 10px 0; color: #fff; }
    .unit { font-size: 0.4em; color: var(--accent); letter-spacing: 1px; }
    .dir-text { font-size: 1.4em; color: var(--alert); text-shadow: 0 0 15px rgba(255, 51, 102, 0.4); font-weight: bold; }

    .metrics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 20px; text-align: left; font-size: 0.85em; background: rgba(15,22,38,0.6); padding: 15px; border-radius: 18px; }
    .metric-item { padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .metric-label { opacity: 0.6; font-size: 0.8em; display: block; }
    .metric-val { font-weight: bold; color: var(--accent); }
  </style>
</head>
<body>
  <div class="container">
    <div style="font-size: 0.8em; letter-spacing: 3px; opacity: 0.5;">LORA MESH GATEWAY</div>
    <div style="font-size: 0.7em; opacity: 0.4; margin-bottom: 10px;">ID: FLAPMAIN-LORA-GW-001</div>
    <div id="statusBadge" class="badge">WAITING FOR PACKETS</div>

    <div class="compass">
      <div class="label n">N</div><div class="label s">S</div><div class="label e">E</div><div class="label w">W</div>
      <div id="needle" class="needle" style="transform: rotate(0deg);"></div>
    </div>

    <div class="dir-text" id="direction">--</div>
    <div class="speed-box"><span id="speed">0.0</span><span class="unit"> KM/H</span></div>

    <div class="metrics-grid">
      <div class="metric-item"><span class="metric-label">Temperature</span><span class="metric-val" id="temp">--</span></div>
      <div class="metric-item"><span class="metric-label">Humidity</span><span class="metric-val" id="hum">--</span></div>
      <div class="metric-item"><span class="metric-label">Barometric Pressure</span><span class="metric-val" id="press">--</span></div>
      <div class="metric-item"><span class="metric-label">Light ADC</span><span class="metric-val" id="light">--</span></div>
      <div class="metric-item"><span class="metric-label">MQ3 Gas ADC</span><span class="metric-val" id="mq3Gas">--</span></div>
      <div class="metric-item"><span class="metric-label">Mesh Origin Node</span><span class="metric-val" id="originNode">--</span></div>
      <div class="metric-item"><span class="metric-label">AWS Battery Voltage</span><span class="metric-val" id="battery">--</span></div>
      <div class="metric-item"><span class="metric-label">LoRa RSSI / SNR</span><span class="metric-val" id="rfStats">--</span></div>
      <div class="metric-item"><span class="metric-label">Gateway Received</span><span class="metric-val" id="rxCount">0 Packets</span></div>
    </div>
  </div>

  <script>
    const angles = {'North':0,'NE':45,'East':90,'SE':135,'South':180,'SW':225,'West':270,'NW':315,'None':0};
    let currentAngle = 0;

    function updateData() {
      fetch('/data').then(r => r.json()).then(data => {
        if (!data.has_data) return;

        const targetDir = data.direction;
        const targetAngle = angles[targetDir] || 0;

        document.getElementById('statusBadge').className = data.alert_level > 0 ? "badge sos-badge" : "badge";
        document.getElementById('statusBadge').innerText = data.alert_level > 0 ? "!!! SOS ALERT ACTIVE !!!" : "LORA MESH ONLINE";
        document.getElementById('direction').innerText = targetDir == "None" ? "CALM" : targetDir.toUpperCase();
        document.getElementById('speed').innerText = parseFloat(data.wind_speed).toFixed(1);
        document.getElementById('temp').innerText = data.temperature + " °C";
        document.getElementById('hum').innerText = data.humidity + " %";
        document.getElementById('press').innerText = data.pressure + " Pa";
        document.getElementById('light').innerText = data.light;
        document.getElementById('mq3Gas').innerText = data.mq3_gas;
        document.getElementById('originNode').innerText = "Node #" + data.origin_node + " (Hops left: " + data.hops_left + ")";
        document.getElementById('battery').innerText = data.battery_mv + " mV";
        document.getElementById('rfStats').innerText = data.rssi + " dBm / " + data.snr + " dB";
        document.getElementById('rxCount').innerText = data.total_packets + " Packets";

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

// NOTE: We use pure polling (LoRa.parsePacket in loop()) for reliable reception.
// No ISR callback registered — avoids ISR/heap conflicts on ESP8266.

// ---- Process Received LoRa Packet ----
void processMeshPacket(const LoRaMeshPacket &pkt, int rssi, float snr) {
  uint16_t msgId = ((uint16_t)pkt.msgIdHi << 8) | pkt.msgIdLo;

  // Deduplication check: ignore already seen packets
  if (!dedupCache.alreadySeen(pkt.originNode, msgId)) {
    dedupCache.markSeen(pkt.originNode, msgId);

    latestPkt = pkt;
    hasTelemetry = true;
    lastRssi = rssi;
    lastSnr = snr;
    lastPacketReceivedTime = millis();
    gatewayReceivedCount++;

    Serial.println("\n==================================================");
    Serial.println("📥 [GATEWAY RECEIVED LORA MESH DATA]");
    Serial.printf(" - Packet Msg ID   : #%u\n", msgId);
    Serial.printf(" - Origin Node ID  : #%u\n", pkt.originNode);
    Serial.printf(" - Target Node ID  : #%u (%s)\n", pkt.targetNode, pkt.targetNode == 0 ? "BROADCAST" : "DIRECT");
    Serial.printf(" - Packet Type     : %s (%d)\n", pkt.packetType == PKT_TYPE_SOS ? "EMERGENCY SOS" : (pkt.packetType == PKT_TYPE_TEXT ? "WALKIE TEXT" : "WEATHER TELEMETRY"), pkt.packetType);
    Serial.printf(" - Expected Size   : %d bytes | Struct Size: %d bytes\n", 56, (int)sizeof(LoRaMeshPacket));
    Serial.printf(" - TTL (Hops Left) : %d\n", pkt.ttl);
    if (pkt.text_msg[0] != '\0') {
      Serial.printf(" - Text Message    : \"%s\"\n", pkt.text_msg);
    }
    Serial.printf(" - Temperature     : %.1f °C\n", pkt.temp_x10 / 10.0);
    Serial.printf(" - Humidity        : %.1f %%\n", pkt.hum_x10 / 10.0);
    float altitude = (pkt.pressure_pa > 0) ? (44330.0 * (1.0 - pow((float)pkt.pressure_pa / 101325.0, 0.1903))) : 0.0;
    Serial.printf(" - Pressure        : %u Pa\n", pkt.pressure_pa);
    Serial.printf(" - Altitude        : %.1f m\n", altitude);
    Serial.printf(" - Wind Speed      : %.1f km/h\n", pkt.wind_speed_x10 / 10.0);
    Serial.printf(" - Wind Direction  : %s (Code: %d)\n", getWindDirString(pkt.wind_dir_code), pkt.wind_dir_code);
    Serial.printf(" - Light ADC       : %u\n", pkt.light_val);
    Serial.printf(" - MQ-9 Gas ADC    : %u\n", pkt.mq3_gas);
    Serial.printf(" - AWS Battery     : %u mV\n", pkt.battery_mv);
    Serial.printf(" - Alert Level     : %u\n", pkt.alert_level);
    Serial.printf(" - Signal RSSI     : %d dBm\n", lastRssi);
    Serial.printf(" - Signal SNR      : %.1f dB\n", lastSnr);
    Serial.printf(" - Total Gateway RX: %u Packets\n", gatewayReceivedCount);
    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf(" - Live Dashboard  : http://%s/\n", WiFi.localIP().toString().c_str());
    } else {
      Serial.printf(" - Hotspot Dashboard: http://%s/\n", WiFi.softAPIP().toString().c_str());
    }
    Serial.println("==================================================");

    // Flash Status LED on receive
    digitalWrite(STATUS_LED, LOW);
    delay(50);
    digitalWrite(STATUS_LED, HIGH);

    // Forward Telemetry & Text/SOS Messages to FlapMain Cloud API Endpoint if connected
    if (WiFi.status() == WL_CONNECTED) {
      handleUplinkPacket(pkt, lastRssi, lastSnr);
    }
  } else {
    Serial.printf("ℹ️ [GW MESH DEDUP] Packet Msg ID #%u from Node #%u (TTL=%d, RSSI=%d dBm) was already accepted — mesh relay duplicate dropped.\n", msgId, pkt.originNode, pkt.ttl, rssi);
  }

  // Ensure radio returns to continuous receive mode
  LoRa.receive();
}

// ---- Setup Routine ----
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== FlapMain ESP LoRa Mesh Gateway Initializing ===");

  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, HIGH); // OFF (Active LOW)

  // Initialize SX1278 LoRa SPI Module
  LoRa.setPins(LORA_SS_PIN, LORA_RST_PIN, LORA_DIO0_PIN);
  LoRa.setSPIFrequency(4000000); // 4MHz SPI Clock for stable jumper/breadboard connections
  if (!LoRa.begin(LORA_FREQUENCY)) {
    Serial.println("ERROR: SX1278 LoRa initialization failed! Check SPI wiring.");
    while (true);
  }

  LoRa.setSpreadingFactor(LORA_SPREADING_FACTOR);
  LoRa.setSignalBandwidth(LORA_BANDWIDTH);
  LoRa.setCodingRate4(LORA_CODING_RATE);
  LoRa.setTxPower(LORA_TX_POWER);
  LoRa.setSyncWord(LORA_SYNC_WORD);
  LoRa.enableCrc();

  LoRa.receive();
  Serial.print("[LoRa Gateway] SX1278 Online — SF10/125kHz/CRC/SyncWord=0x12 | struct=");
  Serial.print((int)sizeof(LoRaMeshPacket));
  Serial.println(" bytes");

  // Wi-Fi Connection Sequence (15s SoftAP Fallback)
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi: ");
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
    Serial.println("\nWi-Fi Connected Successfully!");
    Serial.print("Local Gateway IP: http://");
    Serial.println(WiFi.localIP());

    timeClient.begin();
    timeClient.update();
  } else {
    Serial.println("\nWi-Fi Timeout. Switching to Hotspot AP Mode...");
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

  // Bind Web Server Routes
  server.on("/", []() {
    server.send(200, "text/html", getHTML());
  });

  server.on("/data", []() {
    String json = "{";
    json += "\"has_data\":" + String(hasTelemetry ? "true" : "false") + ",";
    if (hasTelemetry) {
      uint16_t msgId = ((uint16_t)latestPkt.msgIdHi << 8) | latestPkt.msgIdLo;
      json += "\"msg_id\":" + String(msgId) + ",";
      json += "\"origin_node\":" + String(latestPkt.originNode) + ",";
      json += "\"target_node\":" + String(latestPkt.targetNode) + ",";
      json += "\"hops_left\":" + String(latestPkt.ttl) + ",";
      json += "\"packet_type\":" + String(latestPkt.packetType) + ",";
      json += "\"wind_speed\":" + String(latestPkt.wind_speed_x10 / 10.0, 1) + ",";
      json += "\"direction\":\"" + String(getWindDirString(latestPkt.wind_dir_code)) + "\",";
      json += "\"temperature\":" + String(latestPkt.temp_x10 / 10.0, 1) + ",";
      json += "\"humidity\":" + String(latestPkt.hum_x10 / 10.0, 1) + ",";
      float altitude = (latestPkt.pressure_pa > 0) ? (44330.0 * (1.0 - pow((float)latestPkt.pressure_pa / 101325.0, 0.1903))) : 0.0;
      json += "\"pressure\":" + String(latestPkt.pressure_pa) + ",";
      json += "\"altitude\":" + String(altitude, 1) + ",";
      json += "\"light\":" + String(latestPkt.light_val) + ",";
      json += "\"mq9_gas\":" + String(latestPkt.mq3_gas) + ",";
      json += "\"mq3_gas\":" + String(latestPkt.mq3_gas) + ",";
      json += "\"text_msg\":\"" + sanitizeJsonString(latestPkt.text_msg) + "\",";
      json += "\"battery_mv\":" + String(latestPkt.battery_mv) + ",";
      json += "\"alert_level\":" + String(latestPkt.alert_level) + ",";
      json += "\"rssi\":" + String(lastRssi) + ",";
      json += "\"snr\":" + String(lastSnr, 1) + ",";
      json += "\"total_packets\":" + String(gatewayReceivedCount) + ",";
      json += "\"time\":\"" + timeClient.getFormattedTime() + "\"";
    } else {
      json += "\"total_packets\":0";
    }
    json += "}";
    server.send(200, "application/json", json);
  });

  server.begin();
  Serial.println("Local Web Server Online. Gateway ready to receive LoRa mesh packets.");
  LoRa.receive();
}

// ---- Main Loop ----
void loop() {
  // ── PRIORITY 1: Check for incoming LoRa packets FIRST (time-critical) ──
  int packetSize = LoRa.parsePacket();
  if (packetSize > 0) {
    int rssi = LoRa.packetRssi();
    float snr = LoRa.packetSnr();

    Serial.printf("\n[GW RX] Raw packet received: %d bytes | RSSI=%d dBm | SNR=%.1f dB\n",
                  packetSize, rssi, snr);
    Serial.printf("[GW RX] Struct size = %d bytes | Accept window: 50..%d\n",
                  (int)sizeof(LoRaMeshPacket), (int)sizeof(LoRaMeshPacket) + 10);

    if (packetSize >= 50 && packetSize <= (int)sizeof(LoRaMeshPacket) + 10) {
      LoRaMeshPacket pkt;
      memset(&pkt, 0, sizeof(pkt));
      size_t toRead = ((size_t)packetSize < sizeof(pkt)) ? (size_t)packetSize : sizeof(pkt);
      LoRa.readBytes((uint8_t*)&pkt, toRead);
      processMeshPacket(pkt, rssi, snr);
    } else {
      // Drain noise or unexpected packet
      String rawStr = "";
      while (LoRa.available()) rawStr += (char)LoRa.read();
      Serial.printf("[GW RX] UNEXPECTED SIZE %d — dumped: \"%s\"\n", packetSize, rawStr.c_str());
    }
    // Always re-arm SX1278 into continuous RX after any packet
    LoRa.receive();
  }

  // ── PRIORITY 2: Handle Web Server (non-time-critical) ──
  server.handleClient();

  // ── Periodic NTP sync ──
  static unsigned long lastNtpUpdate = 0;
  if (WiFi.status() == WL_CONNECTED && millis() - lastNtpUpdate > 60000) {
    lastNtpUpdate = millis();
    timeClient.update();
  }

  // ── Poll Cloud Outbox every 5s for downlink messages to relay over LoRa ──
  static unsigned long lastOutboxPoll = 0;
  if (WiFi.status() == WL_CONNECTED && millis() - lastOutboxPoll > 5000) {
    lastOutboxPoll = millis();
    pollOutboxAndRelay();
  }

  delay(10); // Short yield — keeps parsePacket() polling fast
}

// ---- Forward Packet Telemetry to FlapMain Cloud API ----
void forwardToCloudApi(const LoRaMeshPacket &pkt, int rssi, float snr) {
  WiFiClient client;
  HTTPClient http;

  String url = String(FLAPMAIN_SERVER) + "/v1/devices/data";

  if (String(FLAPMAIN_SERVER).startsWith("https")) {
    secureClient.setInsecure();
    http.begin(secureClient, url);
  } else {
    http.begin(client, url);
  }

  // Derive per-node Device ID so multiple AWS stations have distinct database records:
  // Node 1: Keep legacy FLAPMAIN_DEVICE_ID ("flap-flap-aws-001-7zhj") for backward compatibility
  // Node 2, 3, etc.: Format as "flap-flap-aws-00X-node" (auto-provisioned by backend)
  String nodeDeviceId;
  if (pkt.originNode <= 1) {
    nodeDeviceId = String(FLAPMAIN_DEVICE_ID);
  } else {
    char idBuf[36];
    snprintf(idBuf, sizeof(idBuf), "flap-flap-aws-%03d-node", pkt.originNode);
    nodeDeviceId = String(idBuf);
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Id", nodeDeviceId);
  http.addHeader("X-Device-Key", FLAPMAIN_DEVICE_KEY);
  http.setTimeout(1500);

  String devType = (pkt.packetType == PKT_TYPE_TEXT || pkt.packetType == PKT_TYPE_SOS) ? "walkie_talkie_v1" : "weather_station_v1";

  float altitude = (pkt.pressure_pa > 0) ? (44330.0 * (1.0 - pow((float)pkt.pressure_pa / 101325.0, 0.1903))) : 0.0;

  String postData = "{";
  postData += "\"device_id\":\"" + nodeDeviceId + "\",";
  postData += "\"device_type\":\"" + devType + "\",";
  postData += "\"wind_speed\":" + String(pkt.wind_speed_x10 / 10.0, 1) + ",";
  postData += "\"wind_direction\":\"" + String(getWindDirString(pkt.wind_dir_code)) + "\",";
  postData += "\"temperature\":" + String(pkt.temp_x10 / 10.0, 2) + ",";
  postData += "\"humidity\":" + String(pkt.hum_x10 / 10.0, 2) + ",";
  postData += "\"light\":" + String(pkt.light_val) + ",";
  postData += "\"mq9_gas\":" + String(pkt.mq3_gas) + ",";
  postData += "\"mq3_gas\":" + String(pkt.mq3_gas) + ",";
  postData += "\"text_msg\":\"" + sanitizeJsonString(pkt.text_msg) + "\",";
  postData += "\"pressure\":" + String(pkt.pressure_pa) + ",";
  postData += "\"altitude\":" + String(altitude, 2) + ",";
  postData += "\"battery_mv\":" + String(pkt.battery_mv) + ",";
  postData += "\"time\":\"" + timeClient.getFormattedTime() + "\",";
  postData += "\"mesh_origin_node\":" + String(pkt.originNode) + ",";
  postData += "\"target_node\":" + String(pkt.targetNode) + ",";
  postData += "\"mesh_hops_left\":" + String(pkt.ttl) + ",";
  postData += "\"alert_level\":" + String(pkt.alert_level) + ",";
  postData += "\"rssi\":" + String(rssi) + ",";
  postData += "\"snr\":" + String(snr, 1);
  postData += "}";

  Serial.printf("[Cloud Forward] Station Node #%d (%s) -> POST %s\n", pkt.originNode, nodeDeviceId.c_str(), url.c_str());

  int httpCode = http.POST(postData);

  if (httpCode > 0) {
    Serial.printf("[Cloud Forward] Success | HTTP %d\n", httpCode);
  } else {
    Serial.printf("[Cloud Forward] Failed | Error: %s\n", http.errorToString(httpCode).c_str());
  }

  http.end();
}

// ---- GATEWAY MESSAGE BRIDGE — TWO-WAY LORA MESH & FLAPMAIN APP ----
void handleUplinkPacket(const LoRaMeshPacket &pkt, int rssi, float snr) {
  if (pkt.packetType == PKT_TYPE_TEXT || pkt.packetType == PKT_TYPE_SOS) {
    forwardMessageToCloudApi(pkt, rssi, snr);
  }
  forwardToCloudApi(pkt, rssi, snr); // Also record into standard telemetry stream
}

void forwardMessageToCloudApi(const LoRaMeshPacket &pkt, int rssi, float snr) {
  WiFiClient client;
  HTTPClient http;
  String url = String(FLAPMAIN_SERVER) + "/v1/devices/messages";

  if (String(FLAPMAIN_SERVER).startsWith("https")) {
    secureClient.setInsecure();
    http.begin(secureClient, url);
  } else {
    http.begin(client, url);
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Id", FLAPMAIN_DEVICE_ID);
  http.addHeader("X-Device-Key", FLAPMAIN_DEVICE_KEY);
  http.setTimeout(1500);

  String safeText = sanitizeJsonString(pkt.text_msg);

  String postData = "{";
  postData += "\"gateway_id\":\"" + String(FLAPMAIN_DEVICE_ID) + "\",";
  postData += "\"origin_node\":" + String(pkt.originNode) + ",";
  postData += "\"target_node\":" + String(pkt.targetNode) + ",";
  postData += "\"message_type\":\"" + String(pkt.packetType == PKT_TYPE_SOS ? "sos" : "text") + "\",";
  postData += "\"text\":\"" + safeText + "\",";
  postData += "\"alert_level\":" + String(pkt.alert_level) + ",";
  postData += "\"battery_mv\":" + String(pkt.battery_mv) + ",";
  postData += "\"hops_left\":" + String(pkt.ttl) + ",";
  postData += "\"rssi\":" + String(rssi) + ",";
  postData += "\"snr\":" + String(snr, 1) + ",";
  postData += "\"time\":\"" + timeClient.getFormattedTime() + "\"";
  postData += "}";

  Serial.print("[Msg Uplink] POST "); Serial.println(url);
  int httpCode = http.POST(postData);

  if (httpCode > 0) {
    Serial.printf("[Msg Uplink] Success | HTTP %d\n", httpCode);
  } else {
    Serial.printf("[Msg Uplink] Failed | %s\n", http.errorToString(httpCode).c_str());
  }
  http.end();
}

// ---- JSON String Sanitizer Helper ----
String sanitizeJsonString(const char* input) {
  String s = "";
  if (!input) return s;
  for (size_t i = 0; i < strlen(input); i++) {
    char c = input[i];
    if (c == '"') {
      s += "\\\"";
    } else if (c == '\\') {
      s += "\\\\";
    } else if (c == '\n') {
      s += "\\n";
    } else if (c == '\r') {
      s += "\\r";
    } else if (c == '\t') {
      s += "\\t";
    } else if ((unsigned char)c >= 32 && (unsigned char)c <= 126) {
      s += c;
    }
  }
  return s;
}

String extractJsonString(const String &body, const String &key) {
  String pattern = "\"" + key + "\":\"";
  int start = body.indexOf(pattern);
  if (start == -1) return "";
  start += pattern.length();
  int end = body.indexOf("\"", start);
  if (end == -1) return "";
  return body.substring(start, end);
}

int extractJsonInt(const String &body, const String &key) {
  String pattern = "\"" + key + "\":";
  int start = body.indexOf(pattern);
  if (start == -1) return 0;
  start += pattern.length();
  int end = start;
  while (end < (int)body.length() && (isDigit(body[end]) || body[end] == '-')) end++;
  return body.substring(start, end).toInt();
}

void acknowledgeOutboxDelivered(const String &outboxId) {
  if (outboxId.length() == 0) return;

  WiFiClient client;
  HTTPClient http;
  String url = String(FLAPMAIN_SERVER) + "/v1/devices/outbox/" + outboxId + "/ack";

  if (String(FLAPMAIN_SERVER).startsWith("https")) {
    secureClient.setInsecure();
    http.begin(secureClient, url);
  } else {
    http.begin(client, url);
  }
  http.addHeader("X-Device-Key", FLAPMAIN_DEVICE_KEY);
  http.POST("");
  http.end();
}

void pollOutboxAndRelay() {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClient client;
  HTTPClient http;
  String url = String(FLAPMAIN_SERVER) + "/v1/devices/" + String(FLAPMAIN_DEVICE_ID) + "/outbox";

  if (String(FLAPMAIN_SERVER).startsWith("https")) {
    secureClient.setInsecure();
    http.begin(secureClient, url);
  } else {
    http.begin(client, url);
  }
  http.addHeader("X-Device-Key", FLAPMAIN_DEVICE_KEY);
  http.setTimeout(1500);

  int httpCode = http.GET();
  if (httpCode != 200) {
    http.end();
    return;
  }

  String body = http.getString();
  http.end();

  if (body.indexOf("\"has_message\":true") == -1) return;

  String outboxId = extractJsonString(body, "outbox_id");
  String text     = extractJsonString(body, "text");
  int alertLevel  = extractJsonInt(body, "alert_level");
  int targetNode  = extractJsonInt(body, "target_node");

  if (text.length() == 0) return;

  LoRaMeshPacket pkt;
  memset(&pkt, 0, sizeof(pkt));
  static uint16_t downlinkMsgCounter = 0;
  uint16_t msgId = downlinkMsgCounter++;

  pkt.msgIdHi    = msgId >> 8;
  pkt.msgIdLo    = msgId & 0xFF;
  pkt.originNode = 0; // 0 reserved to mean "from the cloud/gateway base station"
  pkt.targetNode = (uint8_t)targetNode;
  pkt.ttl        = DEFAULT_MAX_TTL;
  pkt.packetType = (alertLevel > 0) ? PKT_TYPE_SOS : PKT_TYPE_TEXT;
  pkt.alert_level = alertLevel;
  strncpy(pkt.text_msg, text.c_str(), sizeof(pkt.text_msg) - 1);

  digitalWrite(STATUS_LED, LOW);
  LoRa.beginPacket();
  LoRa.write((uint8_t*)&pkt, sizeof(pkt));
  LoRa.endPacket();
  digitalWrite(STATUS_LED, HIGH);

  LoRa.receive(); // return to continuous listening

  Serial.print("[Msg Downlink] Relayed to LoRa Mesh: \"");
  Serial.print(text);
  Serial.println("\"");

  acknowledgeOutboxDelivered(outboxId);
}
