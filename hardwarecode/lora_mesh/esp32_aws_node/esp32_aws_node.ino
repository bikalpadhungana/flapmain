/*
 * =================================================================================
 * FLAPMAIN AUTOMATIC WEATHER STATION (AWS) LORA MESH NODE — ESP32 EDITION
 * ESP32 DevKit + SX1278 LoRa + DHT22 + BMP085/180 + MQ-9 + LDR + Anemometer +
 * Wind vane + Tipping-bucket rain gauge
 *
 * Sends the same 58-byte LoRaMeshPacket as nano_aws_node, so the gateway,
 * repeaters, walkies and dashboard treat it exactly like a Nano station.
 *
 * Differences from the Nano build:
 *  - 12-bit ADC (0..4095) is scaled to 0..1023 for light and gas, so dashboard
 *    thresholds stay the same.
 *  - Battery is read with calibrated analogReadMilliVolts().
 *  - Anemometer ISR is in IRAM; message IDs start from the hardware RNG.
 *  - Pins are set in config.h (3.3 V logic, ADC1 only).
 * =================================================================================
 */

#include "lora_mesh_protocol.h"
#include "config.h"

// The sketch needs its own config.h and lora_mesh_protocol.h next to it. Open the
// whole "esp32_aws_node" folder in the Arduino IDE, not a lone .ino file (the IDE then
// creates a new folder without these files).
#if !defined(LORA_SCK_PIN)
#error "Wrong or missing config.h: copy the whole esp32_aws_node folder (.ino + config.h + lora_mesh_protocol.h)"
#endif
#if !defined(PKT_TYPE_ACK) || !defined(DEFAULT_MAX_TTL)
#error "Wrong lora_mesh_protocol.h: use the one from the esp32_aws_node folder"
#endif
#include <Adafruit_BMP085.h>
#include <DHT.h>
#include <LoRa.h>
#include <SPI.h>
#include <Wire.h>

#if !defined(ESP32)
#error "esp32_aws_node is for ESP32 boards. Use nano_aws_node for the Arduino Nano."
#endif

// originNode is a single byte in the LoRa packet; larger IDs wrap (1003 -> 235).
#if AWS_NODE_ID < 1 || AWS_NODE_ID > 255
#error "AWS_NODE_ID must be 1..255 (it is sent as one byte in the LoRa packet)"
#endif

static_assert(sizeof(LoRaMeshPacket) == 58, "Old lora_mesh_protocol.h (packet is not 58 bytes): use the one from this sketch folder");

// Relay walkie text / SOS packets (never weather). Off = pure AWS, least airtime.
#define ENABLE_AWS_SOS_RELAY false

// ---- Timing / thresholds ----
const unsigned long WIND_WINDOW_MS = 2000;   // anemometer counting window
const unsigned long RAIN_DEBOUNCE_MS = 300;  // tipping-bucket lockout
const int RAIN_THRESHOLD = 2048;             // ADC midpoint (12-bit) for switch state

// ---- Global state ----
volatile uint32_t pulseCount = 0;
unsigned long lastWindCalcTime = 0;
unsigned long lastTelemetryTime = 0;
unsigned long nextInterval = TELEMETRY_INTERVAL;
uint16_t msgSequenceCounter = 0;

float currentWindSpeed = 0.0f;
float currentTemp = 25.0f;
float currentHumidity = 50.0f;
uint16_t currentLight = 0;    // scaled 0..1023
uint16_t currentMq9Gas = 0;   // scaled 0..1023
int32_t currentPressure = 101325;
float currentAltitude = 0.0f;
uint16_t currentBatteryMv = 0;

float rainTotalMm = 0.0f;
int rainPrevState = 0;
unsigned long lastRainTipTime = 0;
uint32_t totalRainTips = 0;

DHT dht(DHT_PIN, DHT22);
Adafruit_BMP085 bmp;
MeshDedup dedupCache;
bool bmpDetected = false;

// ---- ISR: anemometer pulse counter ----
void IRAM_ATTR countPulse() { pulseCount++; }

// ---- Wind direction from the four Hall sensors ----
const char *readWindDirectionStr() {
  bool n = digitalRead(NORTH_PIN) == LOW;
  bool e = digitalRead(EAST_PIN) == LOW;
  bool s = digitalRead(SOUTH_PIN) == LOW;
  bool w = digitalRead(WEST_PIN) == LOW;
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

// 12-bit reading scaled to the Nano's 10-bit range (keeps dashboard levels comparable).
uint16_t analogRead10(uint8_t pin) { return (uint16_t)(analogRead(pin) >> 2); }

uint16_t readBatteryMv() {
  uint32_t mv = analogReadMilliVolts(BATT_PIN); // calibrated pin voltage
  return (uint16_t)min<uint32_t>(65535, (uint32_t)(mv * BATTERY_DIVIDER));
}

// ---- Read all sensors ----
void readAllSensors() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t)) currentTemp = t;
  if (!isnan(h)) currentHumidity = h;

  currentLight = analogRead10(LDR_PIN);
  currentMq9Gas = analogRead10(MQ9_PIN);
  currentBatteryMv = readBatteryMv();

  if (bmpDetected) {
    int32_t p = bmp.readPressure();
    if (p > 50000 && p < 120000) { // 500-1200 hPa sanity check
      currentPressure = p;
      currentAltitude = bmp.readAltitude(101325.0f);
    }
  }
}

// ---- Tipping bucket: count each switch state change (same rule as the Nano node) ----
void checkRainfallSensor() {
  unsigned long now = millis();
  int state = analogRead(RAIN_PIN) > RAIN_THRESHOLD ? 1 : 0;
  if (state != rainPrevState && now - lastRainTipTime >= RAIN_DEBOUNCE_MS) {
    lastRainTipTime = now;
    rainPrevState = state;
    rainTotalMm += RAIN_MM_PER_TIP;
    totalRainTips++;
    Serial.printf("🌧️ [RAIN] Tip detected! Total rain = %.3f mm (Tips: %lu)\n", rainTotalMm, (unsigned long)totalRainTips);
  }
}

// ---- Build and transmit one weather packet ----
bool sendMeshPacket(uint8_t packetType, uint8_t alertLevel) {
  LoRaMeshPacket pkt;
  memset(&pkt, 0, sizeof(pkt));

  uint16_t msgId = msgSequenceCounter++;
  const char *windDir = readWindDirectionStr();
  pkt.msgIdHi = msgId >> 8;
  pkt.msgIdLo = msgId & 0xFF;
  pkt.originNode = AWS_NODE_ID;
  pkt.targetNode = 0; // broadcast
  pkt.ttl = DEFAULT_MAX_TTL;
  pkt.packetType = packetType;
  pkt.temp_x10 = (int16_t)lroundf(currentTemp * 10.0f);
  pkt.hum_x10 = (uint16_t)lroundf(currentHumidity * 10.0f);
  pkt.pressure_pa = (uint32_t)currentPressure;
  pkt.wind_speed_x10 = (uint16_t)lroundf(currentWindSpeed * 10.0f);
  pkt.wind_dir_code = getWindDirCode(windDir);
  pkt.light_val = currentLight;
  pkt.battery_mv = currentBatteryMv;
  pkt.mq3_gas = currentMq9Gas;
  pkt.rain_mm_x100 = (uint16_t)lroundf(rainTotalMm * 100.0f);
  pkt.alert_level = alertLevel;
  // Rain also as text for older gateways that read "RAIN:x.xx"
  snprintf(pkt.text_msg, sizeof(pkt.text_msg), "RAIN:%.2f", rainTotalMm);

  dedupCache.markSeen(AWS_NODE_ID, msgId);

  Serial.println(F("\n=============================================="));
  Serial.printf("📤 [AWS TX #%d] Packet Msg ID #%u  Size=%u bytes\n", AWS_NODE_ID, msgId, (unsigned)sizeof(pkt));
  Serial.printf(" Temp=%.1f°C Hum=%.1f%% Pres=%ldPa Alt=%.1fm\n", currentTemp, currentHumidity, (long)currentPressure, currentAltitude);
  Serial.printf(" Wind=%.1fkm/h Dir=%s Light=%u MQ9=%u Batt=%umV Rain=%.2fmm (%lu tips)\n",
                currentWindSpeed, windDir, currentLight, currentMq9Gas, currentBatteryMv, rainTotalMm, (unsigned long)totalRainTips);
  Serial.println(F("=============================================="));

  LoRa.beginPacket();
  LoRa.write((uint8_t *)&pkt, sizeof(pkt));
  bool ok = LoRa.endPacket() == 1; // blocking TX

  if (ok) Serial.printf("✅ [AWS TX OK] Packet #%u sent over 433MHz\n", msgId);
  else Serial.println(F("❌ [AWS TX FAIL] endPacket() returned 0!"));
  return ok;
}

#if ENABLE_AWS_SOS_RELAY
// ---- Relay walkie text / SOS packets heard from other nodes ----
void handleRelay() {
  int packetSize = LoRa.parsePacket();
  if (packetSize <= 0) return;
  if (packetSize != (int)sizeof(LoRaMeshPacket)) {
    while (LoRa.available()) LoRa.read(); // not our packet format
    return;
  }

  LoRaMeshPacket rx;
  LoRa.readBytes((uint8_t *)&rx, sizeof(rx));
  uint16_t msgId = ((uint16_t)rx.msgIdHi << 8) | rx.msgIdLo;

  if (rx.originNode == AWS_NODE_ID) return;
  if (rx.packetType != PKT_TYPE_SOS && rx.packetType != PKT_TYPE_TEXT && rx.packetType != PKT_TYPE_ACK) return;
  if (dedupCache.alreadySeen(rx.originNode, msgId)) return;
  dedupCache.markSeen(rx.originNode, msgId);

  if (rx.ttl > 1) {
    rx.ttl--;
    delay(random(50, 150)); // jitter against collisions with other relays
    LoRa.beginPacket();
    LoRa.write((uint8_t *)&rx, sizeof(rx));
    LoRa.endPacket();
    LoRa.receive();
    Serial.printf("🔁 [AWS RELAY] MsgID #%u from Node #%u (type %u, TTL %u)\n", msgId, rx.originNode, rx.packetType, rx.ttl);
  }
}
#endif

// ---- Setup ----
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.printf("\n=== FlapMain ESP32 AWS LoRa Mesh Node (Node #%d) ===\n", AWS_NODE_ID);

  pinMode(NORTH_PIN, INPUT_PULLUP);
  pinMode(EAST_PIN, INPUT_PULLUP);
  pinMode(SOUTH_PIN, INPUT_PULLUP);
  pinMode(WEST_PIN, INPUT_PULLUP);
  pinMode(WIND_SPEED_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(WIND_SPEED_PIN), countPulse, FALLING);

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db); // full 0..~3.1 V input range

  dht.begin();
  Serial.printf("[Setup] DHT22 on GPIO%d\n", DHT_PIN);
  Serial.printf("[Setup] LDR GPIO%d, MQ-9 GPIO%d, Battery GPIO%d\n", LDR_PIN, MQ9_PIN, BATT_PIN);

  rainPrevState = analogRead(RAIN_PIN) > RAIN_THRESHOLD ? 1 : 0;
  Serial.printf("[Setup] Rain gauge on GPIO%d (initial state=%d)\n", RAIN_PIN, rainPrevState);

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Wire.setClock(100000);
  Wire.beginTransmission(0x77);
  uint8_t i2cResult = Wire.endTransmission();
  if (i2cResult == 0 && bmp.begin()) {
    bmpDetected = true;
    Serial.println(F("[Setup] BMP085/180 on I2C (0x77) OK"));
  } else {
    Serial.printf("[Setup] BMP085/180 not found (I2C error=%u), using 101325 Pa\n", i2cResult);
  }

  // Default SPI bus on our pins: works on every ESP32 variant (VSPI exists only on the original ESP32).
  SPI.begin(LORA_SCK_PIN, LORA_MISO_PIN, LORA_MOSI_PIN, LORA_SS_PIN);
  LoRa.setSPI(SPI);
  LoRa.setPins(LORA_SS_PIN, LORA_RST_PIN, LORA_DIO0_PIN);
  LoRa.setSPIFrequency(4000000);
  if (!LoRa.begin(LORA_FREQUENCY)) {
    Serial.printf("ERROR: SX1278 init FAILED. Wiring: VCC=3.3V GND SCK=%d MISO=%d MOSI=%d CS=%d RST=%d DIO0=%d\n",
                  LORA_SCK_PIN, LORA_MISO_PIN, LORA_MOSI_PIN, LORA_SS_PIN, LORA_RST_PIN, LORA_DIO0_PIN);
    while (true) delay(500);
  }
  LoRa.setSpreadingFactor(LORA_SPREADING_FACTOR);
  LoRa.setSignalBandwidth(LORA_BANDWIDTH);
  LoRa.setCodingRate4(LORA_CODING_RATE);
  LoRa.setTxPower(LORA_TX_POWER);
  LoRa.setSyncWord(LORA_SYNC_WORD);
  LoRa.enableCrc(); // must match every other node
#if ENABLE_AWS_SOS_RELAY
  LoRa.receive();
#endif

  Serial.printf("[LoRa] SX1278 online — SF%d / %dkHz / 4:%d / CRC / SyncWord=0x%02X / %u-byte packets\n",
                LORA_SPREADING_FACTOR, (int)(LORA_BANDWIDTH / 1000), LORA_CODING_RATE, LORA_SYNC_WORD, (unsigned)sizeof(LoRaMeshPacket));
  Serial.printf("[AWS Ready] Broadcasting telemetry every %lus.\n\n", (unsigned long)(TELEMETRY_INTERVAL / 1000));

  // Random start so radios don't drop our packets as duplicates after a reboot.
  msgSequenceCounter = (uint16_t)(esp_random() % 60000) + 1;

  // Stagger the first packet by node ID to avoid collisions with other stations.
  const unsigned long phaseOffset = ((AWS_NODE_ID - 1) % 4) * 1200UL;
  lastWindCalcTime = millis();
  lastTelemetryTime = millis() - TELEMETRY_INTERVAL + phaseOffset;
}

// ---- Main loop ----
void loop() {
  unsigned long now = millis();

  checkRainfallSensor();

  if (now - lastWindCalcTime >= WIND_WINDOW_MS) {
    noInterrupts();
    uint32_t cnt = pulseCount;
    pulseCount = 0;
    interrupts();
    float elapsed = (now - lastWindCalcTime) / 1000.0f;
    currentWindSpeed = (elapsed > 0 && cnt > 0) ? (cnt / elapsed) * WIND_CALIBRATION_K : 0.0f;
    lastWindCalcTime = now;
  }

  if (now - lastTelemetryTime >= nextInterval) {
    lastTelemetryTime = now;
    nextInterval = TELEMETRY_INTERVAL + random(0, 300); // jitter avoids periodic collisions
    readAllSensors();
    sendMeshPacket(PKT_TYPE_WEATHER, 0);
#if ENABLE_AWS_SOS_RELAY
    LoRa.receive();
#endif
  }

#if ENABLE_AWS_SOS_RELAY
  handleRelay();
#endif

  delay(10);
}
