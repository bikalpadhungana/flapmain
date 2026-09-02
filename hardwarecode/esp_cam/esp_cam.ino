// ===================
// Select camera model
// ===================
#define CAMERA_MODEL_AI_THINKER // AI Thinker ESP32-CAM (Has PSRAM)

#include "esp_camera.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include "config.h"
#include "camera_pins.h"

void startCameraServer();
void setupLedFlash(int pin);

// Heartbeat timer
unsigned long lastHeartbeat = 0;
const unsigned long heartbeatInterval = 30000; // Send heartbeat to FlapMain every 30s

WiFiClientSecure secureClient;

void sendFlapMainHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClient client;
  HTTPClient http;
  String url = String(FLAPMAIN_SERVER) + "/v1/devices/data";

  if (String(FLAPMAIN_SERVER).startsWith("https")) {
    secureClient.setInsecure();
    http.begin(secureClient, url);
  } else {
    http.begin(client, url);
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Id", FLAPMAIN_DEVICE_ID);
  http.addHeader("X-Device-Key", FLAPMAIN_DEVICE_KEY);
  http.setTimeout(8000);

  String ipStr = WiFi.localIP().toString();
  String streamUrl = "http://" + ipStr + ":81/stream";
  String captureUrl = "http://" + ipStr + "/capture";

  String payload = "{";
  payload += "\"device_id\":\"" + String(FLAPMAIN_DEVICE_ID) + "\",";
  payload += "\"device_type\":\"esp32_cam_v1\",";
  payload += "\"ip_address\":\"" + ipStr + "\",";
  payload += "\"stream_url\":\"" + streamUrl + "\",";
  payload += "\"capture_url\":\"" + captureUrl + "\",";
  payload += "\"rssi\":" + String(WiFi.RSSI()) + ",";
  payload += "\"status\":\"online\"";
  payload += "}";

  Serial.println("[FlapMain] Transmitting Camera Telemetry Heartbeat...");
  int httpCode = http.POST(payload);
  if (httpCode > 0) {
    Serial.printf("[FlapMain] Camera Heartbeat Success | HTTP %d\n", httpCode);
  } else {
    Serial.printf("[FlapMain] Camera Heartbeat Error: %s\n", http.errorToString(httpCode).c_str());
  }
  http.end();
}

void setup() {
  Serial.begin(115200);
  Serial.setDebugOutput(true);
  Serial.println("\n=== FlapMain ESP32-CAM Initializing ===");

  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.frame_size = FRAMESIZE_UXGA;
  config.pixel_format = PIXFORMAT_JPEG; // for streaming
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.jpeg_quality = 12;
  config.fb_count = 1;
  
  if(config.pixel_format == PIXFORMAT_JPEG){
    if(psramFound()){
      config.jpeg_quality = 10;
      config.fb_count = 2;
      config.grab_mode = CAMERA_GRAB_LATEST;
    } else {
      config.frame_size = FRAMESIZE_SVGA;
      config.fb_location = CAMERA_FB_IN_DRAM;
    }
  }

  // Camera Init
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed with error 0x%x\n", err);
    return;
  }

  sensor_t * s = esp_camera_sensor_get();
  if (s->id.PID == OV3660_PID) {
    s->set_vflip(s, 1);
    s->set_brightness(s, 1);
    s->set_saturation(s, -2);
  }
  if(config.pixel_format == PIXFORMAT_JPEG){
    s->set_framesize(s, FRAMESIZE_VGA);
  }

#if defined(LED_GPIO_NUM)
  setupLedFlash(LED_GPIO_NUM);
#endif

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  WiFi.setSleep(false);

  Serial.print("Connecting to WiFi: ");
  Serial.print(WIFI_SSID);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected successfully!");

  startCameraServer();

  Serial.println("=============================================");
  Serial.print("Camera Ready! Stream URL : http://");
  Serial.print(WiFi.localIP());
  Serial.println(":81/stream");
  Serial.print("Control Dashboard URL   : http://");
  Serial.println(WiFi.localIP());
  Serial.println("=============================================");

  sendFlapMainHeartbeat();
}

// --- Direct Cloud JPEG Frame Upload Routine ---
void sendFrameToFlapMain() {
  if (WiFi.status() != WL_CONNECTED) return;

  camera_fb_t * fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("Camera frame capture failed!");
    return;
  }

  WiFiClient client;
  HTTPClient http;
  String url = String(FLAPMAIN_SERVER) + "/v1/devices/camera/upload";

  if (String(FLAPMAIN_SERVER).startsWith("https")) {
    secureClient.setInsecure();
    http.begin(secureClient, url);
  } else {
    http.begin(client, url);
  }

  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("X-Device-Id", FLAPMAIN_DEVICE_ID);
  http.addHeader("X-Device-Key", FLAPMAIN_DEVICE_KEY);
  http.setTimeout(4000);

  int httpCode = http.POST(fb->buf, fb->len);
  if (httpCode > 0) {
    String response = http.getString();
    // Parse flash command in response if present
    pinMode(4, OUTPUT);
    if (response.indexOf("\"flash\":1") >= 0 || response.indexOf("\"flash_on\":true") >= 0) {
      digitalWrite(4, HIGH);
    } else if (response.indexOf("\"flash\":0") >= 0 || response.indexOf("\"flash_on\":false") >= 0) {
      digitalWrite(4, LOW);
    }
  } else {
    Serial.printf("[Cloud Frame Sync] Error: %s\n", http.errorToString(httpCode).c_str());
  }

  http.end();
  esp_camera_fb_return(fb);
}

void loop() {
  unsigned long currentMillis = millis();
  if (currentMillis - lastHeartbeat >= heartbeatInterval) {
    lastHeartbeat = currentMillis;
    sendFlapMainHeartbeat();
  }

  // Continuously stream JPEG frames directly to FlapMain Cloud backend
  sendFrameToFlapMain();
  delay(500);
}
