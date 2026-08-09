/*
 * =====================================================================
 * FlapMain IoT — Configuration (Combined Height + Weight Scale)
 * =====================================================================
 * Device type: weight_scale_v1
 * Local System IP: 192.168.1.69:5051
 * =====================================================================
 * =====================================================================
 */

#ifndef FLAPMAIN_CONFIG_H
#define FLAPMAIN_CONFIG_H

// --- Wi-Fi Network Credentials ---
#define WIFI_SSID          "flap_2.4"
#define WIFI_PASSWORD      "CLB43A84C2"

// --- FlapMain Local Backend API Connection ---
#define FLAPMAIN_SERVER    "http://192.168.1.69:5051/api"

// --- Device Provisioning Credentials (Local Database Active Device) ---
#define FLAPMAIN_DEVICE_ID  "flap-weight and height sensor-yftb"
#define FLAPMAIN_DEVICE_KEY "flap_dev_b52d51276c634d4da37310a7a8dbe7f466deaf2a619391f7"

#endif // FLAPMAIN_CONFIG_H
