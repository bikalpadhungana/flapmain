/*
  SOS MESH NODE — flood-routing LoRa firmware sketch
  ---------------------------------------------------
  Target: ESP32 + SX127x LoRa module (RA-02 / RFM95 / E22-900T)
  Library: sandeepmistry/arduino-LoRa

  Design goals (matched to the hilltop-relay use case):
  - No fixed routing table needed. Every node just re-broadcasts
    packets it hasn't seen before ("flood routing"). This is what
    makes the mesh resilient when a single hilltop node dies or a
    link drops out in bad weather.
  - Packets are tiny (fits in one LoRa frame) — lat/long, battery,
    alert type, timestamp, a message ID for dedup, and a hop count
    (TTL) so packets don't circulate forever.
  - Deduplication is first-class: a small ring buffer of recently
    seen message IDs prevents the same SOS from being re-broadcast
    infinitely by every node that hears it more than once.
  - Any node can act as: a plain sensor node, a relay, or (if wired
    to a GSM/WiFi module) a gateway that bridges to the internet.

  This is a starting skeleton, not production code — swap in your
  actual GPS/battery reads, tune SF/BW for your link budget, and
  add encryption before this touches anything safety-critical.
*/

#include <SPI.h>
#include <LoRa.h>

// ---- Radio pins (adjust to your wiring) ----
#define LORA_SS   5
#define LORA_RST  14
#define LORA_DIO0 2

// ---- Node identity ----
#define NODE_ID   0x01        // unique per deployed node (1..255)
#define MAX_TTL   8           // max hops before a packet is dropped
#define SEEN_CACHE_SIZE 32    // how many recent msg IDs we remember

// ---- Packet structure (fits well under LoRa's ~255 byte frame limit) ----
// Total: 1+1+1+1+4+4+2+4+1 = 19 bytes — leaves huge airtime margin
struct __attribute__((packed)) SosPacket {
  uint8_t  msgIdHi;      // message ID, high byte  \_ together form a
  uint8_t  msgIdLo;      // message ID, low byte   /  16-bit rolling ID
  uint8_t  originNode;   // node that first created this packet
  uint8_t  ttl;          // hops remaining
  float    lat;          // GPS latitude
  float    lon;          // GPS longitude
  uint16_t batteryMv;    // battery voltage, millivolts (compact)
  uint32_t timestamp;    // unix time (seconds) — sync via GPS or NTP at boot
  uint8_t  alertType;    // 0 = heartbeat/telemetry, 1 = SOS, 2 = ack, 3 = status
};

uint16_t seenIds[SEEN_CACHE_SIZE];
uint8_t  seenIdx = 0;
uint16_t nextMsgId = 0;

// ------------------------------------------------------------------
// Dedup: has this exact (originNode, msgId) pair already been relayed?
// ------------------------------------------------------------------
bool alreadySeen(uint8_t originNode, uint16_t msgId) {
  uint16_t key = (originNode << 8) | (msgId & 0xFF); // cheap composite key
  for (uint8_t i = 0; i < SEEN_CACHE_SIZE; i++) {
    if (seenIds[i] == key) return true;
  }
  return false;
}

void markSeen(uint8_t originNode, uint16_t msgId) {
  uint16_t key = (originNode << 8) | (msgId & 0xFF);
  seenIds[seenIdx] = key;
  seenIdx = (seenIdx + 1) % SEEN_CACHE_SIZE; // ring buffer, oldest overwritten
}

// ------------------------------------------------------------------
// Send a packet out over LoRa
// ------------------------------------------------------------------
void sendPacket(SosPacket &pkt) {
  LoRa.beginPacket();
  LoRa.write((uint8_t*)&pkt, sizeof(pkt));
  LoRa.endPacket();
}

// ------------------------------------------------------------------
// Originate a brand-new SOS from THIS node (e.g. a button press,
// or a sensor threshold trip — you decide the trigger condition)
// ------------------------------------------------------------------
void triggerSos(float lat, float lon, uint16_t batteryMv) {
  SosPacket pkt;
  uint16_t msgId = nextMsgId++;
  pkt.msgIdHi    = msgId >> 8;
  pkt.msgIdLo    = msgId & 0xFF;
  pkt.originNode = NODE_ID;
  pkt.ttl        = MAX_TTL;
  pkt.lat        = lat;
  pkt.lon        = lon;
  pkt.batteryMv  = batteryMv;
  pkt.timestamp  = millis() / 1000; // replace with real epoch time
  pkt.alertType  = 1; // SOS

  markSeen(NODE_ID, msgId);
  sendPacket(pkt);

  Serial.println("SOS originated and broadcast.");
}

// ------------------------------------------------------------------
// Handle any packet received over the air — relay if new, drop if seen
// ------------------------------------------------------------------
void onReceive(int packetSize) {
  if (packetSize != sizeof(SosPacket)) return; // ignore malformed frames

  SosPacket pkt;
  LoRa.readBytes((uint8_t*)&pkt, sizeof(pkt));

  uint16_t msgId = (pkt.msgIdHi << 8) | pkt.msgIdLo;

  if (alreadySeen(pkt.originNode, msgId)) {
    return; // already relayed this one — stop the flood here
  }
  markSeen(pkt.originNode, msgId);

  // ---- This is where a gateway node would push to internet/GSM ----
  // if (IS_GATEWAY_NODE) { forwardToBackhaul(pkt); }

  Serial.printf(
    "Relaying: origin=%d type=%d lat=%.5f lon=%.5f batt=%dmV ttl=%d\n",
    pkt.originNode, pkt.alertType, pkt.lat, pkt.lon, pkt.batteryMv, pkt.ttl
  );

  if (pkt.ttl > 1) {
    pkt.ttl -= 1;
    delay(random(50, 250)); // small random jitter avoids collision storms
                            // when multiple neighbors relay at once
    sendPacket(pkt);
  }
}

void setup() {
  Serial.begin(115200);
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);

  if (!LoRa.begin(868E6)) { // set to your legal band: 433E6 / 868E6 / 915E6
    Serial.println("LoRa init failed. Check wiring.");
    while (true);
  }

  // Long-range settings: lower data rate, longer airtime, better link
  // budget for hilltop-to-hilltop distances. Tune per your test results.
  LoRa.setSpreadingFactor(10);   // 7 (fast/short) .. 12 (slow/long-range)
  LoRa.setSignalBandwidth(125E3);
  LoRa.setCodingRate4(5);
  LoRa.setTxPower(20);           // max legal TX power varies by band/region

  LoRa.onReceive(onReceive);
  LoRa.receive();

  Serial.println("SOS mesh node ready.");
}

void loop() {
  // Example: periodic heartbeat telemetry so the gateway knows this
  // node is alive (battery, GPS fix) even with no SOS event.
  // Replace with real sensor/GPS reads.
  static unsigned long lastHeartbeat = 0;
  if (millis() - lastHeartbeat > 300000) { // every 5 minutes
    SosPacket pkt;
    uint16_t msgId = nextMsgId++;
    pkt.msgIdHi    = msgId >> 8;
    pkt.msgIdLo    = msgId & 0xFF;
    pkt.originNode = NODE_ID;
    pkt.ttl        = MAX_TTL;
    pkt.lat        = 0.0;   // TODO: real GPS
    pkt.lon        = 0.0;   // TODO: real GPS
    pkt.batteryMv  = 3800;  // TODO: real ADC read
    pkt.timestamp  = millis() / 1000;
    pkt.alertType  = 0; // heartbeat

    markSeen(NODE_ID, msgId);
    sendPacket(pkt);
    LoRa.receive(); // go back to listening after transmitting

    lastHeartbeat = millis();
  }
}
