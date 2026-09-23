/*
 * =================================================================================
 * FLAPMAIN LORA MESH REPEATER NODE FIRMWARE
 * Compatible with Arduino Nano (ATmega328P), ESP8266, and ESP32.
 * Dedicated, ultra-resilient flood-routing relay node.
 * Receives LoRa mesh packets, checks ring-buffer deduplication cache, decrements TTL,
 * injects random jitter to avoid RF collisions, and re-broadcasts packets across mesh.
 * =================================================================================
 */

#include <SPI.h>
#include <LoRa.h>
#include "lora_mesh_protocol.h"
#if __has_include("config.h")
  #include "config.h"
#endif

// ---- Automatic Board Pin Allocation ----
#if defined(ESP8266)
  #define LORA_SS_PIN   15 // D8 (GPIO15)
  #define LORA_RST_PIN  0  // D3 (GPIO0)
  #define LORA_DIO0_PIN 4  // D2 (GPIO4)
  #define STATUS_LED_PIN 2 // D4 (GPIO2)
#elif defined(ESP32)
  #define LORA_SS_PIN   5
  #define LORA_RST_PIN  14
  #define LORA_DIO0_PIN 2
  #define STATUS_LED_PIN 2
#else // Default: Arduino Nano (ATmega328P)
  #define LORA_SS_PIN   10 // D10 SPI Chip Select
  #define LORA_RST_PIN  9  // D9 SX1278 Reset
  #define LORA_DIO0_PIN 2  // D2 Interrupt Pin
  #define STATUS_LED_PIN 13 // D13 Built-in LED
#endif

// ---- Node Configuration ----
#ifndef REPEATER_NODE_ID
  #define REPEATER_NODE_ID 0x02  // Unique node ID for this repeater (1..255)
#endif

// ---- Deduplication Cache ----
MeshDedup dedupCache;
uint32_t totalRelayedPackets = 0;
uint32_t totalDroppedPackets = 0;

// ---- Process & Relay Incoming Packet ----
void processAndRelayPacket(const LoRaMeshPacket &inPkt, int rssi, float snr) {
  LoRaMeshPacket pkt = inPkt;
  uint16_t msgId = ((uint16_t)pkt.msgIdHi << 8) | pkt.msgIdLo;

  // Deduplication Check: If packet from (originNode, msgId) was already relayed, drop it!
  if (dedupCache.alreadySeen(pkt.originNode, msgId)) {
    totalDroppedPackets++;
    Serial.print(F("⚠️ [Repeater] Duplicate MsgID=#"));
    Serial.print(msgId);
    Serial.print(F(" from Origin=#"));
    Serial.print(pkt.originNode);
    Serial.println(F(" dropped."));
    return;
  }

  // Record into ring buffer deduplication cache
  dedupCache.markSeen(pkt.originNode, msgId);

  Serial.println(F("\n=============================================="));
  Serial.print(F("📥 [REPEATER RECEIVED PACKET] MsgID=#"));
  Serial.println(msgId);
  Serial.print(F(" - Origin Node ID : #")); Serial.println(pkt.originNode);
  Serial.print(F(" - Packet Type    : ")); Serial.println(pkt.packetType);
  Serial.print(F(" - Current TTL    : ")); Serial.println(pkt.ttl);
  Serial.print(F(" - Signal RSSI/SNR: ")); Serial.print(rssi); Serial.print(F(" dBm / ")); Serial.print(snr, 1); Serial.println(F(" dB"));
  Serial.println(F("=============================================="));

  // Check TTL (Time To Live / Hops remaining)
  if (pkt.ttl > 1) {
    pkt.ttl -= 1; // Decrement hop counter

    // Random collision-avoidance jitter delay (50ms to 200ms)
    // Prevents RF packet collision storms when multiple repeaters hear the same packet
    int jitter = random(50, 200);
    delay(jitter);

    // Re-broadcast packet over LoRa Mesh
    LoRa.beginPacket();
    LoRa.write((uint8_t*)&pkt, sizeof(pkt));
    int res = LoRa.endPacket();

    if (res == 1) {
      totalRelayedPackets++;
      Serial.print(F("🚀 [Repeater RELAY SUCCESS] MsgID=#"));
      Serial.print(msgId);
      Serial.print(F(" (New TTL="));
      Serial.print(pkt.ttl);
      Serial.println(F(")"));
    } else {
      Serial.println(F("❌ [Repeater RELAY FAIL] Re-transmission error!"));
    }
  } else {
    Serial.print(F("⛔ [Repeater TTL EXPIRED] MsgID=#"));
    Serial.print(msgId);
    Serial.println(F(" dropped."));
  }
}

// ---- Setup Routine ----
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println(F("\n=== FlapMain LoRa Mesh Repeater Initializing ==="));

  #if defined(STATUS_LED_PIN)
    pinMode(STATUS_LED_PIN, OUTPUT);
    digitalWrite(STATUS_LED_PIN, LOW);
  #endif

  // Seed random generator using analog noise
  randomSeed(analogRead(A0) ^ millis());

  // Initialize SX1278 LoRa Module
  LoRa.setPins(LORA_SS_PIN, LORA_RST_PIN, LORA_DIO0_PIN);
  LoRa.setSPIFrequency(4000000); // 4MHz SPI Clock

  if (!LoRa.begin(LORA_FREQUENCY)) {
    Serial.println(F("ERROR: SX1278 LoRa initialization failed! Check SPI wiring."));
    while (true) delay(500);
  }

  // Configure long-range radio settings (SF10 / 125kHz / 14dBm / CRC / SyncWord)
  LoRa.setSpreadingFactor(LORA_SPREADING_FACTOR);
  LoRa.setSignalBandwidth(LORA_BANDWIDTH);
  LoRa.setCodingRate4(LORA_CODING_RATE);
  LoRa.setTxPower(LORA_TX_POWER);
  LoRa.setSyncWord(LORA_SYNC_WORD);
  LoRa.enableCrc();

  Serial.print(F("[LoRa Repeater Node #"));
  Serial.print(REPEATER_NODE_ID);
  Serial.println(F(" Ready] Flood-routing operational on 433MHz with CRC."));
}

// ---- Main Loop ----
void loop() {
  // Polling Check for incoming LoRa Mesh Packets
  int packetSize = LoRa.parsePacket();
  if (packetSize > 0) {
    int rssi = LoRa.packetRssi();
    float snr = LoRa.packetSnr();

    if (packetSize >= 50 && packetSize <= (int)sizeof(LoRaMeshPacket) + 10) {
      LoRaMeshPacket rxPkt;
      memset(&rxPkt, 0, sizeof(rxPkt));
      size_t toRead = ((size_t)packetSize < sizeof(rxPkt)) ? (size_t)packetSize : sizeof(rxPkt);
      LoRa.readBytes((uint8_t*)&rxPkt, toRead);
      processAndRelayPacket(rxPkt, rssi, snr);
    } else {
      String rawStr = "";
      while (LoRa.available()) rawStr += (char)LoRa.read();
      Serial.println(F("\n=============================================="));
      Serial.print(F("📥 [Repeater RAW RX] Received Text: \"")); Serial.print(rawStr); Serial.println(F("\""));
      Serial.print(F(" - RSSI / SNR      : ")); Serial.print(rssi); Serial.print(F(" dBm / ")); Serial.print(snr, 1); Serial.println(F(" dB"));
      Serial.println(F("=============================================="));
    }
    LoRa.receive(); // Re-arm SX1278 into continuous RX mode
  }

  // Periodic status heartbeat printout (Every 60 seconds)
  static unsigned long lastStatusPrint = 0;
  if (millis() - lastStatusPrint > 60000) {
    lastStatusPrint = millis();
    Serial.print(F("[Repeater Heartbeat] Total Relayed: "));
    Serial.print(totalRelayedPackets);
    Serial.print(F(" | Dedup Dropped: "));
    Serial.println(totalDroppedPackets);
  }

  delay(20);
}
