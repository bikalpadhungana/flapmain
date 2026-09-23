/*
 * =================================================================================
 * FLAPMAIN LORA MESH SYSTEM MAIN CONFIGURATION (config.h)
 * Shared Master Local Server & LoRa Radio Parameters
 * =================================================================================
 */

#ifndef MESH_MASTER_CONFIG_H
#define MESH_MASTER_CONFIG_H

// ---- Main Local Server API Target ----
// Local server running FlapMain backend on port 5051
#define FLAPMAIN_LOCAL_SERVER   "http://192.168.1.67:5051"
#define FLAPMAIN_LOCAL_FALLBACK "http://localhost:5051"

// ---- Default Wi-Fi Credentials ----
#define DEFAULT_WIFI_SSID       "Your_WiFi_SSID"
#define DEFAULT_WIFI_PASSWORD   "Your_WiFi_Password"

// ---- Global LoRa Mesh Radio Parameters ----
#define MESH_LORA_FREQUENCY     433E6    // 433 MHz
#define MESH_LORA_SYNC_WORD     0x12     // FlapMain Mesh Sync Word (0x12)
#define MESH_SPREADING_FACTOR   10       // SF10
#define MESH_BANDWIDTH          125E3    // 125 kHz
#define MESH_CODING_RATE        5        // 4/5
#define MESH_MAX_TTL            8        // Hops limit

#endif // MESH_MASTER_CONFIG_H
