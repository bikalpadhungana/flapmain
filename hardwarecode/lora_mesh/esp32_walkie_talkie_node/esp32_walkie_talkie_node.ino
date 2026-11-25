/*
 * =================================================================================
 * FLAPMAIN LORA MESH WALKIE-TALKIE — ESP32 EDITION
 * ESP32 DevKit + SX1278 LoRa + SH1106/SSD1306 OLED + 2 buttons + buzzer
 *
 * Same 58-byte LoRaMeshPacket as every other FlapMain node.
 *  - Direct messages are confirmed with an ACK and re-sent if none arrives.
 *  - Broadcasts / SOS are confirmed by a gateway ("Reached BASE").
 *  - Messages are word-wrapped on screen; inbox keeps the last 10 with unread count.
 *  - Hold CLICK 1.5 s for an emergency SOS broadcast.
 *  - Serial (115200): type text to send; "text /102" sends direct; /help for more.
 *  - Bluetooth LE (Nordic UART Service, name "FlapWalkie-<id>"): exactly the same
 *    text commands and output as serial, so a Web Serial app can switch to BLE
 *    without changing its parser. Pairing uses a 6-digit code shown on the OLED.
 * =================================================================================
 */

#include "lora_mesh_protocol.h"
#include "config.h"
// Optional: Wi-Fi + key for OTA updates (copy secrets.h.example to secrets.h).
#if __has_include("secrets.h")
#include "secrets.h"
#endif
// ---- Firmware version & OTA ----
// Bump FLAP_FW_VERSION for every build you upload to the dashboard.
// OTA is opt-in: add "#define WALKIE_OTA 1" to secrets.h AND set Tools -> Partition
// Scheme -> "Minimal SPIFFS (1.9MB APP with OTA)". With Bluetooth + Wi-Fi the walkie is
// 1.9 MB and does not fit the default 1.3 MB app slot ("Sketch too big").
#ifndef FLAP_FW_VERSION
#define FLAP_FW_VERSION "1.1.1"
#endif
#define FLAP_OTA_BOARD "esp32_walkie_talkie_node"
#if defined(WALKIE_OTA) && WALKIE_OTA && defined(OTA_WIFI_SSID) && defined(OTA_SERVER) && defined(OTA_DEVICE_KEY)
#define OTA_ENABLED 1
#include "flap_ota.h"
#else
#define OTA_ENABLED 0
#endif
bool otaCheckRequested = false;

// The sketch needs its own config.h and lora_mesh_protocol.h next to it. Open the
// whole "esp32_walkie_talkie_node" folder in the Arduino IDE, not a lone .ino file (the IDE then
// creates a new folder without these files).
#if !defined(LORA_SCK_PIN)
#error "Wrong or missing config.h: copy the whole esp32_walkie_talkie_node folder (.ino + config.h + lora_mesh_protocol.h)"
#endif
#if !defined(PKT_TYPE_ACK) || !defined(DEFAULT_MAX_TTL)
#error "Wrong lora_mesh_protocol.h: use the one from the esp32_walkie_talkie_node folder"
#endif
#ifndef BLE_PAIRING
#if defined(BLE_REQUIRE_PAIRING) && BLE_REQUIRE_PAIRING
#define BLE_PAIRING 2
#elif defined(BLE_REQUIRE_PAIRING)
#define BLE_PAIRING 0
#else
#define BLE_PAIRING 1
#endif
#endif
#ifndef BLE_PAIR_WINDOW_MS
#define BLE_PAIR_WINDOW_MS 120000
#endif
#undef BLE_REQUIRE_PAIRING
#define BLE_REQUIRE_PAIRING (BLE_PAIRING > 0)
#include <Adafruit_GFX.h>
#include <LoRa.h>
#include <SPI.h>
#include <Wire.h>
#if BLE_ENABLED
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLESecurity.h>
#endif

#if !defined(ESP32)
#error "esp32_walkie_talkie_node is for ESP32 boards."
#endif
#if WALKIE_NODE_ID < 1 || WALKIE_NODE_ID > 255
#error "WALKIE_NODE_ID must be 1..255 (sent as one byte)"
#endif
static_assert(sizeof(LoRaMeshPacket) == 58, "Old lora_mesh_protocol.h (packet is not 58 bytes): use the one from this sketch folder");

// =================================================================================
// OLED: framebuffer driver for SH1106 (1.3") and SSD1306 (0.96")
// =================================================================================
// Declared before any function: Arduino's generated prototypes use this type.
struct ReceivedMessage {
  uint8_t sender;
  uint8_t target;
  int16_t rssi;
  uint8_t alertLevel;
  unsigned long rxTime;
  char text[32];
};

#ifndef OLED_RST_PIN
#define OLED_RST_PIN -1
#endif
#ifndef OLED_DRIVER
#define OLED_DRIVER 0
#endif

// I2C pins that answered (for messages and /i2c)
int oledSda = OLED_SDA_PIN, oledScl = OLED_SCL_PIN;

// True if `pin` is used by something else in config.h (never probe those as I2C).
bool pinInUse(int pin) {
  const int used[] = {LORA_SCK_PIN, LORA_MISO_PIN, LORA_MOSI_PIN, LORA_SS_PIN, LORA_RST_PIN, LORA_DIO0_PIN,
                      BTN_SELECT_PIN, BTN_CLICK_PIN, BUZZER_PIN, STATUS_LED_PIN, BATT_PIN};
  for (int u : used) if (u == pin) return true;
  return false;
}

// Print every I2C address that answers on the given pins.
void i2cScan(int sda, int scl) {
  Wire.end();
  Wire.begin(sda, scl, 100000);
  Serial.printf("[I2C] Scan SDA=%d SCL=%d:", sda, scl);
  uint8_t n = 0;
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) { Serial.printf(" 0x%02X", a); n++; }
  }
  Serial.println(n ? "" : " nothing found (check wiring, power, SDA/SCL)");
}

class UniversalOLED : public Adafruit_GFX {
  uint8_t addr = 0x3C;
  uint8_t colOffset = 2; // SH1106 RAM is 132 wide; SSD1306 ignores the offset visually
  uint8_t buf[1024];

  // Look for a display at 0x3C / 0x3D on one pin pair (at 100 kHz: works with long jumpers).
  bool probe(int sda, int scl) {
    Wire.end();
    Wire.begin(sda, scl, 100000);
    for (uint8_t a : {(uint8_t)0x3C, (uint8_t)0x3D}) {
      Wire.beginTransmission(a);
      if (Wire.endTransmission() == 0) { addr = a; oledSda = sda; oledScl = scl; return true; }
    }
    return false;
  }

  void cmd(uint8_t c) {
    Wire.beginTransmission(addr);
    Wire.write((uint8_t)0x00);
    Wire.write(c);
    Wire.endTransmission();
  }

public:
  UniversalOLED() : Adafruit_GFX(128, 64) { memset(buf, 0, sizeof(buf)); }

  void drawPixel(int16_t x, int16_t y, uint16_t color) override {
    if (x < 0 || x >= 128 || y < 0 || y >= 64) return;
    if (color) buf[x + (y / 8) * 128] |= (1 << (y & 7));
    else buf[x + (y / 8) * 128] &= ~(1 << (y & 7));
  }

  void clear() { memset(buf, 0, sizeof(buf)); }

  bool begin() {
    if (OLED_RST_PIN >= 0) { // built-in OLEDs on TTGO / Heltec boards stay dark until reset
      pinMode(OLED_RST_PIN, OUTPUT);
      digitalWrite(OLED_RST_PIN, LOW);
      delay(20);
      digitalWrite(OLED_RST_PIN, HIGH);
      delay(20);
    }

    // Configured pins first, then the same pins swapped, then common built-in OLED pins.
    const int pairs[][2] = {{OLED_SDA_PIN, OLED_SCL_PIN}, {OLED_SCL_PIN, OLED_SDA_PIN}, {21, 22}, {22, 21},
                            {4, 15}, {15, 4}, {17, 18}, {18, 17}};
    bool found = false;
    for (uint8_t i = 0; i < sizeof(pairs) / sizeof(pairs[0]) && !found; i++) {
      int sda = pairs[i][0], scl = pairs[i][1];
      if (i >= 2 && (pinInUse(sda) || pinInUse(scl))) continue; // never disturb LoRa / buttons
      found = probe(sda, scl);
    }
    if (!found) {
      Serial.printf("[OLED] No display at 0x3C/0x3D. Expected SDA=%d SCL=%d, VCC=3.3V, GND.\n", OLED_SDA_PIN, OLED_SCL_PIN);
      i2cScan(OLED_SDA_PIN, OLED_SCL_PIN);
      return false;
    }

    // Faster bus for drawing, if the wiring allows it.
    Wire.setClock(400000);
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() != 0) Wire.setClock(100000);

    if (OLED_DRIVER == 1) {        // SSD1306 0.96"
      colOffset = 0;
      static const uint8_t init[] = {0xAE, 0xD5, 0x80, 0xA8, 0x3F, 0xD3, 0x00, 0x40, 0x8D, 0x14, 0x20, 0x02,
                                     0xA1, 0xC8, 0xDA, 0x12, 0x81, 0xCF, 0xD9, 0xF1, 0xDB, 0x40, 0xA4, 0xA6, 0xAF};
      for (uint8_t c : init) cmd(c);
    } else if (OLED_DRIVER == 2) { // SH1106 1.3"
      colOffset = 2;
      static const uint8_t init[] = {0xAE, 0xD5, 0x80, 0xA8, 0x3F, 0xD3, 0x00, 0x40, 0xAD, 0x8B, 0x32,
                                     0xA1, 0xC8, 0xDA, 0x12, 0x81, 0x80, 0xD9, 0x22, 0xDB, 0x35, 0xA4, 0xA6, 0xAF};
      for (uint8_t c : init) cmd(c);
    } else {                       // both: charge pump commands for SSD1306 and SH1106
      static const uint8_t init[] = {0xAE, 0xD5, 0x80, 0xA8, 0x3F, 0xD3, 0x00, 0x40, 0x8D, 0x14,
                                     0xAD, 0x8B, 0x30, 0xA1, 0xC8, 0xDA, 0x12, 0x81, 0xBF, 0xD9,
                                     0x22, 0xDB, 0x40, 0xA4, 0xA6, 0xAF};
      for (uint8_t c : init) cmd(c);
    }
    clear();
    show();
    if (oledSda != OLED_SDA_PIN || oledScl != OLED_SCL_PIN)
      Serial.printf("[OLED] Found on SDA=%d SCL=%d, not the configured %d/%d: set OLED_SDA_PIN/OLED_SCL_PIN in config.h\n",
                    oledSda, oledScl, OLED_SDA_PIN, OLED_SCL_PIN);
    Serial.printf("[OLED] Display at 0x%02X on SDA=%d SCL=%d\n", addr, oledSda, oledScl);
    return true;
  }

  void show() {
    for (uint8_t page = 0; page < 8; page++) {
      cmd(0xB0 + page);
      cmd(0x00 + (colOffset & 0x0F));
      cmd(0x10 + (colOffset >> 4));
      for (uint8_t chunk = 0; chunk < 128; chunk += 16) {
        Wire.beginTransmission(addr);
        Wire.write((uint8_t)0x40);
        Wire.write(&buf[page * 128 + chunk], 16);
        Wire.endTransmission();
      }
    }
  }
};

UniversalOLED display;
bool oledPresent = false;

// =================================================================================
// Bluetooth LE: Nordic UART Service (NUS)
//   RX  6E400002-...  phone writes command lines (same as typing in serial)
//   TX  6E400003-...  walkie notifies output lines (same as serial output)
// =================================================================================
#define NUS_SERVICE_UUID "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_RX_UUID      "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_TX_UUID      "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"

volatile bool bleConnected = false;
volatile bool bleJustConnected = false; // send READY once the link is usable
volatile bool bleSecure = false;        // link encrypted (or pairing disabled): only then send data
volatile bool bleAuthFailed = false;
volatile uint16_t bleConnId = 0;
uint8_t bleRemoteBda[6] = {0};
volatile unsigned long bleConnectedAt = 0;
volatile bool bleSecRequested = false;
unsigned long pairWindowUntil = BLE_PAIR_WINDOW_MS; // new phones may pair until this millis()
volatile bool pairRejectedLocked = false;          // last pairing refused because the window was closed
bool appMode = true; // debug log lines go to USB only; "/debug on" also sends them over Bluetooth
volatile uint32_t blePasskey = 0; // set while a phone is pairing (shown on OLED)

#if BLE_ENABLED
BLEServer *bleServer = nullptr;
BLECharacteristic *bleTx = nullptr;
QueueHandle_t bleInQueue = nullptr; // bytes from the phone; BLE callbacks run on another task
#endif

// Output sink: everything printed goes to USB serial and, when a phone is
// connected, to BLE notifications (sent per line, split to fit the MTU).
class DualConsole : public Print {
  char line[256];
  size_t len = 0;
  bool alwaysBle;

  void flushLine() {
#if BLE_ENABLED
    // Never send anything over an unpaired link; debug lines only when no app protocol is in use.
    if (bleConnected && bleSecure && (alwaysBle || !appMode) && bleTx && len) {
      uint16_t mtu = BLEDevice::getMTU();
      size_t chunk = (mtu > 23 ? mtu - 3 : 20);
      for (size_t off = 0; off < len;) {
        size_t n = min(chunk, len - off);
        // Never end a notification inside a multi-byte UTF-8 character (e.g. Nepali text):
        // apps decode each notification on its own.
        while (n > 1 && off + n < len && (line[off + n] & 0xC0) == 0x80) n--;
        bleTx->setValue((uint8_t *)line + off, n);
        off += n;
        bleTx->notify();
        delay(4); // let the stack drain between notifications
      }
    }
#endif
    len = 0;
  }

public:
  explicit DualConsole(bool always) : alwaysBle(always) {}
  size_t write(uint8_t c) override {
    Serial.write(c);
    if (len < sizeof(line)) line[len++] = (char)c;
    if (c == '\n' || len == sizeof(line)) flushLine();
    return 1;
  }
  size_t write(const uint8_t *buf, size_t n) override {
    for (size_t i = 0; i < n; i++) write(buf[i]);
    return n;
  }
};
DualConsole Console(true); // protocol lines for the app (READY, PONG, OK:, ERR:, RX:)
DualConsole Log(false);    // human-readable debug log

// =================================================================================
// State
// =================================================================================
uint8_t myNodeId = WALKIE_NODE_ID;
MeshDedup dedupCache;
uint16_t msgCounter = 0;

ReceivedMessage inbox[INBOX_CAPACITY];
uint8_t inboxCount = 0;
uint8_t inboxIdx = 0;
uint8_t unreadCount = 0;

// Latest message shown on the home screen
ReceivedMessage lastRx;
bool lastRxDirect = false;
unsigned long lastRxTime = 0;

// Delivery tracking
enum SendStatus : uint8_t { SEND_NONE, SEND_WAITING, SEND_DELIVERED, SEND_FAILED, SEND_BROADCAST, SEND_REACHED_BASE };
LoRaMeshPacket pendingPkt;
uint8_t pendingRetries = 0;
unsigned long pendingSentAt = 0;
uint8_t lastSendStatus = SEND_NONE;
uint8_t lastSendTarget = 0;
uint16_t lastSendMsgId = 0;

void emitAppRx(const LoRaMeshPacket &pkt, int rssi); // app protocol RX: lines (defined below)

// Presets and targets
const char *const PRESETS[] = {"HELP NEEDED!", "STATUS: ALL CLEAR", "COPY THAT / OK", "RETURNING TO BASE",
                               "NEED BACKUP HERE", "ARRIVED AT SCENE", "AFFIRMATIVE (YES)", "NEGATIVE (NO)",
                               "CHECK RADIO PING", "< CANCEL / BACK >"};
const uint8_t PRESET_COUNT = sizeof(PRESETS) / sizeof(PRESETS[0]);
const uint8_t TARGETS[] = {0, 101, 102, 103, 104};
const uint8_t TARGET_COUNT = sizeof(TARGETS);
uint8_t targetIdx = 0;

// UI
enum Screen : uint8_t { SCR_HOME, SCR_MENU, SCR_QUICK_SMS, SCR_INBOX, SCR_TARGET, SCR_SOS_CONFIRM, SCR_SPLASH };
Screen screen = SCR_HOME;
uint8_t menuIdx = 0, presetIdx = 0, targetSelIdx = 0;
char splash1[22] = "", splash2[22] = "";
unsigned long splashUntil = 0;
bool needRedraw = true;
bool loraOk = false;              // SX1278 answered at init; retried every 10 s if not
unsigned long loraRetryAt = 0;

// =================================================================================
// Helpers
// =================================================================================
int bondedPhoneCount() {
#if BLE_ENABLED && defined(CONFIG_BLUEDROID_ENABLED)
  return esp_ble_get_bond_device_num();
#else
  return 0;
#endif
}
// New phones may pair while the window is open, or at any time if no phone is paired yet.
bool pairWindowOpen() { return (long)(pairWindowUntil - millis()) > 0 || bondedPhoneCount() <= 0; }

void beep(uint16_t freq, uint16_t ms) {
#if BUZZER_PIN > 0
  tone(BUZZER_PIN, freq, ms);
#endif
}

void alarmSound() {
#if BUZZER_PIN > 0
  for (uint8_t i = 0; i < 2; i++) {
    tone(BUZZER_PIN, 2400, 80); delay(90);
    tone(BUZZER_PIN, 1600, 80); delay(90);
  }
#endif
}

uint16_t readBatteryMv() {
  return (uint16_t)min<uint32_t>(65535, (uint32_t)(analogReadMilliVolts(BATT_PIN) * BATTERY_DIVIDER));
}

void nodeName(uint8_t id, char *buf, size_t n) {
  switch (id) {
    case 0: snprintf(buf, n, "BASE"); break;
    case 101: snprintf(buf, n, "Alpha"); break;
    case 102: snprintf(buf, n, "Bravo"); break;
    case 103: snprintf(buf, n, "Charlie"); break;
    case 104: snprintf(buf, n, "Delta"); break;
    default: snprintf(buf, n, "#%u", id); break;
  }
}

void formatAge(unsigned long t, char *buf, size_t n) {
  unsigned long s = (millis() - t) / 1000UL;
  if (s < 60) snprintf(buf, n, "%lus", s);
  else if (s < 3600) snprintf(buf, n, "%lum", s / 60);
  else snprintf(buf, n, "%luh", s / 3600);
}

void splash(const char *l1, const char *l2, unsigned long ms = 1500) {
  strncpy(splash1, l1, sizeof(splash1) - 1);
  strncpy(splash2, l2, sizeof(splash2) - 1);
  splashUntil = millis() + ms;
  screen = SCR_SPLASH;
  needRedraw = true;
}

// =================================================================================
// Drawing (6x8 font: 21 columns x 8 rows)
// =================================================================================
void row(uint8_t r, const char *text, bool invert = false) {
  if (invert) {
    display.fillRect(0, r * 8, 128, 8, 1);
    display.setTextColor(0, 1);
  } else {
    display.setTextColor(1, 0);
  }
  display.setCursor(0, r * 8);
  char line[22];
  strncpy(line, text, 21);
  line[21] = '\0';
  display.print(line);
  display.setTextColor(1, 0);
}

// Word-wrap text over up to maxRows rows starting at row r.
void wrapped(uint8_t r, uint8_t maxRows, const char *text) {
  const uint8_t W = 21;
  const char *p = text;
  for (uint8_t i = 0; i < maxRows && *p; i++) {
    while (*p == ' ') p++;
    size_t take = strlen(p);
    if (take > W) {
      take = W;
      if (i < maxRows - 1)
        for (int8_t k = W; k > 0; k--)
          if (p[k] == ' ') { take = k; break; }
    }
    char line[22];
    memcpy(line, p, take);
    line[take] = '\0';
    row(r + i, line);
    p += take;
  }
}

void header(const char *title) {
  char batt[8];
  snprintf(batt, sizeof(batt), "%.1fV", readBatteryMv() / 1000.0f);
  display.setCursor(0, 0);
  display.print(title);
  display.setCursor(128 - 6 * strlen(batt), 0);
  display.print(batt);
  if (bleConnected) { display.setCursor(128 - 6 * (strlen(batt) + 3), 0); display.print("BT"); }
  display.drawFastHLine(0, 9, 128, 1);
}

void footer(const char *left, const char *right) {
  display.drawFastHLine(0, 54, 128, 1);
  display.setCursor(0, 56);
  display.print("[S]");
  display.print(left);
  display.setCursor(66, 56);
  display.print("[C]");
  display.print(right);
}

void messageMeta(uint8_t r, const ReceivedMessage &m, bool toMe, bool invert) {
  char name[9], age[6], line[24];
  nodeName(m.sender, name, sizeof(name));
  formatAge(m.rxTime, age, sizeof(age));
  snprintf(line, sizeof(line), "%s>%s %s %ddB", name, toMe ? "me" : "all", age, m.rssi);
  row(r, line, invert);
}

void drawScreen() {
  if (!oledPresent) return;
  display.clear();
  display.setTextSize(1);
  display.setTextWrap(false);
  char line[24], name[9];

  switch (screen) {
    case SCR_HOME: {
      if (unreadCount) snprintf(line, sizeof(line), "#%u  %u NEW", myNodeId, unreadCount);
      else snprintf(line, sizeof(line), "WALKIE #%u", myNodeId);
      header(line);

      bool sos = lastRx.alertLevel > 0 && lastRxTime && millis() - lastRxTime < 30000;
      bool recent = lastRxTime && millis() - lastRxTime < 60000;
      if (sos || recent) {
        messageMeta(2, lastRx, lastRxDirect, sos);
        wrapped(3, 3, lastRx.text[0] ? lastRx.text : "SOS TRIGGERED!");
      } else {
        row(2, loraOk ? "Listening 433MHz" : "LORA NOT FOUND", !loraOk);
        nodeName(TARGETS[targetIdx], name, sizeof(name));
        snprintf(line, sizeof(line), "To: %s", TARGETS[targetIdx] == 0 ? "ALL" : name);
        row(3, line);
        nodeName(lastSendTarget, name, sizeof(name));
        switch (lastSendStatus) {
          case SEND_WAITING: snprintf(line, sizeof(line), "Sending.. try %u/%u", pendingRetries + 1, ACK_MAX_RETRIES + 1); break;
          case SEND_DELIVERED: snprintf(line, sizeof(line), "Last: Delivered %s", name); break;
          case SEND_FAILED: snprintf(line, sizeof(line), "Last: NOT delivered"); break;
          case SEND_BROADCAST: snprintf(line, sizeof(line), "Last: Sent to all"); break;
          case SEND_REACHED_BASE: snprintf(line, sizeof(line), "Last: Reached BASE"); break;
          default: line[0] = '\0';
        }
        row(4, line, lastSendStatus == SEND_FAILED);
        if (BLE_ENABLED && BLE_PAIRING > 0 && pairWindowOpen() && !bleConnected)
          snprintf(line, sizeof(line), "BT pairing open %lus", (pairWindowUntil - millis()) / 1000);
        else if (unreadCount) snprintf(line, sizeof(line), "Inbox: %u unread", unreadCount);
        else snprintf(line, sizeof(line), "Hold [C] = SOS");
        row(5, line);
      }
      footer("Menu", "QuickSMS");
      break;
    }

    case SCR_MENU: {
      header("MAIN MENU");
      static const char *items[] = {"Quick SMS", "Inbox", "Send SOS Alert", "Target Node", "Back"};
      const uint8_t n = 5;
      uint8_t top = menuIdx >= 4 ? menuIdx - 3 : 0;
      for (uint8_t i = 0; i < 4 && top + i < n; i++) {
        uint8_t k = top + i;
        if (k == 1) snprintf(line, sizeof(line), "%u.Inbox (%u)", k + 1, inboxCount);
        else snprintf(line, sizeof(line), "%u.%s", k + 1, items[k]);
        row(2 + i, line, k == menuIdx);
      }
      footer("Next", "Enter");
      break;
    }

    case SCR_QUICK_SMS: {
      nodeName(TARGETS[targetIdx], name, sizeof(name));
      snprintf(line, sizeof(line), "SMS to %s", TARGETS[targetIdx] == 0 ? "ALL" : name);
      header(line);
      uint8_t top = presetIdx >= 4 ? presetIdx - 3 : 0;
      for (uint8_t i = 0; i < 4 && top + i < PRESET_COUNT; i++) row(2 + i, PRESETS[top + i], top + i == presetIdx);
      footer("Next", "Send");
      break;
    }

    case SCR_INBOX: {
      if (!inboxCount) {
        header("INBOX");
        row(2, "Inbox empty");
        row(3, "Listening on 433MHz");
        footer("---", "Back");
        break;
      }
      snprintf(line, sizeof(line), "INBOX %u/%u", inboxIdx + 1, inboxCount);
      header(line);
      const ReceivedMessage &m = inbox[inboxIdx];
      messageMeta(2, m, m.target == myNodeId, m.alertLevel > 0);
      wrapped(3, 3, m.text);
      footer("Next", "Back");
      break;
    }

    case SCR_TARGET: {
      header("TARGET NODE");
      uint8_t top = targetSelIdx >= 4 ? targetSelIdx - 3 : 0;
      for (uint8_t i = 0; i < 4 && top + i < TARGET_COUNT; i++) {
        uint8_t id = TARGETS[top + i];
        nodeName(id, name, sizeof(name));
        if (id == 0) snprintf(line, sizeof(line), "0: Broadcast All");
        else snprintf(line, sizeof(line), "%u: Walkie %s", id, name);
        row(2 + i, line, top + i == targetSelIdx);
      }
      footer("Next", "Set");
      break;
    }

    case SCR_SOS_CONFIRM:
      header("! CONFIRM SOS !");
      row(2, "Broadcast EMERGENCY");
      row(3, "SOS to all stations?");
      row(4, "Alert: CRITICAL", true);
      footer("Cancel", "CONFIRM");
      break;

    case SCR_SPLASH:
      header("WALKIE");
      row(3, splash1, true);
      row(4, splash2);
      break;
  }
  display.show();
  needRedraw = false;
}

// =================================================================================
// Radio
// =================================================================================
bool transmitPacket(const LoRaMeshPacket &pkt) {
  if (!loraOk) return false;
  digitalWrite(STATUS_LED_PIN, HIGH);
  LoRa.beginPacket();
  LoRa.write((const uint8_t *)&pkt, sizeof(pkt));
  bool ok = LoRa.endPacket() == 1;
  digitalWrite(STATUS_LED_PIN, LOW);
  LoRa.receive();
  return ok;
}

uint16_t nextMsgId() {
  if (++msgCounter == 0) msgCounter = 1;
  return msgCounter;
}

void sendWalkieMessage(const char *text, uint8_t alertLevel, uint8_t pktType, uint8_t target) {
  LoRaMeshPacket pkt;
  memset(&pkt, 0, sizeof(pkt));

  char clean[32] = {0};
  uint8_t parsedTarget = parseTargetNodeFromText(text, clean, sizeof(clean));
  // "text /102" always goes to node 102, whatever target is selected on the walkie's menu
  // (before, a non-zero menu target silently overrode the app's direct messages).
  if (parsedTarget) target = parsedTarget;

  uint16_t id = nextMsgId();
  pkt.msgIdHi = id >> 8;
  pkt.msgIdLo = id & 0xFF;
  pkt.originNode = myNodeId;
  pkt.targetNode = target;
  pkt.ttl = DEFAULT_MAX_TTL;
  pkt.packetType = pktType;
  pkt.alert_level = alertLevel;
  pkt.battery_mv = readBatteryMv();
  strncpy(pkt.text_msg, clean[0] ? clean : text, sizeof(pkt.text_msg) - 1);
  // The packet holds 31 bytes; don't leave half of a multi-byte UTF-8 character at the end.
  size_t tl = strlen(pkt.text_msg);
  if (tl == sizeof(pkt.text_msg) - 1) {
    size_t cut = tl;
    while (cut > 0 && (pkt.text_msg[cut - 1] & 0xC0) == 0x80) cut--;       // back to the lead byte
    if (cut > 0) {
      uint8_t lead = (uint8_t)pkt.text_msg[cut - 1];
      size_t need = lead >= 0xF0 ? 4 : lead >= 0xE0 ? 3 : lead >= 0xC0 ? 2 : 1;
      if (tl - (cut - 1) < need) pkt.text_msg[cut - 1] = '\0';           // incomplete: drop it
    }
  }

  dedupCache.markSeen(myNodeId, id);
  bool ok = transmitPacket(pkt);

  if (pktType == PKT_TYPE_TEXT || pktType == PKT_TYPE_SOS) {
    lastSendTarget = target;
    lastSendMsgId = id;
    if (target != 0) {
      pendingPkt = pkt;
      pendingRetries = 0;
      pendingSentAt = millis();
      lastSendStatus = SEND_WAITING;
    } else {
      lastSendStatus = SEND_BROADCAST;
    }
  }
  if (!loraOk) Console.println("ERR:LoRa radio not detected (check SX1278 wiring and power)");
  Log.printf("%s MsgID #%u to #%u%s: \"%s\"\n", ok ? "🚀 [TX]" : "❌ [TX FAIL]", id, target,
                target ? " (waiting for ACK)" : " (broadcast)", pkt.text_msg);
  needRedraw = true;
}

void sendAck(uint8_t to, uint16_t ackedId) {
  LoRaMeshPacket ack;
  memset(&ack, 0, sizeof(ack));
  uint16_t id = nextMsgId();
  ack.msgIdHi = id >> 8;
  ack.msgIdLo = id & 0xFF;
  ack.originNode = myNodeId;
  ack.targetNode = to;
  ack.ttl = DEFAULT_MAX_TTL;
  ack.packetType = PKT_TYPE_ACK;
  ack.battery_mv = readBatteryMv();
  snprintf(ack.text_msg, sizeof(ack.text_msg), "ACK %u", ackedId);
  dedupCache.markSeen(myNodeId, id);
  delay(random(80, 250)); // let relays of the original finish first
  transmitPacket(ack);
  Log.printf("✅ [ACK SENT] MsgID #%u to #%u\n", ackedId, to);
}

void checkPendingAck() {
  if (lastSendStatus != SEND_WAITING || millis() - pendingSentAt < ACK_TIMEOUT_MS) return;
  char name[9], line[22];
  nodeName(pendingPkt.targetNode, name, sizeof(name));
  if (pendingRetries < ACK_MAX_RETRIES) {
    pendingRetries++;
    pendingSentAt = millis();
    pendingPkt.ttl = DEFAULT_MAX_TTL;
    transmitPacket(pendingPkt); // same ID: receiver drops the copy but ACKs again
    Log.printf("🔁 [RETRY] MsgID #%u (try %u)\n", lastSendMsgId, pendingRetries + 1);
    needRedraw = true;
  } else {
    lastSendStatus = SEND_FAILED;
    Console.printf("ERR:Not delivered to node %u (no reply)\n", pendingPkt.targetNode);
    Log.printf("❌ [NOT DELIVERED] no ACK from #%u\n", pendingPkt.targetNode);
    beep(600, 250);
    snprintf(line, sizeof(line), "No reply from %s", name);
    splash("NOT DELIVERED", line, 2500);
  }
}

void saveToInbox(const LoRaMeshPacket &pkt, int rssi) {
  if (inboxCount < INBOX_CAPACITY) inboxCount++;
  for (int i = inboxCount - 1; i > 0; i--) inbox[i] = inbox[i - 1];
  ReceivedMessage &m = inbox[0];
  m.sender = pkt.originNode;
  m.target = pkt.targetNode;
  m.rssi = rssi;
  m.alertLevel = pkt.alert_level;
  m.rxTime = millis();
  strncpy(m.text, pkt.text_msg, sizeof(m.text) - 1);
  m.text[sizeof(m.text) - 1] = '\0';
  lastRx = m;
  lastRxTime = m.rxTime;
  if (unreadCount < 99) unreadCount++;
}

void processIncomingPacket(int size) {
  int rssi = LoRa.packetRssi();
  float snr = LoRa.packetSnr();
  if (size != (int)sizeof(LoRaMeshPacket)) {
    Log.printf("⚠️ [RX REJECT] %d bytes; expected 58 (sender needs the current lora_mesh_protocol.h)\n", size);
    while (LoRa.available()) LoRa.read();
    return;
  }

  LoRaMeshPacket pkt;
  LoRa.readBytes((uint8_t *)&pkt, sizeof(pkt));
  pkt.text_msg[sizeof(pkt.text_msg) - 1] = '\0';

  uint16_t id = ((uint16_t)pkt.msgIdHi << 8) | pkt.msgIdLo;
  bool isMessage = (pkt.packetType == PKT_TYPE_TEXT || pkt.packetType == PKT_TYPE_SOS) && pkt.text_msg[0];
  bool toMe = pkt.targetNode == myNodeId;

  if (dedupCache.alreadySeen(pkt.originNode, id)) {
    if (isMessage && toMe && pkt.originNode != myNodeId) sendAck(pkt.originNode, id); // our ACK was lost
    return;
  }
  dedupCache.markSeen(pkt.originNode, id);

  // Weather stations are not shown on the walkie, but logging them on USB makes the
  // walkie a handy radio check: "is station #N on the air, and how strong?"
  if (pkt.packetType == PKT_TYPE_WEATHER) {
    Log.printf("🌦  [HEARD] AWS #%u MsgID #%u | RSSI=%d SNR=%.1f | %.1fC %.1f%%\n", pkt.originNode, id, rssi, snr,
               pkt.temp_x10 / 10.0f, pkt.hum_x10 / 10.0f);
  }

  // Dashboard asks this radio to check for a firmware update (the image comes over Wi-Fi)
  if (pkt.originNode == 0 && pkt.packetType == PKT_TYPE_TEXT && !strcmp(pkt.text_msg, "OTA:CHECK") &&
      (pkt.targetNode == myNodeId || pkt.targetNode == 0)) {
    Log.println(OTA_ENABLED ? "📡 [OTA] Update check requested over LoRa"
                            : "📡 [OTA] Update requested over LoRa, but OTA is off (WALKIE_OTA not set)");
    otaCheckRequested = OTA_ENABLED;
    return;
  }

  if (pkt.originNode == myNodeId) {
    Log.println("⚠️ [DUPLICATE NODE ID] Another radio uses this ID. Use '/id <n>' to change it.");
    return;
  }

  // Delivery confirmations
  if (pkt.packetType == PKT_TYPE_ACK) {
    if (toMe) {
      uint16_t acked = (uint16_t)atol(pkt.text_msg + 4); // "ACK <id>"
      char name[9], line[22];
      nodeName(pkt.originNode, name, sizeof(name));
      Log.printf("📬 [ACK RX] #%u confirmed MsgID #%u\n", pkt.originNode, acked);
      if (lastSendStatus == SEND_WAITING && acked == lastSendMsgId && pkt.originNode == pendingPkt.targetNode) {
        lastSendStatus = SEND_DELIVERED;
        Console.printf("OK:Delivered to node %u\n", pkt.originNode);
        beep(2600, 40); delay(60); beep(3000, 60);
        snprintf(line, sizeof(line), "Read by %s", name);
        splash("DELIVERED", line);
      } else if (pkt.originNode == 0 && acked == lastSendMsgId &&
                 (lastSendStatus == SEND_BROADCAST || lastSendStatus == SEND_REACHED_BASE)) {
        lastSendStatus = SEND_REACHED_BASE;
        Console.println("OK:Reached BASE");
        beep(2600, 40);
        needRedraw = true;
      }
      return; // addressed to us: don't relay
    }
  } else if (isMessage && (pkt.targetNode == 0 || toMe)) {
    // Text / SOS for us
    Log.printf("📨 [MESSAGE] From #%u to %s | RSSI=%d SNR=%.1f\n   \"%s\"\n", pkt.originNode, toMe ? "me" : "all",
                  rssi, snr, pkt.text_msg);
    if (pkt.alert_level > 0) alarmSound();
    else beep(1400, 60);
    saveToInbox(pkt, rssi);
    emitAppRx(pkt, rssi);
    lastRxDirect = toMe;
    if (toMe) sendAck(pkt.originNode, id); // broadcasts are not ACKed by walkies
    if (screen == SCR_HOME || pkt.alert_level > 0) screen = SCR_HOME;
    needRedraw = true;
    if (toMe) return; // final destination
  }

  // Relay everything else (weather, heartbeats, messages / ACKs for other nodes)
  if (pkt.ttl > 1) {
    pkt.ttl--;
    delay(random(50, 150));
    transmitPacket(pkt);
    Log.printf("🔁 [RELAY] MsgID #%u from #%u type %u (TTL %u)\n", id, pkt.originNode, pkt.packetType, pkt.ttl);
  }
}

void triggerSos() {
  alarmSound();
  char msg[28];
  snprintf(msg, sizeof(msg), "SOS FROM NODE #%u!", myNodeId);
  sendWalkieMessage(msg, 2, PKT_TYPE_SOS, 0);
  splash("! EMERGENCY SOS !", "BROADCAST TO MESH", 2000);
}

// =================================================================================
// Buttons
// =================================================================================
enum ButtonEvent : uint8_t { BTN_NONE, BTN_SHORT, BTN_LONG };

struct Button {
  uint8_t pin;
  uint16_t longMs = 1500;
  bool last = HIGH, pressed = false, longFired = false;
  bool stuck = false; // read LOW at power-on: ignored until released (prevents false SOS)
  unsigned long since = 0;

  void begin(uint8_t p, uint16_t longPressMs = 1500, const char *name = "button") {
    pin = p;
    longMs = longPressMs;
    pinMode(pin, INPUT_PULLUP);
    delay(5);
    stuck = digitalRead(pin) == LOW;
    last = stuck ? LOW : HIGH;
    if (stuck)
      Serial.printf("⚠️ [BUTTON] %s (GPIO%u) reads pressed at power-on: ignored until released. "
                    "Check it is wired between the pin and GND.\n", name, pin);
  }

  ButtonEvent update() {
    bool raw = digitalRead(pin);
    if (stuck) {
      if (raw == HIGH) stuck = false; // released once: normal from now on
      last = raw;
      return BTN_NONE;
    }
    unsigned long now = millis();
    ButtonEvent e = BTN_NONE;
    if (raw == LOW && last == HIGH) { pressed = true; longFired = false; since = now; }
    else if (raw == LOW && pressed && !longFired && now - since >= longMs) { longFired = true; e = BTN_LONG; }
    else if (raw == HIGH && last == LOW && pressed) {
      if (!longFired && now - since >= 35) e = BTN_SHORT;
      pressed = false;
    }
    last = raw;
    return e;
  }
};
Button btnSelect, btnClick;

void onSelect() {
  beep(1800, 30);
  switch (screen) {
    case SCR_HOME: screen = SCR_MENU; menuIdx = 0; break;
    case SCR_MENU: menuIdx = (menuIdx + 1) % 5; break;
    case SCR_QUICK_SMS: presetIdx = (presetIdx + 1) % PRESET_COUNT; break;
    case SCR_INBOX: if (inboxCount) inboxIdx = (inboxIdx + 1) % inboxCount; break;
    case SCR_TARGET: targetSelIdx = (targetSelIdx + 1) % TARGET_COUNT; break;
    default: screen = SCR_HOME; break;
  }
  needRedraw = true;
}

void onClick() {
  beep(2200, 45);
  char name[9], line[22];
  switch (screen) {
    case SCR_HOME: screen = SCR_QUICK_SMS; presetIdx = 0; break;
    case SCR_MENU:
      switch (menuIdx) {
        case 0: screen = SCR_QUICK_SMS; presetIdx = 0; break;
        case 1: screen = SCR_INBOX; inboxIdx = 0; unreadCount = 0; break;
        case 2: screen = SCR_SOS_CONFIRM; break;
        case 3: screen = SCR_TARGET; targetSelIdx = targetIdx; break;
        default: screen = SCR_HOME; break;
      }
      break;
    case SCR_QUICK_SMS:
      if (presetIdx == PRESET_COUNT - 1) { screen = SCR_HOME; break; }
      sendWalkieMessage(PRESETS[presetIdx], 0, PKT_TYPE_TEXT, TARGETS[targetIdx]);
      if (TARGETS[targetIdx] == 0) splash("SENT TO ALL", "No reply expected");
      else {
        nodeName(TARGETS[targetIdx], name, sizeof(name));
        snprintf(line, sizeof(line), "to %s, wait ACK", name);
        splash("SENDING...", line);
      }
      return;
    case SCR_INBOX: screen = SCR_HOME; break;
    case SCR_TARGET:
      targetIdx = targetSelIdx;
      nodeName(TARGETS[targetIdx], name, sizeof(name));
      snprintf(line, sizeof(line), "Now: %s", TARGETS[targetIdx] == 0 ? "ALL" : name);
      splash("TARGET UPDATED", line);
      return;
    case SCR_SOS_CONFIRM: triggerSos(); return;
    case SCR_SPLASH: screen = SCR_HOME; break;
  }
  needRedraw = true;
}

// =================================================================================
// Serial commands
// =================================================================================
void printHelp() {
  Console.printf("\n=== FLAPMAIN ESP32 WALKIE #%u ===\n", myNodeId);
  Console.println(" <text>          send to current target (0 = all)");
  Console.println(" <text> /102     send direct to node 102");
  Console.println(" /sos [text]     emergency SOS broadcast");
  Console.println(" /target <n>     set target (0 = all)");
  Console.println(" /id <n>         change this node's ID (1..255)");
  Console.println(" /inbox          list received messages");
  Console.println(" /ping           heartbeat to target");
  Console.println(" /status         one-line status (for apps)");
  Console.println(" /pair           allow a new phone to pair (also: hold SELECT 3 s)");
  Console.println(" /unpair         forget all paired phones");
  Console.println(" /ble            Bluetooth + radio state (for troubleshooting)");
  Console.println(" /i2c            scan the display's I2C bus");
  Console.println(" /debug on|off   also send the debug log over Bluetooth");
  Console.println(" /ota            check the dashboard for a firmware update (over Wi-Fi)");
  Console.println(" s / c           simulate SELECT / CLICK");
  Console.println(" App protocol: PING | LORA:MSG <text> | LORA:LOC lat,lon,acc");
  Console.println("               LORA:SOS <TYPE> [lat,lon,acc] | LORA:SOS CANCEL");
  Console.println("==================================\n");
}

// ---- App protocol (same as the flaap.me Hardware page / mobile app) ----
//   in:  PING | LORA:MSG text | LORA:LOC lat,lon,acc | LORA:SOS TYPE [lat,lon,acc] | LORA:SOS CANCEL
//   out: PONG | READY node=N | OK:... | ERR:... | RX:MSG|LOC|SOS|SOS-CANCEL node=N rssi=R ...
// Over the air: LOC / SOS / cancel travel as text "LOC:lat,lon,acc", "SOS:TYPE lat,lon,acc", "SOS-CANCEL".
#define SOS_REPEAT_MS   30000UL        // re-broadcast an active SOS every 30 s
#define SOS_MAX_MS      (10UL * 60000) // ...for at most 10 minutes unless cancelled
static const char *SOS_TYPES[] = {"GENERAL", "MEDICAL", "FIRE", "ACCIDENT", "LOST", "SECURITY"};

bool sosActive = false;
char sosText[32];
unsigned long sosStartedAt = 0, sosNextAt = 0;

// "lat,lon,acc" -> fixed precision that fits the 31-character packet text; false if invalid.
bool formatFix(const char *in, char *out, size_t n, uint8_t decimals) {
  double lat, lon, acc = 0;
  int got = sscanf(in, "%lf , %lf , %lf", &lat, &lon, &acc);
  if (got < 2 || lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  snprintf(out, n, "%.*f,%.*f,%d", decimals, lat, decimals, lon, (int)constrain(acc, 0, 999));
  return true;
}

void sendSosPacket() {
  sendWalkieMessage(sosText, 2, PKT_TYPE_SOS, 0);
  sosNextAt = millis() + SOS_REPEAT_MS;
}

void openPairingWindow() {
  pairWindowUntil = millis() + BLE_PAIR_WINDOW_MS;
  Log.printf("[BLE] Pairing window open for %lus\n", (unsigned long)(BLE_PAIR_WINDOW_MS / 1000));
  beep(2400, 60); delay(80); beep(2400, 60);
  splash("BT PAIRING OPEN", "Pair from the app", 2500);
}

// Forget every paired phone (they must pair again during a pairing window).
void forgetBondedPhones() {
#if BLE_ENABLED && defined(CONFIG_BLUEDROID_ENABLED)
  int n = esp_ble_get_bond_device_num();
  if (n > 0) {
    esp_ble_bond_dev_t *list = (esp_ble_bond_dev_t *)malloc(sizeof(esp_ble_bond_dev_t) * n);
    if (list && esp_ble_get_bond_device_list(&n, list) == ESP_OK)
      for (int i = 0; i < n; i++) esp_ble_remove_bond_device(list[i].bd_addr);
    free(list);
  }
  Log.printf("[BLE] Forgot %d paired phone(s)\n", n < 0 ? 0 : n);
#endif
}

bool handleAppCommand(char *s) {
  if (!strcasecmp(s, "PING")) {
    appMode = true;
    Console.println("PONG");
    Console.printf("READY node=%u\n", myNodeId);
    return true;
  }
  if (strncasecmp(s, "LORA:", 5)) return false;
  appMode = true;
  char *cmd = s + 5;

  if (!strncasecmp(cmd, "MSG", 3)) {
    char *t = cmd + 3;
    while (*t == ' ') t++;
    if (!*t) { Console.println("ERR:Empty message"); return true; }
    sendWalkieMessage(t, 0, PKT_TYPE_TEXT, TARGETS[targetIdx]);
    Console.println("OK:MSG");
    return true;
  }

  if (!strncasecmp(cmd, "LOC", 3)) {
    char fix[28], text[32];
    if (!formatFix(cmd + 3, fix, sizeof(fix), 5)) { Console.println("ERR:Bad location (lat,lon,acc)"); return true; }
    snprintf(text, sizeof(text), "LOC:%s", fix);
    sendWalkieMessage(text, 0, PKT_TYPE_TEXT, 0);
    Console.printf("OK:LOC %s\n", fix);
    return true;
  }

  if (!strncasecmp(cmd, "SOS", 3)) {
    char *arg = cmd + 3;
    while (*arg == ' ') arg++;
    if (!strncasecmp(arg, "CANCEL", 6)) {
      bool was = sosActive;
      sosActive = false;
      sendWalkieMessage("SOS-CANCEL", 0, PKT_TYPE_TEXT, 0);
      Console.println("OK:SOS-CANCEL");
      if (was) splash("SOS CANCELLED", "Sent to mesh");
      return true;
    }
    // TYPE [lat,lon,acc]
    char type[10] = "GENERAL";
    char *coords = strchr(arg, ' ');
    size_t tl = coords ? (size_t)(coords - arg) : strlen(arg);
    for (const char *t : SOS_TYPES)
      if (tl == strlen(t) && !strncasecmp(arg, t, tl)) { strcpy(type, t); break; }
    sosText[0] = '\0';
    if (coords) {
      while (*coords == ' ') coords++;
      // Prefer 5 decimals (~1 m), fall back to 4 (~11 m), then no location, to fit 31 chars.
      for (uint8_t d = 5; d >= 4 && !sosText[0]; d--) {
        char fix[28];
        if (formatFix(coords, fix, sizeof(fix), d) && strlen(type) + 5 + strlen(fix) <= 31)
          snprintf(sosText, sizeof(sosText), "SOS:%s %s", type, fix);
      }
    }
    if (!sosText[0]) snprintf(sosText, sizeof(sosText), "SOS:%s", type);
    sosActive = true;
    sosStartedAt = millis();
    alarmSound();
    sendSosPacket();
    Console.printf("OK:SOS-SENT %s\n", type);
    splash("! SOS BROADCAST !", type, 3000);
    return true;
  }

  Console.println("ERR:Unknown command");
  return true;
}

// Repeat an active SOS until cancelled or SOS_MAX_MS has passed.
void serviceSos() {
  if (!sosActive || (long)(millis() - sosNextAt) < 0) return;
  if (millis() - sosStartedAt >= SOS_MAX_MS) {
    sosActive = false;
    Console.println("OK:SOS stopped after 10 minutes");
    return;
  }
  sendSosPacket();
}

// One RX: line per received message, in the app's format.
void emitAppRx(const LoRaMeshPacket &pkt, int rssi) {
  const char *t = pkt.text_msg;
  if (!strncmp(t, "LOC:", 4)) {
    Console.printf("RX:LOC node=%u rssi=%d %s\n", pkt.originNode, rssi, t + 4);
  } else if (!strcmp(t, "SOS-CANCEL")) {
    Console.printf("RX:SOS-CANCEL node=%u rssi=%d\n", pkt.originNode, rssi);
  } else if (pkt.packetType == PKT_TYPE_SOS || pkt.alert_level > 0) {
    // From the app protocol ("SOS:TYPE lat,lon,acc") or a button SOS from any walkie
    if (!strncmp(t, "SOS:", 4)) Console.printf("RX:SOS node=%u rssi=%d %s\n", pkt.originNode, rssi, t + 4);
    else Console.printf("RX:SOS node=%u rssi=%d GENERAL\n", pkt.originNode, rssi);
  } else {
    Console.printf("RX:MSG node=%u rssi=%d %s\n", pkt.originNode, rssi, t);
  }
}

void handleSerialLine(char *s) {
  if (handleAppCommand(s)) return;
  if (!strcasecmp(s, "/help")) printHelp();
  else if (!strcasecmp(s, "/pair")) openPairingWindow();
  else if (!strcasecmp(s, "/debug on")) { appMode = false; Console.println("OK:Debug log on Bluetooth"); }
  else if (!strcasecmp(s, "/debug off")) { appMode = true; Console.println("OK:Debug log USB only"); }
  else if (!strcasecmp(s, "/i2c")) {
    i2cScan(oledSda, oledScl);
    if (oledPresent) { Wire.end(); Wire.begin(oledSda, oledScl, 400000); needRedraw = true; }
  }
  else if (!strcasecmp(s, "/ble")) {
    long left = (long)(pairWindowUntil - millis());
    Console.printf("BLE enabled=%d mode=%d connected=%d secure=%d paired_phones=%d new_phone_allowed=%d window_s=%ld lora=%d\n",
                   BLE_ENABLED, BLE_PAIRING, bleConnected ? 1 : 0, bleSecure ? 1 : 0, bondedPhoneCount(),
                   pairWindowOpen() ? 1 : 0, left > 0 ? left / 1000 : 0, loraOk ? 1 : 0);
  }
  else if (!strcasecmp(s, "/unpair")) forgetBondedPhones();
  else if (!strcasecmp(s, "/ota")) {
    if (OTA_ENABLED) { otaCheckRequested = true; Console.println("OK:Checking for firmware update"); }
    else Console.println("ERR:OTA is off (set WALKIE_OTA 1 in secrets.h, Minimal SPIFFS partition, rebuild)");
  }
  else if (!strcasecmp(s, "s")) onSelect();
  else if (!strcasecmp(s, "c")) onClick();
  else if (!strncasecmp(s, "/id ", 4)) {
    int v = atoi(s + 4);
    if (v >= 1 && v <= 255) { myNodeId = v; Log.printf("🆔 Node ID is now #%u\n", myNodeId); needRedraw = true; }
    else Log.println("❌ ID must be 1..255");
  } else if (!strncasecmp(s, "/target ", 8)) {
    int v = atoi(s + 8);
    for (uint8_t i = 0; i < TARGET_COUNT; i++)
      if (TARGETS[i] == v) { targetIdx = i; Log.printf("🎯 Target #%d\n", v); needRedraw = true; return; }
    Log.println("❌ Target not in list (0, 101-104). Use 'text /<n>' for other nodes.");
  } else if (!strcasecmp(s, "/inbox")) {
    for (uint8_t i = 0; i < inboxCount; i++) {
      char age[6];
      formatAge(inbox[i].rxTime, age, sizeof(age));
      Log.printf(" %u. #%u>%s %s ago %ddBm \"%s\"\n", i + 1, inbox[i].sender, inbox[i].target ? "me" : "all", age,
                    inbox[i].rssi, inbox[i].text);
    }
    if (!inboxCount) Log.println(" (empty)");
  } else if (!strcasecmp(s, "/status")) {
    static const char *st[] = {"none", "sending", "delivered", "failed", "broadcast", "reached_base"};
    Console.printf("STATUS node=%u batt=%u unread=%u inbox=%u target=%u last=%s last_to=%u ble=%u lora=%u\n", myNodeId,
                   readBatteryMv(), unreadCount, inboxCount, TARGETS[targetIdx], st[lastSendStatus], lastSendTarget,
                   bleConnected ? 1 : 0, loraOk ? 1 : 0);
  } else if (!strcasecmp(s, "/ping")) sendWalkieMessage("PING HEARTBEAT", 0, PKT_TYPE_HEARTBEAT, TARGETS[targetIdx]);
  else if (!strncasecmp(s, "/sos", 4)) {
    char *t = s + 4;
    while (*t == ' ') t++;
    sendWalkieMessage(*t ? t : "CRITICAL EMERGENCY SOS!", 2, PKT_TYPE_SOS, 0);
  } else sendWalkieMessage(s, 0, PKT_TYPE_TEXT, TARGETS[targetIdx]);
}

// Collects characters into lines; one per input source so they never interleave.
struct LineInput {
  char buf[96];
  uint8_t n = 0;
  unsigned long lastByte = 0;

  void feed(char c) {
    lastByte = millis();
    if (c == '\n' || c == '\r') { finish(); return; }
    if (n < sizeof(buf) - 1) buf[n++] = c;
  }
  void finish() {
    buf[n] = '\0';
    if (n) handleSerialLine(buf);
    n = 0;
  }
  // A BLE write without a trailing newline still counts as one line after a short pause.
  void idleFlush(unsigned long ms) { if (n && millis() - lastByte > ms) finish(); }
};
LineInput serialIn, bleIn;

void pollSerial() {
  while (Serial.available()) serialIn.feed((char)Serial.read());
  serialIn.idleFlush(700); // Serial Monitor set to "No line ending" still works
#if BLE_ENABLED
  char c;
  while (bleInQueue && xQueueReceive(bleInQueue, &c, 0) == pdTRUE) bleIn.feed(c);
  bleIn.idleFlush(300);
#endif
}

#if BLE_ENABLED
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *) override {
    bleConnected = true;
    bleSecure = !BLE_REQUIRE_PAIRING;
    bleJustConnected = bleSecure;
  }
#if BLE_REQUIRE_PAIRING && defined(CONFIG_BLUEDROID_ENABLED)
  // Pairing is normally started by the phone: its first write needs encryption, and Android then
  // pairs on its own. If the link is still not secure after 3 s, loop() asks the phone to pair.
  void onConnect(BLEServer *, esp_ble_gatts_cb_param_t *param) override {
    bleConnId = param->connect.conn_id;
    memcpy(bleRemoteBda, param->connect.remote_bda, 6);
    bleConnectedAt = millis();
    bleSecRequested = false;
    const uint8_t *a = param->connect.remote_bda;
    Serial.printf("[BLE] Phone connected %02X:%02X:%02X:%02X:%02X:%02X; waiting for it to pair\n", a[0], a[1], a[2], a[3], a[4], a[5]);
  }
#endif
  void onDisconnect(BLEServer *) override {
    Serial.println("[BLE] Phone disconnected; advertising again");
    bleConnected = false;
    bleSecure = false;
    appMode = true;
    blePasskey = 0;
    BLEDevice::startAdvertising(); // allow the next phone to connect
  }
};

class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *ch) override {
    auto v = ch->getValue(); // std::string on core 2.x, String on core 3.x
    for (size_t i = 0; i < v.length(); i++) {
      char c = v[i];
      xQueueSend(bleInQueue, &c, 0);
    }
  }
};

class PairingCallbacks : public BLESecurityCallbacks {
  uint32_t onPassKeyRequest() override { return 0; } // we display the code, never type one
  void onPassKeyNotify(uint32_t key) override { blePasskey = key; }
  bool onSecurityRequest() override {
    bool ok = pairWindowOpen();
    if (!ok) pairRejectedLocked = true;
    return ok;
  }
  bool onConfirmPIN(uint32_t) override { return false; } // numeric comparison not used
#if defined(CONFIG_BLUEDROID_ENABLED)
  void onAuthenticationComplete(esp_ble_auth_cmpl_t r) override {
    blePasskey = 0;
    if (r.success) {
      bleSecure = true;
      bleJustConnected = true;
      Serial.println("[BLE] Link secured (paired / encrypted)");
    } else {
      // Forget our side of a stale pairing so the next attempt starts fresh.
      esp_ble_remove_bond_device(r.bd_addr);
      const char *why;
      switch (r.fail_reason) {
        case 0x63: why = "the phone did not answer: tap Pair on the phone's dialog or notification"; break;
        case 0x50: case 0x52: why = "the phone refused or does not support this pairing mode"; break;
        case 0x55: case 0x61: why = "stale pairing: remove FlapWalkie in the phone's Bluetooth settings"; break;
        case 0x56: why = "too many attempts: wait a minute, then try again"; break;
        default: why = "remove FlapWalkie in the phone's Bluetooth settings and try again"; break;
      }
      Serial.printf("[BLE] Pairing failed (reason 0x%02X): %s\n", r.fail_reason, why);
      bleAuthFailed = true;
    }
  }
#endif
#if defined(CONFIG_NIMBLE_ENABLED)
  void onAuthenticationComplete(ble_gap_conn_desc *) override { blePasskey = 0; bleSecure = true; bleJustConnected = true; }
#endif
};

void setupBle() {
  bleInQueue = xQueueCreate(512, sizeof(char));
  char name[20];
  snprintf(name, sizeof(name), "FlapWalkie-%u", myNodeId);
  BLEDevice::init(name);
  BLEDevice::setMTU(185);

#if BLE_REQUIRE_PAIRING
  // Written to compile on ESP32 Arduino core 2.0.x and 3.x.
  BLEDevice::setSecurityCallbacks(new PairingCallbacks());
  BLESecurity *sec = new BLESecurity();
#if BLE_PAIRING == 2
  sec->setAuthenticationMode(ESP_LE_AUTH_REQ_SC_MITM_BOND); // bond, MITM protection, secure connections
  sec->setCapability(ESP_IO_CAP_OUT);                       // we show the code; the phone types it
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  BLESecurity::setPassKey(false); // core 3.x would otherwise use the fixed passkey 123456
#endif
#else
  sec->setAuthenticationMode(ESP_LE_AUTH_REQ_SC_BOND); // bond + secure connections, no PIN ("Just Works")
  sec->setCapability(ESP_IO_CAP_NONE);
#endif
  sec->setInitEncryptionKey(ESP_BLE_ENC_KEY_MASK | ESP_BLE_ID_KEY_MASK);
  sec->setRespEncryptionKey(ESP_BLE_ENC_KEY_MASK | ESP_BLE_ID_KEY_MASK);
#endif

  bleServer = BLEDevice::createServer();
  bleServer->setCallbacks(new ServerCallbacks());
  BLEService *svc = bleServer->createService(NUS_SERVICE_UUID);

  bleTx = svc->createCharacteristic(NUS_TX_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  BLE2902 *cccd = new BLE2902();
  bleTx->addDescriptor(cccd);

  BLECharacteristic *rx = svc->createCharacteristic(
      NUS_RX_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  rx->setCallbacks(new RxCallbacks());

#if BLE_REQUIRE_PAIRING && defined(CONFIG_BLUEDROID_ENABLED)
  // Only a paired (encrypted, MITM-protected) phone may send. Subscribing is allowed before
  // pairing so apps that enable notifications right after connecting keep working; nothing is
  // notified until the link is encrypted (see DualConsole / bleSecure).
  rx->setAccessPermissions(BLE_PAIRING == 2 ? ESP_GATT_PERM_WRITE_ENC_MITM : ESP_GATT_PERM_WRITE_ENCRYPTED);
  (void)cccd;
#endif

  svc->start();
  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(NUS_SERVICE_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
  static const char *modes[] = {"OFF (open)", "Just Works (no PIN)", "passkey on OLED"};
  Log.printf("[BLE] Advertising as \"%s\" (Nordic UART, pairing: %s; new phones for %lus or after holding SELECT 3s)\n",
             name, modes[BLE_PAIRING], (unsigned long)(BLE_PAIR_WINDOW_MS / 1000));
}
#endif

// =================================================================================
// LoRa radio start (retried from loop() until the SX1278 answers)
// =================================================================================
bool initLora() {
  if (!LoRa.begin(LORA_FREQUENCY)) {
    loraOk = false;
    loraRetryAt = millis() + 10000;
    Log.printf("❌ [LORA] SX1278 not found. Check: VCC=3.3V GND SCK=%d MISO=%d MOSI=%d CS=%d RST=%d DIO0=%d. Retrying in 10 s\n",
               LORA_SCK_PIN, LORA_MISO_PIN, LORA_MOSI_PIN, LORA_SS_PIN, LORA_RST_PIN, LORA_DIO0_PIN);
    needRedraw = true;
    return false;
  }
  LoRa.setSpreadingFactor(LORA_SPREADING_FACTOR);
  LoRa.setSignalBandwidth(LORA_BANDWIDTH);
  LoRa.setCodingRate4(LORA_CODING_RATE);
  LoRa.setTxPower(LORA_TX_POWER);
  LoRa.setSyncWord(LORA_SYNC_WORD);
  LoRa.enableCrc();
  LoRa.receive();
  loraOk = true;
  Log.printf("✅ [LORA] SX1278 online: %.0f MHz SF%d sync 0x%02X\n", LORA_FREQUENCY / 1e6, LORA_SPREADING_FACTOR, LORA_SYNC_WORD);
  needRedraw = true;
  return true;
}

// =================================================================================
// Setup / loop
// =================================================================================
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.printf("\n[BOOT] FlapMain ESP32 walkie v" FLAP_FW_VERSION " #%u starting (type /help, Serial Monitor at 115200)\n", WALKIE_NODE_ID);
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);
  btnSelect.begin(BTN_SELECT_PIN, 3000, "SELECT"); // hold 3 s: open the Bluetooth pairing window
  btnClick.begin(BTN_CLICK_PIN, 1500, "CLICK");     // hold 1.5 s: SOS
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  msgCounter = (uint16_t)(esp_random() % 60000) + 1; // random start: no false duplicates after reboot
  randomSeed(esp_random());

  oledPresent = display.begin();
  if (oledPresent) {
    display.setTextColor(1, 0);
    display.setCursor(0, 16); display.print("FLAPMAIN LORA MESH");
    display.setCursor(0, 28); display.printf("ESP32 WALKIE #%u", myNodeId);
    display.setCursor(0, 40); display.print("Starting...");
    display.show();
  } else {
    Log.println("[OLED] not found on I2C 0x3C/0x3D (continuing without display)");
  }

  SPI.begin(LORA_SCK_PIN, LORA_MISO_PIN, LORA_MOSI_PIN, LORA_SS_PIN);
  LoRa.setSPI(SPI);
  LoRa.setPins(LORA_SS_PIN, LORA_RST_PIN, LORA_DIO0_PIN);
  LoRa.setSPIFrequency(4000000);
  initLora(); // a missing radio no longer stops the walkie: serial + Bluetooth keep working

#if BLE_ENABLED
  setupBle();
#endif

  beep(2000, 60);
  printHelp();
  needRedraw = true;
}

void loop() {
#if OTA_ENABLED
  if (otaCheckRequested) {
    otaCheckRequested = false;
    static bool otaStarted = false;
    if (!otaStarted) {
      char otaId[32];
      snprintf(otaId, sizeof(otaId), "node-%u", myNodeId);
      FlapOta::onBeforeUpdate([]() { LoRa.sleep(); splash("UPDATING", "do not power off"); });
      FlapOta::begin(OTA_SERVER, otaId, OTA_DEVICE_KEY, myNodeId);
      otaStarted = true;
    }
    if (loraOk) LoRa.idle();
    if (!FlapOta::checkWithWifi(OTA_WIFI_SSID, OTA_WIFI_PASSWORD)) Console.println("OK:No firmware update");
    if (loraOk) LoRa.receive();
  }
#endif
  if (loraOk) {
    int size = LoRa.parsePacket();
    if (size > 0) {
      processIncomingPacket(size);
      LoRa.receive();
    }
  } else if ((long)(millis() - loraRetryAt) >= 0) {
    initLora();
  }

  ButtonEvent s = btnSelect.update();
  ButtonEvent c = btnClick.update();
  if (s == BTN_SHORT) onSelect();
  if (s == BTN_LONG) openPairingWindow();
  if (c == BTN_SHORT) onClick();
  if (c == BTN_LONG) { Log.println("🚨 [BUTTON] long press -> SOS"); triggerSos(); }

  checkPendingAck();
  pollSerial();

  // BLE: show the pairing code while a phone pairs; greet once connected.
  static uint32_t shownKey = 0;
  if (blePasskey && blePasskey != shownKey) {
    shownKey = blePasskey;
    char code[8];
    snprintf(code, sizeof(code), "%06lu", (unsigned long)blePasskey);
    Serial.printf("[BLE] Pairing code: %s\n", code); // USB only: never send the code over BLE
    beep(2400, 80);
    splash("BLE PAIRING CODE", code, 30000);
  } else if (!blePasskey && shownKey) {
    shownKey = 0;
    if (screen == SCR_SPLASH) { screen = SCR_HOME; needRedraw = true; }
  }
  if (bleJustConnected && bleSecure) {
    bleJustConnected = false;
    delay(300); // give the phone time to subscribe to notifications
    Console.printf("READY node=%u\n", myNodeId);
    needRedraw = true;
  }
#if BLE_ENABLED
  if (bleAuthFailed) {
    bleAuthFailed = false;
    Serial.println(pairRejectedLocked ? "[BLE] New phone refused: pairing window closed (hold SELECT 3 s)"
                                      : "[BLE] Pairing failed or was rejected; disconnecting");
    if (bleServer) bleServer->disconnect(bleConnId);
    if (pairRejectedLocked) splash("PAIRING LOCKED", "Hold SELECT 3s", 3000);
    else splash("PAIRING FAILED", "Try again", 2500);
    pairRejectedLocked = false;
  }
#endif
  serviceSos();

#if BLE_ENABLED && BLE_PAIRING > 0 && defined(CONFIG_BLUEDROID_ENABLED)
  // Phone connected but has not paired after 3 s: ask it to (Android shows "Pair with FlapWalkie?").
  if (bleConnected && !bleSecure && !bleSecRequested && millis() - bleConnectedAt > 3000) {
    bleSecRequested = true;
    Serial.println("[BLE] Asking the phone to pair: tap Pair on the phone");
    esp_ble_set_encryption(bleRemoteBda, BLE_PAIRING == 2 ? ESP_BLE_SEC_ENCRYPT_MITM : ESP_BLE_SEC_ENCRYPT);
  }
#endif

  if (screen == SCR_SPLASH && (long)(millis() - splashUntil) >= 0) { screen = SCR_HOME; needRedraw = true; }

  static unsigned long lastRefresh = 0;
  if (screen == SCR_HOME && millis() - lastRefresh > 3000) { lastRefresh = millis(); needRedraw = true; } // battery, ages
  if (needRedraw) drawScreen();

  delay(5);
}
