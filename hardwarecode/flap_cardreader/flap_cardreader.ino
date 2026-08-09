/*
 * FlapMain IoT — NFC Card Reader Terminal
 * Single Standalone File for ESP8266 / NodeMCU + RC522 + OLED SH1106
 * Local System Server: http://192.168.1.69:5051
 */

#include <SPI.h>
#include <MFRC522.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <U8g2lib.h>

// ===================== CONFIGURATION =====================
#define FLAPMAIN_SERVER     "https://main.flap.com.np"
#define FLAPMAIN_DEVICE_ID  "flap-card-w0f5"
#define FLAPMAIN_DEVICE_KEY "flap_dev_dd27a6d26219108b50b8c5704fc94ef641da51089b13289a"

const char* WIFI_SSID       = "flap_2.4";
const char* WIFI_PASS       = "CLB43A84C2";

const char* DEVICE_ID       = FLAPMAIN_DEVICE_ID;
const char* API_KEY         = FLAPMAIN_DEVICE_KEY;
const char* BUSINESS_ID     = "default_org";

// API Endpoints
const char* TAP_URL         = FLAPMAIN_SERVER "/api/device/tap";
const char* PING_URL        = FLAPMAIN_SERVER "/api/device/ping";
const char* REGISTER_URL    = FLAPMAIN_SERVER "/api/tags/lookup";

// ===================== HARDWARE PINS =====================
// OLED: SH1106 128x64 (I2C)
U8G2_SH1106_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, U8X8_PIN_NONE);

// RC522 pins (NodeMCU)
#define RST_PIN  0    // D3
#define SS_PIN   15   // D8
MFRC522 mfrc522(SS_PIN, RST_PIN);

// ===================== COOLDOWN & DEBOUNCE =====================
const unsigned long COOLDOWN_MS = 3000;
unsigned long lastSendTime = 0;
String lastUid = "";

// ===================== DISPLAY HELPERS =====================
int cx(const char* t)    { return max(0, (128 - (int)u8g2.getStrWidth(t)) / 2); }
int cx(const String& t)  { return cx(t.c_str()); }

// Wrap a long string across two lines (max 21 chars per line at 6x10 font)
void drawWrapped(const String& s, int y1, int y2) {
  if (s.length() <= 21) {
    u8g2.drawStr(cx(s), y1, s.c_str());
  } else {
    String a = s.substring(0, 21);
    String b = s.substring(21, 42);
    u8g2.drawStr(cx(a), y1, a.c_str());
    u8g2.drawStr(cx(b), y2, b.c_str());
  }
}

// Ready / idle screen
void showReadyScreen() {
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_7x13B_tf);
  const char* title = "FLAP Reader";
  u8g2.drawStr(cx(title), 14, title);

  u8g2.setFont(u8g2_font_6x10_tf);
  u8g2.drawHLine(0, 18, 128);
  u8g2.drawStr(cx("Tap your card"), 34, "Tap your card");

  // WiFi indicator bottom-left
  String ip = WiFi.localIP().toString();
  u8g2.drawStr(0, 62, ip.c_str());
  u8g2.sendBuffer();
}

// Scanning animation
void drawScanning(int frame) {
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x10_tf);
  u8g2.drawStr(cx("Reading card..."), 14, "Reading card...");

  // Bouncing bar animation
  int pos = abs((frame * 6) % 112 - 56);
  u8g2.drawBox(pos, 32, 16, 8);

  u8g2.sendBuffer();
}

// Sending animation
void drawSending(int frame) {
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x10_tf);
  u8g2.drawStr(cx("Sending to server"), 14, "Sending to server");

  const char spin[] = {'|', '/', '-', '\\'};
  char s[2] = {spin[frame % 4], '\0'};
  u8g2.setFont(u8g2_font_9x15B_tf);
  u8g2.drawStr(cx(s), 44, s);
  u8g2.sendBuffer();
}

// Result screen
void showResult(const String& status,
                const String& line1,
                const String& line2,
                const String& line3) {

  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x10_tf);

  if (status == "ok" || status == "success") {
    u8g2.setFont(u8g2_font_7x13B_tf);
    const char* hdr = "v Welcome!";
    u8g2.drawStr(cx(hdr), 14, hdr);
    u8g2.setFont(u8g2_font_6x10_tf);
  } else if (status == "unknown") {
    u8g2.setFont(u8g2_font_7x13B_tf);
    const char* hdr = "? Unknown";
    u8g2.drawStr(cx(hdr), 14, hdr);
    u8g2.setFont(u8g2_font_6x10_tf);
  } else if (status == "lost") {
    u8g2.setFont(u8g2_font_7x13B_tf);
    const char* hdr = "! CARD LOST";
    u8g2.drawStr(cx(hdr), 14, hdr);
    u8g2.setFont(u8g2_font_6x10_tf);
  } else if (status == "defect") {
    u8g2.setFont(u8g2_font_7x13B_tf);
    const char* hdr = "!! DEFECT !!";
    u8g2.drawStr(cx(hdr), 14, hdr);
    u8g2.setFont(u8g2_font_6x10_tf);
  } else {
    u8g2.setFont(u8g2_font_7x13B_tf);
    const char* hdr = "Error";
    u8g2.drawStr(cx(hdr), 14, hdr);
    u8g2.setFont(u8g2_font_6x10_tf);
  }

  u8g2.drawHLine(0, 18, 128);

  // Three info lines from server response
  if (line1.length()) u8g2.drawStr(cx(line1), 30, line1.substring(0, 21).c_str());
  if (line2.length()) u8g2.drawStr(cx(line2), 44, line2.substring(0, 21).c_str());
  if (line3.length()) u8g2.drawStr(cx(line3), 58, line3.substring(0, 21).c_str());

  u8g2.sendBuffer();
}

// Centred message display helper
void showMsg(const char* msg, int ms = 1500) {
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x10_tf);
  u8g2.drawStr(cx(msg), 34, msg);
  u8g2.sendBuffer();
  delay(ms);
}

// ===================== HTTP POST HELPER =====================
// Supports HTTP & HTTPS dynamically
String httpPost(const char* url, const String& payload) {
  HTTPClient http;
  WiFiClientSecure secureClient;
  WiFiClient plainClient;

  bool isHttps = String(url).startsWith("https");
  if (isHttps) {
    secureClient.setInsecure();
    if (!http.begin(secureClient, url)) {
      Serial.println("[HTTP] begin() failed: " + String(url));
      return "";
    }
  } else {
    if (!http.begin(plainClient, url)) {
      Serial.println("[HTTP] begin() failed: " + String(url));
      return "";
    }
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", API_KEY);
  http.setTimeout(8000);

  int code = http.POST(payload);
  String body = "";

  if (code > 0) {
    body = http.getString();
    Serial.printf("[HTTP] %d -> %s\n", code, body.c_str());
  } else {
    Serial.println("[HTTP] error: " + http.errorToString(code));
  }

  http.end();
  return body;
}

// Register device with server on boot
void registerDevice() {
  StaticJsonDocument<256> doc;
  doc["device_id"]   = DEVICE_ID;
  doc["api_key"]     = API_KEY;
  doc["business_id"] = BUSINESS_ID;
  doc["device_name"] = "Flap NFC Reader";
  doc["device_type"] = "nfc_reader";
  doc["firmware_ver"]= "2.3.0";

  String payload;
  serializeJson(doc, payload);

  String resp = httpPost(REGISTER_URL, payload);
  if (resp.length() == 0) {
    showMsg("Reg failed!", 2000);
    return;
  }

  DynamicJsonDocument r(1024);
  if (!deserializeJson(r, resp)) {
    String bName = r["businessName"] | "unknown";
    String msg   = "Linked: " + bName;
    showMsg(msg.c_str(), 2000);
  }
}

// Ping server
bool pingServer() {
  HTTPClient http;
  WiFiClientSecure secureClient;
  WiFiClient plainClient;

  bool isHttps = String(PING_URL).startsWith("https");
  if (isHttps) {
    secureClient.setInsecure();
    if (!http.begin(secureClient, PING_URL)) return false;
  } else {
    if (!http.begin(plainClient, PING_URL)) return false;
  }

  http.setTimeout(5000);
  int code = http.GET();
  http.end();
  return (code >= 200 && code < 300);
}

// ===================== SETUP =====================
void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println("\n[BOOT] Flap NFC Reader starting (Local System)");

  // OLED Init
  u8g2.begin();
  u8g2.setFont(u8g2_font_6x10_tf);
  showMsg("Booting...", 400);

  // WiFi Connection
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("[WiFi] connecting");

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;

    u8g2.clearBuffer();
    u8g2.setFont(u8g2_font_6x10_tf);
    u8g2.drawStr(cx("Connecting WiFi"), 20, "Connecting WiFi");
    String dots(attempts % 4 + 1, '.');
    u8g2.drawStr(cx(dots), 38, dots.c_str());
    u8g2.sendBuffer();
  }

  if (WiFi.status() != WL_CONNECTED) {
    showMsg("WiFi FAILED!", 3000);
  } else {
    Serial.println("\n[WiFi] IP: " + WiFi.localIP().toString());
    showMsg("WiFi OK!", 1000);

    if (!pingServer()) {
      showMsg("Server unreachable", 2500);
      Serial.println("[WARN] Server ping failed — check URL/port");
    } else {
      showMsg("Server OK!", 1000);
      registerDevice();
    }
  }

  // RC522 RFID Init
  SPI.begin();
  mfrc522.PCD_Init();
  delay(100);

  byte ver = mfrc522.PCD_ReadRegister(mfrc522.VersionReg);
  Serial.printf("[RC522] version reg: 0x%02X\n", ver);
  if (ver == 0x92 || ver == 0x91) {
    showMsg("RC522 OK", 800);
  } else if (ver == 0x00 || ver == 0xFF) {
    showMsg("RC522 NOT FOUND!", 3000);
    Serial.println("[ERROR] RC522 not responding — check wiring");
  } else {
    showMsg("RC522 unusual ver", 1500);
  }

  showReadyScreen();
}

// ===================== LOOP =====================
void loop() {
  // Reconnect WiFi if dropped
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
    delay(500);
    return;
  }

  // Wait for a new card tap
  if (!mfrc522.PICC_IsNewCardPresent() || !mfrc522.PICC_ReadCardSerial()) {
    delay(80);
    return;
  }

  // Build UID string "04A1B2C3"
  String uid = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    if (mfrc522.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(mfrc522.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();

  // Debounce: ignore same card within cooldown window
  unsigned long now = millis();
  if (uid == lastUid && (now - lastSendTime) < COOLDOWN_MS) {
    mfrc522.PICC_HaltA();
    mfrc522.PCD_StopCrypto1();
    delay(100);
    return;
  }
  lastUid = uid;
  lastSendTime = now;

  Serial.println("[TAP] UID: " + uid);

  // Scanning animation
  for (int i = 0; i < 10; i++) {
    drawScanning(i);
    delay(60);
  }

  // Build POST payload
  StaticJsonDocument<320> doc;
  doc["flapid"]      = "";
  doc["uid"]         = uid;
  doc["tag_uid"]     = uid; // Add this for flapcard compatibility
  doc["type"]        = "card";
  doc["device_id"]   = DEVICE_ID;
  doc["api_key"]     = API_KEY;

  String payload;
  serializeJson(doc, payload);
  Serial.println("[POST] " + String(TAP_URL));
  Serial.println("[PAYLOAD] " + payload);

  // Sending animation
  for (int i = 0; i < 8; i++) {
    drawSending(i);
    delay(100);
  }

  // HTTP POST to Local FlapMain Server
  String body = httpPost(TAP_URL, payload);

  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();

  // Parse response
  String status = "error";
  String line1  = "";
  String line2  = "";
  String line3  = "";

  if (body.length() == 0) {
    status = "error";
    line1  = "No server response";
    line2  = uid.substring(0, 21);
    line3  = "Check server/WiFi";
  } else {
    // Use a filter to ONLY parse the fields we need.
    // The server includes a large base64 photo in the user object which
    // overflows the ESP8266's limited RAM if we parse the whole response.
    StaticJsonDocument<128> filter;
    filter["status"] = true;
    filter["message"] = true;
    filter["display"]["line1"] = true;
    filter["display"]["line2"] = true;
    filter["display"]["line3"] = true;

    DynamicJsonDocument resp(512);
    DeserializationError err = deserializeJson(resp, body, DeserializationOption::Filter(filter));

    if (err) {
      status = "error";
      line1  = "Bad JSON response";
      line2  = uid.substring(0, 21);
      line3  = String(err.c_str());
    } else {
      status = resp["status"] | "error";

      if (resp.containsKey("display")) {
        line1 = resp["display"]["line1"] | "";
        line2 = resp["display"]["line2"] | "";
        line3 = resp["display"]["line3"] | "";
      } else {
        line1 = resp["message"] | "Done";
        line2 = uid.substring(0, 21);
        line3 = "";
      }
    }
  }

  // Show result on OLED screen
  int displayMs = (status == "defect" || status == "lost") ? 6000 : 3500;
  showResult(status, line1, line2, line3);
  delay(displayMs);

  showReadyScreen();
}
