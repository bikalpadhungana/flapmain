/*
 * =================================================================================
 * FLAPMAIN ESP LORA GATEWAY NODE CONFIGURATION (config.h)
 * Local Server Target & Hardware Configuration
 * =================================================================================
 */

#ifndef CONFIG_H
#define CONFIG_H

// ---- Wi-Fi Station Credentials ----
#define WIFI_SSID       "ALHN-334A"      // Replace with your local WiFi network name
#define WIFI_PASSWORD   "vRY79KAwK9"  // Replace with your local WiFi password

// ---- Hotspot AP Fallback Credentials ----
#define AP_SSID         "FlapMain-LoRaGateway-AP"
#define AP_PASSWORD     "12345678"

// ---- FlapMain Server API Target ----
// • Live VPS Host:  "http://main.esainnovation.com:5003" (FlapMain API is on port 5003)
// • Local Dev Host: "http://192.168.1.64:5003"
#define FLAPMAIN_SERVER    "http://main.esainnovation.com:5003"
#define FLAPMAIN_DEVICE_ID "flap-flap-aws-001-7zhj"      // Target Device ID for telemetry ingestion
#define FLAPMAIN_DEVICE_KEY "flap_dev_aab35d32a090cf3116ec2fdd83bc063e46ee39faeeffc8ca"

// ---- LoRa Radio Settings ----
#define LORA_FREQ_CONFIG          433E6    // 433 MHz
#define LORA_SPREADING_FACTOR_CFG 10       // SF10
#define LORA_SYNC_WORD_CFG        0x12     // FlapMain Mesh Sync Word

#endif // CONFIG_H
