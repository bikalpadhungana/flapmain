# Minimal LoRa RF Hardware Verification Test Suite

This minimal test suite is designed to test two LoRa modules (Arduino Nano Sender and ESP8266/ESP32 Receiver) using simple text strings (`"FLAPMAIN PING #1"`), eliminating all sensor code, web server overhead, and complex protocol structs.

---

## 📁 Test Files

1. **[`nano_sender_test/nano_sender_test.ino`](./nano_sender_test/nano_sender_test.ino)**:
   - Microcontroller: **Arduino Nano**
   - Transmits `"FLAPMAIN PING #1"`, `"FLAPMAIN PING #2"` every 2 seconds.
   - Flashes Built-in LED **D13** on transmit.

2. **[`esp_receiver_test/esp_receiver_test.ino`](./esp_receiver_test/esp_receiver_test.ino)**:
   - Microcontroller: **ESP8266** (NodeMCU / Wemos D1) or **ESP32**
   - Listens for packets on 433MHz.
   - Flashes Built-in LED **D4 (GPIO2)** on receive.
   - Prints `🎉 [RX SUCCESS #1] Payload: "FLAPMAIN PING #1"` on Serial Monitor.

---

## ⚡ Quick Test Instructions

### Step 1: Upload Sender to Arduino Nano
1. Open [`nano_sender_test.ino`](./nano_sender_test/nano_sender_test.ino) in Arduino IDE.
2. Select **Arduino Nano** (ATmega328P), select Port, and click **Upload**.
3. Open Serial Monitor at **115200 baud**.
4. You will see:
   ```
   [TX START] Sending PING #1...
   [TX SUCCESS] Broadcasted PING #1
   ```

### Step 2: Upload Receiver to ESP8266 / ESP32
1. Open [`esp_receiver_test.ino`](./esp_receiver_test/esp_receiver_test.ino) in Arduino IDE.
2. Select **NodeMCU 1.0 (ESP-12E)** or **ESP32 Dev Module**, select Port, and click **Upload**.
3. Open Serial Monitor at **115200 baud**.
4. As soon as the Arduino Nano sends a ping, you will see:
   ```
   ----------------------------------------
   🎉 [RX SUCCESS #1] Payload: "FLAPMAIN PING #1"
       Packet Size: 17 bytes | RSSI: -65 dBm | SNR: 9.5 dB
   ----------------------------------------
   ```

---

## 🔍 Troubleshooting Checklist

| Symptom | Cause | Solution |
|---|---|---|
| `SX1278 initialization FAILED!` | Incorrect SPI pin wiring or unpowered VCC | Check `VCC=3.3V`, `GND=GND`, `SCK`, `MISO`, `MOSI`, `CS`, `RST` wiring |
| Nano Sender prints `[TX FAIL]` | Power brownout on Nano 3.3V pin | Ensure `LoRa.setTxPower(14)` is set (drawing <30mA) |
| Both boards say `READY` but Receiver shows no pings | Frequency mismatch (e.g. 433MHz vs 868MHz module) | Change `#define LORA_FREQ 868E6` on both sketches and test again |
