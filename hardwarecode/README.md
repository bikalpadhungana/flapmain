# FlapMain Hardware Code Repository (.ino)

This directory contains production-ready Arduino C++ sketches for all hardware devices in the FlapMain IoT ecosystem.

---

## 📁 Repository Files

| File | Hardware / Sensor | Telemetry Payload Fields |
|---|---|---|
| [`config.h.example`](./config.h.example) | Configuration Header Template | SSID, Password, Server Host, Device ID, API Key |
| [`esp8266_ultrasonic_sensor.ino`](./esp8266_ultrasonic_sensor.ino) | ESP8266 + HC-SR04 Ultrasonic Distance Sensor | `distance_cm`, `water_level_percent` |
| [`esp8266_water_tank.ino`](./esp8266_water_tank.ino) | ESP8266 + DS18B20 Temp Sensor & 5V Relay | `temperature_c`, `actuator_state` |
| [`esp8266_weight_scale.ino`](./esp8266_weight_scale.ino) | ESP8266 + HX711 Load Cell & Height Sensor | `weight_kg`, `height_cm` |
| [`esp8266_flap_switch.ino`](./esp8266_flap_switch.ino) | ESP8266 + Optocoupled Relay Switch | `switch_state` |

---

## ⚡ Quick Start & Flash Instructions

### 1. Requirements (Arduino IDE)
1. Install **Arduino IDE** (v1.8.x or v2.x).
2. Add ESP8266 Board Manager URL in **Preferences**:
   ```
   http://arduino.esp8266.com/stable/package_esp8266com_index.json
   ```
3. Install **ESP8266 Board Package** via *Tools ➜ Board ➜ Boards Manager* (search `esp8266`).
4. Install Required Libraries via *Tools ➜ Manage Libraries*:
   - `ArduinoJson` (v6.x)
   - `DallasTemperature` (for DS18B20)
   - `OneWire`

---

### 2. Provisioning Device on FlapMain Dashboard
1. Open the FlapMain Dashboard at `http://localhost:5173/`.
2. Click **Provision Device** button.
3. Select your device schema (e.g. `esp8266_ultrasonic_sensor` ➜ `ultrasonic_distance_v1`).
4. Click **Submit & Generate Code Snippet**.
5. Copy the generated `config.h` snippet!

---

### 3. Flashing Your ESP8266

1. In the same folder as your `.ino` file, create a new file named `config.h`.
2. Paste the generated snippet from your dashboard:
   ```cpp
   #define WIFI_SSID       "Your_WiFi_SSID"
   #define WIFI_PASSWORD   "Your_WiFi_Password"

   #define FLAPMAIN_SERVER "http://192.168.1.50:5050" // Your local computer IP
   #define DEVICE_ID       "flap-ultrasonic-a1b2"
   #define DEVICE_KEY      "flap_dev_b7ec01d69b63a758d660cdf8ce8857ed"
   #define TELEMETRY_INTERVAL_MS 5000
   ```
3. Connect your ESP8266 via USB.
4. Select **NodeMCU 1.0 (ESP-12E Module)** or **Wemos D1 Mini** in *Tools ➜ Board*.
5. Select the COM / Serial Port in *Tools ➜ Port*.
6. Click **Upload**!

---

## 📌 HC-SR04 Ultrasonic Sensor Pinout (esp8266_ultrasonic_sensor.ino)

```
       +------------------+
       |   HC-SR04        |
       | VCC  TRIG ECHO GND|
       +--+----+----+---+--+
          |    |    |   |
          |    |    |   +------> ESP8266 GND
          |    |    +----------> ESP8266 D6 (GPIO 12)
          |    +---------------> ESP8266 D5 (GPIO 14)
          +--------------------> ESP8266 5V (VIN / VU)
```

---

## 🔍 Ingestion Verification
Open your Arduino IDE Serial Monitor (*115200 baud*). You will see live telemetry readings posted directly to your FlapMain dashboard:
```
--- Sensor Measurement ---
  Distance: 24.5 cm
  Water Level: 75.5 %
[FlapMain HTTP] Posting to: http://192.168.1.50:5050/v1/devices/flap-ultrasonic-a1b2/readings
[FlapMain HTTP] Response Code: 201
[FlapMain HTTP] Response Body: {"message":"Telemetry reading logged successfully"...}
```
