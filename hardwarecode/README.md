# FlapMain Hardware Code Repository (.ino)

This directory contains production-ready Arduino C++ sketches for all hardware devices in the FlapMain IoT ecosystem, including Wi-Fi telemetry nodes, ESP32-CAM surveillance nodes, and the long-range **LoRa Mesh Network Architecture**.

---

## 📁 Repository Files

| Directory / File | Target Hardware | Description / Telemetry Payload |
|---|---|---|
| [`lora_mesh/lora_mesh_protocol.h`](./lora_mesh/lora_mesh_protocol.h) | Shared Header | 19-byte packed LoRa mesh struct, dedup ring buffer, radio settings |
| [`lora_mesh/nano_aws_node/`](./lora_mesh/nano_aws_node/nano_aws_node.ino) | Arduino Nano + SX1278 | Automatic Weather Station & SOS Node (Wind, DHT22, BMP085, Light, Battery) |
| [`lora_mesh/nano_repeater_node/`](./lora_mesh/nano_repeater_node/nano_repeater_node.ino) | Arduino Nano + SX1278 | Dedicated Flood-Routing Relay Node (dedup, jitter, TTL decrementing) |
| [`lora_mesh/esp_gateway_node/`](./lora_mesh/esp_gateway_node/esp_gateway_node.ino) | ESP8266/ESP32 + SX1278 | LoRa Mesh to Wi-Fi/Cloud API Gateway (Local Dashboard & Cloud POST) |
| [`esp8266_weather_station/`](./esp8266_weather_station/esp8266_weather_station.ino) | ESP8266 | Direct Wi-Fi Weather Station Firmware (Legacy direct station) |
| [`esp_cam/`](./esp_cam/esp_cam.ino) | ESP32-CAM | Live MJPEG Surveillance, Direct Cloud JPEG Ingestion, Flash LED Driver |
| [`esp8266_ultrasonic_sensor.ino`](./esp8266_ultrasonic_sensor.ino) | ESP8266 + HC-SR04 | `distance_cm`, `water_level_percent` |
| [`esp8266_water_tank.ino`](./esp8266_water_tank.ino) | ESP8266 + DS18B20 | `temperature_c`, `actuator_state` |
| [`esp8266_weight_scale.ino`](./esp8266_weight_scale.ino) | ESP8266 + HX711 | `weight_kg`, `height_cm` |
| [`esp8266_flap_switch.ino`](./esp8266_flap_switch.ino) | ESP8266 Relay | `switch_state` |

---

## 📡 FlapMain LoRa Mesh Topology

```
 +---------------------------+         +--------------------------+         +----------------------------+
 | Arduino Nano AWS Node     |  LoRa   | Arduino Nano Repeater    |  LoRa   | ESP8266 / ESP32 Gateway    |  Wi-Fi/HTTPS
 | (Sensors + SX1278 LoRa)   |-------->| (SX1278 Relay Node)      |-------->| (SX1278 + Wi-Fi Backhaul) |-------------> FlapMain Cloud API
 | Origin Node #1            |  SF10   | Flood Routing Relay      |  SF10   | Local Dashboard + NTP      |               (main.esainnovation.com)
 +---------------------------+         +--------------------------+         +----------------------------+
```

### Pin Wiring Matrix

#### 1. Arduino Nano AWS Node & Repeater Node Pinout (SX1278 SPI)
- **SX1278 LoRa Module**:
  - `NSS / CS` ➔ Arduino Nano `D10`
  - `RST` ➔ Arduino Nano `D9`
  - `DIO0` ➔ Arduino Nano `D2` (Hardware Interrupt 0)
  - `MOSI` ➔ Arduino Nano `D11`
  - `MISO` ➔ Arduino Nano `D12`
  - `SCK` ➔ Arduino Nano `D13`
  - `VCC` ➔ `3.3V` | `GND` ➔ `GND`
- **AWS Sensors (nano_aws_node.ino)**:
  - Anemometer Wind Pulse ➔ `D3` (Hardware Interrupt 1)
  - Hall Sensors (Active LOW): North `D4`, East `D5`, South `D6`, West `D7`
  - Emergency SOS Trigger Button ➔ `D8` (Active LOW)
  - DHT22 Temp/Humidity ➔ `A0` (Digital Pin Mode)
  - LDR Light Sensor ➔ `A1` (Analog)
  - Battery Voltage Divider ➔ `A2` (Analog 1:1 Divider)
  - BMP085/180 Pressure ➔ `A4` (SDA), `A5` (SCL)

#### 2. ESP8266 Gateway Node Pinout (SX1278 SPI)
- `NSS / CS` ➔ ESP8266 `D8` (GPIO 15)
- `RST` ➔ ESP8266 `D3` (GPIO 0)
- `DIO0` ➔ ESP8266 `D2` (GPIO 4)
- `MOSI` ➔ ESP8266 `D7` (GPIO 13)
- `MISO` ➔ ESP8266 `D6` (GPIO 12)
- `SCK` ➔ ESP8266 `D5` (GPIO 14)
- `VCC` ➔ `3.3V` | `GND` ➔ `GND`

---

## ⚡ Quick Start & Flash Instructions

### 1. Required Libraries (Arduino IDE)
1. Install **sandeepmistry/arduino-LoRa** via *Tools ➜ Manage Libraries* (search `LoRa`).
2. Install **DHT sensor library** and **Adafruit BMP085 Library**.
3. Install **NTPClient** (for ESP Gateway).

### 2. Flashing the LoRa Mesh Nodes
1. **Arduino Nano AWS Node**: Open `lora_mesh/nano_aws_node/nano_aws_node.ino`, select `Arduino Nano` (Processor: ATmega328P or Old Bootloader), select Port, and click **Upload**.
2. **Arduino Nano Repeater Node**: Open `lora_mesh/nano_repeater_node/nano_repeater_node.ino`, select `Arduino Nano`, select Port, and click **Upload**.
3. **ESP Gateway Node**: Copy `config.h.example` to `config.h` in `lora_mesh/esp_gateway_node/`, edit your Wi-Fi credentials and FlapMain API key, open `esp_gateway_node.ino`, select `NodeMCU 1.0 (ESP-12E Module)` or `ESP32 Dev Module`, and click **Upload**.
