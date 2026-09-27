/*
 * =================================================================================
 * FLAPMAIN LORA MESH ESP8266 WALKIE-TALKIE & EMERGENCY SOS COMMUNICATOR
 * Board: ESP8266 (NodeMCU v1.0 / Wemos D1 Mini) + SX1278 LoRa + 1.3" / 0.96" OLED (SH1106 / SSD1306)
 * 
 * Hardware 2-Button Interactive Navigation:
 * - Button 1 (SELECT) -> Pin D5 (GPIO14, Active LOW with INPUT_PULLUP to GND)
 *   * Short-press: Cycles through menus, scrolls canned SMS, browses inbox history.
 *   * Long-press (>1.8s): Quickly exits any submenu back to HOME screen.
 * - Button 2 (CLICK)  -> Pin D6 (GPIO12, Active LOW with INPUT_PULLUP to GND)
 *   * Short-press: Selects menu item, sends selected SMS, or initiates reply from inbox.
 *   * Long-press (>1.8s): Direct emergency panic broadcast from ANY screen!
 * 
 * Pinout Mapping (NodeMCU / Wemos D1 Mini):
 * - SSD1306 / SH1106 OLED SDA: GPIO4  (D2) [Standard NodeMCU I2C SDA]
 * - SSD1306 / SH1106 OLED SCL: GPIO5  (D1) [Standard NodeMCU I2C SCL]
 * - SX1278 NSS / CS           : GPIO15 (D8) [SPI CS]
 * - SX1278 RESET              : GPIO0  (D3) [RST]
 * - SX1278 DIO0               : GPIO16 (D0) [DIO0 Interrupt]
 * - Button 1 (SELECT)         : GPIO14 (D5) [Active LOW with INPUT_PULLUP]
 * - Button 2 (CLICK / SOS)    : GPIO12 (D6) [Active LOW with INPUT_PULLUP]
 * - Battery ADC               : A0     (0..3.3V ADC)
 * - Status LED                : GPIO2  (D4 Built-in LED Active LOW)
 * 
 * Features:
 * - 2-Button OLED GUI with Home, Main Menu, Quick SMS, Inbox Log, Target Node, and Status.
 * - Circular Inbox Buffer storing previous received messages with RSSI, SNR, and sender Node ID.
 * - Fast preset tactical/emergency canned SMS messaging over 433MHz LoRa Mesh.
 * - Hardware Emergency SOS (confirmation menu + instant hardware long-press).
 * - Interactive Serial Monitor CLI for full keyboard walkie messaging.
 * - Deduplicated flood routing compatible with Arduino Nano & ESP Gateway nodes.
 * =================================================================================
 */

#include <ESP8266WiFi.h>
#include <SPI.h>
#include <Wire.h>
#include <LoRa.h>
#include <Adafruit_GFX.h>
#if defined(ESP8266) || defined(ESP32)
  #include <pgmspace.h>
#else
  #include <avr/pgmspace.h>
#endif
#include "lora_mesh_protocol.h"
#if __has_include("config.h")
  #include "config.h"
#endif

// ---- Default Node ID & Hardware Pins ----
#ifndef WALKIE_NODE_ID
  #define WALKIE_NODE_ID 103  // Default Node ID for ESP8266 Walkie (103)
#endif

#define OLED_SDA_PIN    4    // D2 (GPIO4)  Standard NodeMCU I2C SDA
#define OLED_SCL_PIN    5    // D1 (GPIO5)  Standard NodeMCU I2C SCL
#define LORA_SS_PIN     15   // D8 (GPIO15) SPI Chip Select
#define LORA_RST_PIN    0    // D3 (GPIO0)  SX1278 Reset
#define LORA_DIO0_PIN   16   // D0 (GPIO16) SX1278 Interrupt Pin
#define BATT_PIN        A0   // A0 Analog Battery Input (0..3.3V)
#define STATUS_LED_PIN  2    // D4 (GPIO2)  Built-in LED (Active LOW on ESP8266)

// 2-Button Interactive Hardware Navigation Pins (NodeMCU SD1 / SD2 Header Pins)
#ifndef BTN_SELECT_PIN
  #define BTN_SELECT_PIN  8  // GPIO8 (SD1 Pin, Active LOW with INPUT_PULLUP)
#endif
#ifndef BTN_CLICK_PIN
  #define BTN_CLICK_PIN   9  // GPIO9 (SD2 Pin, Active LOW with INPUT_PULLUP)
#endif

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

  bool begin(uint8_t preferredAddr = 0x3C, uint8_t sdaPin = OLED_SDA_PIN, uint8_t sclPin = OLED_SCL_PIN) {
    Wire.begin(sdaPin, sclPin);
    
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
      // Send 128 bytes per page in 16-byte I2C chunks
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

// ---- Global Protocol & Mesh State ----
MeshDedup dedupCache;
uint16_t msgCounter = 0;
String serialInputBuffer = "";

// Last Received Message State
uint8_t  lastRxNode = 0;
int      lastRxRssi = 0;
float    lastRxSnr = 0.0;
char     lastRxMsg[33] = "";
uint8_t  lastRxPktType = PKT_TYPE_TEXT;
uint8_t  lastRxAlertLevel = 0;
unsigned long lastRxTime = 0;

// Communication Counters
uint16_t txCount = 0;
uint16_t rxCount = 0;

// ---- Circular Buffer for Received Message History (Inbox) ----
#define MAX_INBOX_SIZE 5

struct InboxMessage {
  uint8_t  originNode;
  uint8_t  targetNode;
  uint8_t  packetType;
  uint8_t  alertLevel;
  int16_t  rssi;
  int8_t   snr;
  char     text[32];
  uint32_t receivedAt;
};

InboxMessage inbox[MAX_INBOX_SIZE];
uint8_t inboxCount = 0;
int8_t  inboxViewIdx = 0;

void addMessageToInbox(const LoRaMeshPacket* pkt, int rssi, float snr) {
  if (inboxCount < MAX_INBOX_SIZE) {
    inboxCount++;
  }
  for (int i = inboxCount - 1; i > 0; i--) {
    inbox[i] = inbox[i - 1];
  }
  inbox[0].originNode = pkt->originNode;
  inbox[0].targetNode = pkt->targetNode;
  inbox[0].packetType = pkt->packetType;
  inbox[0].alertLevel = pkt->alert_level;
  inbox[0].rssi = (int16_t)rssi;
  inbox[0].snr = (int8_t)snr;
  strncpy(inbox[0].text, pkt->text_msg, sizeof(inbox[0].text) - 1);
  inbox[0].text[sizeof(inbox[0].text) - 1] = '\0';
  inbox[0].receivedAt = millis();
}

// ---- Preset Tactical / Emergency Short SMS Messages in PROGMEM ----
const char canned_0[] PROGMEM = "ROGER / RECEIVED";
const char canned_1[] PROGMEM = "AFFIRMATIVE / YES";
const char canned_2[] PROGMEM = "NEGATIVE / NO";
const char canned_3[] PROGMEM = "NEED ASSISTANCE";
const char canned_4[] PROGMEM = "ON MY WAY";
const char canned_5[] PROGMEM = "ARRIVED SAFELY";
const char canned_6[] PROGMEM = "SAY AGAIN / REPEAT";
const char canned_7[] PROGMEM = "ALL CLEAR / SECURE";
const char canned_8[] PROGMEM = "BATTERY LOW";
const char canned_9[] PROGMEM = "STANDBY";
const char canned_10[] PROGMEM = "< BACK";

const char* const cannedMessages[] PROGMEM = {
  canned_0, canned_1, canned_2, canned_3, canned_4,
  canned_5, canned_6, canned_7, canned_8, canned_9, canned_10
};
const uint8_t CANNED_MSG_COUNT = 11;

// Main Menu Items in PROGMEM
const char menu_0[] PROGMEM = "1. Quick SMS";
const char menu_1[] PROGMEM = "2. Inbox History";
const char menu_2[] PROGMEM = "3. Send SOS Alert";
const char menu_3[] PROGMEM = "4. Set Target Node";
const char menu_4[] PROGMEM = "5. Node Status";
const char menu_5[] PROGMEM = "6. Back to Home";

const char* const mainMenuItems[] PROGMEM = {
  menu_0, menu_1, menu_2, menu_3, menu_4, menu_5
};
const uint8_t MAIN_MENU_COUNT = 6;

// Target Node Options in PROGMEM
const char target_0[] PROGMEM = "0 (ALL BCAST)";
const char target_1[] PROGMEM = "101 (Walkie A)";
const char target_2[] PROGMEM = "102 (Walkie B)";
const char target_3[] PROGMEM = "103 (ESP Walkie)";
const char target_4[] PROGMEM = "1 (AWS Node 1)";
const char target_5[] PROGMEM = "2 (AWS Node 2)";
const char target_6[] PROGMEM = "10 (ESP Gateway)";
const char target_7[] PROGMEM = "< BACK";

const char* const targetMenuNames[] PROGMEM = {
  target_0, target_1, target_2, target_3, target_4, target_5, target_6, target_7
};
const uint8_t targetNodeValues[] PROGMEM = {
  0, 101, 102, 103, 1, 2, 10, 255
};
const uint8_t TARGET_MENU_COUNT = 8;

// ---- UI Navigation States ----
enum WalkieScreen {
  SCREEN_HOME = 0,
  SCREEN_MENU,
  SCREEN_QUICK_SMS,
  SCREEN_INBOX,
  SCREEN_CONFIRM_SOS,
  SCREEN_TARGET,
  SCREEN_STATUS,
  SCREEN_ALERT_POPUP
};

WalkieScreen currentScreen = SCREEN_HOME;
uint8_t menuCursor = 0;
uint8_t smsCursor = 0;
uint8_t targetCursor = 0;
uint8_t sosConfirmCursor = 0;
uint8_t currentTargetNode = 0; // 0 = Broadcast to all
unsigned long lastUserInteraction = 0;
char popupText[24] = "";
unsigned long popupEndTime = 0;

void showPopup(const char* text, unsigned long durationMs = 2000) {
  strncpy(popupText, text, sizeof(popupText) - 1);
  popupText[sizeof(popupText) - 1] = '\0';
  popupEndTime = millis() + durationMs;
  currentScreen = SCREEN_ALERT_POPUP;
}

// ---- Debounced Button Handler ----
enum ButtonEvent {
  BTN_NONE = 0,
  BTN_SHORT_CLICK,
  BTN_LONG_PRESS
};

struct DebouncedButton {
  uint8_t pin;
  bool lastState;
  bool isPressed;
  unsigned long pressStart;
  bool longPressFired;

  void init(uint8_t p) {
    pin = p;
    pinMode(pin, INPUT_PULLUP);
    lastState = HIGH;
    isPressed = false;
    pressStart = 0;
    longPressFired = false;
  }

  ButtonEvent update() {
    bool raw = digitalRead(pin);
    unsigned long now = millis();
    ButtonEvent evt = BTN_NONE;

    // Active LOW button
    if (raw == LOW && lastState == HIGH) {
      pressStart = now;
      isPressed = true;
      longPressFired = false;
    } else if (raw == LOW && isPressed) {
      if (!longPressFired && (now - pressStart >= 1800)) {
        longPressFired = true;
        evt = BTN_LONG_PRESS;
      }
    } else if (raw == HIGH && lastState == LOW) {
      if (isPressed) {
        if (!longPressFired && (now - pressStart >= 40) && (now - pressStart < 1800)) {
          evt = BTN_SHORT_CLICK;
        }
        isPressed = false;
        longPressFired = false;
      }
    }
    lastState = raw;
    return evt;
  }
};

DebouncedButton btnSelect;
DebouncedButton btnClick;

// ---- Forward Declarations ----
void updateOledDisplay();
void sendWalkieMessage(const char* text, uint8_t alertLevel = 0, uint8_t pktType = PKT_TYPE_TEXT, uint8_t targetNode = 255);

// ---- Helper Functions ----
uint16_t readBatteryMv() {
  int raw = analogRead(BATT_PIN);
  // ESP8266 0..1023 ADC mapped to 0..3300 mV
  return (uint16_t)((raw * 3300UL) / 1023UL);
}

// ---- OLED Screen Renderers ----
void drawHomeScreen() {
  // Top Status Bar: Node ID and Battery Voltage
  display.setCursor(0, 0);
  display.print(F("ESP#"));
  display.print(WALKIE_NODE_ID);
  display.print(F("->#"));
  if (currentTargetNode == 0) display.print(F("ALL"));
  else display.print(currentTargetNode);

  display.setCursor(94, 0);
  uint16_t mv = readBatteryMv();
  display.print(mv / 1000.0, 1);
  display.print(F("V"));

  display.drawLine(0, 9, 127, 9, 1);

  // Emergency SOS Alert Active
  if (lastRxAlertLevel > 0 && (millis() - lastRxTime < 30000)) {
    display.fillRect(0, 11, 128, 11, 1);
    display.setTextColor(0, 1);
    display.setCursor(6, 13);
    display.print(F("! EMERGENCY SOS !"));
    display.setTextColor(1);

    display.setCursor(0, 24);
    display.print(F("From Node #"));
    display.print(lastRxNode);

    display.setCursor(0, 35);
    display.print(lastRxMsg[0] ? lastRxMsg : "SOS TRIGGERED!");

    display.setCursor(0, 47);
    display.print(F("RSSI:"));
    display.print(lastRxRssi);
    display.print(F("dBm"));

    display.setCursor(0, 56);
    display.print(F("[SEL]Menu  [CLK]SMS"));
  }
  // Recent Text Message Received (< 60s)
  else if (lastRxNode > 0 && (millis() - lastRxTime < 60000)) {
    display.setCursor(0, 12);
    display.print(F("RX #"));
    display.print(lastRxNode);
    if (lastRxNode == currentTargetNode) display.print(F(" [DIR]"));
    else display.print(F(" [BC]"));

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

    display.setCursor(0, 55);
    display.print(F("[SEL]Menu  [CLK]SMS"));
  }
  // Default Idle / Online Screen
  else {
    display.setCursor(0, 13);
    display.print(F("Status: ONLINE (ESP8266)"));

    display.setCursor(0, 24);
    display.print(F("Target: #"));
    if (currentTargetNode == 0) display.print(F("0 (BROADCAST)"));
    else display.print(currentTargetNode);

    display.setCursor(0, 36);
    display.print(F("[SEL] Menu / Inbox"));

    display.setCursor(0, 46);
    display.print(F("[CLK] Send Quick SMS"));

    display.setCursor(0, 56);
    display.print(F("Hold CLK: Direct SOS"));
  }
}

void drawMenuScreen() {
  display.setCursor(16, 0);
  display.print(F("=== MAIN MENU ==="));
  display.drawLine(0, 9, 127, 9, 1);

  uint8_t topIndex = 0;
  if (menuCursor >= 4) {
    topIndex = menuCursor - 3;
  }

  for (uint8_t i = 0; i < 4; i++) {
    uint8_t itemIdx = topIndex + i;
    if (itemIdx < MAIN_MENU_COUNT) {
      int y = 12 + (i * 10);
      if (itemIdx == menuCursor) {
        display.fillRect(0, y - 1, 128, 9, 1);
        display.setTextColor(0, 1);
        display.setCursor(2, y);
        display.print(F("> "));
      } else {
        display.setTextColor(1);
        display.setCursor(10, y);
      }
      char buf[20];
      strcpy_P(buf, (char*)pgm_read_ptr(&(mainMenuItems[itemIdx])));
      display.print(buf);
    }
  }

  display.setTextColor(1);
  display.setCursor(0, 55);
  display.print(F("[SEL]Down [CLK]Select"));
}

void drawQuickSmsScreen() {
  display.setCursor(0, 0);
  display.print(F("SMS -> "));
  if (currentTargetNode == 0) display.print(F("ALL (BCAST)"));
  else { display.print(F("NODE #")); display.print(currentTargetNode); }
  display.drawLine(0, 9, 127, 9, 1);

  uint8_t topIndex = 0;
  if (smsCursor >= 4) {
    topIndex = smsCursor - 3;
  }

  for (uint8_t i = 0; i < 4; i++) {
    uint8_t itemIdx = topIndex + i;
    if (itemIdx < CANNED_MSG_COUNT) {
      int y = 12 + (i * 10);
      if (itemIdx == smsCursor) {
        display.fillRect(0, y - 1, 128, 9, 1);
        display.setTextColor(0, 1);
        display.setCursor(2, y);
        display.print(F("> "));
      } else {
        display.setTextColor(1);
        display.setCursor(10, y);
      }
      char buf[21];
      strcpy_P(buf, (char*)pgm_read_ptr(&(cannedMessages[itemIdx])));
      display.print(buf);
    }
  }

  display.setTextColor(1);
  display.setCursor(0, 55);
  display.print(F("[SEL]Scroll  [CLK]Send"));
}

void drawInboxScreen() {
  if (inboxCount == 0) {
    display.setCursor(22, 0);
    display.print(F("INBOX [EMPTY]"));
    display.drawLine(0, 9, 127, 9, 1);

    display.setCursor(12, 22);
    display.print(F("No messages received"));
    display.setCursor(16, 36);
    display.print(F("Waiting for mesh..."));
    display.setCursor(8, 55);
    display.print(F("[Press CLK to Return]"));
    return;
  }

  display.setCursor(0, 0);
  display.print(F("INBOX ["));
  display.print(inboxViewIdx + 1);
  display.print(F("/"));
  display.print(inboxCount);
  display.print(F("]"));

  display.setCursor(84, 0);
  display.print(inbox[inboxViewIdx].rssi);
  display.print(F("dBm"));
  display.drawLine(0, 9, 127, 9, 1);

  display.setCursor(0, 12);
  if (inbox[inboxViewIdx].alertLevel > 0) {
    display.print(F("!SOS! From: #"));
  } else {
    display.print(F("From: Node #"));
  }
  display.print(inbox[inboxViewIdx].originNode);
  if (inbox[inboxViewIdx].targetNode != 0) {
    display.print(F(" (DIR)"));
  }

  // Split message text over two lines if needed
  char line1[21];
  char line2[21];
  memset(line1, 0, sizeof(line1));
  memset(line2, 0, sizeof(line2));
  strncpy(line1, inbox[inboxViewIdx].text, 20);
  if (strlen(inbox[inboxViewIdx].text) > 20) {
    strncpy(line2, inbox[inboxViewIdx].text + 20, 20);
  }

  display.setCursor(0, 23);
  display.print(line1);
  if (line2[0] != '\0') {
    display.setCursor(0, 33);
    display.print(line2);
  }

  display.setCursor(0, 44);
  display.print(F("SNR:"));
  display.print(inbox[inboxViewIdx].snr);
  display.print(F("dB Age:"));
  unsigned long secAgo = (millis() - inbox[inboxViewIdx].receivedAt) / 1000UL;
  if (secAgo < 60) {
    display.print(secAgo); display.print(F("s"));
  } else {
    display.print(secAgo / 60); display.print(F("m"));
  }

  display.setCursor(0, 55);
  display.print(F("[SEL]Next [CLK]Reply"));
}

void drawConfirmSosScreen() {
  display.fillRect(0, 0, 128, 12, 1);
  display.setTextColor(0, 1);
  display.setCursor(6, 2);
  display.print(F("! EMERGENCY SOS !"));
  display.setTextColor(1);

  display.setCursor(4, 16);
  display.print(F("Broadcast Panic to"));
  display.setCursor(4, 26);
  display.print(F("ALL mesh nodes now?"));

  if (sosConfirmCursor == 0) {
    display.fillRect(6, 37, 116, 10, 1);
    display.setTextColor(0, 1);
    display.setCursor(10, 38);
    display.print(F("> [ CANCEL ]"));
    display.setTextColor(1);

    display.setCursor(10, 49);
    display.print(F("  [ SEND SOS NOW ]"));
  } else {
    display.setTextColor(1);
    display.setCursor(10, 38);
    display.print(F("  [ CANCEL ]"));

    display.fillRect(6, 48, 116, 10, 1);
    display.setTextColor(0, 1);
    display.setCursor(10, 49);
    display.print(F("> [ SEND SOS NOW ]"));
    display.setTextColor(1);
  }

  display.setCursor(0, 56);
  display.print(F("[SEL]Toggle [CLK]Exec"));
}

void drawTargetScreen() {
  display.setCursor(0, 0);
  display.print(F("SET DEST (Now:#"));
  display.print(currentTargetNode);
  display.print(F(")"));
  display.drawLine(0, 9, 127, 9, 1);

  uint8_t topIndex = 0;
  if (targetCursor >= 4) {
    topIndex = targetCursor - 3;
  }

  for (uint8_t i = 0; i < 4; i++) {
    uint8_t itemIdx = topIndex + i;
    if (itemIdx < TARGET_MENU_COUNT) {
      int y = 12 + (i * 10);
      if (itemIdx == targetCursor) {
        display.fillRect(0, y - 1, 128, 9, 1);
        display.setTextColor(0, 1);
        display.setCursor(2, y);
        display.print(F("> "));
      } else {
        display.setTextColor(1);
        display.setCursor(10, y);
      }
      char buf[20];
      strcpy_P(buf, (char*)pgm_read_ptr(&(targetMenuNames[itemIdx])));
      display.print(buf);
    }
  }

  display.setTextColor(1);
  display.setCursor(0, 55);
  display.print(F("[SEL]Scroll  [CLK]Set"));
}

void drawStatusScreen() {
  display.setCursor(8, 0);
  display.print(F("ESP WALKIE #"));
  display.print(WALKIE_NODE_ID);
  display.print(F(" STATUS"));
  display.drawLine(0, 9, 127, 9, 1);

  display.setCursor(0, 12);
  display.print(F("Target: Node #"));
  if (currentTargetNode == 0) display.print(F("0 (BCAST)"));
  else display.print(currentTargetNode);

  display.setCursor(0, 22);
  display.print(F("Batt  : "));
  uint16_t mv = readBatteryMv();
  display.print(mv / 1000.0, 2);
  display.print(F("V ("));
  display.print(mv);
  display.print(F("mV)"));

  display.setCursor(0, 32);
  display.print(F("Mesh  : TX:"));
  display.print(txCount);
  display.print(F(" | RX:"));
  display.print(rxCount);

  display.setCursor(0, 42);
  display.print(F("Radio : 433M SF10 BW125"));

  display.setCursor(0, 55);
  display.print(F("[Click Any Key: Exit]"));
}

void drawAlertPopupScreen() {
  display.drawRect(2, 6, 124, 52, 1);
  display.drawRect(4, 8, 120, 48, 1);

  display.setCursor(12, 12);
  display.print(F("*** NOTIFICATION ***"));

  display.setCursor(10, 27);
  display.print(popupText);

  display.setCursor(12, 44);
  display.print(F("Returning to Home..."));
}

void updateOledDisplay() {
  if (!oledPresent) return;

  display.clearDisplay();
  display.setTextColor(1);
  display.setTextSize(1);

  switch (currentScreen) {
    case SCREEN_HOME:
      drawHomeScreen();
      break;
    case SCREEN_MENU:
      drawMenuScreen();
      break;
    case SCREEN_QUICK_SMS:
      drawQuickSmsScreen();
      break;
    case SCREEN_INBOX:
      drawInboxScreen();
      break;
    case SCREEN_CONFIRM_SOS:
      drawConfirmSosScreen();
      break;
    case SCREEN_TARGET:
      drawTargetScreen();
      break;
    case SCREEN_STATUS:
      drawStatusScreen();
      break;
    case SCREEN_ALERT_POPUP:
      drawAlertPopupScreen();
      break;
  }

  display.display();
}

// ---- Transmit Function ----
void sendWalkieMessage(const char* text, uint8_t alertLevel, uint8_t pktType, uint8_t targetNode) {
  msgCounter++;
  txCount++;
  
  LoRaMeshPacket pkt;
  memset(&pkt, 0, sizeof(pkt));

  // Parse target node from text if syntax "/{node_id}" was used (e.g. "Hello /102")
  char cleanText[32];
  memset(cleanText, 0, sizeof(cleanText));
  uint8_t parsedTarget = parseTargetNodeFromText(text, cleanText, sizeof(cleanText));

  if (targetNode == 255) {
    if (parsedTarget != 0) {
      targetNode = parsedTarget;
    } else {
      targetNode = currentTargetNode;
    }
  }

  // Emergency SOS packets are ALWAYS broadcast to everyone
  if (pktType == PKT_TYPE_SOS) {
    targetNode = 0;
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

  // Mark in local dedup cache so we don't process our own broadcast
  uint16_t msgId = ((uint16_t)pkt.msgIdHi << 8) | pkt.msgIdLo;
  dedupCache.markSeen(WALKIE_NODE_ID, msgId);

  // Transmit over LoRa (Active LOW LED on ESP8266)
  digitalWrite(STATUS_LED_PIN, LOW);
  LoRa.beginPacket();
  LoRa.write((uint8_t*)&pkt, sizeof(pkt));
  int res = LoRa.endPacket();
  digitalWrite(STATUS_LED_PIN, HIGH);

  // Re-enter receive mode immediately
  LoRa.receive();

  Serial.println(F("\n=============================================="));
  if (res == 1) {
    Serial.print(F("🚀 [ESP WALKIE TX SUCCESS] Sent "));
    Serial.print(pktType == PKT_TYPE_SOS ? F("EMERGENCY SOS") : F("TEXT MESSAGE"));
    Serial.print(F(" (MsgID=#")); Serial.print(msgId); Serial.println(F(")"));
    Serial.print(F(" - Target Node: #")); Serial.print(targetNode); Serial.println(targetNode == 0 ? F(" (BROADCAST)") : F(" (DIRECT)"));
    Serial.print(F(" - Message    : \"")); Serial.print(pkt.text_msg); Serial.println(F("\""));
    Serial.print(F(" - Alert      : ")); Serial.println(alertLevel);
  } else {
    Serial.println(F("❌ [ESP WALKIE TX FAIL] LoRa radio transmit error!"));
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

// ---- Direct Panic SOS Trigger ----
void triggerEmergencySos() {
  lastUserInteraction = millis();
  char sosMsg[32];
  snprintf(sosMsg, sizeof(sosMsg), "ESP SOS FROM #%d!", WALKIE_NODE_ID);
  sendWalkieMessage(sosMsg, 2, PKT_TYPE_SOS, 0);
  showPopup("! EMERGENCY SOS !", 2500);
  updateOledDisplay();
}

// ---- Button Event Handlers ----
void handleSelectButton() {
  lastUserInteraction = millis();

  switch (currentScreen) {
    case SCREEN_HOME:
      currentScreen = SCREEN_MENU;
      menuCursor = 0;
      break;

    case SCREEN_MENU:
      menuCursor = (menuCursor + 1) % MAIN_MENU_COUNT;
      break;

    case SCREEN_QUICK_SMS:
      smsCursor = (smsCursor + 1) % CANNED_MSG_COUNT;
      break;

    case SCREEN_INBOX:
      if (inboxCount > 0) {
        inboxViewIdx = (inboxViewIdx + 1) % inboxCount;
      } else {
        currentScreen = SCREEN_HOME;
      }
      break;

    case SCREEN_CONFIRM_SOS:
      sosConfirmCursor = (sosConfirmCursor + 1) % 2;
      break;

    case SCREEN_TARGET:
      targetCursor = (targetCursor + 1) % TARGET_MENU_COUNT;
      break;

    case SCREEN_STATUS:
      currentScreen = SCREEN_HOME;
      break;

    case SCREEN_ALERT_POPUP:
      currentScreen = SCREEN_HOME;
      break;
  }

  updateOledDisplay();
}

void handleClickButton() {
  lastUserInteraction = millis();

  switch (currentScreen) {
    case SCREEN_HOME:
      // Fast shortcut into Quick SMS list
      currentScreen = SCREEN_QUICK_SMS;
      smsCursor = 0;
      break;

    case SCREEN_MENU:
      switch (menuCursor) {
        case 0: // 1. Quick SMS
          currentScreen = SCREEN_QUICK_SMS;
          smsCursor = 0;
          break;
        case 1: // 2. Inbox History
          currentScreen = SCREEN_INBOX;
          inboxViewIdx = 0;
          break;
        case 2: // 3. Send SOS
          currentScreen = SCREEN_CONFIRM_SOS;
          sosConfirmCursor = 0;
          break;
        case 3: // 4. Target Node
          currentScreen = SCREEN_TARGET;
          targetCursor = 0;
          break;
        case 4: // 5. Node Status
          currentScreen = SCREEN_STATUS;
          break;
        case 5: // 6. Back to Home
          currentScreen = SCREEN_HOME;
          break;
      }
      break;

    case SCREEN_QUICK_SMS:
      if (smsCursor == CANNED_MSG_COUNT - 1) {
        currentScreen = SCREEN_MENU;
      } else {
        char msgToSend[32];
        strcpy_P(msgToSend, (char*)pgm_read_ptr(&(cannedMessages[smsCursor])));
        sendWalkieMessage(msgToSend, 0, PKT_TYPE_TEXT, currentTargetNode);
        char pop[24];
        snprintf(pop, sizeof(pop), "SENT -> #%d", currentTargetNode);
        showPopup(pop, 1800);
      }
      break;

    case SCREEN_INBOX:
      if (inboxCount == 0) {
        currentScreen = SCREEN_HOME;
      } else {
        // Fast reply: set current target to the message sender and open Quick SMS
        currentTargetNode = inbox[inboxViewIdx].originNode;
        currentScreen = SCREEN_QUICK_SMS;
        smsCursor = 0;
      }
      break;

    case SCREEN_CONFIRM_SOS:
      if (sosConfirmCursor == 1) {
        char sosMsg[32];
        snprintf(sosMsg, sizeof(sosMsg), "ESP SOS FROM NODE #%d!", WALKIE_NODE_ID);
        sendWalkieMessage(sosMsg, 2, PKT_TYPE_SOS, 0);
        showPopup("! SOS BROADCAST !", 2500);
      } else {
        currentScreen = SCREEN_HOME;
      }
      break;

    case SCREEN_TARGET:
      if (targetCursor == TARGET_MENU_COUNT - 1) {
        currentScreen = SCREEN_MENU;
      } else {
        uint8_t selectedId = pgm_read_byte(&(targetNodeValues[targetCursor]));
        currentTargetNode = selectedId;
        char pop[24];
        snprintf(pop, sizeof(pop), "TARGET: #%d", currentTargetNode);
        showPopup(pop, 1800);
      }
      break;

    case SCREEN_STATUS:
      currentScreen = SCREEN_HOME;
      break;

    case SCREEN_ALERT_POPUP:
      currentScreen = SCREEN_HOME;
      break;
  }

  updateOledDisplay();
}

void printSerialHelp() {
  Serial.println(F("\n=== FLAPMAIN ESP8266 LORA MESH WALKIE-TALKIE CLI ==="));
  Serial.print(F(" ESP Node ID: #")); Serial.println(WALKIE_NODE_ID);
  Serial.println(F(" Instructions:"));
  Serial.println(F("  - Type text and hit Enter to broadcast or send to current target."));
  Serial.println(F("  - Type 'text /{node_id}' to send to specific node (e.g., 'Hello /102')."));
  Serial.println(F("  - Type '/sos <message>' to broadcast an Emergency SOS alert."));
  Serial.println(F("  - Press physical D6 button to trigger Emergency SOS (or hold >1.8s)."));
  Serial.println(F("  - Press physical D5 button to open Menu / scroll items."));
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
    rxCount++;

    // Flash LED on receive (Active LOW on ESP8266)
    digitalWrite(STATUS_LED_PIN, LOW);
    delay(30);
    digitalWrite(STATUS_LED_PIN, HIGH);

    // Log incoming message
    Serial.println(F("\n=============================================="));
    Serial.print(F("📥 [ESP WALKIE RECEIVED MESH DATA - FOR ME] MsgID=#")); Serial.println(msgId);
    Serial.print(F(" - Origin Node ID : #")); Serial.println(pkt.originNode);
    Serial.print(F(" - Target Node ID : #")); Serial.print(pkt.targetNode);
    Serial.println(pkt.targetNode == 0 ? F(" (BROADCAST)") : F(" (DIRECT TO ME)"));
    Serial.print(F(" - Packet Type    : ")); Serial.print(pkt.packetType);
    Serial.println(pkt.packetType == PKT_TYPE_SOS ? F(" (EMERGENCY SOS)") : F(" (TEXT)"));
    Serial.print(F(" - Hops Left (TTL): ")); Serial.println(pkt.ttl);
    Serial.print(F(" - Message Text   : \"")); Serial.print(pkt.text_msg); Serial.println(F("\""));
    Serial.print(F(" - Signal RSSI/SNR: ")); Serial.print(rssi); Serial.print(F(" dBm / ")); Serial.print(snr, 1); Serial.println(F(" dB"));
    Serial.println(F("=============================================="));

    // Update State
    lastRxNode = pkt.originNode;
    lastRxRssi = rssi;
    lastRxSnr = snr;
    strncpy(lastRxMsg, pkt.text_msg, sizeof(lastRxMsg) - 1);
    lastRxMsg[sizeof(lastRxMsg) - 1] = '\0';
    lastRxPktType = pkt.packetType;
    lastRxAlertLevel = pkt.alert_level;
    lastRxTime = millis();

    // Store in circular message history inbox
    addMessageToInbox(&pkt, rssi, snr);

    // If an emergency SOS arrives, immediately switch to HOME screen so it's impossible to miss!
    if (pkt.packetType == PKT_TYPE_SOS || pkt.alert_level > 0) {
      currentScreen = SCREEN_HOME;
    }

    updateOledDisplay();
  } else {
    Serial.println(F("\n=============================================="));
    Serial.print(F("🙈 [ESP WALKIE RECEIVED MESH DATA - TARGETED TO NODE #")); Serial.print(pkt.targetNode);
    Serial.print(F("] (Not for Node #")); Serial.print(WALKIE_NODE_ID); Serial.println(F(", passing through mesh...)"));
    Serial.println(F("=============================================="));
  }

  // Automatic LoRa Mesh Relay Forwarding (if TTL > 1)
  if (pkt.ttl > 1) {
    LoRaMeshPacket relayPkt = pkt;
    relayPkt.ttl -= 1;

    // Random collision-avoidance jitter delay (50ms to 150ms)
    delay(random(50, 150));

    digitalWrite(STATUS_LED_PIN, LOW); // LED ON
    LoRa.beginPacket();
    LoRa.write((uint8_t*)&relayPkt, sizeof(relayPkt));
    LoRa.endPacket();
    digitalWrite(STATUS_LED_PIN, HIGH); // LED OFF

    LoRa.receive(); // Re-enter continuous receive mode

    Serial.print(F("🚀 [ESP WALKIE MESH RELAY] Forwarded MsgID=#"));
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

  // Disable Wi-Fi to eliminate 2.4GHz RF noise & reduce power consumption
  WiFi.mode(WIFI_OFF);
  WiFi.forceSleepBegin();
  delay(1);

  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, HIGH); // OFF (Active LOW)

  // Initialize Debounced Push Buttons (D5 = SELECT, D6 = CLICK)
  btnSelect.init(BTN_SELECT_PIN);
  btnClick.init(BTN_CLICK_PIN);

  // Initialize Universal OLED (1.3" SH1106 & 0.96" SSD1306, 0x3C or 0x3D)
  if (display.begin(0x3C, OLED_SDA_PIN, OLED_SCL_PIN)) {
    oledPresent = true;
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(1);
    display.setCursor(10, 15);
    display.println(F("FLAPMAIN ESP MESH"));
    display.setCursor(10, 30);
    display.print(F("ESP WALKIE #"));
    display.print(WALKIE_NODE_ID);
    display.setCursor(10, 45);
    display.println(F("Initializing..."));
    display.display();
  } else {
    Serial.println(F("WARNING: OLED Display not found at 0x3C or 0x3D! Check Wire I2C SDA/SCL pins."));
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
  
  printSerialHelp();
  updateOledDisplay();
}

// ---- Main Loop ----
void loop() {
  // Yield to ESP8266 system Watchdog timer
  yield();

  // 1. Process LoRa Packet Reception
  int packetSize = LoRa.parsePacket();
  if (packetSize > 0) {
    processIncomingPacket(packetSize);
    LoRa.receive();
  }

  // 2. Process Hardware Buttons
  ButtonEvent selEvt = btnSelect.update();
  ButtonEvent clkEvt = btnClick.update();

  // Instant Emergency Panic: Long-press (>1.8s) on CLICK button triggers SOS from ANY screen!
  if (clkEvt == BTN_LONG_PRESS) {
    triggerEmergencySos();
  }
  // Short press on CLICK button
  else if (clkEvt == BTN_SHORT_CLICK) {
    handleClickButton();
  }

  // Long-press on SELECT button exits any submenu back to SCREEN_HOME
  if (selEvt == BTN_LONG_PRESS) {
    currentScreen = SCREEN_HOME;
    lastUserInteraction = millis();
    updateOledDisplay();
  }
  // Short press on SELECT button
  else if (selEvt == BTN_SHORT_CLICK) {
    handleSelectButton();
  }

  // 3. Auto-timeout back to SCREEN_HOME after 25s of inactivity in submenus
  if (currentScreen != SCREEN_HOME && currentScreen != SCREEN_ALERT_POPUP) {
    if (millis() - lastUserInteraction > 25000) {
      currentScreen = SCREEN_HOME;
      updateOledDisplay();
    }
  }

  // 4. Temporary popup notification dismissal
  if (currentScreen == SCREEN_ALERT_POPUP) {
    if (millis() >= popupEndTime) {
      currentScreen = SCREEN_HOME;
      updateOledDisplay();
    }
  }

  // 5. Periodic OLED Refresh (updates battery voltage & elapsed timers)
  static unsigned long lastOledRefresh = 0;
  if (millis() - lastOledRefresh >= 1000) {
    lastOledRefresh = millis();
    if (currentScreen == SCREEN_HOME || currentScreen == SCREEN_STATUS) {
      updateOledDisplay();
    }
  }

  // 6. Process Serial Monitor Input Commands
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      serialInputBuffer.trim();
      if (serialInputBuffer.length() > 0) {
        if (serialInputBuffer.equalsIgnoreCase("/help")) {
          printSerialHelp();
        }
        else if (serialInputBuffer.equalsIgnoreCase("/ping")) {
          sendWalkieMessage("ESP PING HEARTBEAT", 0, PKT_TYPE_HEARTBEAT);
        }
        else if (serialInputBuffer.startsWith("/sos")) {
          String text = serialInputBuffer.substring(4);
          text.trim();
          if (text.length() == 0) text = "CRITICAL ESP EMERGENCY SOS!";
          sendWalkieMessage(text.c_str(), 2, PKT_TYPE_SOS);
        }
        else {
          sendWalkieMessage(serialInputBuffer.c_str(), 0, PKT_TYPE_TEXT);
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
