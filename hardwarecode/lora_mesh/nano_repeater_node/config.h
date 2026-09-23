/*
 * =================================================================================
 * FLAPMAIN ARDUINO NANO LORA MESH REPEATER CONFIGURATION (config.h)
 * Relay Node ID & Mesh Routing Settings
 * =================================================================================
 */

#ifndef REPEATER_CONFIG_H
#define REPEATER_CONFIG_H

// ---- Repeater Hardware Identifier ----
#define REPEATER_NODE_ID     0x02                      // Unique Repeater Node ID (1..255)
#define FLAPMAIN_DEVICE_ID   "nano_repeater_node_01"   // Device ID registered in Main Local Server DB

// ---- Mesh Routing Parameters ----
#define MAX_TTL              8                         // Maximum hop limit before packet drop
#define RELAY_JITTER_MIN_MS  50                        // Min random backoff jitter before re-tx
#define RELAY_JITTER_MAX_MS  250                       // Max random backoff jitter before re-tx

// ---- LoRa Radio Settings ----
#define LORA_FREQ_CONFIG     433E6                     // 433 MHz
#define LORA_SYNC_WORD_CFG   0x12                      // FlapMain Mesh Sync Word

#endif // REPEATER_CONFIG_H
