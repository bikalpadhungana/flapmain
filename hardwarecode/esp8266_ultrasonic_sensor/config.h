/*
 * =====================================================================
 * FlapMain IoT Platform — Configuration (Ultrasonic Height Sensor)
 * =====================================================================
 * This device measures HEIGHT ONLY using an HC-SR04 ultrasonic sensor.
 * It is registered as device type: height_sensor_v1
 * =====================================================================
 */

#ifndef FLAPMAIN_CONFIG_H
#define FLAPMAIN_CONFIG_H

// --- Wi-Fi Network Credentials ---
#define WIFI_SSID       "flap_2.4"
#define WIFI_PASSWORD   "CLB43A84C2"

// --- FlapMain Backend API Connection ---
#define FLAPMAIN_SERVER "http://192.168.1.64:5051"

// --- Device Provisioning Credentials (from Dashboard) ---
// Register this device as type "height_sensor_v1" in the dashboard
#define DEVICE_ID       "flap-height-9k2m"
#define DEVICE_KEY      "PASTE_YOUR_HEIGHT_SENSOR_DEVICE_KEY_HERE"

#endif // FLAPMAIN_CONFIG_H
