/*
 * =================================================================================
 * FLAPMAIN ARDUINO NANO AWS LORA NODE CONFIGURATION (config.h)
 * Hardware Node ID, Calibration & Radio Parameters
 * =================================================================================
 */

#ifndef AWS_CONFIG_H
#define AWS_CONFIG_H

// ---- Hardware Node Identifier ----
#define AWS_NODE_ID        0x01                          // Unique Node ID on LoRa Mesh (1..255)
#define FLAPMAIN_DEVICE_ID "flap-flap-aws-001-7zhj"      // Device ID registered in Main Local Server DB

// ---- Telemetry & Transmission Timing ----
#define TELEMETRY_INTERVAL 5000                          // Telemetry broadcast interval in ms (5s)

// ---- Sensor Calibration ----
#define WIND_CALIBRATION_K 2.4                           // km/h per pulse per second
#define MEASURE_INTERVAL_MS 2000                         // Anemometer sampling window (2s)

// ---- LoRa Radio Settings ----
#define LORA_FREQ_CONFIG   433E6                         // 433 MHz
#define LORA_SYNC_WORD_CFG 0x12                          // FlapMain Mesh Sync Word

#endif // AWS_CONFIG_H
