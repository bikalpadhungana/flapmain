/*
 * =================================================================================
 * FLAPMAIN ESP32 LORA MESH WALKIE-TALKIE CONFIGURATION (config.h)
 * =================================================================================
 */

#ifndef ESP32_WALKIE_CONFIG_H
#define ESP32_WALKIE_CONFIG_H

// ---- Node ID (1..255, unique per radio) ----
// 101 = Alpha, 102 = Bravo (Nano), 103 = Charlie (ESP8266), 104 = Delta (ESP32).
// Two radios with the same ID drop each other's messages as duplicates.
#ifndef WALKIE_NODE_ID
  #define WALKIE_NODE_ID 104
#endif

// ---- Delivery confirmation ----
#define ACK_TIMEOUT_MS   6000   // wait this long for an ACK before re-sending
#define ACK_MAX_RETRIES  2      // re-sends after the first attempt
#define INBOX_CAPACITY   10

// ---- Bluetooth LE (phone / flaap.me app) ----
// Nordic UART Service: the app sends the same text commands as over USB serial
// and receives the same output lines. Device name: "FlapWalkie-<node id>".
#define BLE_ENABLED          1
// BLE_PAIRING
//   1 = "Just Works" (default): the phone shows Pair / Cancel, no PIN; link is encrypted.
//       New phones can pair only while the pairing window is open: the first
//       BLE_PAIR_WINDOW_MS after power-on, or after holding SELECT for 3 s.
//       Already-paired phones reconnect at any time.
//   2 = 6-digit passkey shown on the OLED (phone asks for a PIN; needs the display).
//   0 = open, no pairing or encryption: bench testing only.
#define BLE_PAIRING          1
#define BLE_PAIR_WINDOW_MS   120000   // 2 minutes

// ---- Pin map (ESP32 DevKit / WROOM-32) ----
#define LORA_SCK_PIN    18
#define LORA_MISO_PIN   19
#define LORA_MOSI_PIN   23
#define LORA_SS_PIN     5
#define LORA_RST_PIN    14
#define LORA_DIO0_PIN   26

#define OLED_SDA_PIN    21   // SH1106 1.3" or SSD1306 0.96", I2C 0x3C/0x3D
#define OLED_SCL_PIN    22
#define OLED_RST_PIN    -1   // -1 = no reset pin. TTGO / Heltec LoRa32 V1 built-in OLED: 16
#define OLED_DRIVER     0    // 0 = works with both, 1 = force SSD1306 (0.96"), 2 = force SH1106 (1.3")
// If no display answers on the pins above, the walkie also tries SDA/SCL swapped and the
// common built-in OLED pins (4/15, 17/18), and prints an I2C scan on the serial monitor.

#define BTN_SELECT_PIN  32   // Button 1: next / menu / browse (to GND, internal pull-up)
#define BTN_CLICK_PIN   33   // Button 2: enter / send; hold 1.5 s = SOS (to GND)
#define BUZZER_PIN      25   // piezo (0 = none)
#define STATUS_LED_PIN  2    // on-board LED
#define BATT_PIN        34   // battery divider (input-only, ADC1)
#define BATTERY_DIVIDER 2.0f // 100k/100k divider

#endif // ESP32_WALKIE_CONFIG_H
