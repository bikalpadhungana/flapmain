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
#define SOS_BUTTON_PIN  8     // D8 Active LOW Emergency SOS Button
#define BATT_PIN        A3    // A3 Analog Battery Voltage Divider
#define STATUS_LED_PIN  13    // D13 Built-in Status LED

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

// Button Debounce
unsigned long lastSosPressTime = 0;

// ---- Helper Functions ----
uint16_t readBatteryMv() {
  int raw = analogRead(BATT_PIN);
  // 5V ADC ref with 2:1 divider = (raw * 5000 / 1023) * 2
  return (uint16_t)((raw * 10000UL) / 1023UL);
}

void updateOledDisplay() {
  if (!oledPresent) return;

  display.clearDisplay();
  display.setTextColor(1);

  // Top Bar: Node ID & Battery
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print(F("WALKIE #"));
  display.print(WALKIE_NODE_ID);
  
  display.setCursor(85, 0);
  uint16_t mv = readBatteryMv();
  display.print(mv / 1000.0, 1);
  display.print(F("V"));

  display.drawLine(0, 10, 127, 10, 1);

  // If Emergency SOS is active
  if (lastRxAlertLevel > 0 && (millis() - lastRxTime < 30000)) {
    display.fillRect(0, 13, 128, 14, 1);
    display.setTextColor(0, 1); // Inverse text (black on white)
    display.setCursor(4, 16);
    display.print(F("! EMERGENCY SOS !"));
    display.setTextColor(1);

    display.setCursor(0, 31);
    display.print(F("From Node #"));
    display.print(lastRxNode);

    display.setCursor(0, 42);
    display.print(lastRxMsg[0] ? lastRxMsg : "SOS TRIGGERED!");

    display.setCursor(0, 55);
    display.print(F("RSSI:"));
    display.print(lastRxRssi);
    display.print(F("dBm"));
  }
  else if (lastRxNode > 0 && (millis() - lastRxTime < 60000)) {
    // Normal Incoming Text Message
    display.setCursor(0, 14);
    display.print(F("RX From Node #"));
    display.print(lastRxNode);

    display.setCursor(0, 26);
    display.setTextSize(1);
    display.print(F("\""));
    display.print(lastRxMsg);
    display.print(F("\""));

    display.setCursor(0, 52);
    display.print(F("RSSI:"));
    display.print(lastRxRssi);
    display.print(F("dBm SNR:"));
    display.print(lastRxSnr, 1);
  }
  else {
    // Ready State
    display.setCursor(0, 18);
    display.print(F("Status: READY"));

    display.setCursor(0, 32);
    display.print(F("Serial: Type text"));
    display.setCursor(0, 42);
    display.print(F("Button: Press D8 SOS"));

    display.setCursor(0, 55);
    display.print(F("LoRa Mesh 433MHz"));
  }

  display.display();
}

void sendWalkieMessage(const char* text, uint8_t alertLevel = 0, uint8_t pktType = PKT_TYPE_TEXT, uint8_t targetNode = 0) {
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
    Serial.print(F(" - Alert      : ")); Serial.println(alertLevel);
  } else {
    Serial.println(F("❌ [WALKIE TX FAIL] LoRa radio transmit error!"));
  }
  Serial.println(F("=============================================="));

  // Update local display with sent status
  lastRxNode = WALKIE_NODE_ID;
  lastRxRssi = 0;
  lastRxSnr = 0.0;
  strncpy(lastRxMsg, pkt.text_msg, sizeof(lastRxMsg) - 1);
  lastRxPktType = pktType;
  lastRxAlertLevel = alertLevel;
  lastRxTime = millis();

  updateOledDisplay();
}

void printSerialHelp() {
  Serial.println(F("\n=== FLAPMAIN LORA MESH WALKIE-TALKIE CLI ==="));
  Serial.print(F(" Node ID: #")); Serial.println(WALKIE_NODE_ID);
  Serial.println(F(" Instructions:"));
  Serial.println(F("  - Type text and hit Enter to broadcast to ALL nodes."));
  Serial.println(F("  - Type 'text /{node_id}' to send to specific node (e.g., 'Hello /102')."));
  Serial.println(F("  - Type '/sos <message>' to broadcast an Emergency SOS alert."));
  Serial.println(F("  - Press physical D8 button to trigger Emergency SOS."));
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
    lastRxPktType = pkt.packetType;
    lastRxAlertLevel = pkt.alert_level;
    lastRxTime = millis();

    updateOledDisplay();
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
  pinMode(SOS_BUTTON_PIN, INPUT_PULLUP);

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

  // 2. Check Hardware SOS Button (Requires HIGH -> LOW edge transition & 80ms press)
  static bool prevSosState = HIGH;
  static unsigned long sosPressStartTime = 0;
  bool currentSosState = digitalRead(SOS_BUTTON_PIN);

  if (currentSosState == LOW && prevSosState == HIGH) {
    sosPressStartTime = millis(); // Record press start
  } else if (currentSosState == LOW && prevSosState == LOW) {
    if (sosPressStartTime > 0 && (millis() - sosPressStartTime >= 80) && (millis() - lastSosPressTime > 3000)) {
      lastSosPressTime = millis();
      sosPressStartTime = 0;
      char sosMsg[32];
      snprintf(sosMsg, sizeof(sosMsg), "SOS ALERT FROM NODE #%d!", WALKIE_NODE_ID);
      sendWalkieMessage(sosMsg, 2, PKT_TYPE_SOS);
    }
  } else if (currentSosState == HIGH) {
    sosPressStartTime = 0;
  }
  prevSosState = currentSosState;

  // 3. Process Serial Monitor Input Commands
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      serialInputBuffer.trim();
      if (serialInputBuffer.length() > 0) {
        if (serialInputBuffer.equalsIgnoreCase("/help")) {
          printSerialHelp();
        }
        else if (serialInputBuffer.equalsIgnoreCase("/ping")) {
          sendWalkieMessage("PING HEARTBEAT", 0, PKT_TYPE_HEARTBEAT);
        }
        else if (serialInputBuffer.startsWith("/sos")) {
          String text = serialInputBuffer.substring(4);
          text.trim();
          if (text.length() == 0) text = "CRITICAL EMERGENCY SOS!";
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
