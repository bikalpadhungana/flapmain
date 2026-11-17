/*
 * =================================================================================
 * FLAPMAIN ESP32 AWS LORA NODE CONFIGURATION (config.h)
 * Node ID, timing, calibration and pin map for the ESP32 weather station.
 * =================================================================================
 */

#ifndef ESP32_AWS_CONFIG_H
#define ESP32_AWS_CONFIG_H

// ---- Node ID on the LoRa mesh (1..255, unique per station) ----
// The gateway forwards node N as device "flap-flap-aws-00N-node" (node 1 uses
// the legacy ID). A new ID shows up in the dashboard under "Discovered devices",
// where you add it with its name and GPS position.
//   1 = Manung Dada   2 = Damauli Bazar   3 = Kalupada Dada   4 = Chandragiri Hill
//   101..103 are used by walkie-talkies.
#ifndef AWS_NODE_ID
  #define AWS_NODE_ID 5
#endif

// ---- Timing ----
#ifndef TELEMETRY_INTERVAL
  #define TELEMETRY_INTERVAL 5000   // ms between weather broadcasts (same as the Nano AWS)
#endif

// ---- Calibration ----
#define WIND_CALIBRATION_K   2.4f   // km/h per anemometer pulse per second
#define RAIN_MM_PER_TIP      0.173f // mm of rain per tipping-bucket tip
#define BATTERY_DIVIDER      2.0f   // battery voltage divider ratio (100k/100k = 2)

// ---- Pin map (ESP32 DevKit / WROOM-32) ----
// Avoids flash pins (6-11) and boot strapping pins (0, 2, 12, 15).
// Analog inputs use ADC1 only (ADC2 cannot be read while Wi-Fi is on).
// ESP32 GPIOs are 3.3 V: never feed 5 V sensor outputs straight in.
#define LORA_SCK_PIN    18
#define LORA_MISO_PIN   19
#define LORA_MOSI_PIN   23
#define LORA_SS_PIN     5
#define LORA_RST_PIN    14
#define LORA_DIO0_PIN   26

#define I2C_SDA_PIN     21   // BMP085/BMP180
#define I2C_SCL_PIN     22

#define DHT_PIN         4    // DHT22 data
#define WIND_SPEED_PIN  27   // anemometer pulses (internal pull-up, falling edge)
#define NORTH_PIN       13   // wind-vane Hall sensors, active LOW (internal pull-ups)
#define EAST_PIN        16   //   note: 16/17 are not usable on WROVER (PSRAM) modules;
#define SOUTH_PIN       17   //   move them to free GPIOs there
#define WEST_PIN        25

#define LDR_PIN         32   // ADC1_CH4  light sensor
#define MQ9_PIN         33   // ADC1_CH5  MQ-9 gas: its AO swings to 5 V, use a divider!
#define BATT_PIN        34   // ADC1_CH6  battery divider (input-only pin)
#define RAIN_PIN        35   // ADC1_CH7  tipping bucket (input-only, no internal
                             //           pull-up: add 10k to 3.3 V for a bare reed switch)

#endif // ESP32_AWS_CONFIG_H
