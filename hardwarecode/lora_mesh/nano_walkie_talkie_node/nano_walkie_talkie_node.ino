/*
 * =================================================================================
 * FLAPMAIN LORA MESH WALKIE-TALKIE & EMERGENCY SOS COMMUNICATOR
 * Board: Arduino Nano (ATmega328P) + SX1278 LoRa Module + 1.3" / 0.96" OLED (SH1106 / SSD1306)
 * 
 * Display Compatibility:
 * Supports BOTH 1.3-inch SH1106 and 0.96-inch SSD1306 128x64 I2C OLED displays
 * with auto-detection for 0x3C / 0x3D I2C slave addresses.
 * 
 * Features:
 * - Interactive Serial Monitor Text Walkie-Talkie Messaging over 433MHz LoRa Mesh.
 * - Hardware SOS Push Button (Pin D8) for immediate emergency broadcast.
 * - OLED display (128x64 I2C SDA=A4, SCL=A5) displaying incoming text messages,
 *   sender Node ID, RSSI/SNR signal metrics, and emergency SOS alerts.
 * - Deduplicated mesh flood routing & automatic relay forwarding across repeaters & ESP gateway.
 * =================================================================================
 */

#include <SPI.h>
#include <Wire.h>
#include <LoRa.h>
#include <Adafruit_GFX.h>
#include "lora_mesh_protocol.h"
#if __has_include("config.h")
  #include "config.h"
#endif

// ---- Default Node ID & Hardware Pins ----
#ifndef WALKIE_NODE_ID
  #define WALKIE_NODE_ID 101  // Default Node ID (101 for Alpha, 102 for Bravo)
#endif

#define LORA_SS_PIN     10    // D10 SPI Chip Select
#define LORA_RST_PIN    9     // D9 SX1278 Reset
#define LORA_DIO0_PIN   2     // D2 Interrupt Pin
#define BATT_PIN        A3    // A3 Analog Battery Voltage Divider
#define STATUS_LED_PIN  13    // D13 Built-in Status LED

// ---- Two-Button Navigation & Emergency Action System ----
// Button 1: SELECT (Cycle Menu Options / Move Cursor / Browse Inbox Messages)
#ifndef BTN_SELECT_PIN
  #define BTN_SELECT_PIN 7    // D7 Active LOW with internal pull-up
#endif

// Button 2: CLICK (Enter / Confirm Selection / Transmit Quick SMS / Hold 1.5s for SOS)
#ifndef BTN_CLICK_PIN
  #define BTN_CLICK_PIN  8    // D8 Active LOW with internal pull-up
#endif

// Optional Audio Buzzer Pin for click tones & emergency SOS sirens
#ifndef BUZZER_PIN
  #define BUZZER_PIN     6    // D6 Piezo Buzzer (Active / Passive)
#endif

#define SOS_BUTTON_PIN   BTN_CLICK_PIN // Backward compatibility alias

// ---- Universal SH1106 (1.3") & SSD1306 (0.96") OLED Display Class ----
class UniversalOLED : public Adafruit_GFX {
private:
  uint8_t i2cAddr;
  uint8_t buffer[1024]; // 128x64 pixels / 8 = 1024 bytes
  uint8_t colOffset;    // Column offset (2 for 1.3" SH1106 OLED, 0 for SSD1306)

public:
  UniversalOLED() : Adafruit_GFX(128, 64), i2cAddr(0x3C), colOffset(2) {
    memset(buffer, 0, sizeof(buffer));
  }

  void drawPixel(int16_t x, int16_t y, uint16_t color) override {
    if (x < 0 || x >= 128 || y < 0 || y >= 64) return;
    if (color) {
      buffer[x + (y / 8) * 128] |= (1 << (y & 7));
    } else {
      buffer[x + (y / 8) * 128] &= ~(1 << (y & 7));
    }
  }

  void clearDisplay() {
    memset(buffer, 0, sizeof(buffer));
  }

  bool begin(uint8_t preferredAddr = 0x3C) {
    Wire.begin();
    
    // Auto-detect I2C address (0x3C or 0x3D)
    i2cAddr = preferredAddr;
    Wire.beginTransmission(i2cAddr);
    if (Wire.endTransmission() != 0) {
      i2cAddr = (preferredAddr == 0x3C) ? 0x3D : 0x3C;
      Wire.beginTransmission(i2cAddr);
      if (Wire.endTransmission() != 0) {
        return false; // Display not responding on I2C bus
      }
    }

    // Universal SH1106 (1.3") & SSD1306 (0.96") Initialization Sequence
    static const uint8_t PROGMEM initCmds[] = {
      0xAE,       // Display OFF
      0xD5, 0x80, // Set Clock Divide Ratio/Oscillator Frequency
      0xA8, 0x3F, // Set Multiplex Ratio (64 rows)
      0xD3, 0x00, // Set Display Offset = 0
      0x40,       // Set Display Start Line = 0
      0x8D, 0x14, // Enable Charge Pump (SSD1306)
      0xAD, 0x8B, // Enable DC-DC Charge Pump (SH1106 1.3" OLED)
      0x30,       // Set Discharge/Precharge Period (SH1106)
      0xA1,       // Segment Remap (Column 127 mapped to SEG0)
      0xC8,       // COM Output Scan Direction (remapped mode)
      0xDA, 0x12, // Set COM Pins Hardware Configuration
      0x81, 0xBF, // Set Contrast Control
      0xD9, 0x22, // Set Pre-charge Period
      0xDB, 0x40, // Set VCOMH Deselect Level
      0xA4,       // Entire Display ON (Resume to RAM)
      0xA6,       // Normal Display Mode
      0xAF        // Display ON
    };

    for (size_t i = 0; i < sizeof(initCmds); i++) {
      sendCommand(pgm_read_byte(&initCmds[i]));
    }

    clearDisplay();
    display();
    return true;
  }

  void sendCommand(uint8_t cmd) {
    Wire.beginTransmission(i2cAddr);
    Wire.write((uint8_t)0x00); // Command stream byte
    Wire.write(cmd);
    Wire.endTransmission();
  }

  void display() {
    // Flush 8 pages supporting both 1.3" SH1106 and 0.96" SSD1306 displays
    for (uint8_t page = 0; page < 8; page++) {
      sendCommand(0xB0 + page);                 // Set Page Address (0xB0..0xB7)
      sendCommand(0x00 + (colOffset & 0x0F));   // Set Lower Column Address (0x02 for SH1106 1.3")
      sendCommand(0x10 + ((colOffset >> 4) & 0x0F)); // Set Higher Column Address (0x10)

      uint16_t pageStart = page * 128;
      // Send 128 bytes per page in 16-byte I2C chunks to prevent Wire buffer overflow
      for (uint8_t chunk = 0; chunk < 128; chunk += 16) {
        Wire.beginTransmission(i2cAddr);
        Wire.write((uint8_t)0x40); // Data stream byte
        for (uint8_t i = 0; i < 16; i++) {
          Wire.write(buffer[pageStart + chunk + i]);
        }
        Wire.endTransmission();
      }
    }
  }
};

UniversalOLED display;
bool oledPresent = false;

// ---- Global Protocol State ----
MeshDedup dedupCache;
uint16_t msgCounter = 0;
String serialInputBuffer = "";

// Last Received Telemetry / Text Message State
uint8_t  lastRxNode = 0;
int      lastRxRssi = 0;
float    lastRxSnr = 0.0;
char     lastRxMsg[33] = "";
uint8_t  lastRxPktType = PKT_TYPE_TEXT;
uint8_t  lastRxAlertLevel = 0;
unsigned long lastRxTime = 0;

// ---- Received Messages Inbox History (Circular Buffer in RAM) ----
#define INBOX_CAPACITY 5

struct ReceivedMessage {
  uint8_t senderNode;
  uint8_t targetNode;
  int8_t  rssi;
  uint8_t alertLevel;
  uint8_t pktType;
  char    text[32];
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
uint8_t currentTargetIdx = 0; // Default 0 = Broadcast to all nodes

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
char splashLine1[22] = "";
char splashLine2[22] = "";

// Forward Declarations
void sendWalkieMessage(const char* text, uint8_t alertLevel = 0, uint8_t pktType = PKT_TYPE_TEXT, uint8_t targetNode = 0);
void updateOledDisplay();
void playToneBeep(uint16_t freq = 1800, uint8_t duration = 30);
void triggerInstantSos();

// ---- Helper Functions ----
uint16_t readBatteryMv() {
  int raw = analogRead(BATT_PIN);
  // 5V ADC ref with 2:1 divider = (raw * 5000 / 1023) * 2
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
  // Shift older messages down (index 0 is always newest)
  for (int8_t i = inboxCount - 1; i > 0; i--) {
    messageInbox[i] = messageInbox[i - 1];
  }
  messageInbox[0].senderNode = pkt.originNode;
  messageInbox[0].targetNode = pkt.targetNode;
  messageInbox[0].rssi = (int8_t)rssi;
  messageInbox[0].alertLevel = pkt.alert_level;
  messageInbox[0].pktType = pkt.packetType;
  strncpy(messageInbox[0].text, pkt.text_msg, sizeof(messageInbox[0].text) - 1);
  messageInbox[0].text[31] = '\0';
}

void drawHeader(const __FlashStringHelper* title) {
  display.setTextSize(1);
  display.setTextColor(1);
  display.setCursor(0, 0);
  display.print(title);
  
  display.setCursor(85, 0);
  uint16_t mv = readBatteryMv();
  display.print(mv / 1000.0, 1);
  display.print(F("V"));
  display.drawLine(0, 9, 127, 9, 1);
}

void drawHeader(const char* title) {
  display.setTextSize(1);
  display.setTextColor(1);
  display.setCursor(0, 0);
  display.print(title);
  
  display.setCursor(85, 0);
  uint16_t mv = readBatteryMv();
  display.print(mv / 1000.0, 1);
  display.print(F("V"));
  display.drawLine(0, 9, 127, 9, 1);
}

void drawFooter(const __FlashStringHelper* leftBtn, const __FlashStringHelper* rightBtn) {
  display.drawLine(0, 53, 127, 53, 1);
  display.setTextSize(1);
  display.setTextColor(1);
  display.setCursor(0, 56);
  display.print(F("[S]"));
  display.print(leftBtn);
  display.setCursor(68, 56);
  display.print(F("[C]"));
  display.print(rightBtn);
}

// ---- Main OLED Screen Renderer ----
void updateOledDisplay() {
  if (!oledPresent) return;

  display.clearDisplay();
  display.setTextColor(1);

  switch (uiState) {
    // ── 1. IDLE / STANDBY DASHBOARD ──────────────────────────────────────────
    case UI_STATE_IDLE: {
      char headerBuf[16];
      snprintf(headerBuf, sizeof(headerBuf), "WALKIE #%d", WALKIE_NODE_ID);
      drawHeader(headerBuf);

      // Active SOS Warning Banner
      if (lastRxAlertLevel > 0 && (millis() - lastRxTime < 30000)) {
        display.fillRect(0, 11, 128, 12, 1);
        display.setTextColor(0, 1); // Inverse text
        display.setCursor(4, 13);
        display.print(F("! EMERGENCY SOS !"));
        display.setTextColor(1);

        display.setCursor(0, 26);
        display.print(F("From Node #"));
        display.print(lastRxNode);

        display.setCursor(0, 37);
        display.print(lastRxMsg[0] ? lastRxMsg : "SOS TRIGGERED!");

        display.setCursor(0, 47);
        display.print(F("RSSI:"));
        display.print(lastRxRssi);
        display.print(F("dBm"));
      }
      else if (lastRxNode > 0 && (millis() - lastRxTime < 45000)) {
        // Recent Incoming Message Preview
        display.setCursor(0, 12);
        display.print(F("RX From #"));
        display.print(lastRxNode);
        if (inboxCount > 0) {
          display.print(F(" (New)"));
        }

        display.setCursor(0, 23);
        display.print(F("\""));
        display.print(lastRxMsg);
        display.print(F("\""));

        display.setCursor(0, 44);
        display.print(F("Sig:"));
        display.print(lastRxRssi);
        display.print(F("dBm "));
        display.print(lastRxSnr, 1);
        display.print(F("dB"));
      }
      else {
        // Standard Ready Standby State
        display.setCursor(0, 13);
        display.print(F("LoRa Mesh 433MHz"));
        display.setCursor(0, 24);
        display.print(F("Status: LISTENING"));
        display.setCursor(0, 35);
        display.print(F("Target: "));
        char tBuf[20];
        strcpy_P(tBuf, (char*)pgm_read_word(&(TARGET_NAMES[currentTargetIdx])));
        display.print(tBuf);
        display.setCursor(0, 45);
        display.print(F("Hold [CLK]=Instant SOS"));
      }

      drawFooter(F("Menu"), F("QuickSMS"));
      break;
    }

    // ── 2. MAIN MENU ────────────────────────────────────────────────────────
    case UI_STATE_MENU: {
      drawHeader(F("=== MAIN MENU ==="));

      const uint8_t TOTAL_MENU_ITEMS = 5;
      uint8_t topIdx = 0;
      if (menuIdx >= 2) topIdx = menuIdx - 1;
      if (topIdx > TOTAL_MENU_ITEMS - 3) topIdx = TOTAL_MENU_ITEMS - 3;

      for (uint8_t i = 0; i < 3; i++) {
        uint8_t cur = topIdx + i;
        int16_t y = 14 + (i * 12);
        display.setCursor(0, y);
        if (cur == menuIdx) {
          display.print(F("> "));
        } else {
          display.print(F("  "));
        }

        switch (cur) {
          case 0: display.print(F("1.Quick SMS")); break;
          case 1: {
            display.print(F("2.Inbox ("));
            display.print(inboxCount);
            display.print(F(")"));
            break;
          }
          case 2: display.print(F("3.Send SOS Alert")); break;
          case 3: display.print(F("4.Target Node")); break;
          case 4: display.print(F("5.Back to Idle")); break;
        }
      }

      drawFooter(F("Next"), F("Enter"));
      break;
    }

    // ── 3. PRESET QUICK SMS SELECTOR ─────────────────────────────────────────
    case UI_STATE_QUICK_SMS: {
      drawHeader(F("SEND QUICK SMS"));

      uint8_t topIdx = 0;
      if (presetIdx >= 2) topIdx = presetIdx - 1;
      if (topIdx > PRESET_COUNT - 3) topIdx = PRESET_COUNT - 3;

      char pBuf[24];
      for (uint8_t i = 0; i < 3; i++) {
        uint8_t cur = topIdx + i;
        int16_t y = 14 + (i * 12);
        display.setCursor(0, y);
        if (cur == presetIdx) {
          display.print(F(">"));
        } else {
          display.print(F(" "));
        }
        strcpy_P(pBuf, (char*)pgm_read_word(&(PRESET_MESSAGES[cur])));
        display.print(pBuf);
      }

      drawFooter(F("Next"), F("Send"));
      break;
    }

    // ── 4. RECEIVED MESSAGE INBOX HISTORY BROWSER ────────────────────────────
    case UI_STATE_INBOX: {
      drawHeader(F("INBOX HISTORY"));

      if (inboxCount == 0) {
        display.setCursor(0, 18);
        display.print(F("No messages received"));
        display.setCursor(0, 30);
        display.print(F("yet on this node."));
        display.setCursor(0, 42);
        display.print(F("Listening on 433MHz"));
        drawFooter(F("---"), F("Back"));
      } else {
        ReceivedMessage* m = &messageInbox[inboxBrowseIdx];

        display.setCursor(0, 11);
        display.print(F("#"));
        display.print(inboxBrowseIdx + 1);
        display.print(F("/"));
        display.print(inboxCount);
        display.print(F(" From:#"));
        display.print(m->senderNode);
        if (m->targetNode == 0) {
          display.print(F(" (All)"));
        } else {
          display.print(F(" (Dir)"));
        }

        display.setCursor(0, 23);
        if (m->alertLevel > 0) {
          display.print(F("!SOS! "));
        }
        display.print(F("\""));
        display.print(m->text);
        display.print(F("\""));

        display.setCursor(0, 44);
        display.print(F("Sig:"));
        display.print(m->rssi);
        display.print(F("dBm "));
        display.print(m->alertLevel > 0 ? F("ALERT:SOS") : F("TYPE:TXT"));

        drawFooter(F("NextMsg"), F("Back"));
      }
      break;
    }

    // ── 5. DESTINATION TARGET NODE SELECTOR ──────────────────────────────────
    case UI_STATE_TARGET: {
      drawHeader(F("TARGET DESTINATION"));

      uint8_t topIdx = 0;
      if (targetSelectIdx >= 2) topIdx = targetSelectIdx - 1;
      if (topIdx > TARGET_COUNT - 3) topIdx = TARGET_COUNT - 3;

      char tBuf[22];
      for (uint8_t i = 0; i < 3; i++) {
        uint8_t cur = topIdx + i;
        int16_t y = 14 + (i * 12);
        display.setCursor(0, y);
        if (cur == targetSelectIdx) {
          display.print(F(">"));
        } else {
          display.print(F(" "));
        }
        strcpy_P(tBuf, (char*)pgm_read_word(&(TARGET_NAMES[cur])));
        display.print(tBuf);
      }

      drawFooter(F("Next"), F("Set"));
      break;
    }

    // ── 6. EMERGENCY SOS CONFIRMATION ────────────────────────────────────────
    case UI_STATE_SOS_CONFIRM: {
      drawHeader(F("! CONFIRM SOS !"));
      display.setCursor(0, 14);
      display.print(F("Broadcast EMERGENCY"));
      display.setCursor(0, 26);
      display.print(F("SOS to all stations?"));
      display.setCursor(0, 40);
      display.print(F("Alert Level: CRITICAL"));
      drawFooter(F("Cancel"), F("CONFIRM"));
      break;
    }

    // ── 7. TEMPORARY STATUS SPLASH ──────────────────────────────────────────
    case UI_STATE_SPLASH: {
      drawHeader(F("TRANSMISSION"));
      display.setCursor(4, 20);
      display.setTextSize(1);
      display.print(splashLine1);
      display.setCursor(4, 34);
      display.print(splashLine2);
      display.drawLine(0, 53, 127, 53, 1);
      display.setCursor(20, 56);
      display.print(F("Please wait..."));
      break;
    }
  }

  display.display();
}

// ---- Transmit Walkie LoRa Message ----
void sendWalkieMessage(const char* text, uint8_t alertLevel, uint8_t pktType, uint8_t targetNode) {
  msgCounter++;
  
  LoRaMeshPacket pkt;
  memset(&pkt, 0, sizeof(pkt));

  // Parse target node from text if syntax "/{node_id}" was used (e.g. "Hello /102" or "/102 SOS")
  char cleanText[32];
  memset(cleanText, 0, sizeof(cleanText));
  uint8_t parsedTarget = parseTargetNodeFromText(text, cleanText, sizeof(cleanText));
  if (targetNode == 0) {
    targetNode = parsedTarget;
  }

  pkt.msgIdHi = (uint8_t)(msgCounter >> 8);
  pkt.msgIdLo = (uint8_t)(msgCounter & 0xFF);
  pkt.originNode = WALKIE_NODE_ID;
  pkt.targetNode = targetNode; // 0 = Broadcast, 1..255 = specific target node
  pkt.ttl = DEFAULT_MAX_TTL;
  pkt.packetType = pktType;
  pkt.alert_level = alertLevel;
  pkt.battery_mv = readBatteryMv();
  
  strncpy(pkt.text_msg, (cleanText[0] != '\0' ? cleanText : text), sizeof(pkt.text_msg) - 1);
  pkt.text_msg[sizeof(pkt.text_msg) - 1] = '\0';

  // Mark in local dedup cache so we don't process our own broadcast
  uint16_t msgId = ((uint16_t)pkt.msgIdHi << 8) | pkt.msgIdLo;
  dedupCache.markSeen(WALKIE_NODE_ID, msgId);

  // Transmit over LoRa
  digitalWrite(STATUS_LED_PIN, HIGH);
  LoRa.beginPacket();
  LoRa.write((uint8_t*)&pkt, sizeof(pkt));
  int res = LoRa.endPacket();
  digitalWrite(STATUS_LED_PIN, LOW);

  // Re-enter receive mode immediately
  LoRa.receive();

  Serial.println(F("\n=============================================="));
  if (res == 1) {
    Serial.print(F("🚀 [WALKIE TX SUCCESS] Sent "));
    Serial.print(pktType == PKT_TYPE_SOS ? F("EMERGENCY SOS") : F("TEXT MESSAGE"));
    Serial.print(F(" (MsgID=#")); Serial.print(msgId); Serial.println(F(")"));
    Serial.print(F(" - Target Node: #")); Serial.print(targetNode); Serial.println(targetNode == 0 ? F(" (BROADCAST)") : F(" (DIRECT)"));
    Serial.print(F(" - Message    : \"")); Serial.print(pkt.text_msg); Serial.println(F("\""));
    Serial.print(F(" - Alert Level: ")); Serial.println(alertLevel);
  } else {
    Serial.println(F("❌ [WALKIE TX FAIL] LoRa radio transmit error!"));
  }
  Serial.println(F("=============================================="));

  // Update local display with sent status
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
  char sosMsg[32];
  snprintf(sosMsg, sizeof(sosMsg), "SOS ALERT FROM NODE #%d!", WALKIE_NODE_ID);
  sendWalkieMessage(sosMsg, 2, PKT_TYPE_SOS, 0); // Always broadcast emergency to entire mesh
  triggerSplash("! EMERGENCY SOS !", "BROADCAST TO MESH");
}

// ---- Two-Button Navigation Event Handlers ----

// Button 1: SELECT (Cycle menu, next item, scroll inbox)
void handleSelectButton() {
  playToneBeep(1800, 30); // Subtle click chirp

  switch (uiState) {
    case UI_STATE_IDLE:
      // Open Main Menu
      uiState = UI_STATE_MENU;
      menuIdx = 0;
      break;

    case UI_STATE_MENU:
      // Cycle through menu items (0..4)
      menuIdx = (menuIdx + 1) % 5;
      break;

    case UI_STATE_QUICK_SMS:
      // Cycle through preset SMS options (0..9)
      presetIdx = (presetIdx + 1) % PRESET_COUNT;
      break;

    case UI_STATE_INBOX:
      // Scroll to previous received message in history
      if (inboxCount > 0) {
        inboxBrowseIdx = (inboxBrowseIdx + 1) % inboxCount;
      }
      break;

    case UI_STATE_TARGET:
      // Cycle through target nodes (0..4)
      targetSelectIdx = (targetSelectIdx + 1) % TARGET_COUNT;
      break;

    case UI_STATE_SOS_CONFIRM:
      // Cancel SOS and return to idle
      uiState = UI_STATE_IDLE;
      break;

    case UI_STATE_SPLASH:
      // Dismiss splash
      uiState = UI_STATE_IDLE;
      break;
  }

  updateOledDisplay();
}

// Button 2: CLICK (Enter, Confirm, Send SMS, or Exit Inbox)
void handleClickButton() {
  playToneBeep(2200, 45); // Confirmation tone

  switch (uiState) {
    case UI_STATE_IDLE:
      // Direct shortcut to Quick SMS
      uiState = UI_STATE_QUICK_SMS;
      presetIdx = 0;
      break;

    case UI_STATE_MENU:
      switch (menuIdx) {
        case 0: // 1. Quick SMS
          uiState = UI_STATE_QUICK_SMS;
          presetIdx = 0;
          break;
        case 1: // 2. Inbox History
          uiState = UI_STATE_INBOX;
          inboxBrowseIdx = 0;
          break;
        case 2: // 3. Send SOS Alert
          uiState = UI_STATE_SOS_CONFIRM;
          break;
        case 3: // 4. Target Node
          uiState = UI_STATE_TARGET;
          targetSelectIdx = currentTargetIdx;
          break;
        case 4: // 5. Back to Idle
          uiState = UI_STATE_IDLE;
          break;
      }
      break;

    case UI_STATE_QUICK_SMS:
      if (presetIdx == PRESET_COUNT - 1) {
        // User selected "< CANCEL / BACK >"
        uiState = UI_STATE_IDLE;
      } else {
        // Load selected preset from Flash and transmit!
        char sendBuf[32];
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
      // Exit inbox back to idle
      uiState = UI_STATE_IDLE;
      break;

    case UI_STATE_TARGET:
      // Confirm destination target node
      currentTargetIdx = targetSelectIdx;
      char setBuf[20];
      snprintf(setBuf, sizeof(setBuf), "Node #%d Active", TARGET_NODE_IDS[currentTargetIdx]);
      triggerSplash("TARGET UPDATED!", setBuf);
      return;

    case UI_STATE_SOS_CONFIRM:
      // Trigger full Emergency SOS broadcast
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

  // ── 1. SELECT BUTTON (Pin D7) — Active LOW ─────────────────────────────────
  static bool prevSelState = HIGH;
  static unsigned long selDebounceTime = 0;
  bool curSelState = digitalRead(BTN_SELECT_PIN);

  if (curSelState == LOW && prevSelState == HIGH && (now - selDebounceTime > 160)) {
    selDebounceTime = now;
    handleSelectButton();
  }
  prevSelState = curSelState;

  // ── 2. CLICK BUTTON (Pin D8) — Active LOW with Long-Press SOS Shortcut ────
  static bool prevClkState = HIGH;
  static unsigned long clkPressStart = 0;
  static bool longPressTriggered = false;
  bool curClkState = digitalRead(BTN_CLICK_PIN);

  if (curClkState == LOW && prevClkState == HIGH) {
    clkPressStart = now;
    longPressTriggered = false;
  } else if (curClkState == LOW && prevClkState == LOW) {
    // Check if held down for > 1500ms for INSTANT EMERGENCY SOS!
    if (!longPressTriggered && clkPressStart > 0 && (now - clkPressStart >= 1500)) {
      longPressTriggered = true;
      triggerInstantSos();
    }
  } else if (curClkState == HIGH && prevClkState == LOW) {
    // Button released
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
  Serial.println(F("\n=== FLAPMAIN LORA MESH WALKIE-TALKIE CLI ==="));
  Serial.print(F(" Node ID: #")); Serial.println(WALKIE_NODE_ID);
  Serial.println(F(" Hardware Controls:"));
  Serial.println(F("  - Button 1 (Pin D7): SELECT / Next Item / Browse Inbox."));
  Serial.println(F("  - Button 2 (Pin D8): CLICK / Confirm / Send Quick SMS."));
  Serial.println(F("  - Hold Button 2 (1.5s): INSTANT EMERGENCY SOS BROADCAST."));
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

  // Deduplication check
  if (dedupCache.alreadySeen(pkt.originNode, msgId)) return;
  dedupCache.markSeen(pkt.originNode, msgId);

  // Check target node filtering: is packet for ME or BROADCAST?
  bool isForMe = (pkt.targetNode == 0 || pkt.targetNode == WALKIE_NODE_ID);

  if (isForMe) {
    // Flash LED on receive
    digitalWrite(STATUS_LED_PIN, HIGH);
    delay(30);
    digitalWrite(STATUS_LED_PIN, LOW);

    // Audio chime on receive
    if (pkt.alert_level > 0) {
      soundAlarm();
    } else if (pkt.text_msg[0] != '\0') {
      playToneBeep(1400, 60);
    }

    // Save into Received Messages Inbox History
    saveToInbox(pkt, rssi);

    // Log incoming message
    Serial.println(F("\n=============================================="));
    Serial.print(F("📥 [WALKIE RECEIVED MESH DATA - FOR ME] MsgID=#")); Serial.println(msgId);
    Serial.print(F(" - Origin Node ID : #")); Serial.println(pkt.originNode);
    Serial.print(F(" - Target Node ID : #")); Serial.print(pkt.targetNode);
    Serial.println(pkt.targetNode == 0 ? F(" (BROADCAST)") : F(" (DIRECT TO ME)"));
    Serial.print(F(" - Packet Type    : ")); Serial.print(pkt.packetType);
    Serial.println(pkt.packetType == PKT_TYPE_SOS ? F(" (EMERGENCY SOS)") : F(" (TEXT)"));
    Serial.print(F(" - Hops Left (TTL): ")); Serial.println(pkt.ttl);
    Serial.print(F(" - Message Text   : \"")); Serial.print(pkt.text_msg); Serial.println(F("\""));
    Serial.print(F(" - Signal RSSI/SNR: ")); Serial.print(rssi); Serial.print(F(" dBm / ")); Serial.print(snr, 1); Serial.println(F(" dB"));
    Serial.println(F("=============================================="));

    // Update State & OLED Screen
    lastRxNode = pkt.originNode;
    lastRxRssi = rssi;
    lastRxSnr = snr;
    strncpy(lastRxMsg, pkt.text_msg, sizeof(lastRxMsg) - 1);
    lastRxMsg[sizeof(lastRxMsg) - 1] = '\0';
    lastRxPktType = pkt.packetType;
    lastRxAlertLevel = pkt.alert_level;
    lastRxTime = millis();

    // If on idle screen or if SOS arrived, refresh display immediately
    if (uiState == UI_STATE_IDLE || pkt.alert_level > 0) {
      if (pkt.alert_level > 0) {
        uiState = UI_STATE_IDLE; // Switch to idle to show big SOS warning banner
      }
      updateOledDisplay();
    }
  } else {
    Serial.println(F("\n=============================================="));
    Serial.print(F("🙈 [WALKIE RECEIVED MESH DATA - TARGETED TO NODE #")); Serial.print(pkt.targetNode);
    Serial.print(F("] (Not for Node #")); Serial.print(WALKIE_NODE_ID); Serial.println(F(", passing through mesh...)"));
    Serial.println(F("=============================================="));
  }

  // Automatic LoRa Mesh Relay Forwarding (if TTL > 1)
  if (pkt.ttl > 1) {
    LoRaMeshPacket relayPkt = pkt;
    relayPkt.ttl -= 1;

    // Random collision-avoidance jitter delay (50ms to 150ms)
    delay(random(50, 150));

    digitalWrite(STATUS_LED_PIN, HIGH);
    LoRa.beginPacket();
    LoRa.write((uint8_t*)&relayPkt, sizeof(relayPkt));
    LoRa.endPacket();
    digitalWrite(STATUS_LED_PIN, LOW);

    LoRa.receive(); // Re-enter continuous receive mode

    Serial.print(F("🚀 [WALKIE MESH RELAY] Forwarded MsgID=#"));
    Serial.print(msgId);
    Serial.print(F(" (New TTL="));
    Serial.print(relayPkt.ttl);
    Serial.println(F(")"));
  }
}

// ---- Setup Routine ----
void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);

  // Configure Two Push Buttons with Internal Pull-Ups
  pinMode(BTN_SELECT_PIN, INPUT_PULLUP);
  pinMode(BTN_CLICK_PIN,  INPUT_PULLUP);

  #if defined(BUZZER_PIN) && BUZZER_PIN > 0
    pinMode(BUZZER_PIN, OUTPUT);
    digitalWrite(BUZZER_PIN, LOW);
  #endif

  // Initialize Universal OLED (1.3" SH1106 & 0.96" SSD1306, 0x3C or 0x3D)
  if (display.begin(0x3C)) {
    oledPresent = true;
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(1);
    display.setCursor(10, 15);
    display.println(F("FLAPMAIN LORA MESH"));
    display.setCursor(10, 30);
    display.print(F("WALKIE #"));
    display.print(WALKIE_NODE_ID);
    display.setCursor(10, 45);
    display.println(F("Initializing..."));
    display.display();
  } else {
    Serial.println(F("WARNING: OLED Display not found at 0x3C or 0x3D! Check I2C SDA/SCL wiring."));
  }

  // Initialize SX1278 LoRa Radio
  LoRa.setPins(LORA_SS_PIN, LORA_RST_PIN, LORA_DIO0_PIN);
  LoRa.setSPIFrequency(4000000);

  if (!LoRa.begin(LORA_FREQUENCY)) {
    Serial.println(F("ERROR: SX1278 LoRa initialization failed! Check SPI connections."));
    if (oledPresent) {
      display.clearDisplay();
      display.setCursor(0, 20);
      display.println(F("LORA INIT FAIL!"));
      display.display();
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
  
  playToneBeep(2000, 60); // Startup chirp
  printSerialHelp();
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

  // 2. Non-blocking Check of Two Hardware Buttons (SELECT & CLICK)
  checkButtons();

  // 3. Auto-Dismiss Status Splash after timeout
  if (uiState == UI_STATE_SPLASH && (millis() - splashStartTime >= 1400)) {
    uiState = UI_STATE_IDLE;
    updateOledDisplay();
  }

  // 4. Periodic Battery & Status Refresh on Idle Screen (every 3 seconds)
  static unsigned long lastIdleRefresh = 0;
  if (uiState == UI_STATE_IDLE && (millis() - lastIdleRefresh > 3000)) {
    lastIdleRefresh = millis();
    updateOledDisplay();
  }

  // 5. Process Serial Monitor Input Commands (CLI Fallback)
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      serialInputBuffer.trim();
      if (serialInputBuffer.length() > 0) {
        if (serialInputBuffer.equalsIgnoreCase("/help")) {
          printSerialHelp();
        }
        else if (serialInputBuffer.equalsIgnoreCase("/ping")) {
          sendWalkieMessage("PING HEARTBEAT", 0, PKT_TYPE_HEARTBEAT, TARGET_NODE_IDS[currentTargetIdx]);
        }
        else if (serialInputBuffer.startsWith("/sos")) {
          String text = serialInputBuffer.substring(4);
          text.trim();
          if (text.length() == 0) text = "CRITICAL EMERGENCY SOS!";
          sendWalkieMessage(text.c_str(), 2, PKT_TYPE_SOS, 0);
        }
        else {
          sendWalkieMessage(serialInputBuffer.c_str(), 0, PKT_TYPE_TEXT, TARGET_NODE_IDS[currentTargetIdx]);
        }
        serialInputBuffer = "";
      }
    } else {
      if (serialInputBuffer.length() < 31) {
        serialInputBuffer += c;
      }
    }
  }

  delay(10);
}
