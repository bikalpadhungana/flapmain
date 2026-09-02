/*
 * =====================================================================
 * FlapMain IoT — Configuration (Unified Weather Station Pro)
 * =====================================================================
 * Device type: weather_station_v1
 * Device ID  : flap-flap-aws-001-7zhj
 * =====================================================================
 */

#ifndef FLAPMAIN_WEATHER_CONFIG_H
#define FLAPMAIN_WEATHER_CONFIG_H

// --- Wi-Fi Network Credentials ---
#define WIFI_SSID          "flap_2.4"
#define WIFI_PASSWORD      "CLB43A84C2"

// --- Wi-Fi Access Point / Hotspot Fallback (when defined Wi-Fi is unavailable) ---
#define AP_SSID            "FlapWeather-Hotspot"
#define AP_PASSWORD        "12345678"

// --- FlapMain Production Backend API Connection ---
#define FLAPMAIN_SERVER    "https://main.esainnovation.com/api"

// --- Device Provisioning Credentials ---
#define FLAPMAIN_DEVICE_ID  "flap-flap-aws-001-7zhj"
#define FLAPMAIN_DEVICE_KEY "flap_dev_aab35d32a090cf3116ec2fdd83bc063e46ee39faeeffc8ca"

#endif // FLAPMAIN_WEATHER_CONFIG_H
