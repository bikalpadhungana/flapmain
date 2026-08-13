#ifndef CONFIG_H
#define CONFIG_H

// --- FlapMain Arduino Hardware Config (Local System) ---
#define FLAPMAIN_SERVER    "https://main.flap.com.np"
#define FLAPMAIN_DEVICE_ID "flap-card-w0f5"
#define FLAPMAIN_DEVICE_KEY "flap_dev_dd27a6d26219108b50b8c5704fc94ef641da51089b13289a"

const char* WIFI_SSID    = "flap_2.4";
const char* WIFI_PASS    = "CLB43A84C2";

const char* DEVICE_ID    = FLAPMAIN_DEVICE_ID;
const char* API_KEY      = FLAPMAIN_DEVICE_KEY;
const char* BUSINESS_ID  = "default_org";

// Endpoints pointing to the local system API
const char* TAP_URL      = FLAPMAIN_SERVER "/api/device/tap";
const char* PING_URL     = FLAPMAIN_SERVER "/api/device/ping";
const char* REGISTER_URL = FLAPMAIN_SERVER "/api/tags/lookup";

#endif // CONFIG_H
