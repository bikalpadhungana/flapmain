/*
 * =====================================================================
 * FlapMain IoT Platform - Hardware Configuration File Header
 * =====================================================================
 * Instructions:
 * 1. Copy this file to "config.h" in your Arduino sketch directory.
 * 2. Fill in your Wi-Fi credentials and FlapMain server IP.
 * 3. Paste the generated DEVICE_ID and DEVICE_KEY from your FlapMain Dashboard.
 */

#ifndef FLAPMAIN_CONFIG_H
#define FLAPMAIN_CONFIG_H

// --- Wi-Fi Network Credentials ---
#define WIFI_SSID       "flap_2.4"
#define WIFI_PASSWORD   "CLB43A84C2"

// --- FlapMain Backend API Connection ---
// Example: "http://192.168.1.100:5050" or "http://yourdomain.com:5050"
#define FLAPMAIN_SERVER "http://192.168.1.100:5050"

// --- Device Provisioning Credentials (from Dashboard) ---
#define DEVICE_ID       "flap-ultrasonic-a1b2"
#define DEVICE_KEY      "flap_dev_your_generated_device_api_key"

// --- Sensor Read Interval (in milliseconds) ---
#define TELEMETRY_INTERVAL_MS 5000 // Ingest reading every 5 seconds

#endif // FLAPMAIN_CONFIG_H
