/*
 * =================================================================================
 * FLAPMAIN ARDUINO NANO AWS LORA NODE CONFIGURATION (config.h)
 * Hardware Node ID, Calibration & Radio Parameters
 * =================================================================================
 */

#ifndef AWS_CONFIG_H
#define AWS_CONFIG_H

// ---- Hardware Node Identifier ----
// Set AWS_NODE_ID for target deployment site:
//   1 = Manung Dada                    -> Device ID: flap-flap-aws-001-7zhj
//   2 = Damauli Bazar                  -> Device ID: flap-flap-aws-002-node
//   3 = Kalupada Dada Kathmandu        -> Device ID: flap-flap-aws-003-node
//   4 = Chandragiri Hill Kathmandu     -> Device ID: flap-flap-aws-004-node
#ifndef AWS_NODE_ID
  #define AWS_NODE_ID        0x01                          // Unique Node ID on LoRa Mesh (1..255)
#endif

#ifndef FLAPMAIN_DEVICE_ID
  #if AWS_NODE_ID == 1
    #define FLAPMAIN_DEVICE_ID "flap-flap-aws-001-7zhj"      // Manung Dada
  #elif AWS_NODE_ID == 2
    #define FLAPMAIN_DEVICE_ID "flap-flap-aws-002-node"      // Damauli Bazar
  #elif AWS_NODE_ID == 3
    #define FLAPMAIN_DEVICE_ID "flap-flap-aws-003-node"      // Kalupada Dada Kathmandu
  #elif AWS_NODE_ID == 4
    #define FLAPMAIN_DEVICE_ID "flap-flap-aws-004-node"      // Chandragiri Hill Kathmandu
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
