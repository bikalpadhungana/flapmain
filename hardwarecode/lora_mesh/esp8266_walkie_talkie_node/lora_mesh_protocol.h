/*
 * =================================================================================
 * FLAPMAIN LORA MESH PROTOCOL HEADER (lora_mesh_protocol.h)
 * Shared between Arduino Nano AWS, Arduino Nano Repeater, and ESP Gateway nodes.
 * Compatible with sandeepmistry/arduino-LoRa library and SX1278 / SX1276 / RFM95.
 * =================================================================================
 */

#ifndef LORA_MESH_PROTOCOL_H
#define LORA_MESH_PROTOCOL_H

#include <Arduino.h>

// ---- Default Radio Parameters ----
#define LORA_FREQUENCY        433E6   // 433 MHz (change to 868E6 or 915E6 for your region)
#define LORA_SPREADING_FACTOR 10      // SF10 for extended link budget and long range
#define LORA_BANDWIDTH        125E3   // 125 kHz bandwidth
#define LORA_CODING_RATE      5       // 4/5 coding rate
#define LORA_TX_POWER         14      // 14 dBm TX power (safe current draw for Arduino Nano 3.3V pin <40mA)
#define LORA_SYNC_WORD        0x12    // Explicit Sync Word for FlapMain LoRa Mesh

// ---- Mesh Network Constants ----
#define DEFAULT_MAX_TTL       8       // Maximum hop limit before packet expiry
#define SEEN_CACHE_SIZE       32      // Ring buffer capacity for deduplication

// ---- Packet Types ----
#define PKT_TYPE_WEATHER      0       // Weather Telemetry (Temp, Hum, Pressure, Wind, Light)
#define PKT_TYPE_SOS          1       // Emergency SOS Alert
#define PKT_TYPE_HEARTBEAT    2       // Node Status & Battery Heartbeat
#define PKT_TYPE_ACK          3       // Gateway Acknowledgment
#define PKT_TYPE_TEXT         4       // Walkie-Talkie Text / Emergency Message

// ---- Wind Direction Codes ----
// 0=None, 1=North, 2=NE, 3=East, 4=SE, 5=South, 6=SW, 7=West, 8=NW
inline const char* getWindDirString(uint8_t code) {
  switch (code) {
    case 1: return "North";
    case 2: return "NE";
    case 3: return "East";
    case 4: return "SE";
    case 5: return "South";
    case 6: return "SW";
    case 7: return "West";
    case 8: return "NW";
    default: return "None";
  }
}

inline uint8_t getWindDirCode(const char* dir) {
  if (strcmp(dir, "North") == 0) return 1;
  if (strcmp(dir, "NE") == 0)    return 2;
  if (strcmp(dir, "East") == 0)  return 3;
  if (strcmp(dir, "SE") == 0)    return 4;
  if (strcmp(dir, "South") == 0) return 5;
  if (strcmp(dir, "SW") == 0)    return 6;
  if (strcmp(dir, "West") == 0)  return 7;
  if (strcmp(dir, "NW") == 0)    return 8;
  return 0;
}

// ---- Compact Packed LoRa Mesh Packet ----
// Uses __attribute__((packed)) for zero structure padding across MCU platforms.
struct __attribute__((packed)) LoRaMeshPacket {
  uint8_t  msgIdHi;        // Message sequence ID, high byte  \_ 16-bit sequence ID
  uint8_t  msgIdLo;        // Message sequence ID, low byte   /
  uint8_t  originNode;     // Unique origin node ID (1..255)
  uint8_t  targetNode;     // Destination node ID (0 = Broadcast to all nodes, 1..255 = specific walkie node)
  uint8_t  ttl;            // Hops remaining (decremented at each relay hop)
  uint8_t  packetType;     // PKT_TYPE_WEATHER, PKT_TYPE_SOS, etc.
  int16_t  temp_x10;       // Temperature in °C * 10 (e.g. 254 = 25.4 °C)
  uint16_t hum_x10;        // Relative humidity % * 10 (e.g. 655 = 65.5 %)
  uint32_t pressure_pa;    // Barometric pressure in Pascals (e.g. 101325 Pa)
  uint16_t wind_speed_x10; // Wind speed in km/h * 10 (e.g. 125 = 12.5 km/h)
  uint8_t  wind_dir_code;  // Wind direction code (0..8)
  uint16_t light_val;      // Light intensity raw ADC (0..1023)
  uint16_t battery_mv;     // Battery voltage in millivolts (e.g. 3850 mV)
  uint16_t mq3_gas;        // MQ-3 Gas / Alcohol Sensor ADC (0..1023)
  uint8_t  alert_level;    // 0 = Normal, 1 = Warning, 2 = Critical Emergency SOS
  char     text_msg[32];   // Walkie-Talkie / Emergency Text Message (null-terminated)
};

// Parses target node ID from text if specified as "/{target_node}" (e.g., "Hello /102" or "/101 SOS")
// Returns target node ID (1..255) if found, or 0 if broadcast.
inline uint8_t parseTargetNodeFromText(const char* text, char* cleanTextBuffer, size_t bufferSize) {
  if (!text) return 0;
  uint8_t target = 0;
  String str = String(text);
  str.trim();

  int slashIdx = str.lastIndexOf('/');
  if (slashIdx != -1 && slashIdx + 1 < (int)str.length()) {
    int parsed = str.substring(slashIdx + 1).toInt();
    if (parsed > 0 && parsed <= 255) {
      target = (uint8_t)parsed;
      str = str.substring(0, slashIdx);
      str.trim();
    }
  } else if (str.startsWith("/")) {
    int spaceIdx = str.indexOf(' ');
    if (spaceIdx != -1) {
      int parsed = str.substring(1, spaceIdx).toInt();
      if (parsed > 0 && parsed <= 255) {
        target = (uint8_t)parsed;
        str = str.substring(spaceIdx + 1);
        str.trim();
      }
    }
  }

  if (cleanTextBuffer && bufferSize > 0) {
    strncpy(cleanTextBuffer, str.c_str(), bufferSize - 1);
    cleanTextBuffer[bufferSize - 1] = '\0';
  }

  return target;
}

// ---- Deduplication Helper Class ----
class MeshDedup {
private:
  uint32_t seenIds[SEEN_CACHE_SIZE];
  uint8_t  seenIdx;

public:
  MeshDedup() : seenIdx(0) {
    for (uint8_t i = 0; i < SEEN_CACHE_SIZE; i++) seenIds[i] = 0xFFFFFFFF;
  }

  // Returns true if packet (originNode + msgId) has already been processed/relayed
  bool alreadySeen(uint8_t originNode, uint16_t msgId) {
    uint32_t key = ((uint32_t)originNode << 16) | (uint32_t)msgId;
    for (uint8_t i = 0; i < SEEN_CACHE_SIZE; i++) {
      if (seenIds[i] == key) return true;
    }
    return false;
  }

  // Records packet into the ring buffer cache
  void markSeen(uint8_t originNode, uint16_t msgId) {
    uint32_t key = ((uint32_t)originNode << 16) | (uint32_t)msgId;
    seenIds[seenIdx] = key;
    seenIdx = (seenIdx + 1) % SEEN_CACHE_SIZE;
  }
};

#endif // LORA_MESH_PROTOCOL_H
