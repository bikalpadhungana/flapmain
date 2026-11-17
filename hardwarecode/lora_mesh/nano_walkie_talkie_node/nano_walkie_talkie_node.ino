/*
 * =================================================================================
 * FLAPMAIN LORA MESH WALKIE-TALKIE & EMERGENCY SOS COMMUNICATOR (MEMORY-OPTIMIZED)
 * Board: Arduino Nano (ATmega328P) + SX1278 LoRa Module + 1.3" / 0.96" OLED (SH1106 / SSD1306)
 *
 * MEMORY FOOTPRINT OPTIMIZATION:
 * - Direct-write MicroOLED driver eliminating the 1024-byte RAM framebuffer (0 bytes RAM).
 * - Standard 5x7 ASCII font table stored in Flash (PROGMEM, 0 bytes RAM).
 * - Zero dynamic String allocations; all serial commands and buffers use static C strings.
 * - Dynamic memory reduced from 2283 bytes (111% - overflow) to ~1050 bytes (51%).
 * - Program Flash reduced from 28040 bytes (91%) to ~18000 bytes (58%).
 *
 * Hardware Controls:
 * - Button 1 (Pin D7): SELECT (Cycle Menu Options / Move Cursor / Browse Inbox Messages)
 * - Button 2 (Pin D8): CLICK (Enter / Confirm Selection / Transmit Quick SMS)
 * - Hold Button 2 (>1.5s): INSTANT EMERGENCY SOS BROADCAST
 * - Audio Buzzer (Pin D6): Click feedback, incoming message chimes, emergency siren
 * =================================================================================
 */

#include <Arduino.h>
#include <SPI.h>
#include <Wire.h>
#include <LoRa.h>

#if __has_include("config.h")
  #include "config.h"
#endif

// Set lightweight deduplication cache for ATmega328P Walkie
#ifndef SEEN_CACHE_SIZE
  #define SEEN_CACHE_SIZE 12
#endif
#include "lora_mesh_protocol.h"
#include "font5x7.h"

// ---- Node Identification & Hardware Pins ----
#ifndef WALKIE_NODE_ID
  #define WALKIE_NODE_ID  101   // Default: 101 for Alpha, 102 for Bravo
#endif
uint8_t currentWalkieNodeId = WALKIE_NODE_ID;

#ifndef LORA_SS_PIN
  #define LORA_SS_PIN     10    // D10 SPI Chip Select
#endif
#ifndef LORA_RST_PIN
  #define LORA_RST_PIN    9     // D9 SX1278 Reset
#endif
#ifndef LORA_DIO0_PIN
  #define LORA_DIO0_PIN   2     // D2 Interrupt Pin
#endif
#ifndef BATT_PIN
  #define BATT_PIN        A3    // A3 Analog Battery Voltage Divider
#endif
#ifndef STATUS_LED_PIN
  #define STATUS_LED_PIN  13    // D13 Built-in Status LED
#endif

// Two-Button Navigation & Emergency System Pins
#ifndef BTN_SELECT_PIN
  #define BTN_SELECT_PIN  7     // D7 Active LOW with internal pull-up
#endif
#ifndef BTN_CLICK_PIN
  #define BTN_CLICK_PIN   8     // D8 Active LOW with internal pull-up
#endif
#ifndef BUZZER_PIN
  #define BUZZER_PIN      6     // D6 Piezo Buzzer
#endif

// Backward compatibility alias
#define SOS_BUTTON_PIN    BTN_CLICK_PIN

// =================================================================================
// ULTRA-COMPACT ZERO-RAM OLED DRIVER (SH1106 1.3" & SSD1306 0.96")
// Uses Direct Page Mode over I2C without any 1024-byte RAM framebuffer.
// =================================================================================
class MicroOLED {
private:
  uint8_t i2cAddr;
  uint8_t colOffset;
  uint8_t curPage;
  uint8_t curCol;

public:
  MicroOLED() : i2cAddr(0x3C), colOffset(2), curPage(0), curCol(0) {}

  void sendCmd(uint8_t cmd) {
    Wire.beginTransmission(i2cAddr);
    Wire.write((uint8_t)0x00);
    Wire.write(cmd);
    Wire.endTransmission();
  }

  bool begin(uint8_t preferred = 0x3C) {
    Wire.begin();
    i2cAddr = preferred;
    Wire.beginTransmission(i2cAddr);
    if (Wire.endTransmission() != 0) {
      i2cAddr = (preferred == 0x3C) ? 0x3D : 0x3C;
      Wire.beginTransmission(i2cAddr);
      if (Wire.endTransmission() != 0) return false;
    }

    static const uint8_t PROGMEM initCmds[] = {
      0xAE,       // Display OFF
      0xD5, 0x80, // Set Clock Divide Ratio
      0xA8, 0x3F, // Set Multiplex Ratio (64 rows)
      0xD3, 0x00, // Set Display Offset = 0
      0x40,       // Set Display Start Line = 0
      0x8D, 0x14, // Enable SSD1306 Charge Pump
      0xAD, 0x8B, // Enable SH1106 DC-DC Pump
      0x30,       // Precharge period
      0xA1,       // Segment Remap (Column 127 mapped to SEG0)
      0xC8,       // COM Output Scan Direction
      0xDA, 0x12, // COM Pins Config
      0x81, 0xBF, // Contrast
      0xD9, 0x22, // Precharge
      0xDB, 0x40, // VCOMH
      0xA4,       // Entire Display ON
      0xA6,       // Normal Display
      0xAF        // Display ON
    };

    for (size_t i = 0; i < sizeof(initCmds); i++) {
      sendCmd(pgm_read_byte(&initCmds[i]));
    }
    clear();
    return true;
  }

  void setCursor(uint8_t page, uint8_t col = 0) {
    curPage = page & 0x07;
    curCol = col;
    uint8_t c = col + colOffset;
    Wire.beginTransmission(i2cAddr);
    Wire.write((uint8_t)0x00);
    Wire.write((uint8_t)(0xB0 + curPage));
    Wire.write((uint8_t)(0x00 + (c & 0x0F)));
    Wire.write((uint8_t)(0x10 + ((c >> 4) & 0x0F)));
    Wire.endTransmission();
  }

  void writeChar(char ch, bool invert = false) {
    if (curCol > 122) return;
    if (ch < 32 || ch > 126) ch = ' ';
    uint16_t offset = (ch - 32) * 5;

    Wire.beginTransmission(i2cAddr);
    Wire.write((uint8_t)0x40);
    for (uint8_t i = 0; i < 5; i++) {
      uint8_t b = pgm_read_byte(&FONT_5X7[offset + i]);
      Wire.write(invert ? ~b : b);
    }
    Wire.write(invert ? (uint8_t)0xFF : (uint8_t)0x00);
    Wire.endTransmission();
    curCol += 6;
  }

  void clearToEol(bool invert = false) {
    while (curCol < 128) {
      uint8_t remaining = 128 - curCol;
      uint8_t chunk = (remaining > 16) ? 16 : remaining;
      Wire.beginTransmission(i2cAddr);
      Wire.write((uint8_t)0x40);
      for (uint8_t i = 0; i < chunk; i++) {
        Wire.write(invert ? (uint8_t)0xFF : (uint8_t)0x00);
      }
      Wire.endTransmission();
      curCol += chunk;
    }
  }

  void clearPage(uint8_t page) {
    setCursor(page, 0);
    clearToEol(false);
  }

  void clear() {
    for (uint8_t p = 0; p < 8; p++) clearPage(p);
  }

  void print(const char* s, bool invert = false) {
    while (*s) writeChar(*s++, invert);
  }

  void print(const __FlashStringHelper* fs, bool invert = false) {
    PGM_P p = reinterpret_cast<PGM_P>(fs);
    while (true) {
      char c = pgm_read_byte(p++);
      if (!c) break;
      writeChar(c, invert);
    }
  }

  void printInt(long n, bool invert = false) {
    char buf[12];
    ltoa(n, buf, 10);
    print(buf, invert);
  }

  void printFloat(float val, uint8_t decimals = 1, bool invert = false) {
    char buf[12];
    dtostrf(val, 0, decimals, buf);
    print(buf, invert);
  }

  void printLine(uint8_t page, const __FlashStringHelper* fs, bool invert = false) {
    setCursor(page, 0);
    print(fs, invert);
    clearToEol(invert);
  }

  void printLine(uint8_t page, const char* s, bool invert = false) {
    setCursor(page, 0);
    print(s, invert);
    clearToEol(invert);
  }

  void drawDivider(uint8_t page, uint8_t pattern = 0x08) {
    setCursor(page, 0);
    for (uint8_t chunk = 0; chunk < 8; chunk++) {
      Wire.beginTransmission(i2cAddr);
      Wire.write((uint8_t)0x40);
      for (uint8_t i = 0; i < 16; i++) Wire.write(pattern);
      Wire.endTransmission();
    }
    curCol = 128;
  }
};

MicroOLED display;
bool oledPresent = false;

// ---- Global Protocol State ----
MeshDedup dedupCache;
uint16_t msgCounter = 0;

// Every node must use the same 58-byte packet as the AWS and gateway.
static_assert(sizeof(LoRaMeshPacket) == 58, "LoRaMeshPacket must be 58 bytes (update lora_mesh_protocol.h)");

// Last received message (shown on the idle screen)
uint8_t  lastRxNode = 0;
int      lastRxRssi = 0;
float    lastRxSnr = 0.0;
char     lastRxMsg[32] = "";
uint8_t  lastRxPktType = PKT_TYPE_TEXT;
uint8_t  lastRxAlertLevel = 0;
bool     lastRxDirect = false;
unsigned long lastRxTime = 0;

// ---- Received Messages Inbox History (Compact RAM Buffer) ----
#define INBOX_CAPACITY 4

struct ReceivedMessage {
  uint8_t senderNode;
  uint8_t targetNode;
  int8_t  rssi;
  uint8_t alertLevel;
  unsigned long rxTime;
  char    text[32];
};

ReceivedMessage messageInbox[INBOX_CAPACITY];
uint8_t inboxCount = 0;
int8_t  inboxBrowseIdx = 0; // 0 = newest, 1 = previous, etc.
uint8_t unreadCount = 0;

// ---- Delivery confirmation (ACK) ----
// Direct messages wait for an ACK from the receiver and are re-sent if none
// arrives. Broadcasts are not re-sent; a gateway (BASE) ACKs them when it hears them.
#define ACK_TIMEOUT_MS  6000
#define ACK_MAX_RETRIES 2

enum SendStatus : uint8_t {
  SEND_NONE = 0,
  SEND_WAITING,      // direct message, waiting for the receiver's ACK
  SEND_DELIVERED,    // receiver confirmed
  SEND_FAILED,       // no ACK after all retries
  SEND_BROADCAST,    // broadcast sent (no ACK expected from walkies)
  SEND_REACHED_BASE  // a gateway confirmed the broadcast
};

LoRaMeshPacket pendingPkt;          // copy of the direct message being confirmed
uint8_t  pendingRetries = 0;
unsigned long pendingSentAt = 0;
uint8_t  lastSendStatus = SEND_NONE;
uint8_t  lastSendTarget = 0;
uint16_t lastSendMsgId = 0;

// ---- Preset Short SMS Messages Stored in Flash (PROGMEM) ----
const char preset_0[] PROGMEM = "HELP NEEDED!";
const char preset_1[] PROGMEM = "STATUS: ALL CLEAR";
const char preset_2[] PROGMEM = "COPY THAT / OK";
const char preset_3[] PROGMEM = "RETURNING TO BASE";
const char preset_4[] PROGMEM = "NEED BACKUP HERE";
const char preset_5[] PROGMEM = "ARRIVED AT SCENE";
const char preset_6[] PROGMEM = "AFFIRMATIVE (YES)";
const char preset_7[] PROGMEM = "NEGATIVE (NO)";
const char preset_8[] PROGMEM = "CHECK RADIO PING";
const char preset_9[] PROGMEM = "< CANCEL / BACK >";

const char* const PRESET_MESSAGES[] PROGMEM = {
  preset_0, preset_1, preset_2, preset_3, preset_4,
  preset_5, preset_6, preset_7, preset_8, preset_9
};
#define PRESET_COUNT 10

// ---- Target Destination Nodes ----
const uint8_t TARGET_NODE_IDS[] = { 0, 101, 102, 103, 1 };
const char target_name_0[] PROGMEM = "0: Broadcast All";
const char target_name_1[] PROGMEM = "101: Walkie Alpha";
const char target_name_2[] PROGMEM = "102: Walkie Bravo";
const char target_name_3[] PROGMEM = "103: Walkie Charlie";
const char target_name_4[] PROGMEM = "1: AWS Weather Stn";

const char* const TARGET_NAMES[] PROGMEM = {
  target_name_0, target_name_1, target_name_2, target_name_3, target_name_4
};
#define TARGET_COUNT 5
uint8_t currentTargetIdx = 0; // Default 0 = Broadcast to all stations

// ---- UI Navigation State Machine ----
enum WalkieUiState {
  UI_STATE_IDLE = 0,      // Live Standby Dashboard
  UI_STATE_MENU,          // Main Menu
  UI_STATE_QUICK_SMS,     // Pre-set SMS Selector
  UI_STATE_INBOX,         // Inbox History Browser
  UI_STATE_TARGET,        // Destination Target Selector
  UI_STATE_SOS_CONFIRM,   // Emergency SOS Confirmation Screen
  UI_STATE_SPLASH         // Temporary Status Splash
};

WalkieUiState uiState = UI_STATE_IDLE;
uint8_t menuIdx = 0;
uint8_t presetIdx = 0;
uint8_t targetSelectIdx = 0;

// Temporary Status Splash
unsigned long splashStartTime = 0;
char splashLine1[20] = "";
char splashLine2[20] = "";

// Forward Declarations
void sendWalkieMessage(const char* text, uint8_t alertLevel = 0, uint8_t pktType = PKT_TYPE_TEXT, uint8_t targetNode = 0);
void updateOledDisplay();
void playToneBeep(uint16_t freq = 1800, uint8_t duration = 30);
void triggerInstantSos();
void printPinDiagnostics();

// ---- Helper Functions ----
uint16_t readBatteryMv() {
  int raw = analogRead(BATT_PIN);
  return (uint16_t)((raw * 10000UL) / 1023UL);
}

void playToneBeep(uint16_t freq, uint8_t duration) {
  #if defined(BUZZER_PIN) && BUZZER_PIN > 0
    tone(BUZZER_PIN, freq, duration);
  #endif
}

void soundAlarm() {
  #if defined(BUZZER_PIN) && BUZZER_PIN > 0
    for (uint8_t i = 0; i < 2; i++) {
      tone(BUZZER_PIN, 2400, 80);
      delay(90);
      tone(BUZZER_PIN, 1600, 80);
      delay(90);
    }
  #endif
}

void triggerSplash(const __FlashStringHelper* l1, const char* l2) {
  strncpy_P(splashLine1, (PGM_P)l1, sizeof(splashLine1) - 1);
  splashLine1[sizeof(splashLine1) - 1] = '\0';
  strncpy(splashLine2, l2, sizeof(splashLine2) - 1);
  splashLine2[sizeof(splashLine2) - 1] = '\0';
  splashStartTime = millis();
  uiState = UI_STATE_SPLASH;
  updateOledDisplay();
}

void triggerSplash(const char* l1, const char* l2) {
  strncpy(splashLine1, l1, sizeof(splashLine1) - 1);
  splashLine1[sizeof(splashLine1) - 1] = '\0';
  strncpy(splashLine2, l2, sizeof(splashLine2) - 1);
  splashLine2[sizeof(splashLine2) - 1] = '\0';
  splashStartTime = millis();
  uiState = UI_STATE_SPLASH;
  updateOledDisplay();
}

void printPinDiagnostics() {
  Serial.println(F("\n=============================================="));
  Serial.println(F("🔍 [HARDWARE PIN & BUTTON DIAGNOSTIC]"));
  Serial.print(F(" - SELECT Button (Pin D")); Serial.print(BTN_SELECT_PIN); Serial.print(F("): "));
  int sVal = digitalRead(BTN_SELECT_PIN);
  if (sVal == LOW) {
    Serial.println(F("LOW (0V / PRESSED / SHORTED TO GND)"));
    Serial.println(F("   ⚠️ Note: If you are NOT holding the button, it is shorted to GND (check 4-pin switch orientation!)"));
  } else {
    Serial.println(F("HIGH (5V / Idle OK - Ready for press to GND)"));
  }

  Serial.print(F(" - CLICK  Button (Pin D")); Serial.print(BTN_CLICK_PIN); Serial.print(F("): "));
  int cVal = digitalRead(BTN_CLICK_PIN);
  if (cVal == LOW) {
    Serial.println(F("LOW (0V / PRESSED / SHORTED TO GND)"));
    Serial.println(F("   ⚠️ Note: If you are NOT holding the button, it is shorted to GND (check 4-pin switch orientation!)"));
  } else {
    Serial.println(F("HIGH (5V / Idle OK - Ready for press to GND)"));
  }

  Serial.print(F(" - OLED Display Present : ")); Serial.println(oledPresent ? F("YES (0x3C/0x3D I2C OK)") : F("NO (I2C Communication Failed)"));
  Serial.print(F(" - Current UI State     : "));
  switch (uiState) {
    case UI_STATE_IDLE: Serial.println(F("IDLE DASHBOARD (0)")); break;
    case UI_STATE_MENU: Serial.println(F("MAIN MENU (1)")); break;
    case UI_STATE_QUICK_SMS: Serial.println(F("QUICK SMS (2)")); break;
    case UI_STATE_INBOX: Serial.println(F("INBOX HISTORY (3)")); break;
    case UI_STATE_TARGET: Serial.println(F("TARGET NODE (4)")); break;
    case UI_STATE_SOS_CONFIRM: Serial.println(F("SOS CONFIRM (5)")); break;
    case UI_STATE_SPLASH: Serial.println(F("SPLASH (6)")); break;
  }
  Serial.print(F(" - Battery Voltage      : ")); Serial.print(readBatteryMv()); Serial.println(F(" mV"));
  Serial.println(F("  Tip: Type 's' to simulate SELECT, 'c' to simulate CLICK"));
  Serial.println(F("==============================================\n"));
}

void saveToInbox(const LoRaMeshPacket &pkt, int rssi) {
  if (pkt.text_msg[0] == '\0') return;

  if (inboxCount < INBOX_CAPACITY) {
    inboxCount++;
  }
  for (int8_t i = inboxCount - 1; i > 0; i--) {
    messageInbox[i] = messageInbox[i - 1];
  }
  messageInbox[0].senderNode = pkt.originNode;
  messageInbox[0].targetNode = pkt.targetNode;
  messageInbox[0].rssi = (int8_t)constrain(rssi, -128, 127);
  messageInbox[0].alertLevel = pkt.alert_level;
  messageInbox[0].rxTime = millis();
  strncpy(messageInbox[0].text, pkt.text_msg, sizeof(messageInbox[0].text) - 1);
  messageInbox[0].text[sizeof(messageInbox[0].text) - 1] = '\0';
  if (unreadCount < 9) unreadCount++;
}

// Short display name for a node number (0 = gateway / dashboard).
void nodeName(uint8_t id, char* buf, size_t n) {
  switch (id) {
    case 0:   strncpy_P(buf, PSTR("BASE"), n); break;
    case 101: strncpy_P(buf, PSTR("Alpha"), n); break;
    case 102: strncpy_P(buf, PSTR("Bravo"), n); break;
    case 103: strncpy_P(buf, PSTR("Charlie"), n); break;
    default:  snprintf_P(buf, n, PSTR("#%u"), id); break;
  }
  buf[n - 1] = '\0';
}

// Age of a millis() timestamp as "12s" / "5m" / "2h".
void formatAge(unsigned long t, char* buf, size_t n) {
  unsigned long sec = (millis() - t) / 1000UL;
  if (sec < 60) snprintf_P(buf, n, PSTR("%lus"), sec);
  else if (sec < 3600) snprintf_P(buf, n, PSTR("%lum"), sec / 60);
  else snprintf_P(buf, n, PSTR("%luh"), sec / 3600);
}

// Print text word-wrapped over up to maxLines OLED rows (21 characters each).
void printWrapped(uint8_t page, uint8_t maxLines, const char* text, bool invert = false) {
  const uint8_t W = 21;
  const char* p = text;
  for (uint8_t line = 0; line < maxLines; line++) {
    while (*p == ' ') p++;
    display.setCursor(page + line, 0);
    size_t take = strlen(p);
    if (take > W) {
      take = W;
      if (line < maxLines - 1) {
        for (int8_t i = W; i > 0; i--) {
          if (p[i] == ' ') { take = i; break; }
        }
      }
    }
    for (size_t i = 0; i < take; i++) display.writeChar(p[i], invert);
    display.clearToEol(invert);
    p += take;
  }
}

// One-line "Bravo>me 12s -82dB" / "BASE>all 3m -95dB" summary (max 21 chars).
void printMessageMeta(uint8_t page, uint8_t sender, uint8_t target, int rssi, unsigned long rxTime, bool invert) {
  char name[9], age[6], line[24];
  nodeName(sender, name, sizeof(name));
  formatAge(rxTime, age, sizeof(age));
  snprintf_P(line, sizeof(line), PSTR("%s>%s %s %ddB"), name, target == 0 ? "all" : "me", age, rssi);
  display.printLine(page, line, invert);
}

void drawHeader(const __FlashStringHelper* title) {
  display.setCursor(0, 0);
  display.print(title);
  display.setCursor(0, 88);
  display.printFloat(readBatteryMv() / 1000.0, 1);
  display.print(F("V"));
  display.clearToEol();
  display.drawDivider(1, 0x01);
}

void drawHeader(const char* title) {
  display.setCursor(0, 0);
  display.print(title);
  display.setCursor(0, 88);
  display.printFloat(readBatteryMv() / 1000.0, 1);
  display.print(F("V"));
  display.clearToEol();
  display.drawDivider(1, 0x01);
}

void drawFooter(const __FlashStringHelper* leftBtn, const __FlashStringHelper* rightBtn) {
  display.drawDivider(6, 0x80);
  display.setCursor(7, 0);
  display.print(F("[S]"));
  display.print(leftBtn);
  display.setCursor(7, 68);
  display.print(F("[C]"));
  display.print(rightBtn);
  display.clearToEol();
}

// ---- Main OLED Screen Renderer ----
void updateOledDisplay() {
  if (!oledPresent) return;
  display.clear();

  switch (uiState) {
    // ── 1. IDLE / STANDBY DASHBOARD ──────────────────────────────────────────
    case UI_STATE_IDLE: {
      char headerBuf[16];
      if (unreadCount > 0) snprintf_P(headerBuf, sizeof(headerBuf), PSTR("#%d  %u NEW"), currentWalkieNodeId, unreadCount);
      else snprintf_P(headerBuf, sizeof(headerBuf), PSTR("WALKIE #%d"), currentWalkieNodeId);
      drawHeader(headerBuf);

      bool showSos = lastRxAlertLevel > 0 && (millis() - lastRxTime < 30000);
      bool showMsg = lastRxTime > 0 && (millis() - lastRxTime < 60000); // includes messages from BASE (node 0)

      if (showSos || showMsg) {
        // Latest message: sender line, then the text word-wrapped over 3 rows
        printMessageMeta(2, lastRxNode, lastRxDirect ? currentWalkieNodeId : 0, lastRxRssi, lastRxTime, showSos);
        printWrapped(3, 3, lastRxMsg[0] ? lastRxMsg : "SOS TRIGGERED!");
      } else {
        char tBuf[22], line[24];
        display.printLine(2, F("Listening 433MHz"));
        strcpy_P(tBuf, (char*)pgm_read_word(&(TARGET_NAMES[currentTargetIdx])));
        snprintf_P(line, sizeof(line), PSTR("To %s"), tBuf);
        display.printLine(3, line);

        char name[9];
        nodeName(lastSendTarget, name, sizeof(name));
        switch (lastSendStatus) {
          case SEND_WAITING:
            snprintf_P(line, sizeof(line), PSTR("Sending.. try %u/%u"), pendingRetries + 1, ACK_MAX_RETRIES + 1);
            break;
          case SEND_DELIVERED:    snprintf_P(line, sizeof(line), PSTR("Last: Delivered %s"), name); break;
          case SEND_FAILED:       snprintf_P(line, sizeof(line), PSTR("Last: NOT delivered")); break;
          case SEND_BROADCAST:    snprintf_P(line, sizeof(line), PSTR("Last: Sent to all")); break;
          case SEND_REACHED_BASE: snprintf_P(line, sizeof(line), PSTR("Last: Reached BASE")); break;
          default:                line[0] = '\0'; break;
        }
        display.printLine(4, line, lastSendStatus == SEND_FAILED);

        if (unreadCount > 0) {
          snprintf_P(line, sizeof(line), PSTR("Inbox: %u unread"), unreadCount);
          display.printLine(5, line);
        } else {
          display.printLine(5, F("Hold [C] = SOS"));
        }
      }

      drawFooter(F("Menu"), F("QuickSMS"));
      break;
    }

    // ── 2. MAIN MENU ────────────────────────────────────────────────────────
    case UI_STATE_MENU: {
      drawHeader(F("=== MAIN MENU ==="));

      const uint8_t TOTAL_ITEMS = 5;
      uint8_t topIdx = (menuIdx >= 3) ? menuIdx - 2 : 0;
      if (topIdx > TOTAL_ITEMS - 4) topIdx = TOTAL_ITEMS - 4;

      for (uint8_t i = 0; i < 4; i++) {
        uint8_t cur = topIdx + i;
        display.setCursor(2 + i, 0);
        bool sel = (cur == menuIdx);
        display.print(sel ? F(">") : F(" "));

        switch (cur) {
          case 0: display.print(F("1.Quick SMS")); break;
          case 1:
            display.print(F("2.Inbox ("));
            display.printInt(inboxCount);
            display.print(F(")"));
            break;
          case 2: display.print(F("3.Send SOS Alert")); break;
          case 3: display.print(F("4.Target Node")); break;
          case 4: display.print(F("5.Back to Idle")); break;
        }
        display.clearToEol();
      }

      drawFooter(F("Next"), F("Enter"));
      break;
    }

    // ── 3. PRESET QUICK SMS SELECTOR ─────────────────────────────────────────
    case UI_STATE_QUICK_SMS: {
      drawHeader(F("SEND QUICK SMS"));

      uint8_t topIdx = (presetIdx >= 3) ? presetIdx - 2 : 0;
      if (topIdx > PRESET_COUNT - 4) topIdx = PRESET_COUNT - 4;

      char pBuf[22];
      for (uint8_t i = 0; i < 4; i++) {
        uint8_t cur = topIdx + i;
        display.setCursor(2 + i, 0);
        display.print(cur == presetIdx ? F(">") : F(" "));
        strcpy_P(pBuf, (char*)pgm_read_word(&(PRESET_MESSAGES[cur])));
        display.print(pBuf);
        display.clearToEol();
      }

      drawFooter(F("Next"), F("Send"));
      break;
    }

    // ── 4. RECEIVED MESSAGE INBOX HISTORY BROWSER ────────────────────────────
    case UI_STATE_INBOX: {
      if (inboxCount == 0) {
        drawHeader(F("INBOX"));
        display.printLine(2, F("Inbox Empty"));
        display.printLine(3, F("No messages received"));
        display.printLine(4, F("Listening on 433MHz"));
        drawFooter(F("---"), F("Back"));
      } else {
        ReceivedMessage* m = &messageInbox[inboxBrowseIdx];
        char title[16];
        snprintf_P(title, sizeof(title), PSTR("INBOX %d/%d"), inboxBrowseIdx + 1, inboxCount);
        drawHeader(title);

        printMessageMeta(2, m->senderNode, m->targetNode, m->rssi, m->rxTime, m->alertLevel > 0);
        printWrapped(3, 3, m->text);

        drawFooter(F("Next"), F("Back"));
      }
      break;
    }

    // ── 5. DESTINATION TARGET NODE SELECTOR ──────────────────────────────────
    case UI_STATE_TARGET: {
      drawHeader(F("TARGET NODE"));

      uint8_t topIdx = (targetSelectIdx >= 3) ? targetSelectIdx - 2 : 0;
      if (topIdx > TARGET_COUNT - 4) topIdx = TARGET_COUNT - 4;

      char tBuf[22];
      for (uint8_t i = 0; i < 4; i++) {
        uint8_t cur = topIdx + i;
        display.setCursor(2 + i, 0);
        display.print(cur == targetSelectIdx ? F(">") : F(" "));
        strcpy_P(tBuf, (char*)pgm_read_word(&(TARGET_NAMES[cur])));
        display.print(tBuf);
        display.clearToEol();
      }

      drawFooter(F("Next"), F("Set"));
      break;
    }

    // ── 6. EMERGENCY SOS CONFIRMATION ────────────────────────────────────────
    case UI_STATE_SOS_CONFIRM: {
      drawHeader(F("! CONFIRM SOS !"));
      display.printLine(2, F("Broadcast EMERGENCY"));
      display.printLine(3, F("SOS to all stations?"));
      display.printLine(4, F("Alert: CRITICAL"));
      drawFooter(F("Cancel"), F("CONFIRM"));
      break;
    }

    // ── 7. TEMPORARY STATUS SPLASH ──────────────────────────────────────────
    case UI_STATE_SPLASH: {
      drawHeader(F("TRANSMISSION"));
      display.printLine(3, splashLine1);
      display.printLine(4, splashLine2);
      drawFooter(F("---"), F("Wait..."));
      break;
    }
  }
}

// ---- Transmit a packet and return to receive mode ----
bool transmitPacket(const LoRaMeshPacket &pkt) {
  digitalWrite(STATUS_LED_PIN, HIGH);
  LoRa.beginPacket();
  LoRa.write((const uint8_t*)&pkt, sizeof(pkt));
  int res = LoRa.endPacket();
  digitalWrite(STATUS_LED_PIN, LOW);
  LoRa.receive();
  return res == 1;
}

uint16_t nextMsgId() {
  msgCounter++;
  if (msgCounter == 0) msgCounter = 1;
  return msgCounter;
}

// ---- Transmit Walkie LoRa Message ----
void sendWalkieMessage(const char* text, uint8_t alertLevel, uint8_t pktType, uint8_t targetNode) {
  LoRaMeshPacket pkt;
  memset(&pkt, 0, sizeof(pkt));

  char cleanText[32];
  memset(cleanText, 0, sizeof(cleanText));
  uint8_t parsedTarget = parseTargetNodeFromText(text, cleanText, sizeof(cleanText));
  if (targetNode == 0) {
    targetNode = parsedTarget;
  }

  uint16_t msgId = nextMsgId();
  pkt.msgIdHi = (uint8_t)(msgId >> 8);
  pkt.msgIdLo = (uint8_t)(msgId & 0xFF);
  pkt.originNode = currentWalkieNodeId;
  pkt.targetNode = targetNode;
  pkt.ttl = DEFAULT_MAX_TTL;
  pkt.packetType = pktType;
  pkt.alert_level = alertLevel;
  pkt.battery_mv = readBatteryMv();

  strncpy(pkt.text_msg, (cleanText[0] != '\0' ? cleanText : text), sizeof(pkt.text_msg) - 1);
  pkt.text_msg[sizeof(pkt.text_msg) - 1] = '\0';

  dedupCache.markSeen(currentWalkieNodeId, msgId);
  bool ok = transmitPacket(pkt);

  // Track delivery for text and SOS messages.
  if (pktType == PKT_TYPE_TEXT || pktType == PKT_TYPE_SOS) {
    lastSendTarget = targetNode;
    lastSendMsgId = msgId;
    if (targetNode != 0) {
      pendingPkt = pkt;
      pendingRetries = 0;
      pendingSentAt = millis();
      lastSendStatus = SEND_WAITING;
    } else {
      lastSendStatus = SEND_BROADCAST;
    }
  }

  Serial.println(F("\n=============================================="));
  if (ok) {
    Serial.print(F("🚀 [WALKIE TX SUCCESS] Sent MsgID=#")); Serial.println(msgId);
    Serial.print(F(" - Origin Node: #")); Serial.println(currentWalkieNodeId);
    Serial.print(F(" - Target Node: #")); Serial.print(targetNode);
    Serial.println(targetNode == 0 ? F(" (BROADCAST ALL)") : F(" (DIRECT, waiting for ACK)"));
    Serial.print(F(" - Message    : \"")); Serial.print(pkt.text_msg); Serial.println(F("\""));
  } else {
    Serial.println(F("❌ [WALKIE TX FAIL] LoRa radio transmit error!"));
  }
  Serial.println(F("=============================================="));
}

// ---- Confirm a received message back to its sender ----
void sendAck(uint8_t toNode, uint16_t ackedMsgId) {
  LoRaMeshPacket ack;
  memset(&ack, 0, sizeof(ack));
  uint16_t msgId = nextMsgId();
  ack.msgIdHi = (uint8_t)(msgId >> 8);
  ack.msgIdLo = (uint8_t)(msgId & 0xFF);
  ack.originNode = currentWalkieNodeId;
  ack.targetNode = toNode;
  ack.ttl = DEFAULT_MAX_TTL;
  ack.packetType = PKT_TYPE_ACK;
  ack.battery_mv = readBatteryMv();
  snprintf_P(ack.text_msg, sizeof(ack.text_msg), PSTR("ACK %u"), ackedMsgId);

  dedupCache.markSeen(currentWalkieNodeId, msgId);
  delay(random(80, 250)); // let relays of the original packet finish first
  transmitPacket(ack);

  Serial.print(F("✅ [ACK SENT] Confirmed MsgID=#")); Serial.print(ackedMsgId);
  Serial.print(F(" to Node #")); Serial.println(toNode);
}

// ---- Re-send an unconfirmed direct message, or give up ----
void checkPendingAck() {
  if (lastSendStatus != SEND_WAITING) return;
  if (millis() - pendingSentAt < ACK_TIMEOUT_MS) return;

  char name[9], line[20];
  nodeName(pendingPkt.targetNode, name, sizeof(name));

  if (pendingRetries < ACK_MAX_RETRIES) {
    pendingRetries++;
    pendingSentAt = millis();
    pendingPkt.ttl = DEFAULT_MAX_TTL;
    transmitPacket(pendingPkt); // same message ID: receivers drop the copy but ACK again
    Serial.print(F("🔁 [RETRY] No ACK yet, re-sent MsgID=#")); Serial.print(lastSendMsgId);
    Serial.print(F(" (try ")); Serial.print(pendingRetries + 1); Serial.println(F(")"));
    if (uiState == UI_STATE_IDLE) updateOledDisplay();
  } else {
    lastSendStatus = SEND_FAILED;
    Serial.print(F("❌ [NOT DELIVERED] No ACK from Node #")); Serial.println(pendingPkt.targetNode);
    playToneBeep(600, 250);
    snprintf_P(line, sizeof(line), PSTR("No reply from %s"), name);
    triggerSplash(F("NOT DELIVERED"), line);
  }
}

// ---- Instant Emergency SOS Trigger ----
void triggerInstantSos() {
  soundAlarm();
  char sosMsg[28];
  snprintf_P(sosMsg, sizeof(sosMsg), PSTR("SOS FROM NODE #%d!"), currentWalkieNodeId);
  sendWalkieMessage(sosMsg, 2, PKT_TYPE_SOS, 0);
  triggerSplash("! EMERGENCY SOS !", "BROADCAST TO MESH");
}

// ---- Two-Button Navigation Handlers ----

// Button 1: SELECT (Cycle menu, next item, scroll inbox)
void handleSelectButton() {
  Serial.println(F("\n🔘 [BUTTON EVENT] SELECT (D7) pressed!"));
  digitalWrite(STATUS_LED_PIN, HIGH);
  playToneBeep(1800, 30);

  switch (uiState) {
    case UI_STATE_IDLE:
      uiState = UI_STATE_MENU;
      menuIdx = 0;
      Serial.println(F("   -> UI State: MAIN MENU (Item 1: Quick SMS)"));
      break;

    case UI_STATE_MENU:
      menuIdx = (menuIdx + 1) % 5;
      Serial.print(F("   -> Menu Item changed: ")); Serial.println(menuIdx + 1);
      break;

    case UI_STATE_QUICK_SMS:
      presetIdx = (presetIdx + 1) % PRESET_COUNT;
      Serial.print(F("   -> Preset SMS selected: #")); Serial.println(presetIdx + 1);
      break;

    case UI_STATE_INBOX:
      if (inboxCount > 0) {
        inboxBrowseIdx = (inboxBrowseIdx + 1) % inboxCount;
        Serial.print(F("   -> Inbox browsing message #")); Serial.println(inboxBrowseIdx + 1);
      }
      break;

    case UI_STATE_TARGET:
      targetSelectIdx = (targetSelectIdx + 1) % TARGET_COUNT;
      Serial.print(F("   -> Target node selected: ")); Serial.println(targetSelectIdx);
      break;

    case UI_STATE_SOS_CONFIRM:
    case UI_STATE_SPLASH:
      uiState = UI_STATE_IDLE;
      Serial.println(F("   -> Cancelled -> Returning to IDLE"));
      break;
  }

  updateOledDisplay();
  digitalWrite(STATUS_LED_PIN, LOW);
}

// Button 2: CLICK (Enter, Confirm, Send SMS, or Exit Inbox)
void handleClickButton() {
  Serial.println(F("\n🔘 [BUTTON EVENT] CLICK (D8) pressed!"));
  digitalWrite(STATUS_LED_PIN, HIGH);
  playToneBeep(2200, 45);

  switch (uiState) {
    case UI_STATE_IDLE:
      uiState = UI_STATE_QUICK_SMS;
      presetIdx = 0;
      Serial.println(F("   -> Shortcut: IDLE -> QUICK SMS MENU"));
      break;

    case UI_STATE_MENU:
      Serial.print(F("   -> Entered Menu Option: ")); Serial.println(menuIdx + 1);
      switch (menuIdx) {
        case 0:
          uiState = UI_STATE_QUICK_SMS;
          presetIdx = 0;
          break;
        case 1:
          uiState = UI_STATE_INBOX;
          inboxBrowseIdx = 0;
          unreadCount = 0;
          break;
        case 2:
          uiState = UI_STATE_SOS_CONFIRM;
          break;
        case 3:
          uiState = UI_STATE_TARGET;
          targetSelectIdx = currentTargetIdx;
          break;
        case 4:
          uiState = UI_STATE_IDLE;
          break;
      }
      break;

    case UI_STATE_QUICK_SMS:
      if (presetIdx == PRESET_COUNT - 1) {
        uiState = UI_STATE_IDLE;
        Serial.println(F("   -> Quick SMS Cancelled -> IDLE"));
      } else {
        char sendBuf[28];
        strcpy_P(sendBuf, (char*)pgm_read_word(&(PRESET_MESSAGES[presetIdx])));
        uint8_t target = TARGET_NODE_IDS[currentTargetIdx];
        sendWalkieMessage(sendBuf, 0, PKT_TYPE_TEXT, target);

        char name[9], destBuf[20];
        nodeName(target, name, sizeof(name));
        if (target == 0) {
          triggerSplash(F("SENT TO ALL"), "No reply expected");
        } else {
          snprintf_P(destBuf, sizeof(destBuf), PSTR("to %s, wait ACK"), name);
          triggerSplash(F("SENDING..."), destBuf);
        }
        digitalWrite(STATUS_LED_PIN, LOW);
        return;
      }
      break;

    case UI_STATE_INBOX:
      uiState = UI_STATE_IDLE;
      Serial.println(F("   -> Exited Inbox -> IDLE"));
      break;

    case UI_STATE_TARGET:
      currentTargetIdx = targetSelectIdx;
      char setBuf[20];
      snprintf_P(setBuf, sizeof(setBuf), PSTR("Node #%d Active"), TARGET_NODE_IDS[currentTargetIdx]);
      triggerSplash("TARGET UPDATED!", setBuf);
      digitalWrite(STATUS_LED_PIN, LOW);
      return;

    case UI_STATE_SOS_CONFIRM:
      triggerInstantSos();
      digitalWrite(STATUS_LED_PIN, LOW);
      return;

    case UI_STATE_SPLASH:
      uiState = UI_STATE_IDLE;
      break;
  }

  updateOledDisplay();
  digitalWrite(STATUS_LED_PIN, LOW);
}

// ---- Non-Blocking Push Button Poller ----
void checkButtons() {
  unsigned long now = millis();

  // 1. SELECT BUTTON (Pin D7) — Active LOW (Press to Advance/Cycle)
  static bool prevSelState = HIGH;
  static unsigned long lastSelEdgeTime = 0;
  bool curSelState = digitalRead(BTN_SELECT_PIN);

  if (curSelState != prevSelState) {
    if ((now - lastSelEdgeTime) > 35) { // 35ms debounce filter
      if (curSelState == LOW) {
        handleSelectButton();
      }
      prevSelState = curSelState;
      lastSelEdgeTime = now;
    }
  }

  // 2. CLICK BUTTON (Pin D8) — Active LOW (Short Click = Enter/Send, Hold >1.5s = Instant SOS)
  static bool prevClkState = HIGH;
  static unsigned long lastClkEdgeTime = 0;
  static unsigned long clkPressStart = 0;
  static bool longPressTriggered = false;
  bool curClkState = digitalRead(BTN_CLICK_PIN);

  if (curClkState != prevClkState) {
    if ((now - lastClkEdgeTime) > 35) { // 35ms debounce filter
      if (curClkState == LOW) {
        clkPressStart = now;
        longPressTriggered = false;
      } else {
        if (!longPressTriggered && clkPressStart > 0) {
          unsigned long pressDuration = now - clkPressStart;
          if (pressDuration >= 15 && pressDuration < 1500) {
            handleClickButton();
          }
        }
        clkPressStart = 0;
        longPressTriggered = false;
      }
      prevClkState = curClkState;
      lastClkEdgeTime = now;
    }
  }

  // Check for Long-Press while held down
  if (curClkState == LOW && !longPressTriggered && clkPressStart > 0 && (now - clkPressStart >= 1500)) {
    longPressTriggered = true;
    Serial.println(F("\n🚨 [BUTTON EVENT] LONG-PRESS (>1.5s) on CLICK (D8) -> EMERGENCY SOS!"));
    triggerInstantSos();
  }
}

void printSerialHelp() {
  Serial.println(F("\n=== FLAPMAIN LORA MESH WALKIE-TALKIE CLI ==="));
  Serial.print(F(" Node ID: #")); Serial.print(currentWalkieNodeId);
  Serial.println(currentWalkieNodeId == 101 ? F(" (Walkie Alpha)") : (currentWalkieNodeId == 102 ? F(" (Walkie Bravo)") : F("")));
  Serial.println(F(" Hardware Controls:"));
  Serial.println(F("  - Button 1 (Pin D7): SELECT / Next Item / Browse Inbox."));
  Serial.println(F("  - Button 2 (Pin D8): CLICK / Confirm / Send Quick SMS."));
  Serial.println(F("  - Hold Button 2 (1.5s): INSTANT EMERGENCY SOS BROADCAST."));
  Serial.println(F(" Serial Commands for Interactive Testing:"));
  Serial.println(F("  - '/id <number>'   : Change this node's ID (e.g. '/id 102')."));
  Serial.println(F("  - '/target <num>'  : Change target destination node (0=All, 101, 102, etc.)."));
  Serial.println(F("  - 's' or '/select': Simulate pressing SELECT button (changes screen)."));
  Serial.println(F("  - 'c' or '/click' : Simulate pressing CLICK button (enters/sends)."));
  Serial.println(F("  - '/diag' or '/test': Check live pin voltages and OLED status."));
  Serial.println(F("  - Type text + Enter: Broadcast text message to mesh."));
  Serial.println(F("  - Type 'text /{node}' (e.g. 'Hello /102') to send direct message."));
  Serial.println(F("  - '/sos <message>' : Broadcast Emergency SOS alert."));
  Serial.println(F("  - '/ping'          : Send heartbeat ping."));
  Serial.println(F("  - '/help'          : Display this menu."));
  Serial.println(F("===========================================\n"));
}

void processIncomingPacket(int packetSize) {
  int rssi = LoRa.packetRssi();
  float snr = LoRa.packetSnr();

  if (packetSize != (int)sizeof(LoRaMeshPacket)) {
    Serial.print(F("⚠️ [RX REJECT] ")); Serial.print(packetSize);
    Serial.println(F(" bytes; expected 58. Sender has an old lora_mesh_protocol.h, re-flash it."));
    while (LoRa.available()) LoRa.read();
    return;
  }

  LoRaMeshPacket pkt;
  LoRa.readBytes((uint8_t*)&pkt, sizeof(pkt));
  pkt.text_msg[sizeof(pkt.text_msg) - 1] = '\0'; // never trust the terminator from the air

  uint16_t msgId = ((uint16_t)pkt.msgIdHi << 8) | pkt.msgIdLo;
  bool isMessage = (pkt.packetType == PKT_TYPE_TEXT || pkt.packetType == PKT_TYPE_SOS) && pkt.text_msg[0] != '\0';
  bool toMe = (pkt.targetNode == currentWalkieNodeId);

  // Copies of packets already handled (mesh relays, or a sender retrying).
  if (dedupCache.alreadySeen(pkt.originNode, msgId)) {
    // The sender retries when our ACK was lost: confirm again.
    if (isMessage && toMe && pkt.originNode != currentWalkieNodeId) sendAck(pkt.originNode, msgId);
    return;
  }
  dedupCache.markSeen(pkt.originNode, msgId);

  if (pkt.originNode == currentWalkieNodeId) {
    Serial.println(F("⚠️ [DUPLICATE NODE ID] Another radio uses this node ID! Type '/id 102' to change it."));
    return;
  }

  // ── Delivery confirmations ──────────────────────────────────────────────
  if (pkt.packetType == PKT_TYPE_ACK) {
    if (!toMe) {
      // ACK for another node: only relay it.
    } else {
      uint16_t ackedId = (uint16_t)atol(pkt.text_msg + 4); // "ACK <id>"
      char name[9];
      nodeName(pkt.originNode, name, sizeof(name));
      Serial.print(F("📬 [ACK RX] Node #")); Serial.print(pkt.originNode);
      Serial.print(F(" confirmed MsgID=#")); Serial.println(ackedId);

      if (lastSendStatus == SEND_WAITING && ackedId == lastSendMsgId && pkt.originNode == pendingPkt.targetNode) {
        lastSendStatus = SEND_DELIVERED;
        playToneBeep(2600, 40); delay(60); playToneBeep(3000, 60);
        char line[20];
        snprintf_P(line, sizeof(line), PSTR("Read by %s"), name);
        triggerSplash(F("DELIVERED"), line);
      } else if (pkt.originNode == 0 && ackedId == lastSendMsgId &&
                 (lastSendStatus == SEND_BROADCAST || lastSendStatus == SEND_REACHED_BASE)) {
        lastSendStatus = SEND_REACHED_BASE;
        playToneBeep(2600, 40);
        if (uiState == UI_STATE_IDLE) updateOledDisplay();
      }
      return; // addressed to us: do not relay
    }
  }

  // ── Text / SOS messages ─────────────────────────────────────────────────
  if (isMessage && (pkt.targetNode == 0 || toMe)) {
    Serial.println(F("\n=============================================="));
    Serial.print(F("📨 [MESSAGE] From #")); Serial.print(pkt.originNode);
    Serial.print(toMe ? F(" to me") : F(" to all"));
    Serial.print(F(" | RSSI=")); Serial.print(rssi); Serial.print(F(" SNR=")); Serial.println(snr, 1);
    Serial.print(F("   \"")); Serial.print(pkt.text_msg); Serial.println(F("\""));
    Serial.println(F("=============================================="));

    digitalWrite(STATUS_LED_PIN, HIGH);
    delay(30);
    digitalWrite(STATUS_LED_PIN, LOW);

    if (pkt.alert_level > 0) soundAlarm();
    else playToneBeep(1400, 60);

    saveToInbox(pkt, rssi);

    lastRxNode = pkt.originNode;
    lastRxRssi = rssi;
    lastRxSnr = snr;
    strncpy(lastRxMsg, pkt.text_msg, sizeof(lastRxMsg) - 1);
    lastRxMsg[sizeof(lastRxMsg) - 1] = '\0';
    lastRxPktType = pkt.packetType;
    lastRxAlertLevel = pkt.alert_level;
    lastRxDirect = toMe;
    lastRxTime = millis();

    // Direct messages are confirmed to the sender (broadcasts are not, to avoid ACK storms).
    if (toMe) sendAck(pkt.originNode, msgId);

    if (uiState == UI_STATE_IDLE || pkt.alert_level > 0) {
      uiState = UI_STATE_IDLE;
      updateOledDisplay();
    }
    if (toMe) return; // final destination: no relay
  }

  // ── Mesh relay (weather, heartbeats, and messages for other nodes) ──────
  if (pkt.ttl > 1) {
    pkt.ttl -= 1;
    delay(random(50, 150));
    transmitPacket(pkt);
    Serial.print(F("🔁 [RELAY] MsgID=#")); Serial.print(msgId);
    Serial.print(F(" from #")); Serial.print(pkt.originNode);
    Serial.print(F(" type ")); Serial.print(pkt.packetType);
    Serial.print(F(" (TTL ")); Serial.print(pkt.ttl); Serial.println(F(")"));
  }
}

// ---- Setup Routine ----
void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);

  // Start message IDs at a random value: after a reboot, IDs restarting at 1
  // would be dropped as duplicates by radios that still remember the old ones.
  randomSeed(analogRead(A0) ^ ((uint32_t)analogRead(A1) << 10) ^ micros());
  msgCounter = (uint16_t)random(1, 65000);

  pinMode(BTN_SELECT_PIN, INPUT_PULLUP);
  pinMode(BTN_CLICK_PIN,  INPUT_PULLUP);

  #if defined(BUZZER_PIN) && BUZZER_PIN > 0
    pinMode(BUZZER_PIN, OUTPUT);
    digitalWrite(BUZZER_PIN, LOW);
  #endif

  if (display.begin(0x3C)) {
    oledPresent = true;
    display.printLine(2, F("FLAPMAIN LORA MESH"));
    display.setCursor(3, 0);
    display.print(F("WALKIE #"));
    display.printInt(currentWalkieNodeId);
    display.clearToEol();
    display.printLine(4, F("Initializing..."));
  }

  LoRa.setPins(LORA_SS_PIN, LORA_RST_PIN, LORA_DIO0_PIN);
  LoRa.setSPIFrequency(4000000);

  if (!LoRa.begin(LORA_FREQUENCY)) {
    Serial.println(F("ERROR: SX1278 LoRa initialization failed! Check SPI connections."));
    if (oledPresent) {
      display.clear();
      display.printLine(2, F("LORA INIT FAIL!"));
    }
    while (true);
  }

  LoRa.setSpreadingFactor(LORA_SPREADING_FACTOR);
  LoRa.setSignalBandwidth(LORA_BANDWIDTH);
  LoRa.setCodingRate4(LORA_CODING_RATE);
  LoRa.setTxPower(LORA_TX_POWER);
  LoRa.setSyncWord(LORA_SYNC_WORD);
  LoRa.enableCrc();

  LoRa.receive();

  playToneBeep(2000, 60);
  printSerialHelp();
  printPinDiagnostics();
  updateOledDisplay();
}

// ---- Main Loop ----
void loop() {
  // 1. Process LoRa Packet Reception
  int packetSize = LoRa.parsePacket();
  if (packetSize > 0) {
    processIncomingPacket(packetSize);
    LoRa.receive();
  }

  // 2. Hardware Button Polling
  checkButtons();

  // 2b. Re-send unconfirmed direct messages
  checkPendingAck();

  // 3. Auto-Dismiss Status Splash
  if (uiState == UI_STATE_SPLASH && (millis() - splashStartTime >= 1400)) {
    uiState = UI_STATE_IDLE;
    updateOledDisplay();
  }

  // 4. Periodic Battery & Status Refresh on Idle Screen (every 3s)
  static unsigned long lastIdleRefresh = 0;
  if (uiState == UI_STATE_IDLE && (millis() - lastIdleRefresh > 3000)) {
    lastIdleRefresh = millis();
    updateOledDisplay();
  }

  // 5. Zero-Heap Serial Monitor Input Handler
  static char serialBuf[32];
  static uint8_t sIdx = 0;
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      serialBuf[sIdx] = '\0';
      if (sIdx > 0) {
        if (strcasecmp(serialBuf, "/help") == 0) {
          printSerialHelp();
        } else if (strcasecmp(serialBuf, "/diag") == 0 || strcasecmp(serialBuf, "/test") == 0) {
          printPinDiagnostics();
        } else if (strncasecmp(serialBuf, "/id ", 4) == 0) {
          int newId = atoi(serialBuf + 4);
          if (newId > 0 && newId <= 255) {
            currentWalkieNodeId = (uint8_t)newId;
            Serial.print(F("🆔 [NODE ID UPDATED] This walkie is now Node #"));
            Serial.println(currentWalkieNodeId);
            updateOledDisplay();
          } else {
            Serial.println(F("❌ Invalid Node ID! Must be 1..255."));
          }
        } else if (strncasecmp(serialBuf, "/target ", 8) == 0) {
          int newTarget = atoi(serialBuf + 8);
          if (newTarget >= 0 && newTarget <= 255) {
            bool found = false;
            for (uint8_t i = 0; i < TARGET_COUNT; i++) {
              if (TARGET_NODE_IDS[i] == newTarget) {
                currentTargetIdx = i;
                found = true;
                break;
              }
            }
            if (!found) {
              currentTargetIdx = 0;
            }
            Serial.print(F("🎯 [TARGET UPDATED] Target Node is now #"));
            Serial.println(newTarget);
            updateOledDisplay();
          }
        } else if (strcasecmp(serialBuf, "/select") == 0 || strcasecmp(serialBuf, "s") == 0 || strcmp(serialBuf, "1") == 0) {
          Serial.println(F("💻 [SERIAL CLI] Simulated SELECT button!"));
          handleSelectButton();
        } else if (strcasecmp(serialBuf, "/click") == 0 || strcasecmp(serialBuf, "c") == 0 || strcmp(serialBuf, "2") == 0) {
          Serial.println(F("💻 [SERIAL CLI] Simulated CLICK button!"));
          handleClickButton();
        } else if (strcasecmp(serialBuf, "/ping") == 0) {
          sendWalkieMessage("PING HEARTBEAT", 0, PKT_TYPE_HEARTBEAT, TARGET_NODE_IDS[currentTargetIdx]);
        } else if (strncasecmp(serialBuf, "/sos", 4) == 0) {
          char* text = serialBuf + 4;
          while (*text == ' ') text++;
          sendWalkieMessage((*text ? text : "CRITICAL EMERGENCY SOS!"), 2, PKT_TYPE_SOS, 0);
        } else {
          sendWalkieMessage(serialBuf, 0, PKT_TYPE_TEXT, TARGET_NODE_IDS[currentTargetIdx]);
        }
        sIdx = 0;
      }
    } else {
      if (sIdx < sizeof(serialBuf) - 1) {
        serialBuf[sIdx++] = c;
      }
    }
  }

  delay(10);
}
