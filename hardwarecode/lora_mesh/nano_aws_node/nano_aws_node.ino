/*
 * =================================================================================
 * FLAPMAIN AUTOMATIC WEATHER STATION (AWS) LORA MESH NODE — v2.1 (FIXED)
 * Arduino Nano ATmega328P + SX1278 LoRa + DHT22 + BMP180 + MQ-9 + LDR + Anemometer
 *
 * FIXED IN v2.1:
 *  - BATT_PIN moved from A5 (I2C SCL!) to A3 to prevent I2C bus corruption
 *  - Proper TX→RX state machine: LoRa.receive() only called AFTER endPacket()
 *  - Removed LoRa.parsePacket() during TX window (cannot RX while TX)
 *  - Serial.print blocks minimized to avoid UART stalls during TX
 *  - Repeater listening only happens in dedicated idle window, not during TX
 * =================================================================================
 */

#include <SPI.h>
#include <LoRa.h>
#include <DHT.h>
#include <Wire.h>
#include <Adafruit_BMP085.h>
#include "./lora_mesh_protocol.h"

// =================================================================================
// NODE IDENTIFICATION — SET THIS FOR EACH PHYSICAL AWS STATION BOARD!
// Board #1 = 1, Board #2 = 2, Board #3 = 3, etc.
// Each physical station MUST have a unique node ID to prevent network collisions!
// =================================================================================
#ifndef AWS_NODE_ID
  #define AWS_NODE_ID        1         // 1 = Primary Station, 2 = Station #2, 3 = Station #3, etc.
#endif

#if __has_include("config.h")
  #include "config.h"
#endif

#ifndef TELEMETRY_INTERVAL
  #define TELEMETRY_INTERVAL 5000      // Telemetry broadcast interval in ms (5 seconds — fast & responsive)
#endif

// ---- AWS Operational Mode ----
// Set to false (RECOMMENDED): Pure Dedicated AWS Station — only broadcasts weather telemetry,
// no repeater overhead, zero airtime collision.
// Set to true : Relays incoming Emergency SOS (1) and Walkie text (4) ONLY (never relays weather packets).
#define ENABLE_AWS_SOS_RELAY  false

// ---- Pin Allocation (Arduino Nano ATmega328P) ----
// NOTE: A4 = SDA, A5 = SCL — DO NOT use A4/A5 for anything except I2C!
#define LORA_DIO0_PIN   2         // D2 — LoRa SX1278 RxDone / TxDone interrupt (not used as ISR)
#define WIND_SPEED_PIN  3         // D3 — Anemometer pulse interrupt (INT1)
#define NORTH_PIN       4         // D4 — Hall sensor N (Active LOW)
#define EAST_PIN        5         // D5 — Hall sensor E (Active LOW)
#define SOUTH_PIN       6         // D6 — Hall sensor S (Active LOW)
#define WEST_PIN        7         // D7 — Hall sensor W (Active LOW)
#define LORA_RST_PIN    9         // D9 — SX1278 Reset
#define LORA_SS_PIN     10        // D10 — SX1278 SPI Chip Select

#define DHT_PIN         A0        // A0 — DHT22 Data Pin
#define DHT_TYPE        DHT22
#define LDR_PIN         A1        // A1 — LDR Light Sensor (Analog)
#define MQ9_PIN         A2        // A2 — MQ-9 Gas Sensor: CO & Flammable Gas (Analog)
#define BATT_PIN        A3        // A3 — Battery Voltage Divider (A4=SDA, A5=SCL — reserved!)
// I2C Bus: SDA = A4, SCL = A5 — reserved for BMP085/180 sensor

// ---- Anemometer Calibration ----
const float   CALIBRATION_K    = 2.4;   // km/h per pulse/second
const unsigned long WIND_WINDOW = 2000; // 2s wind pulse counting window (ms)

// ---- Global State ----
volatile unsigned long pulseCount       = 0;
unsigned long lastWindCalcTime          = 0;
unsigned long lastTelemetryTime         = 0;
uint16_t      msgSequenceCounter        = 0;

float    currentWindSpeed  = 0.0;
float    currentTemp       = 25.0;
float    currentHumidity   = 50.0;
int      currentLight      = 0;
int      currentMq9Gas     = 0;
int32_t  currentPressure   = 101325;
float    currentAltitude   = 0.0;
uint16_t currentBatteryMv  = 3800;

DHT             dht(DHT_PIN, DHT_TYPE);
Adafruit_BMP085 bmp;
MeshDedup       dedupCache;
bool            bmpDetected = false;

// ---- ISR: Anemometer Pulse Counter ----
// ICACHE_RAM_ATTR is ESP8266-only; AVR Nano needs plain void
#if defined(ESP8266)
  void ICACHE_RAM_ATTR countPulse() { pulseCount++; }
#elif defined(ESP32)
  void IRAM_ATTR countPulse() { pulseCount++; }
#else
  // AVR (Arduino Nano ATmega328P) — no special attribute needed
  void countPulse() { pulseCount++; }
#endif

// ---- Wind Direction Reader ----
const char* readWindDirectionStr() {
  bool n = (digitalRead(NORTH_PIN) == LOW);
  bool e = (digitalRead(EAST_PIN)  == LOW);
  bool s = (digitalRead(SOUTH_PIN) == LOW);
  bool w = (digitalRead(WEST_PIN)  == LOW);
  if (n && e) return "NE";
  if (n && w) return "NW";
  if (s && e) return "SE";
  if (s && w) return "SW";
  if (n) return "North";
  if (e) return "East";
  if (s) return "South";
  if (w) return "West";
  return "CALM";
}

// ---- Battery Voltage Reader ----
uint16_t readBatteryVoltageMv() {
  // A3 — 100kΩ/100kΩ voltage divider → multiply raw by 2
  // IMPORTANT: A4 (SDA) and A5 (SCL) must NOT be used for analogRead!
  int raw = analogRead(BATT_PIN);
  float voltage = (raw / 1023.0f) * 5.0f * 2.0f;
  return (uint16_t)(voltage * 1000.0f);
}

// ---- Read All Sensors ----
void readAllSensors() {
  // DHT22 — temperature & humidity
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t)) currentTemp     = t;
  if (!isnan(h)) currentHumidity = h;

  // LDR — ambient light
  currentLight = analogRead(LDR_PIN);

  // MQ-9 — CO & flammable gas
  currentMq9Gas = analogRead(MQ9_PIN);

  // Battery voltage (A3)
  currentBatteryMv = readBatteryVoltageMv();

  // BMP180 — barometric pressure & altitude
  if (bmpDetected) {
    int32_t p = bmp.readPressure();
    if (p > 50000 && p < 120000) {  // Sanity check (500–1200 hPa)
      currentPressure = p;
      currentAltitude = bmp.readAltitude(101325.0f);
    }
  }
}

// ---- Transmit LoRa Mesh Packet ----
// IMPORTANT: Call LoRa.receive() AFTER this returns to re-arm listener.
bool sendMeshPacket(uint8_t packetType, uint8_t alertLevel) {
  LoRaMeshPacket pkt;
  memset(&pkt, 0, sizeof(pkt));

  uint16_t msgId = msgSequenceCounter++;
  pkt.msgIdHi        = (msgId >> 8) & 0xFF;
  pkt.msgIdLo        = msgId & 0xFF;
  pkt.originNode     = AWS_NODE_ID;
  pkt.targetNode     = 0;             // 0 = Broadcast to all nodes
  pkt.ttl            = DEFAULT_MAX_TTL;
  pkt.packetType     = packetType;
  pkt.temp_x10       = (int16_t)(currentTemp * 10.0f);
  pkt.hum_x10        = (uint16_t)(currentHumidity * 10.0f);
  pkt.pressure_pa    = (uint32_t)currentPressure;
  pkt.wind_speed_x10 = (uint16_t)(currentWindSpeed * 10.0f);
  pkt.wind_dir_code  = getWindDirCode(readWindDirectionStr());
  pkt.light_val      = (uint16_t)currentLight;
  pkt.battery_mv     = currentBatteryMv;
  pkt.mq3_gas        = (uint16_t)currentMq9Gas;
  pkt.alert_level    = alertLevel;
  // text_msg is zero from memset

  dedupCache.markSeen(AWS_NODE_ID, msgId);

  // -- Serial debug BEFORE TX (safe; TX hasn't started yet) --
  Serial.println(F("\n=============================================="));
  Serial.print(F("📤 [AWS TX #")); Serial.print(AWS_NODE_ID);
  Serial.print(F("] Packet Msg ID #")); Serial.print(msgId);
  Serial.print(F("  Size=")); Serial.print((int)sizeof(pkt)); Serial.println(F(" bytes"));
  Serial.print(F(" Temp=")); Serial.print(currentTemp,1); Serial.print(F("°C"));
  Serial.print(F(" Hum=")); Serial.print(currentHumidity,1); Serial.print(F("%"));
  Serial.print(F(" Pres=")); Serial.print(currentPressure); Serial.print(F("Pa"));
  Serial.print(F(" Alt=")); Serial.print(currentAltitude,1); Serial.println(F("m"));
  Serial.print(F(" Wind=")); Serial.print(currentWindSpeed,1); Serial.print(F("km/h"));
  Serial.print(F(" Dir=")); Serial.print(readWindDirectionStr());
  Serial.print(F(" Light=")); Serial.print(currentLight);
  Serial.print(F(" MQ9=")); Serial.print(currentMq9Gas);
  Serial.print(F(" Batt=")); Serial.print(currentBatteryMv); Serial.println(F("mV"));
  Serial.println(F("=============================================="));

  // -- Transmit --
  LoRa.beginPacket();
  LoRa.write((uint8_t*)&pkt, sizeof(pkt));
  int res = LoRa.endPacket(); // Synchronous blocking TX

  if (res == 1) {
    Serial.print(F("✅ [AWS TX OK] Packet #")); Serial.print(msgId);
    Serial.println(F(" sent over 433MHz"));
  } else {
    Serial.println(F("❌ [AWS TX FAIL] endPacket() returned 0!"));
  }

  return (res == 1);
}

// ---- Setup ----
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.print(F("\n=== FlapMain AWS LoRa Mesh Node v2.1 (Node #"));
  Serial.print(AWS_NODE_ID);
  Serial.println(F(") ==="));

  // --- Pin Setup ---
  pinMode(NORTH_PIN,      INPUT_PULLUP);
  pinMode(EAST_PIN,       INPUT_PULLUP);
  pinMode(SOUTH_PIN,      INPUT_PULLUP);
  pinMode(WEST_PIN,       INPUT_PULLUP);
  pinMode(WIND_SPEED_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(WIND_SPEED_PIN), countPulse, FALLING);

  // --- Sensors ---
  dht.begin();
  Serial.println(F("[Setup] DHT22 on A0 OK"));
  Serial.println(F("[Setup] MQ-9 Gas Sensor on A2 OK"));
  Serial.println(F("[Setup] Battery ADC on A3 OK (A5=SCL reserved)"));

  Wire.begin();
  Wire.setClock(100000); // 100kHz I2C

  // Non-blocking BMP180 probe at I2C address 0x77
  Wire.beginTransmission(0x77);
  uint8_t i2cResult = Wire.endTransmission();
  if (i2cResult == 0) {
    if (bmp.begin()) {
      bmpDetected = true;
      Serial.println(F("[Setup] BMP085/180 on I2C (0x77) OK"));
    } else {
      Serial.println(F("[Setup] BMP085/180 found but init() failed — using 101325 Pa fallback"));
    }
  } else {
    Serial.print(F("[Setup] BMP085/180 not found at 0x77 (I2C error="));
    Serial.print(i2cResult);
    Serial.println(F(") — using 101325 Pa fallback"));
  }

  // --- LoRa SX1278 ---
  LoRa.setPins(LORA_SS_PIN, LORA_RST_PIN, LORA_DIO0_PIN);
  LoRa.setSPIFrequency(4000000); // 4MHz SPI (stable for jumper wires)

  if (!LoRa.begin(LORA_FREQUENCY)) {
    Serial.println(F("ERROR: SX1278 LoRa init FAILED! Check SPI wiring."));
    Serial.println(F("Wiring: VCC=3.3V GND SCK=D13 MISO=D12 MOSI=D11 CS=D10 RST=D9 DIO0=D2"));
    while (true) { delay(500); }
  }

  LoRa.setSpreadingFactor(LORA_SPREADING_FACTOR); // SF10
  LoRa.setSignalBandwidth(LORA_BANDWIDTH);         // 125kHz
  LoRa.setCodingRate4(LORA_CODING_RATE);           // 4/5
  LoRa.setTxPower(LORA_TX_POWER);                  // 14 dBm
  LoRa.setSyncWord(LORA_SYNC_WORD);                // 0x12
  LoRa.enableCrc();                                // CRC MUST be enabled on both TX and RX!

#if ENABLE_AWS_SOS_RELAY
  LoRa.receive();                                  // Enter continuous RX mode for relay
#endif

  Serial.println(F("[LoRa] SX1278 online — SF10 / 125kHz / 4:5 / CRC / SyncWord=0x12"));
  Serial.print  (F("[LoRa] Packet size = ")); Serial.print((int)sizeof(LoRaMeshPacket));
  Serial.println(F(" bytes"));
#if ENABLE_AWS_SOS_RELAY
  Serial.println(F("[AWS Ready] Broadcasting telemetry (5s) & listening for SOS relay.\n"));
#else
  Serial.println(F("[AWS Ready] Pure AWS Mode: Broadcasting telemetry every 5s.\n"));
#endif

  // Seed random for msg counter
  randomSeed(analogRead(A1) ^ millis());
  msgSequenceCounter = (uint16_t)random(100, 1000);

  // Stagger initial transmission phase based on Node ID to prevent simultaneous airtime collisions:
  // Node 1: offset 0ms
  // Node 2: offset 1200ms
  // Node 3: offset 2400ms
  // Node 4: offset 3600ms
  const unsigned long nodePhaseOffset = ((AWS_NODE_ID - 1) % 4) * 1200UL;
  lastWindCalcTime   = millis();
  lastTelemetryTime  = millis() - TELEMETRY_INTERVAL + nodePhaseOffset;
}

// ---- Main Loop ----
void loop() {
  unsigned long now = millis();

  // ── 1. Wind Speed Calculation (every 2s) ──────────────────────────────────
  if (now - lastWindCalcTime >= WIND_WINDOW) {
    noInterrupts();
    unsigned long cnt = pulseCount;
    pulseCount = 0;
    interrupts();

    float elapsed = (float)(now - lastWindCalcTime) / 1000.0f;
    currentWindSpeed = (elapsed > 0 && cnt > 0)
                       ? ((float)cnt / elapsed) * CALIBRATION_K
                       : 0.0f;
    lastWindCalcTime = now;
  }

  // ── 2. Telemetry Broadcast (every TELEMETRY_INTERVAL + anti-collision jitter) ──
  static unsigned long nextInterval = TELEMETRY_INTERVAL;
  if (now - lastTelemetryTime >= nextInterval) {
    lastTelemetryTime = now;
    nextInterval = TELEMETRY_INTERVAL + random(0, 300); // 0..300ms random jitter prevents periodic airtime sync

    readAllSensors();       // Read all sensors before TX
    sendMeshPacket(PKT_TYPE_WEATHER, 0);

#if ENABLE_AWS_SOS_RELAY
    // Re-arm SX1278 continuous receive mode AFTER TX completes
    LoRa.receive();
#endif
  }

#if ENABLE_AWS_SOS_RELAY
  // ── 3. Mesh Packet Relay Listener (ONLY active when ENABLE_AWS_SOS_RELAY is true) ──
  int packetSize = LoRa.parsePacket();
  if (packetSize >= 50 && packetSize <= (int)sizeof(LoRaMeshPacket) + 10) {
    LoRaMeshPacket rxPkt;
    memset(&rxPkt, 0, sizeof(rxPkt));
    size_t toRead = ((size_t)packetSize < sizeof(rxPkt)) ? (size_t)packetSize : sizeof(rxPkt);
    LoRa.readBytes((uint8_t*)&rxPkt, toRead);

    uint16_t msgId = ((uint16_t)rxPkt.msgIdHi << 8) | rxPkt.msgIdLo;

    // Never relay packets that originated from this AWS node itself
    if (rxPkt.originNode == AWS_NODE_ID) {
      LoRa.receive();
      return;
    }

    // ONLY relay SOS alerts (1) and Walkie Text messages (4) — NEVER relay weather packets (0)!
    if (rxPkt.packetType != PKT_TYPE_SOS && rxPkt.packetType != PKT_TYPE_TEXT) {
      LoRa.receive();
      return;
    }

    if (!dedupCache.alreadySeen(rxPkt.originNode, msgId)) {
      dedupCache.markSeen(rxPkt.originNode, msgId);

      Serial.println(F("\n=============================================="));
      Serial.print(F("🚨 [AWS SOS RELAY] Relaying MsgID=#")); Serial.print(msgId);
      Serial.print(F(" from Node #")); Serial.println(rxPkt.originNode);

      if (rxPkt.ttl > 1) {
        rxPkt.ttl--;
        delay(random(50, 150)); // Jitter to avoid LoRa collision with other repeaters

        LoRa.beginPacket();
        LoRa.write((uint8_t*)&rxPkt, sizeof(rxPkt));
        LoRa.endPacket();

        Serial.println(F("✅ [AWS SOS RELAY] Relayed!"));
        LoRa.receive(); // Re-arm after relay TX
      } else {
        Serial.println(F("⛔ [AWS SOS RELAY] TTL expired — dropped."));
      }
      Serial.println(F("=============================================="));
    }
  } else if (packetSize > 0) {
    // Drain unexpected noise packet
    while (LoRa.available()) LoRa.read();
    LoRa.receive();
  }
#endif

  delay(10); // Minimal yield delay
}
