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
#define FLAPMAIN_SERVER     "http://main.esainnovation.com:5003"
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
  } else if (status == "denied") {
    u8g2.setFont(u8g2_font_7x13B_tf);
    const char* hdr = "x Not verified";
    u8g2.drawStr(cx(hdr), 14, hdr);
    u8g2.setFont(u8g2_font_6x10_tf);
  } else if (status == "defect" || status == "defective") {
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
// Supports HTTP & HTTPS dynamically with status code checking and error sanitization
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

    // Sanitize HTML or non-2xx responses to clean JSON so display shows readable HTTP errors
    if (body.startsWith("<") || body.startsWith("<!")) {
      body = "{\"status\":\"error\",\"display\":{\"line1\":\"HTML Response\",\"line2\":\"Server Error HTML\",\"line3\":\"Check API URL\"}}";
    } else if (code == 401) {
      body = "{\"status\":\"error\",\"display\":{\"line1\":\"HTTP 401 Error\",\"line2\":\"Invalid API Key\",\"line3\":\"Check config.h\"}}";
    } else if (code == 403) {
      body = "{\"status\":\"error\",\"display\":{\"line1\":\"HTTP 403 Error\",\"line2\":\"Device Pending\",\"line3\":\"Activate on Panel\"}}";
    } else if (code == 404) {
      body = "{\"status\":\"error\",\"display\":{\"line1\":\"HTTP 404 Error\",\"line2\":\"Endpoint 404\",\"line3\":\"Check TAP_URL\"}}";
    } else if (code >= 500) {
      body = "{\"status\":\"error\",\"display\":{\"line1\":\"HTTP " + String(code) + " Error\",\"line2\":\"Server Error\",\"line3\":\"Try again later\"}}";
    }
  } else {
    Serial.println("[HTTP] error: " + http.errorToString(code));
  }

  http.end();
  return body;
}

// Register device with server on boot
void registerDevice() {
#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument doc;
#else
  StaticJsonDocument<256> doc;
#endif
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

#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument r;
#else
  DynamicJsonDocument r(1024);
#endif
  if (!deserializeJson(r, resp)) {
    String bName = r["businessName"] | r["message"] | "unknown";
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

// ===================== CARD USER PRINT =====================
// Prints the cardholder info that the server looked up on flap.esainnovation.com
// (returned as the "user" object in the /api/device/tap response).
void printCardUser(const String& uid, JsonVariantConst user) {
  Serial.println(F("=============== CARD TAPPED ==============="));
  Serial.printf("%-14s: %s\n", "uid", uid.c_str());
  JsonObjectConst obj = user.as<JsonObjectConst>();
  if (obj.isNull() || obj.size() == 0) {
    Serial.println(F("No user info returned (unregistered card or flap.esainnovation.com unreachable)"));
  } else {
    for (JsonPairConst kv : obj) {
      Serial.printf("%-14s: ", kv.key().c_str());
      if (kv.value().is<const char*>()) Serial.println(kv.value().as<const char*>());
      else { serializeJson(kv.value(), Serial); Serial.println(); }
    }
  }
  Serial.println(F("==========================================="));
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

// ===================== PHONE AS FLAP CARD =====================
// Phones (Flap app → Settings → Phone as Flap card) have a new random UID on every tap, so
// the UID can't identify them. Instead this reader selects the private Flap app on the phone
// (AID F0464C415001), sends a random 16-byte challenge, and forwards the phone's signed
// answer { pid, challenge, ctr, mac } as "phone_auth". The Flap server checks the signature
// and that the counter only goes up, so a copied or recorded tap can't be used again.

enum PhoneResult { PHONE_OK, PHONE_NOT_FLAP, PHONE_COMM_ERROR };

struct PhoneTap {
  String pid;
  String challenge; // 32 hex chars
  uint32_t ctr;
  String mac;       // 32 hex chars
};

static byte isoBlockNum = 0; // ISO 14443-4 block number, toggles 0/1

String toHex(const byte* b, byte n) {
  static const char* H = "0123456789abcdef";
  String s; s.reserve(n * 2);
  for (byte i = 0; i < n; i++) { s += H[b[i] >> 4]; s += H[b[i] & 0x0F]; }
  return s;
}

// Hardware timeout for one frame: cards answer in ~5 ms, phones can take 100 ms or more
void setRcTimeout(uint16_t ticks) { // 1 tick = 25 us (prescaler set by PCD_Init)
  mfrc522.PCD_WriteRegister(MFRC522::TReloadRegH, ticks >> 8);
  mfrc522.PCD_WriteRegister(MFRC522::TReloadRegL, ticks & 0xFF);
}

// One raw frame: append CRC_A, send, wait up to waitMs, check and strip the reply's CRC.
// (MFRC522::PCD_TransceiveData gives up after 36 ms, too soon for some phones.)
MFRC522::StatusCode rcFrame(const byte* data, byte len, byte* back, byte* backLen, uint16_t waitMs) {
  byte tx[64];
  if (len + 2 > sizeof(tx)) return MFRC522::STATUS_NO_ROOM;
  memcpy(tx, data, len);
  if (mfrc522.PCD_CalculateCRC(tx, len, tx + len) != MFRC522::STATUS_OK) return MFRC522::STATUS_CRC_WRONG;

  mfrc522.PCD_WriteRegister(MFRC522::CommandReg, MFRC522::PCD_Idle);
  mfrc522.PCD_WriteRegister(MFRC522::ComIrqReg, 0x7F);      // clear interrupt flags
  mfrc522.PCD_WriteRegister(MFRC522::FIFOLevelReg, 0x80);   // flush FIFO
  mfrc522.PCD_WriteRegister(MFRC522::FIFODataReg, len + 2, tx);
  mfrc522.PCD_WriteRegister(MFRC522::BitFramingReg, 0x00);
  mfrc522.PCD_WriteRegister(MFRC522::CommandReg, MFRC522::PCD_Transceive);
  mfrc522.PCD_SetRegisterBitMask(MFRC522::BitFramingReg, 0x80); // StartSend

  const uint32_t start = millis();
  bool received = false;
  while (millis() - start < waitMs) {
    byte irq = mfrc522.PCD_ReadRegister(MFRC522::ComIrqReg);
    if (irq & 0x30) { received = true; break; } // RxIRq | IdleIRq
    if (irq & 0x01) return MFRC522::STATUS_TIMEOUT; // TimerIRq
    yield();
  }
  if (!received) return MFRC522::STATUS_TIMEOUT;

  byte err = mfrc522.PCD_ReadRegister(MFRC522::ErrorReg);
  if (err & 0x13) return MFRC522::STATUS_ERROR; // BufferOvfl | ParityErr | ProtocolErr
  byte n = mfrc522.PCD_ReadRegister(MFRC522::FIFOLevelReg);
  if (n < 3 || n > *backLen) return MFRC522::STATUS_NO_ROOM;
  mfrc522.PCD_ReadRegister(MFRC522::FIFODataReg, n, back, 0);
  byte crc[2];
  if (mfrc522.PCD_CalculateCRC(back, n - 2, crc) != MFRC522::STATUS_OK) return MFRC522::STATUS_CRC_WRONG;
  if (back[n - 2] != crc[0] || back[n - 1] != crc[1]) return MFRC522::STATUS_CRC_WRONG;
  *backLen = n - 2;
  return MFRC522::STATUS_OK;
}

// Send one APDU in an ISO 14443-4 I-block; answers the phone's "wait" (S(WTX)) requests.
// Returns the response APDU (data + SW1 SW2) without the protocol byte.
bool isoApdu(const byte* apdu, byte len, byte* resp, byte* respLen) {
  byte frame[60];
  if (len + 1 > sizeof(frame)) return false;
  frame[0] = 0x02 | isoBlockNum;
  memcpy(frame + 1, apdu, len);
  byte back[64]; byte backLen = sizeof(back);
  if (rcFrame(frame, len + 1, back, &backLen, 300) != MFRC522::STATUS_OK) return false;

  for (byte waits = 0; waits < 20; waits++) {
    byte pcb = back[0];
    if ((pcb & 0xF7) == 0xF2 && backLen >= 2) { // S(WTX): phone needs more time, say yes
      byte wtx[2] = { 0xF2, (byte)(back[1] & 0x3F) };
      backLen = sizeof(back);
      if (rcFrame(wtx, 2, back, &backLen, 1000) != MFRC522::STATUS_OK) return false;
      continue;
    }
    if ((pcb & 0xE2) == 0x02 && !(pcb & 0x10)) { // I-block, not chained
      isoBlockNum ^= 1;
      if (backLen - 1 > *respLen) return false;
      *respLen = backLen - 1;
      memcpy(resp, back + 1, *respLen);
      return true;
    }
    return false; // R-block / chaining: not used by Flap phones
  }
  return false;
}

// Ask a tapped ISO-DEP device (phone) to prove it is a Flap phone card.
PhoneResult readFlapPhone(PhoneTap& out) {
  setRcTimeout(0xFFFF); // ~1.6 s hardware limit while talking to a phone; rcFrame's waitMs is the real limit
  isoBlockNum = 0;
  PhoneResult result = PHONE_COMM_ERROR;

  // RATS: FSD 64 bytes, CID 0. Reply is the ATS.
  byte rats[2] = { 0xE0, 0x50 };
  byte ats[64]; byte atsLen = sizeof(ats);
  if (rcFrame(rats, 2, ats, &atsLen, 300) == MFRC522::STATUS_OK) {
    static const byte selectFlap[] = { 0x00, 0xA4, 0x04, 0x00, 0x06, 0xF0, 0x46, 0x4C, 0x41, 0x50, 0x01, 0x00 };
    byte r[40]; byte rLen = sizeof(r);
    if (isoApdu(selectFlap, sizeof(selectFlap), r, &rLen)) {
      if (rLen >= 2 + 8 && r[rLen - 2] == 0x90 && r[rLen - 1] == 0x00 && r[0] == 0x01) {
        out.pid = "";
        for (byte i = 1; i < rLen - 2; i++) out.pid += (char)r[i];

        byte apdu[5 + 16 + 1] = { 0x80, 0x10, 0x00, 0x00, 0x10 };
        for (byte i = 0; i < 16; i += 4) { uint32_t v = ESP.random(); memcpy(apdu + 5 + i, &v, 4); } // hardware RNG
        apdu[21] = 0x00;
        byte a[40]; byte aLen = sizeof(a);
        if (isoApdu(apdu, sizeof(apdu), a, &aLen) && aLen == 4 + 16 + 2 && a[20] == 0x90 && a[21] == 0x00) {
          out.challenge = toHex(apdu + 5, 16);
          out.ctr = ((uint32_t)a[0] << 24) | ((uint32_t)a[1] << 16) | ((uint32_t)a[2] << 8) | a[3];
          out.mac = toHex(a + 4, 16);
          result = PHONE_OK;
        }
      } else {
        result = PHONE_NOT_FLAP; // phone/card answered, but has no (switched-on) Flap card
      }
    }
    byte deselect[1] = { 0xC2 };
    byte d[8]; byte dLen = sizeof(d);
    rcFrame(deselect, 1, d, &dLen, 50);
  }
  setRcTimeout(0x03E8); // back to the library default (25 ms) for cards
  return result;
}

// Android phones use a random 4-byte UID starting with 0x08
bool looksLikePhone() { return mfrc522.uid.size == 4 && mfrc522.uid.uidByte[0] == 0x08; }

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

  // Phones and other ISO 14443-4 devices (SAK bit 0x20): try the Flap phone card first
  PhoneTap phone;
  bool isPhone = false;
  if (mfrc522.uid.sak & 0x20) {
    PhoneResult pr = readFlapPhone(phone);
    if (pr == PHONE_OK) {
      isPhone = true;
      uid = "PHONE:" + phone.pid; // the phone's UID changes every tap; debounce on its Flap ID
      Serial.println("[TAP] Flap phone " + phone.pid + " ctr=" + String(phone.ctr));
    } else if (looksLikePhone()) {
      mfrc522.PICC_HaltA();
      showResult(pr == PHONE_NOT_FLAP ? "unknown" : "error",
                 pr == PHONE_NOT_FLAP ? "Phone card is off" : "Hold phone still",
                 pr == PHONE_NOT_FLAP ? "Flap > Settings >" : "Keep it on the",
                 pr == PHONE_NOT_FLAP ? "Phone as Flap card" : "reader, try again");
      delay(2500);
      showReadyScreen();
      return;
    }
    // Otherwise an ISO-DEP card without the Flap app: use its UID like any card
  }

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
#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument doc;
#else
  StaticJsonDocument<640> doc;
#endif
  doc["flapid"]      = "";
  doc["uid"]         = uid;
  doc["tag_uid"]     = uid; // Add this for flapcard compatibility
  doc["type"]        = "card";
  if (isPhone) {
    doc["tag_type"] = "PHONE";
#if ARDUINOJSON_VERSION_MAJOR >= 7
    JsonObject pa = doc["phone_auth"].to<JsonObject>();
#else
    JsonObject pa = doc.createNestedObject("phone_auth");
#endif
    pa["pid"]       = phone.pid;
    pa["challenge"] = phone.challenge;
    pa["ctr"]       = phone.ctr;
    pa["mac"]       = phone.mac;
  }
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
#if ARDUINOJSON_VERSION_MAJOR >= 7
    JsonDocument filter;
    filter["status"] = true;
    filter["message"] = true;
    filter["display"] = true;
    filter["user"] = true;

    JsonDocument resp;
    DeserializationError err = deserializeJson(resp, body, DeserializationOption::Filter(filter));
#else
    StaticJsonDocument<128> filter;
    filter["status"] = true;
    filter["message"] = true;
    filter["display"] = true;
    filter["user"] = true;

    DynamicJsonDocument resp(3072);
    DeserializationError err = deserializeJson(resp, body, DeserializationOption::Filter(filter));
#endif

    if (err) {
      status = "error";
      line1  = "Bad JSON response";
      line2  = uid.substring(0, 21);
      line3  = String(err.c_str());
      Serial.println("[JSON ERROR] " + String(err.c_str()) + " | Body: " + body);
    } else {
      status = resp["status"] | "error";
      printCardUser(uid, resp["user"]);

      if (resp["display"]) {
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
  int displayMs = (status == "defect" || status == "defective" || status == "lost" || status == "denied") ? 6000 : 3500;
  showResult(status, line1, line2, line3);
  delay(displayMs);

  showReadyScreen();
}
