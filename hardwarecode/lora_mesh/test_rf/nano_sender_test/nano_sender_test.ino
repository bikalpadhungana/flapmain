/*
 * =================================================================================
 * FLAPMAIN AWS LORA RF TEST SKETCH — v2.1 (FULL PRODUCTION MATCH)
 * Arduino Nano ATmega328P + SX1278 LoRa
 *
 * This sketch matches nano_aws_node.ino exactly:
 *   - Same pin layout (BATT=A3, MQ9=A2, I2C=A4/A5, DHT=A0, LDR=A1)
 *   - Same radio settings (SF10 / 125kHz / CR4:5 / 14dBm / CRC / SyncWord 0x12)
 *   - Same LoRaMeshPacket struct with targetNode=0 (broadcast) and memset
 *   - Same BMP180 non-blocking I2C probe at 0x77
 *   - Same MQ-9 gas sensor on A2
 *   - Same mesh repeater relay logic
 *   - Broadcasts every 5 seconds (faster than production for testing)
 *
 * USE THIS TO CONFIRM:
 *   1. Flash this to Nano → open Serial Monitor at 115200 baud
 *   2. Confirm "✅ TX OK" messages appear every 5s
 *   3. Open Serial Monitor on ESP Gateway — confirm "📥 [GATEWAY RECEIVED]"
 *   4. Once confirmed, flash the production nano_aws_node.ino
 * =================================================================================
 */

#include <SPI.h>
#include <LoRa.h>
#include <DHT.h>
#include <Wire.h>
#include <Adafruit_BMP085.h>
#include "./lora_mesh_protocol.h"

// ---- Pin Allocation — MATCHES nano_aws_node.ino ----
// A4 = SDA, A5 = SCL — RESERVED for I2C BMP180. DO NOT use for analogRead!
#define LORA_SS         10        // D10 — SX1278 SPI Chip Select
#define LORA_RST        9         // D9  — SX1278 Reset
#define LORA_DIO0       2         // D2  — SX1278 DIO0

#define WIND_SPEED_PIN  3         // D3 — Anemometer pulse (INT1)
#define NORTH_PIN       4         // D4 — Hall sensor N (Active LOW)
#define EAST_PIN        5         // D5 — Hall sensor E (Active LOW)
#define SOUTH_PIN       6         // D6 — Hall sensor S (Active LOW)
#define WEST_PIN        7         // D7 — Hall sensor W (Active LOW)

#define DHT_PIN         A0        // A0 — DHT22 temperature/humidity
#define DHT_TYPE        DHT22
#define LDR_PIN         A1        // A1 — LDR ambient light (analog)
#define MQ9_PIN         A2        // A2 — MQ-9 CO & flammable gas (analog)
#define BATT_PIN        A3        // A3 — Battery voltage divider (NOT A5 — A5 is SCL!)
// I2C BMP085/180: SDA = A4, SCL = A5

// ---- Radio Settings — MUST match Gateway ----
#define LORA_FREQ       433E6     // 433 MHz
#define LORA_SF         10        // Spreading Factor 10
#define LORA_BW         125E3     // 125 kHz bandwidth
#define LORA_CR         5         // Coding Rate 4/5
#define LORA_PWR        14        // 14 dBm TX power
#define LORA_SYNC       0x12      // FlapMain sync word

// ---- Node ID ----
#define TEST_NODE_ID    0x01      // Same as production AWS_NODE_ID

// ---- Anemometer Calibration ----
const float   CALIBRATION_K  = 2.4;   // km/h per pulse/sec
const unsigned long WIND_WIN = 2000;  // 2s counting window

// ---- Timing ----
#define TX_INTERVAL     5000      // Transmit every 5 seconds (faster for testing)

// ---- Global State ----
volatile unsigned long pulseCount = 0;
unsigned long lastWindCalcTime    = 0;
unsigned long lastTxTime          = 0;
uint16_t      txCounter           = 0;

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

// ---- ISR: Anemometer ----
void countPulse() { pulseCount++; }

// ---- Wind Direction ----
const char* readWindDir() {
  bool n = digitalRead(NORTH_PIN) == LOW;
  bool e = digitalRead(EAST_PIN)  == LOW;
  bool s = digitalRead(SOUTH_PIN) == LOW;
  bool w = digitalRead(WEST_PIN)  == LOW;
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

// ---- Battery Voltage (A3 — NOT A5!) ----
uint16_t readBattMv() {
  int raw = analogRead(BATT_PIN);
  return (uint16_t)((raw / 1023.0f) * 5.0f * 2.0f * 1000.0f);
}

// ---- Read All Sensors ----
void readSensors() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t)) currentTemp     = t;
  if (!isnan(h)) currentHumidity = h;

  currentLight   = analogRead(LDR_PIN);
  currentMq9Gas  = analogRead(MQ9_PIN);
  currentBatteryMv = readBattMv();

  if (bmpDetected) {
    int32_t p = bmp.readPressure();
    if (p > 50000 && p < 120000) {
      currentPressure = p;
      currentAltitude = bmp.readAltitude(101325.0f);
    }
  }
}

// ---- Setup ----
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println(F("\n=========================================="));
  Serial.println(F("  FLAPMAIN AWS LORA TEST — v2.1"));
  Serial.println(F("  (Production-matched pin layout)"));
  Serial.println(F("=========================================="));

  // --- Pin modes ---
  pinMode(NORTH_PIN,      INPUT_PULLUP);
  pinMode(EAST_PIN,       INPUT_PULLUP);
  pinMode(SOUTH_PIN,      INPUT_PULLUP);
  pinMode(WEST_PIN,       INPUT_PULLUP);
  pinMode(WIND_SPEED_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(WIND_SPEED_PIN), countPulse, FALLING);

  // --- Sensors ---
  dht.begin();
  Serial.println(F("[Init] DHT22 on A0 OK"));
  Serial.println(F("[Init] MQ-9 Gas Sensor on A2 OK"));
  Serial.println(F("[Init] Battery ADC on A3 OK  (A5=SCL reserved for I2C!)"));

  Wire.begin();
  Wire.setClock(100000);

  // Non-blocking BMP180 probe — same as production node
  Wire.beginTransmission(0x77);
  uint8_t i2cErr = Wire.endTransmission();
  if (i2cErr == 0) {
    if (bmp.begin()) {
      bmpDetected = true;
      Serial.println(F("[Init] BMP085/180 on I2C (0x77) OK"));
    } else {
      Serial.println(F("[Init] BMP085/180 found but init() failed — fallback 101325 Pa"));
    }
  } else {
    Serial.print(F("[Init] BMP085/180 not found (I2C err="));
    Serial.print(i2cErr);
    Serial.println(F(") — fallback 101325 Pa"));
  }

  // --- LoRa SX1278 ---
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  LoRa.setSPIFrequency(4000000); // 4MHz SPI for breadboard/jumper stability

  Serial.print(F("[LoRa] Initializing SX1278 on "));
  Serial.print(LORA_FREQ / 1E6);
  Serial.println(F(" MHz..."));

  if (!LoRa.begin(LORA_FREQ)) {
    Serial.println(F("ERROR: SX1278 init FAILED!"));
    Serial.println(F("Check: VCC=3.3V GND SCK=D13 MISO=D12 MOSI=D11 CS=D10 RST=D9 DIO0=D2"));
    while (true) delay(500);
  }

  LoRa.setSpreadingFactor(LORA_SF);   // SF10 — must match gateway
  LoRa.setSignalBandwidth(LORA_BW);   // 125 kHz — must match gateway
  LoRa.setCodingRate4(LORA_CR);       // 4/5 — must match gateway
  LoRa.setTxPower(LORA_PWR);          // 14 dBm
  LoRa.setSyncWord(LORA_SYNC);        // 0x12 — must match gateway
  LoRa.enableCrc();                   // CRC — must be enabled on BOTH TX and RX!

  Serial.println(F("[LoRa] SF10 / 125kHz / CR4:5 / CRC / SyncWord=0x12 OK"));
  Serial.print  (F("[LoRa] Packet struct size = "));
  Serial.print  ((int)sizeof(LoRaMeshPacket));
  Serial.println(F(" bytes (gateway expects 56)"));
  Serial.println(F("[Ready] Broadcasting every 5s. Gateway accept window: 50-66 bytes.\n"));

  randomSeed(analogRead(A1) ^ millis());
  txCounter        = (uint16_t)random(100, 1000);
  lastWindCalcTime = millis();
  lastTxTime       = millis() - TX_INTERVAL; // Trigger immediately on first loop
}

// ---- Main Loop ----
void loop() {
  unsigned long now = millis();

  // ── 1. Wind Speed Calculation (every 2s) ────────────────────────────────
  if (now - lastWindCalcTime >= WIND_WIN) {
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

  // ── 2. Transmit Every TX_INTERVAL ────────────────────────────────────────
  if (now - lastTxTime >= TX_INTERVAL) {
    lastTxTime = now;

    // Read all sensors first
    readSensors();
    const char* windDir = readWindDir();

    // Build packet — IDENTICAL layout to production nano_aws_node.ino
    LoRaMeshPacket pkt;
    memset(&pkt, 0, sizeof(pkt));                    // Zero ALL fields (critical!)

    pkt.msgIdHi        = (txCounter >> 8) & 0xFF;
    pkt.msgIdLo        = txCounter & 0xFF;
    pkt.originNode     = TEST_NODE_ID;               // Node #1
    pkt.targetNode     = 0;                          // 0 = Broadcast to all nodes
    pkt.ttl            = DEFAULT_MAX_TTL;            // 8 hops
    pkt.packetType     = PKT_TYPE_WEATHER;           // 0 = Weather telemetry
    pkt.temp_x10       = (int16_t)(currentTemp * 10.0f);
    pkt.hum_x10        = (uint16_t)(currentHumidity * 10.0f);
    pkt.pressure_pa    = (uint32_t)currentPressure;
    pkt.wind_speed_x10 = (uint16_t)(currentWindSpeed * 10.0f);
    pkt.wind_dir_code  = getWindDirCode(windDir);
    pkt.light_val      = (uint16_t)currentLight;
    pkt.battery_mv     = currentBatteryMv;
    pkt.mq3_gas        = (uint16_t)currentMq9Gas;   // Field name is mq3_gas, value is MQ-9
    pkt.alert_level    = 0;
    // text_msg is zeroed by memset

    dedupCache.markSeen(TEST_NODE_ID, txCounter);

    // --- Serial debug ---
    Serial.println(F("\n=========================================="));
    Serial.print(F("📤 [TX #")); Serial.print(txCounter);
    Serial.print(F("] Size=")); Serial.print((int)sizeof(pkt));
    Serial.println(F(" bytes"));
    Serial.print(F("  Temp=")); Serial.print(currentTemp, 1);
    Serial.print(F("°C  Hum=")); Serial.print(currentHumidity, 1);
    Serial.print(F("%  Pres=")); Serial.print(currentPressure);
    Serial.println(F("Pa"));
    Serial.print(F("  Alt=")); Serial.print(currentAltitude, 1);
    Serial.print(F("m  Wind=")); Serial.print(currentWindSpeed, 1);
    Serial.print(F("km/h(")); Serial.print(windDir); Serial.println(F(")"));
    Serial.print(F("  Light=")); Serial.print(currentLight);
    Serial.print(F("  MQ9=")); Serial.print(currentMq9Gas);
    Serial.print(F("  Batt=")); Serial.print(currentBatteryMv);
    Serial.println(F("mV"));
    Serial.print(F("  SF=")); Serial.print(LORA_SF);
    Serial.print(F("  BW=125kHz  SyncWord=0x")); Serial.println(LORA_SYNC, HEX);
    Serial.println(F("=========================================="));

    // --- Transmit ---
    LoRa.beginPacket();
    LoRa.write((uint8_t*)&pkt, sizeof(pkt));
    int result = LoRa.endPacket(); // Synchronous blocking TX

    if (result == 1) {
      Serial.print(F("✅ [TX OK] Packet #")); Serial.print(txCounter);
      Serial.println(F(" sent! Watch gateway Serial Monitor for: '[GW RX] 56 bytes'"));
    } else {
      Serial.println(F("❌ [TX FAIL] endPacket()=0 — check SPI wiring!"));
    }

    txCounter++;

    // Re-arm radio for mesh relay listening
    LoRa.receive();
  }

  // ── 3. Mesh Relay Listener (forward packets from walkie-talkies) ─────────
  int packetSize = LoRa.parsePacket();
  if (packetSize >= 50 && packetSize <= (int)sizeof(LoRaMeshPacket) + 10) {
    LoRaMeshPacket rxPkt;
    memset(&rxPkt, 0, sizeof(rxPkt));
    size_t toRead = ((size_t)packetSize < sizeof(rxPkt)) ? (size_t)packetSize : sizeof(rxPkt);
    LoRa.readBytes((uint8_t*)&rxPkt, toRead);

    uint16_t msgId = ((uint16_t)rxPkt.msgIdHi << 8) | rxPkt.msgIdLo;

    // Never relay packets that originated from this test node itself
    if (rxPkt.originNode == TEST_NODE_ID) {
      LoRa.receive();
      return;
    }

    // Only relay SOS alerts and Text messages — never relay weather packets
    if (rxPkt.packetType != PKT_TYPE_SOS && rxPkt.packetType != PKT_TYPE_TEXT) {
      LoRa.receive();
      return;
    }

    if (!dedupCache.alreadySeen(rxPkt.originNode, msgId)) {
      dedupCache.markSeen(rxPkt.originNode, msgId);

      Serial.print(F("[RELAY] MsgID=#")); Serial.print(msgId);
      Serial.print(F(" from Node #")); Serial.println(rxPkt.originNode);

      if (rxPkt.ttl > 1) {
        rxPkt.ttl--;
        delay(random(50, 150));
        LoRa.beginPacket();
        LoRa.write((uint8_t*)&rxPkt, sizeof(rxPkt));
        LoRa.endPacket();
        Serial.println(F("  → Relayed!"));
        LoRa.receive();
      }
    }
  } else if (packetSize > 0) {
    while (LoRa.available()) LoRa.read(); // Drain noise
    LoRa.receive();
  }

  delay(10);
}
