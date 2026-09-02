/*
 * =====================================================================
 * FlapMain IoT — ESP32-CAM Camera Configuration
 * =====================================================================
 * Device type: esp32_cam_v1
 * Device ID  : flap-esp32-cam-001
 * =====================================================================
 */

#ifndef FLAPMAIN_CAM_CONFIG_H
#define FLAPMAIN_CAM_CONFIG_H

// --- Select Camera Board Model ---
#ifndef CAMERA_MODEL_AI_THINKER
#define CAMERA_MODEL_AI_THINKER // AI Thinker ESP32-CAM (with PSRAM)
#endif

// --- Wi-Fi Network Credentials ---
#define WIFI_SSID          "flap_2.4"
#define WIFI_PASSWORD      "CLB43A84C2"

// --- FlapMain Backend API Connection ---
#define FLAPMAIN_SERVER    "https://main.esainnovation.com/api"

// --- Device Provisioning Credentials ---
#define FLAPMAIN_DEVICE_ID  "flap-esp32-cam-001"
#define FLAPMAIN_DEVICE_KEY "flap_dev_c4m_88291a0b3e921d7465f"

#endif // FLAPMAIN_CAM_CONFIG_H
