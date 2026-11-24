/*
 * =================================================================================
 * flap_ota.h — dashboard-driven over-the-air (OTA) updates for ESP8266 / ESP32
 * =================================================================================
 * Master copy: hardwarecode/flap_ota/flap_ota.h. Each sketch folder has its own
 * copy (the Arduino IDE only compiles files inside the sketch folder); after
 * editing this file run hardwarecode/flap_ota/sync.sh to update the copies.
 *
 * How it works
 *   1. Upload a .bin in the dashboard (Firmware page) and deploy it to devices.
 *   2. The device checks in every FLAP_OTA_INTERVAL_MS (and 20 s after boot):
 *        GET {server}/v1/firmware/check?device_id=..&board=..&version=..
 *   3. If an update is waiting, the server answers with a signed, 15-minute download
 *      link; the device downloads it, verifies the MD5 and reboots into it.
 *   4. After the reboot it checks in with the new version and the dashboard shows
 *      "success".
 *
 * Using it in a sketch
 *   #define FLAP_FW_VERSION "1.0.3"          // bump for every build you upload
 *   #define FLAP_OTA_BOARD  "esp_gateway_node" // which sketch this is
 *   #include "flap_ota.h"
 *
 *   setup():  FlapOta::begin(FLAPMAIN_SERVER, DEVICE_ID, DEVICE_KEY);
 *   loop():   FlapOta::loop();        // needs Wi-Fi connected; returns quickly
 *
 * LoRa-only ESP32 boards (no permanent Wi-Fi) call
 *   FlapOta::checkWithWifi(ssid, password)   e.g. when an "OTA:CHECK" LoRa command
 * arrives: it joins Wi-Fi, checks, and switches Wi-Fi off again.
 *
 * Build the .bin with Arduino IDE: Sketch -> Export Compiled Binary. Upload the
 * "<sketch>.ino.bin" file (not bootloader / partitions / merged).
 * ESP32: the partition scheme must have two app slots (the default does; "Huge
 * APP / No OTA" does not).
 * =================================================================================
 */
#ifndef FLAP_OTA_H
#define FLAP_OTA_H

#ifndef FLAP_FW_VERSION
#error "Define FLAP_FW_VERSION (e.g. \"1.0.0\") before including flap_ota.h"
#endif
#ifndef FLAP_OTA_BOARD
#error "Define FLAP_OTA_BOARD (the sketch name, e.g. \"esp_gateway_node\") before including flap_ota.h"
#endif
#ifndef FLAP_OTA_INTERVAL_MS
#define FLAP_OTA_INTERVAL_MS (10UL * 60UL * 1000UL) // check every 10 minutes
#endif
#ifndef FLAP_OTA_FIRST_CHECK_MS
#define FLAP_OTA_FIRST_CHECK_MS 20000UL // first check 20 s after begin()
#endif

#include <Arduino.h>
#include <WiFiClientSecure.h>
#if defined(ESP8266)
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266httpUpdate.h>
#define FLAP_OTA_CHIP "esp8266"
#define FLAP_OTA_UPDATER ESPhttpUpdate
#elif defined(ESP32)
#include <WiFi.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#define FLAP_OTA_CHIP "esp32"
#define FLAP_OTA_UPDATER httpUpdate
#else
#error "flap_ota.h supports ESP8266 and ESP32 only"
#endif

namespace FlapOta {

struct State {
  String server, deviceId, deviceKey;
  int node = 0;                       // LoRa node number (boards without their own device ID)
  unsigned long nextCheck = 0;
  bool started = false;
  bool requested = false;
  void (*beforeUpdate)() = nullptr;   // e.g. stop the radio, show "Updating" on a display
};

inline State &st() {
  static State s;
  return s;
}

inline String urlEncode(const String &v) {
  String out;
  const char *hex = "0123456789ABCDEF";
  for (size_t i = 0; i < v.length(); i++) {
    char c = v[i];
    if (isalnum((unsigned char)c) || c == '-' || c == '_' || c == '.' || c == '~') out += c;
    else { out += '%'; out += hex[(c >> 4) & 0xF]; out += hex[c & 0xF]; }
  }
  return out;
}

inline String baseUrl() {
  String b = st().server;
  while (b.endsWith("/")) b.remove(b.length() - 1);
  return b;
}

// Minimal JSON helpers (the server's replies are flat and small)
inline String jsonString(const String &body, const char *key) {
  String k = String("\"") + key + "\":\"";
  int i = body.indexOf(k);
  if (i < 0) return "";
  i += k.length();
  int j = body.indexOf('"', i);
  return j < 0 ? "" : body.substring(i, j);
}

inline bool jsonTrue(const String &body, const char *key) {
  return body.indexOf(String("\"") + key + "\":true") >= 0;
}

// One HTTP(S) request helper so http and https servers both work.
struct Http {
  WiFiClient plain;
  WiFiClientSecure secure;
  HTTPClient http;
  bool begin(const String &url) {
    if (url.startsWith("https")) {
      secure.setInsecure(); // same trust model as the rest of the firmware
      return http.begin(secure, url);
    }
    return http.begin(plain, url);
  }
  WiFiClient &client(const String &url) {
    if (url.startsWith("https")) { secure.setInsecure(); return secure; }
    return plain;
  }
};

inline String identityQuery() {
  String q = "device_id=" + urlEncode(st().deviceId);
  if (st().node > 0) q += "&node=" + String(st().node);
  return q;
}

/** Tell the dashboard what happened (state: downloading | failed). */
inline void report(const char *state, const String &message) {
  if (WiFi.status() != WL_CONNECTED) return;
  Http h;
  String url = baseUrl() + "/v1/firmware/status";
  if (!h.begin(url)) return;
  h.http.addHeader("Content-Type", "application/json");
  h.http.addHeader("X-Device-Key", st().deviceKey);
  h.http.setTimeout(6000);
  String msg = message;
  msg.replace("\\", "/");
  msg.replace("\"", "'");
  String body = "{\"device_id\":\"" + st().deviceId + "\",\"node\":" + String(st().node) +
                ",\"state\":\"" + state + "\",\"version\":\"" FLAP_FW_VERSION "\",\"message\":\"" + msg + "\"}";
  h.http.POST(body);
  h.http.end();
}

/**
 * Ask the server whether an update is waiting and install it.
 * Returns false when there was nothing to do or the update failed; on success the
 * board reboots into the new firmware and this never returns.
 */
inline bool checkNow() {
  if (!st().started || WiFi.status() != WL_CONNECTED) return false;

  String url = baseUrl() + "/v1/firmware/check?" + identityQuery() +
               "&board=" + urlEncode(FLAP_OTA_BOARD) + "&version=" + urlEncode(FLAP_FW_VERSION) +
               "&chip=" FLAP_OTA_CHIP;
  String body;
  int code;
  {
    Http h;
    if (!h.begin(url)) return false;
    h.http.addHeader("X-Device-Key", st().deviceKey);
    h.http.setTimeout(8000);
    code = h.http.GET();
    if (code > 0) body = h.http.getString();
    h.http.end();
  }
  if (code != 200) {
    Serial.printf("[OTA] Check-in failed: HTTP %d %s\n", code, body.substring(0, 120).c_str());
    return false;
  }
  if (!jsonTrue(body, "update")) return false;

  String version = jsonString(body, "version");
  String path = jsonString(body, "path");
  if (path.length() == 0) return false;
  String dl = baseUrl() + path;

  Serial.printf("[OTA] Update %s -> %s: downloading...\n", FLAP_FW_VERSION, version.c_str());
  if (st().beforeUpdate) st().beforeUpdate();

  Http h;
  FLAP_OTA_UPDATER.rebootOnUpdate(false); // reboot ourselves after logging
#if defined(ESP8266)
  t_httpUpdate_return r = FLAP_OTA_UPDATER.update(h.client(dl), dl, FLAP_FW_VERSION);
#else
  HTTPUpdateResult r = FLAP_OTA_UPDATER.update(h.client(dl), dl, FLAP_FW_VERSION);
#endif

  if (r == HTTP_UPDATE_OK) {
    Serial.printf("[OTA] Installed %s. Rebooting...\n", version.c_str());
    report("downloading", "Installed " + version + ", rebooting");
    delay(300);
    ESP.restart();
    return true; // not reached
  }
  String err = r == HTTP_UPDATE_NO_UPDATES ? String("server had no update")
                                           : String(FLAP_OTA_UPDATER.getLastErrorString());
  Serial.printf("[OTA] Update failed: %s\n", err.c_str());
  report("failed", err);
  return false;
}

/**
 * Start OTA. deviceId: the ID this board has in the dashboard. deviceKey: its device
 * key (or the gateway's key for LoRa nodes). node: LoRa node number if any.
 */
inline void begin(const char *server, const char *deviceId, const char *deviceKey, int node = 0) {
  st().server = server;
  st().deviceId = deviceId;
  st().deviceKey = deviceKey;
  st().node = node;
  st().started = true;
  st().nextCheck = millis() + FLAP_OTA_FIRST_CHECK_MS;
  Serial.printf("[OTA] %s %s (%s): checks %s every %lu min\n", FLAP_OTA_BOARD, FLAP_FW_VERSION, deviceId,
                server, (unsigned long)(FLAP_OTA_INTERVAL_MS / 60000UL));
}

/** Run a check soon (e.g. after an "OTA:CHECK" LoRa command). */
inline void requestCheck() { st().requested = true; }

inline void onBeforeUpdate(void (*cb)()) { st().beforeUpdate = cb; }

/** Call from loop(). Cheap unless a check is due. */
inline void loop() {
  if (!st().started || WiFi.status() != WL_CONNECTED) return;
  if (!st().requested && (long)(millis() - st().nextCheck) < 0) return;
  st().requested = false;
  st().nextCheck = millis() + FLAP_OTA_INTERVAL_MS;
  checkNow();
}

/**
 * For boards that normally keep Wi-Fi off (LoRa nodes): join Wi-Fi, check for an
 * update, then turn Wi-Fi off again. Blocks for up to timeoutMs while connecting.
 */
inline bool checkWithWifi(const char *ssid, const char *password, unsigned long timeoutMs = 15000) {
  if (!ssid || !ssid[0]) return false;
  bool wasConnected = WiFi.status() == WL_CONNECTED;
  if (!wasConnected) {
    Serial.printf("[OTA] Joining Wi-Fi \"%s\" to check for updates...\n", ssid);
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid, password);
    unsigned long t0 = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < timeoutMs) delay(200);
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[OTA] Wi-Fi not reachable; skipping the update check.");
      WiFi.disconnect(true);
      WiFi.mode(WIFI_OFF);
      return false;
    }
  }
  bool r = checkNow(); // reboots on success
  if (!wasConnected) {
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
  }
  return r;
}

} // namespace FlapOta

#endif // FLAP_OTA_H
