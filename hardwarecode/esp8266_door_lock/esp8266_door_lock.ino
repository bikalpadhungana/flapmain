/*
 * =================================================================================
 * FLAPMAIN DOOR LOCK — ESP8266 (NodeMCU) + A3144 Hall sensor + relay
 * =================================================================================
 * Unlocks:
 *  - locally with a magnet on the Hall sensor (works without Wi-Fi), and
 *  - from the dashboard (Door Locks page): the lock polls the server every
 *    POLL_INTERVAL_MS for a command; commands older than 30 s are dropped by the
 *    server, so a lock coming back online never opens for an old click.
 * Every unlock / lock is reported to the server and kept in the audit log.
 * The relay always starts LOCKED (fail-secure on power loss or reboot) and the
 * re-lock timer runs on the lock itself, even if Wi-Fi drops while it is open.
 *
 * Setup: copy config.h.example to config.h and fill it in. The lock must be
 * registered in the dashboard as device type "door_lock" and use its OWN key.
 * =================================================================================
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>

#if __has_include("config.h")
#include "config.h"
#else
#error "Copy config.h.example to config.h in this folder and fill in Wi-Fi, server, device ID and key"
#endif

#ifndef HALL_SENSOR_PIN
#define HALL_SENSOR_PIN D2
#endif
#ifndef RELAY_PIN
#define RELAY_PIN D1
#endif
#ifndef RELAY_ACTIVE_LOW
#define RELAY_ACTIVE_LOW 1
#endif
#ifndef UNLOCK_DURATION_MS
#define UNLOCK_DURATION_MS 5000
#endif
#ifndef ENABLE_MAGNET_UNLOCK
#define ENABLE_MAGNET_UNLOCK 1
#endif
#ifndef POLL_INTERVAL_MS
#define POLL_INTERVAL_MS 1500
#endif

// ---- Firmware version & OTA updates from the dashboard (Firmware page) ----
#ifndef FLAP_FW_VERSION
#define FLAP_FW_VERSION "1.0.0"
#endif
#define FLAP_OTA_BOARD "esp8266_door_lock"
#include "flap_ota.h"

const int UNLOCK_STATE = RELAY_ACTIVE_LOW ? LOW : HIGH;
const int LOCK_STATE = RELAY_ACTIVE_LOW ? HIGH : LOW;
const unsigned long MAX_UNLOCK_MS = 60000UL;

bool unlocked = false;
unsigned long relockAt = 0;
bool bootReported = false;
unsigned long lastPoll = 0;

// Magnet debounce: unlock once per approach, re-arm after the magnet is removed
bool magnetArmed = true;
bool magnetLast = false;
unsigned long magnetChangedAt = 0;

// ---- Server helpers ----
String apiUrl(const String &path) {
  String b = FLAPMAIN_SERVER;
  while (b.endsWith("/")) b.remove(b.length() - 1);
  return b + path;
}

bool httpBegin(HTTPClient &http, WiFiClient &plain, BearSSL::WiFiClientSecure &secure, const String &url) {
  if (url.startsWith("https")) {
    secure.setInsecure();
    secure.setBufferSizes(1024, 512); // keep RAM free on the ESP8266
    return http.begin(secure, url);
  }
  return http.begin(plain, url);
}

String jsonString(const String &body, const char *key) {
  String k = String("\"") + key + "\":\"";
  int i = body.indexOf(k);
  if (i < 0) return "";
  i += k.length();
  int j = body.indexOf('"', i);
  return j < 0 ? "" : body.substring(i, j);
}

long jsonLong(const String &body, const char *key) {
  String k = String("\"") + key + "\":";
  int i = body.indexOf(k);
  return i < 0 ? -1 : body.substring(i + k.length()).toInt();
}

void reportEvent(const char *event, const char *source, const String &commandId = "") {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.printf("[LOCK] (offline) %s via %s not reported\n", event, source);
    return;
  }
  WiFiClient plain;
  BearSSL::WiFiClientSecure secure;
  HTTPClient http;
  if (!httpBegin(http, plain, secure, apiUrl("/v1/locks/event"))) return;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", FLAPMAIN_DEVICE_KEY);
  http.setTimeout(3000);
  String body = String("{\"device_id\":\"") + FLAPMAIN_DEVICE_ID + "\",\"event\":\"" + event +
                "\",\"source\":\"" + source + "\",\"command_id\":\"" + commandId + "\"}";
  int code = http.POST(body);
  http.end();
  if (code != 200) Serial.printf("[LOCK] Event report failed: HTTP %d\n", code);
}

// ---- Lock control ----
void unlockFor(unsigned long ms, const char *source, const String &commandId = "") {
  if (ms == 0 || ms > MAX_UNLOCK_MS) ms = UNLOCK_DURATION_MS;
  digitalWrite(RELAY_PIN, UNLOCK_STATE);
  bool wasUnlocked = unlocked;
  unlocked = true;
  relockAt = millis() + ms;
  Serial.printf("🔓 [LOCK] Unlocked for %lus (%s)\n", ms / 1000, source);
  if (!wasUnlocked || commandId.length()) reportEvent("unlocked", source, commandId);
}

void lockNow(const char *source, const String &commandId = "") {
  digitalWrite(RELAY_PIN, LOCK_STATE);
  bool wasUnlocked = unlocked;
  unlocked = false;
  Serial.printf("🔒 [LOCK] Locked (%s)\n", source);
  if (wasUnlocked || commandId.length()) reportEvent("locked", source, commandId);
}

// ---- Dashboard commands ----
void pollServer() {
  WiFiClient plain;
  BearSSL::WiFiClientSecure secure;
  HTTPClient http;
  String url = apiUrl("/v1/locks/poll?device_id=" + String(FLAPMAIN_DEVICE_ID));
  if (!httpBegin(http, plain, secure, url)) return;
  http.addHeader("X-Device-Key", FLAPMAIN_DEVICE_KEY);
  http.setTimeout(2500);
  int code = http.GET();
  String body = code == 200 ? http.getString() : "";
  http.end();

  if (code != 200) {
    static unsigned long lastWarn = 0;
    if (millis() - lastWarn > 30000) {
      lastWarn = millis();
      if (code == 401) Serial.println("[LOCK] Server refused the device key (use this lock's own key from the dashboard)");
      else if (code == 404) Serial.println("[LOCK] Not registered: add it in the dashboard as device type door_lock");
      else if (code == 403) Serial.println("[LOCK] Lock is not active: activate it on the Devices page");
      else Serial.printf("[LOCK] Poll failed: HTTP %d\n", code);
    }
    return;
  }
  if (body.indexOf("\"command\":null") >= 0) return;

  String action = jsonString(body, "action");
  String id = jsonString(body, "id");
  if (action == "unlock") unlockFor((unsigned long)jsonLong(body, "duration_ms"), "dashboard", id);
  else if (action == "lock") lockNow("dashboard", id);
}

// ---- Magnet (A3144 outputs LOW near a magnet's south pole) ----
void checkMagnet() {
#if ENABLE_MAGNET_UNLOCK
  bool present = digitalRead(HALL_SENSOR_PIN) == LOW;
  if (present != magnetLast) {
    magnetLast = present;
    magnetChangedAt = millis();
  }
  if (millis() - magnetChangedAt < 50) return; // debounce
  if (present && magnetArmed) {
    magnetArmed = false;
    Serial.println("🧲 [LOCK] Magnet detected");
    unlockFor(UNLOCK_DURATION_MS, "magnet");
  } else if (!present) {
    magnetArmed = true; // magnet removed: next approach unlocks again
  }
#endif
}

void setup() {
  // Lock first, before anything else can delay it
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOCK_STATE);
  pinMode(HALL_SENSOR_PIN, INPUT_PULLUP);

  Serial.begin(115200);
  delay(200);
  Serial.printf("\n=== FlapMain Door Lock v%s (%s) ===\n", FLAP_FW_VERSION, FLAPMAIN_DEVICE_ID);

  // A magnet already present at power-on does not unlock until it is removed
  magnetLast = digitalRead(HALL_SENSOR_PIN) == LOW;
  magnetArmed = !magnetLast;

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD); // non-blocking: the magnet works while connecting
  Serial.printf("[Wi-Fi] Connecting to %s...\n", WIFI_SSID);

  FlapOta::onBeforeUpdate([]() { digitalWrite(RELAY_PIN, LOCK_STATE); }); // stay locked while updating
  FlapOta::begin(FLAPMAIN_SERVER, FLAPMAIN_DEVICE_ID, FLAPMAIN_DEVICE_KEY);
  Serial.println("Door lock ready (locked).");
}

void loop() {
  checkMagnet();

  if (unlocked && (long)(millis() - relockAt) >= 0) lockNow("timer");

  if (WiFi.status() == WL_CONNECTED) {
    if (!bootReported) {
      bootReported = true;
      Serial.printf("[Wi-Fi] Connected, IP %s\n", WiFi.localIP().toString().c_str());
      reportEvent("boot", "boot");
    }
    if (millis() - lastPoll >= POLL_INTERVAL_MS) {
      lastPoll = millis();
      pollServer();
    }
    if (!unlocked) FlapOta::loop(); // never restart for an update while the door is open
  }

  delay(10);
}
