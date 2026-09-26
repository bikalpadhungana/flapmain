/*
 * =================================================================================
 * FLAPMAIN LORA MESH ESP8266 WALKIE-TALKIE & EMERGENCY SOS COMMUNICATOR
 * Board: ESP8266 (NodeMCU v1.0 / Wemos D1 Mini / ESP-12E/F) + SX1278 LoRa + 1.3"/0.96" OLED
 * 
 * Hardware Controls (Two Push Buttons):
 * - Button 1 (SELECT): GPIO8 (SD1 Pin) - Active LOW with INPUT_PULLUP
 * - Button 2 (CLICK) : GPIO9 (SD2 Pin) - Active LOW with INPUT_PULLUP
 * - Long-Press Button 2 (>1.5s): INSTANT EMERGENCY SOS BROADCAST
 * 
 * Pinout Mapping (NodeMCU / ESP-12):
 * - OLED SDA     : GPIO4  (D2) [I2C SDA]
 * - OLED SCL     : GPIO5  (D1) [I2C SCL]
 * - LoRa SS / CS : GPIO15 (D8) [SPI CS]
 * - LoRa RESET   : GPIO0  (D3) [RST]
 * - LoRa DIO0    : GPIO16 (D0) [DIO0 Interrupt]
 * - SPI SCK      : GPIO14 (D5)
 * - SPI MISO     : GPIO12 (D6)
 * - SPI MOSI     : GPIO13 (D7)
 * - SELECT Button: GPIO8  (SD1) [Active LOW with internal pull-up]
 * - CLICK Button : GPIO9  (SD2) [Active LOW with internal pull-up]
 * - Battery ADC  : A0     (0..3.3V ADC)
 * - Status LED   : GPIO2  (D4 Built-in LED - Active LOW)
 * - Piezo Buzzer : Defined in config.h (0 = disabled, e.g. GPIO10/SD3 if connected)
 *
 * NOTE ON ESP8266 GPIO8 & GPIO9:
 * On NodeMCU / ESP-12, GPIO8 & GPIO9 map to the SD1 and SD2 header pins.
 * In the Arduino IDE, set Tools -> Flash Mode to 'DIO' (Dual I/O) so the flash
 * controller does not reserve GPIO9/GPIO8 for Quad-SPI data lines.
 * =================================================================================
 */

#include <ESP8266WiFi.h>
#include <SPI.h>
#include <Wire.h>
#include <LoRa.h>

#if __has_include("config.h")
  #include "config.h"
#endif

// Set deduplication cache size for ESP8266 Walkie
#ifndef SEEN_CACHE_SIZE
  #define SEEN_CACHE_SIZE 16
#endif
#include "lora_mesh_protocol.h"
#include "font5x7.h"

// ---- Default Node ID & Hardware Pins ----
#ifndef WALKIE_NODE_ID
  #define WALKIE_NODE_ID  103   // Default Node ID for ESP8266 Walkie Charlie (103)
#endif

#define OLED_SDA_PIN      4     // D2 (GPIO4) Standard NodeMCU I2C SDA
#define OLED_SCL_PIN      5     // D1 (GPIO5) Standard NodeMCU I2C SCL
#define LORA_SS_PIN       15    // D8 (GPIO15) SPI Chip Select
#define LORA_RST_PIN      0     // D3 (GPIO0) SX1278 Reset
#define LORA_DIO0_PIN     16    // D0 (GPIO16) SX1278 Interrupt Pin
#define BATT_PIN          A0    // A0 Analog Battery Input (0..3.3V)
#define STATUS_LED_PIN    2     // D4 (GPIO2) Built-in LED (Active LOW on ESP8266)

// Two-Button Navigation & Emergency Action System Pins
#ifndef BTN_SELECT_PIN
  #define BTN_SELECT_PIN  8     // GPIO8 (SD1 Pin) - Active LOW with internal pull-up
#endif
#ifndef BTN_CLICK_PIN
  #define BTN_CLICK_PIN   9     // GPIO9 (SD2 Pin) - Active LOW with internal pull-up
#endif
#ifndef BUZZER_PIN
  #define BUZZER_PIN      0     // 0 = Disabled
#endif

#define SOS_BUTTON_PIN    BTN_CLICK_PIN // Backward compatibility alias

// =================================================================================
// ULTRA-COMPACT ZERO-RAM OLED DRIVER (SH1106 1.3" & SSD1306 0.96")
// Direct Page Mode over I2C compatible with ESP8266 Wire driver
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

  bool begin(uint8_t preferred = 0x3C, uint8_t sdaPin = OLED_SDA_PIN, uint8_t sclPin = OLED_SCL_PIN) {
    Wire.begin(sdaPin, sclPin);
    Wire.setClock(400000); // 400kHz fast I2C mode
    
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

// Last Received Telemetry / Message Preview State
uint8_t  lastRxNode = 0;
int      lastRxRssi = 0;
float    lastRxSnr = 0.0;
char     lastRxMsg[28] = "";
uint8_t  lastRxPktType = PKT_TYPE_TEXT;
uint8_t  lastRxAlertLevel = 0;
unsigned long lastRxTime = 0;

// ---- Received Messages Inbox History (RAM Buffer) ----
#define INBOX_CAPACITY 4

struct ReceivedMessage {
  uint8_t senderNode;
  uint8_t targetNode;
  int8_t  rssi;
  uint8_t alertLevel;
  char    text[26];
};

ReceivedMessage messageInbox[INBOX_CAPACITY];
uint8_t inboxCount = 0;
int8_t  inboxBrowseIdx = 0; // 0 = newest, 1 = previous, etc.

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

// ---- Helper Functions ----
uint16_t readBatteryMv() {
  int raw = analogRead(BATT_PIN);
  // ESP8266 0..1023 ADC mapped to 0..3300 mV (with NodeMCU voltage divider)
  return (uint16_t)((raw * 3300UL) / 1023UL);
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

void triggerSplash(const char* l1, const char* l2) {
  strncpy(splashLine1, l1, sizeof(splashLine1) - 1);
  splashLine1[sizeof(splashLine1) - 1] = '\0';
  strncpy(splashLine2, l2, sizeof(splashLine2) - 1);
  splashLine2[sizeof(splashLine2) - 1] = '\0';
  splashStartTime = millis();
  uiState = UI_STATE_SPLASH;
  updateOledDisplay();
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
  messageInbox[0].rssi = (int8_t)rssi;
  messageInbox[0].alertLevel = pkt.alert_level;
  strncpy(messageInbox[0].text, pkt.text_msg, sizeof(messageInbox[0].text) - 1);
  messageInbox[0].text[sizeof(messageInbox[0].text) - 1] = '\0';
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
      snprintf(headerBuf, sizeof(headerBuf), "ESP #%d", WALKIE_NODE_ID);
      drawHeader(headerBuf);

      if (lastRxAlertLevel > 0 && (millis() - lastRxTime < 30000)) {
        display.printLine(1, F("! EMERGENCY SOS !"), true);
        display.setCursor(2, 0);
        display.print(F("From Node #"));
        display.printInt(lastRxNode);
        display.clearToEol();
        display.printLine(3, lastRxMsg[0] ? lastRxMsg : "SOS TRIGGERED!");
        display.setCursor(4, 0);
        display.print(F("RSSI:"));
        display.printInt(lastRxRssi);
        display.print(F("dBm"));
        display.clearToEol();
      } else if (lastRxNode > 0 && (millis() - lastRxTime < 45000)) {
        display.setCursor(2, 0);
        display.print(F("RX From #"));
        display.printInt(lastRxNode);
        if (inboxCount > 0) display.print(F(" (New)"));
        display.clearToEol();

        display.setCursor(3, 0);
        display.print(F("\""));
        display.print(lastRxMsg);
        display.print(F("\""));
        display.clearToEol();

        display.setCursor(4, 0);
        display.print(F("Sig:"));
        display.printInt(lastRxRssi);
        display.print(F("dBm "));
        display.printFloat(lastRxSnr, 1);
        display.print(F("dB"));
        display.clearToEol();
      } else {
        display.printLine(2, F("LoRa Mesh 433MHz"));
        display.printLine(3, F("Status: LISTENING"));
        display.setCursor(4, 0);
        display.print(F("Target: "));
        char tBuf[20];
        strcpy_P(tBuf, (char*)pgm_read_word(&(TARGET_NAMES[currentTargetIdx])));
        display.print(tBuf);
        display.clearToEol();
        display.printLine(5, F("Hold [CLK]=SOS"));
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
      drawHeader(F("INBOX HISTORY"));

      if (inboxCount == 0) {
        display.printLine(2, F("Inbox Empty"));
        display.printLine(3, F("No messages received"));
        display.printLine(4, F("Listening on 433MHz"));
        drawFooter(F("---"), F("Back"));
      } else {
        ReceivedMessage* m = &messageInbox[inboxBrowseIdx];

        display.setCursor(2, 0);
        display.print(F("#"));
        display.printInt(inboxBrowseIdx + 1);
        display.print(F("/"));
        display.printInt(inboxCount);
        display.print(F(" From:#"));
        display.printInt(m->senderNode);
        display.print(m->targetNode == 0 ? F(" (All)") : F(" (Dir)"));
        display.clearToEol();

        display.setCursor(3, 0);
        if (m->alertLevel > 0) display.print(F("!SOS! "));
        display.print(F("\""));
        display.print(m->text);
        display.print(F("\""));
        display.clearToEol();

        display.setCursor(4, 0);
        display.print(F("Sig:"));
        display.printInt(m->rssi);
        display.print(F("dBm "));
        display.print(m->alertLevel > 0 ? F("ALERT:SOS") : F("TYPE:TXT"));
        display.clearToEol();

        drawFooter(F("NextMsg"), F("Back"));
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

// ---- Transmit Walkie LoRa Message ----
void sendWalkieMessage(const char* text, uint8_t alertLevel, uint8_t pktType, uint8_t targetNode) {
  msgCounter++;

  LoRaMeshPacket pkt;
  memset(&pkt, 0, sizeof(pkt));

  char cleanText[28];
  memset(cleanText, 0, sizeof(cleanText));
  uint8_t parsedTarget = parseTargetNodeFromText(text, cleanText, sizeof(cleanText));
  if (targetNode == 0) {
    targetNode = parsedTarget;
  }

  pkt.msgIdHi = (uint8_t)(msgCounter >> 8);
  pkt.msgIdLo = (uint8_t)(msgCounter & 0xFF);
  pkt.originNode = WALKIE_NODE_ID;
  pkt.targetNode = targetNode;
  pkt.ttl = DEFAULT_MAX_TTL;
  pkt.packetType = pktType;
  pkt.alert_level = alertLevel;
  pkt.battery_mv = readBatteryMv();

  strncpy(pkt.text_msg, (cleanText[0] != '\0' ? cleanText : text), sizeof(pkt.text_msg) - 1);
  pkt.text_msg[sizeof(pkt.text_msg) - 1] = '\0';

  uint16_t msgId = ((uint16_t)pkt.msgIdHi << 8) | pkt.msgIdLo;
  dedupCache.markSeen(WALKIE_NODE_ID, msgId);

  // Active LOW LED on ESP8266
  digitalWrite(STATUS_LED_PIN, LOW);
  LoRa.beginPacket();
  LoRa.write((uint8_t*)&pkt, sizeof(pkt));
  int res = LoRa.endPacket();
  digitalWrite(STATUS_LED_PIN, HIGH);

  LoRa.receive();

  Serial.println(F("\n=============================================="));
  if (res == 1) {
    Serial.print(F("🚀 [ESP WALKIE TX SUCCESS] Sent MsgID=#")); Serial.println(msgId);
    Serial.print(F(" - Target Node: #")); Serial.print(targetNode);
    Serial.println(targetNode == 0 ? F(" (BROADCAST)") : F(" (DIRECT)"));
    Serial.print(F(" - Message    : \"")); Serial.print(pkt.text_msg); Serial.println(F("\""));
  } else {
    Serial.println(F("❌ [ESP WALKIE TX FAIL] LoRa radio transmit error!"));
  }
  Serial.println(F("=============================================="));

  lastRxNode = WALKIE_NODE_ID;
  lastRxRssi = 0;
  lastRxSnr = 0.0;
  strncpy(lastRxMsg, pkt.text_msg, sizeof(lastRxMsg) - 1);
  lastRxMsg[sizeof(lastRxMsg) - 1] = '\0';
  lastRxPktType = pktType;
  lastRxAlertLevel = alertLevel;
  lastRxTime = millis();
}

// ---- Instant Emergency SOS Trigger ----
void triggerInstantSos() {
  soundAlarm();
  char sosMsg[28];
  snprintf(sosMsg, sizeof(sosMsg), "ESP SOS FROM NODE #%d!", WALKIE_NODE_ID);
  sendWalkieMessage(sosMsg, 2, PKT_TYPE_SOS, 0);
  triggerSplash("! EMERGENCY SOS !", "BROADCAST TO MESH");
}

// ---- Two-Button Navigation Handlers ----

// Button 1: SELECT (Cycle menu, next item, scroll inbox)
void handleSelectButton() {
  playToneBeep(1800, 30);

  switch (uiState) {
    case UI_STATE_IDLE:
      uiState = UI_STATE_MENU;
      menuIdx = 0;
      break;

    case UI_STATE_MENU:
      menuIdx = (menuIdx + 1) % 5;
      break;

    case UI_STATE_QUICK_SMS:
      presetIdx = (presetIdx + 1) % PRESET_COUNT;
      break;

    case UI_STATE_INBOX:
      if (inboxCount > 0) {
        inboxBrowseIdx = (inboxBrowseIdx + 1) % inboxCount;
      }
      break;

    case UI_STATE_TARGET:
      targetSelectIdx = (targetSelectIdx + 1) % TARGET_COUNT;
      break;

    case UI_STATE_SOS_CONFIRM:
    case UI_STATE_SPLASH:
      uiState = UI_STATE_IDLE;
      break;
  }

  updateOledDisplay();
}

// Button 2: CLICK (Enter, Confirm, Send SMS, or Exit Inbox)
void handleClickButton() {
  playToneBeep(2200, 45);

  switch (uiState) {
    case UI_STATE_IDLE:
      uiState = UI_STATE_QUICK_SMS;
      presetIdx = 0;
      break;

    case UI_STATE_MENU:
      switch (menuIdx) {
        case 0:
          uiState = UI_STATE_QUICK_SMS;
          presetIdx = 0;
          break;
        case 1:
          uiState = UI_STATE_INBOX;
          inboxBrowseIdx = 0;
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
      } else {
        char sendBuf[28];
        strcpy_P(sendBuf, (char*)pgm_read_word(&(PRESET_MESSAGES[presetIdx])));
        uint8_t target = TARGET_NODE_IDS[currentTargetIdx];
        sendWalkieMessage(sendBuf, 0, PKT_TYPE_TEXT, target);

        char destBuf[20];
        snprintf(destBuf, sizeof(destBuf), "Sent to #%d", target);
        triggerSplash("SMS BROADCASTED!", destBuf);
        return;
      }
      break;

    case UI_STATE_INBOX:
      uiState = UI_STATE_IDLE;
      break;

    case UI_STATE_TARGET:
      currentTargetIdx = targetSelectIdx;
      char setBuf[20];
      snprintf(setBuf, sizeof(setBuf), "Node #%d Active", TARGET_NODE_IDS[currentTargetIdx]);
      triggerSplash("TARGET UPDATED!", setBuf);
      return;

    case UI_STATE_SOS_CONFIRM:
      triggerInstantSos();
      return;

    case UI_STATE_SPLASH:
      uiState = UI_STATE_IDLE;
      break;
  }

  updateOledDisplay();
}

// ---- Non-Blocking Push Button Poller ----
void checkButtons() {
  unsigned long now = millis();

  // 1. SELECT BUTTON (GPIO8 / Pin SD1) — Active LOW
  static bool prevSelState = HIGH;
  static unsigned long selDebounceTime = 0;
  bool curSelState = digitalRead(BTN_SELECT_PIN);

  if (curSelState == LOW && prevSelState == HIGH && (now - selDebounceTime > 160)) {
    selDebounceTime = now;
    handleSelectButton();
  }
  prevSelState = curSelState;

  // 2. CLICK BUTTON (GPIO9 / Pin SD2) — Active LOW with Long-Press SOS Shortcut
  static bool prevClkState = HIGH;
  static unsigned long clkPressStart = 0;
  static bool longPressTriggered = false;
  bool curClkState = digitalRead(BTN_CLICK_PIN);

  if (curClkState == LOW && prevClkState == HIGH) {
    clkPressStart = now;
    longPressTriggered = false;
  } else if (curClkState == LOW && prevClkState == LOW) {
    if (!longPressTriggered && clkPressStart > 0 && (now - clkPressStart >= 1500)) {
      longPressTriggered = true;
      triggerInstantSos();
    }
  } else if (curClkState == HIGH && prevClkState == LOW) {
    unsigned long duration = now - clkPressStart;
    clkPressStart = 0;
    if (!longPressTriggered && duration >= 35 && duration < 1500) {
      handleClickButton();
    }
    longPressTriggered = false;
  }
  prevClkState = curClkState;
}

void printSerialHelp() {
  Serial.println(F("\n=== FLAPMAIN ESP8266 LORA MESH WALKIE-TALKIE CLI ==="));
  Serial.print(F(" Node ID: #")); Serial.println(WALKIE_NODE_ID);
  Serial.println(F(" Hardware Controls:"));
  Serial.println(F("  - Button 1 (GPIO8 / SD1): SELECT / Next Item / Browse Inbox."));
  Serial.println(F("  - Button 2 (GPIO9 / SD2): CLICK / Confirm / Send Quick SMS."));
  Serial.println(F("  - Hold Button 2 (1.5s) : INSTANT EMERGENCY SOS BROADCAST."));
  Serial.println(F(" Serial Commands:"));
  Serial.println(F("  - Type text and hit Enter to broadcast to ALL nodes."));
  Serial.println(F("  - Type 'text /{node_id}' to send to specific node (e.g., 'Hello /102')."));
  Serial.println(F("  - Type '/sos <message>' to broadcast an Emergency SOS alert."));
  Serial.println(F("  - Type '/ping' to send a heartbeat ping."));
  Serial.println(F("  - Type '/help' to display this menu."));
  Serial.println(F("===========================================\n"));
}

void processIncomingPacket(int packetSize) {
  if (packetSize < 50 || packetSize > (int)sizeof(LoRaMeshPacket) + 10) return;

  LoRaMeshPacket pkt;
  memset(&pkt, 0, sizeof(pkt));
  size_t toRead = ((size_t)packetSize < sizeof(pkt)) ? (size_t)packetSize : sizeof(pkt);
  LoRa.readBytes((uint8_t*)&pkt, toRead);

  uint16_t msgId = ((uint16_t)pkt.msgIdHi << 8) | pkt.msgIdLo;
  int rssi = LoRa.packetRssi();
  float snr = LoRa.packetSnr();

  if (dedupCache.alreadySeen(pkt.originNode, msgId)) return;
  dedupCache.markSeen(pkt.originNode, msgId);

  bool isForMe = (pkt.targetNode == 0 || pkt.targetNode == WALKIE_NODE_ID);

  if (isForMe) {
    digitalWrite(STATUS_LED_PIN, LOW); // LED ON (Active LOW on ESP8266)
    delay(30);
    digitalWrite(STATUS_LED_PIN, HIGH); // LED OFF

    if (pkt.alert_level > 0) {
      soundAlarm();
    } else if (pkt.text_msg[0] != '\0') {
      playToneBeep(1400, 60);
    }

    saveToInbox(pkt, rssi);

    Serial.println(F("\n=============================================="));
    Serial.print(F("📥 [ESP WALKIE RECEIVED MESH DATA] MsgID=#")); Serial.println(msgId);
    Serial.print(F(" - Origin Node ID : #")); Serial.println(pkt.originNode);
    Serial.print(F(" - Target Node ID : #")); Serial.print(pkt.targetNode);
    Serial.println(pkt.targetNode == 0 ? F(" (BROADCAST)") : F(" (DIRECT)"));
    Serial.print(F(" - Packet Type    : ")); Serial.println(pkt.packetType);
    Serial.print(F(" - Message Text   : \"")); Serial.print(pkt.text_msg); Serial.println(F("\""));
    Serial.print(F(" - Signal RSSI/SNR: ")); Serial.print(rssi); Serial.print(F(" dBm / ")); Serial.print(snr, 1); Serial.println(F(" dB"));
    Serial.println(F("=============================================="));

    lastRxNode = pkt.originNode;
    lastRxRssi = rssi;
    lastRxSnr = snr;
    strncpy(lastRxMsg, pkt.text_msg, sizeof(lastRxMsg) - 1);
    lastRxMsg[sizeof(lastRxMsg) - 1] = '\0';
    lastRxPktType = pkt.packetType;
    lastRxAlertLevel = pkt.alert_level;
    lastRxTime = millis();

    if (uiState == UI_STATE_IDLE || pkt.alert_level > 0) {
      if (pkt.alert_level > 0) {
        uiState = UI_STATE_IDLE;
      }
      updateOledDisplay();
    }
  }

  // Automatic LoRa Mesh Relay Forwarding (if TTL > 1)
  if (pkt.ttl > 1) {
    LoRaMeshPacket relayPkt = pkt;
    relayPkt.ttl -= 1;
    delay(random(50, 150));

    digitalWrite(STATUS_LED_PIN, LOW); // LED ON
    LoRa.beginPacket();
    LoRa.write((uint8_t*)&relayPkt, sizeof(relayPkt));
    LoRa.endPacket();
    digitalWrite(STATUS_LED_PIN, HIGH); // LED OFF

    LoRa.receive();

    Serial.print(F("🚀 [ESP WALKIE RELAY] Forwarded MsgID=#"));
    Serial.print(msgId);
    Serial.print(F(" (New TTL="));
    Serial.print(relayPkt.ttl);
    Serial.println(F(")"));
  }
}

// ---- Setup Routine ----
void setup() {
  Serial.begin(115200);
  delay(300);

  // Turn off Wi-Fi on boot to save power and eliminate 2.4GHz RF noise
  WiFi.mode(WIFI_OFF);
  WiFi.forceSleepBegin();
  delay(1);

  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, HIGH); // LED OFF (Active LOW)

  // Configure Two Push Buttons with Internal Pull-Ups
  pinMode(BTN_SELECT_PIN, INPUT_PULLUP);
  pinMode(BTN_CLICK_PIN,  INPUT_PULLUP);

  #if defined(BUZZER_PIN) && BUZZER_PIN > 0
    pinMode(BUZZER_PIN, OUTPUT);
    digitalWrite(BUZZER_PIN, LOW);
  #endif

  // Initialize OLED (1.3" SH1106 & 0.96" SSD1306, 0x3C or 0x3D)
  if (display.begin(0x3C, OLED_SDA_PIN, OLED_SCL_PIN)) {
    oledPresent = true;
    display.printLine(2, F("FLAPMAIN ESP MESH"));
    display.setCursor(3, 0);
    display.print(F("ESP WALKIE #"));
    display.printInt(WALKIE_NODE_ID);
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
    while (true) {
      yield();
    }
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
  updateOledDisplay();
}

// ---- Main Loop ----
void loop() {
  // Yield to ESP8266 background Watchdog Timer
  yield();

  // 1. Process LoRa Packet Reception
  int packetSize = LoRa.parsePacket();
  if (packetSize > 0) {
    processIncomingPacket(packetSize);
    LoRa.receive();
  }

  // 2. Hardware Button Polling
  checkButtons();

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
        } else if (strcasecmp(serialBuf, "/ping") == 0) {
          sendWalkieMessage("ESP PING HEARTBEAT", 0, PKT_TYPE_HEARTBEAT, TARGET_NODE_IDS[currentTargetIdx]);
        } else if (strncasecmp(serialBuf, "/sos", 4) == 0) {
          char* text = serialBuf + 4;
          while (*text == ' ') text++;
          sendWalkieMessage((*text ? text : "CRITICAL ESP EMERGENCY SOS!"), 2, PKT_TYPE_SOS, 0);
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
