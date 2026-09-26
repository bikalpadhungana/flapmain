/*
 * =================================================================================
 * FLAPMAIN LORA MESH ESP8266 WALKIE-TALKIE NODE CONFIGURATION (config.h)
 * =================================================================================
 */

#ifndef ESP8266_WALKIE_CONFIG_H
#define ESP8266_WALKIE_CONFIG_H

// Unique Node ID for this ESP8266 Walkie-Talkie communicator (e.g., 103 for ESP Walkie Charlie)
#define WALKIE_NODE_ID 103

// Radio Frequency Settings
#define LORA_FREQUENCY 433E6

// ---- Two-Button Walkie Navigation System Pins ----
// Button 1: SELECT (Cycle Menu Options / Move Cursor / Browse Inbox Messages)
#define BTN_SELECT_PIN  8   // GPIO8: Active LOW with internal pullup (NodeMCU SD1 pin)

// Button 2: CLICK (Enter / Confirm Selection / Transmit Quick SMS / Long-Press SOS)
#define BTN_CLICK_PIN   9   // GPIO9: Active LOW with internal pullup (NodeMCU SD2 pin)

// Optional Audio Buzzer Pin for click tones & emergency SOS sirens
// Note: Set to 0 if not connected, or assign to an available pin (e.g., 14 for D5)
#define BUZZER_PIN      0   // 0 = Disabled

/*
 * NOTE ON ESP8266 GPIO8 & GPIO9:
 * On ESP-12 / NodeMCU modules, GPIO8 and GPIO9 map to the SD1 and SD2 pins.
 * In the Arduino IDE, set Tools -> Flash Mode to 'DIO' (Dual I/O) so the flash
 * controller does not reserve GPIO9/GPIO8 for Quad-SPI data lines.
 */

#endif // ESP8266_WALKIE_CONFIG_H
