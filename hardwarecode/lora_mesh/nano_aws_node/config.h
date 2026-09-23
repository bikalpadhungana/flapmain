/*
 * =================================================================================
 * FLAPMAIN ARDUINO NANO AWS LORA NODE CONFIGURATION (config.h)
 * Hardware Node ID, Calibration & Radio Parameters
 * =================================================================================
 */

#ifndef AWS_CONFIG_H
#define AWS_CONFIG_H

// ---- Hardware Node Identifier ----
// Set AWS_NODE_ID to:
//   1 = Primary Station (Roof Deck)       -> Device ID: flap-flap-aws-001-7zhj
//   2 = Secondary Station (Perimeter/Field) -> Device ID: flap-flap-aws-002-node
//   3 = Station #3, etc.
#ifndef AWS_NODE_ID
  #define AWS_NODE_ID        0x01                          // Unique Node ID on LoRa Mesh (1..255)
#endif

#ifndef FLAPMAIN_DEVICE_ID
  #if AWS_NODE_ID == 1
    #define FLAPMAIN_DEVICE_ID "flap-flap-aws-001-7zhj"      // Registered in Main Local Server DB
  #elif AWS_NODE_ID == 2
    #define FLAPMAIN_DEVICE_ID "flap-flap-aws-002-node"      // Registered in Main Local Server DB
  #else
    #define FLAPMAIN_DEVICE_ID "flap-flap-aws-custom"
  #endif
#endif

// ---- Telemetry & Transmission Timing ----
#ifndef TELEMETRY_INTERVAL
  #define TELEMETRY_INTERVAL 5000                          // Telemetry broadcast interval in ms (5s)
#endif

// ---- Sensor Calibration ----
#define WIND_CALIBRATION_K 2.4                           // km/h per pulse per second
#define MEASURE_INTERVAL_MS 2000                         // Anemometer sampling window (2s)

// ---- LoRa Radio Settings ----
#define LORA_FREQ_CONFIG   433E6                         // 433 MHz
#define LORA_SYNC_WORD_CFG 0x12                          // FlapMain Mesh Sync Word

#endif // AWS_CONFIG_H
