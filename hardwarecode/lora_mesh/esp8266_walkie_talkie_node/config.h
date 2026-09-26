/*
 * =================================================================================
 * FLAPMAIN LORA MESH ESP8266 WALKIE-TALKIE NODE CONFIGURATION (config.h)
 * =================================================================================
 */

#ifndef ESP8266_WALKIE_CONFIG_H
#define ESP8266_WALKIE_CONFIG_H

// Unique Node ID for this ESP8266 Walkie-Talkie communicator (e.g., 103 for Walkie Charlie)
#define WALKIE_NODE_ID 103

// Radio Frequency Settings
#define LORA_FREQUENCY 433E6

// ---- Two-Button Walkie Navigation System Pins (ESP8266 GPIO) ----
// Button 1: SELECT (Cycle Menu Options / Move Cursor / Browse Inbox Messages)
#define BTN_SELECT_PIN  8   // GPIO8: Active LOW with internal pull-up

// Button 2: CLICK (Enter / Confirm Selection / Transmit Quick SMS / Long-Press SOS)
#define BTN_CLICK_PIN   9   // GPIO9: Active LOW with internal pull-up

// Optional Audio Buzzer Pin for click tones & emergency SOS sirens (-1 if unused)
#define BUZZER_PIN      -1  // Optional Piezo Buzzer pin

#endif // ESP8266_WALKIE_CONFIG_H
