/*
 * =================================================================================
 * FLAPMAIN LORA MESH WALKIE-TALKIE NODE CONFIGURATION (config.h)
 * =================================================================================
 */

#ifndef WALKIE_CONFIG_H
#define WALKIE_CONFIG_H

// Unique Node ID for this Walkie-Talkie communicator (e.g., 101 for Walkie Alpha, 102 for Walkie Bravo)
#define WALKIE_NODE_ID 101

// Radio Frequency Settings
#define LORA_FREQUENCY 433E6

// ---- Two-Button Walkie Navigation System Pins ----
// Button 1: SELECT (Cycle Menu Options / Move Cursor / Browse Inbox Messages)
#define BTN_SELECT_PIN  7   // D7: Active LOW with internal pullup

// Button 2: CLICK (Enter / Confirm Selection / Transmit Quick SMS / Long-Press SOS)
#define BTN_CLICK_PIN   8   // D8: Active LOW with internal pullup

// Optional Audio Buzzer Pin for click tones & emergency SOS sirens
#define BUZZER_PIN      6   // D6: Piezo Buzzer (Active / Passive)

#endif // WALKIE_CONFIG_H
