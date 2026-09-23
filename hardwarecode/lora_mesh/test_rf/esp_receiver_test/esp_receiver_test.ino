/*
 * =================================================================================
 * MINIMAL LORA RF RECEIVER TEST SKETCH (ESP8266 / ESP32 + SX1278)
 * Use this to verify hardware reception from the Arduino Nano Sender.
 * =================================================================================
 */

#if defined(ESP8266)
  #include <ESP8266WiFi.h>
  #define LORA_SS   15 // D8 (GPIO15)
  #define LORA_RST  0  // D3 (GPIO0)
  #define LORA_DIO0 4  // D2 (GPIO4)
  #define LED_PIN   2  // D4 (GPIO2 Built-in LED)
#elif defined(ESP32)
  #include <WiFi.h>
  #define LORA_SS   5
  #define LORA_RST  14
  #define LORA_DIO0 2
  #define LED_PIN   2
#else
  #error "Unsupported platform! Use ESP8266 or ESP32."
#endif

#include <SPI.h>
#include <LoRa.h>

// ---- Frequency Setting (MUST match Sender: 433E6, 868E6, or 915E6) ----
#define LORA_FREQ 433E6

uint32_t rxCounter = 0;

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n==========================================");
  Serial.println("  FLAPMAIN MINIMAL LORA RECEIVER TEST (ESP)");
  Serial.println("==========================================");

  // Disable Wi-Fi radio during minimal RF test to eliminate RF interference
  WiFi.mode(WIFI_OFF);

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH); // OFF (Active LOW LED)

  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  LoRa.setSPIFrequency(4000000); // 4MHz SPI Clock

  Serial.print("[Receiver] Initializing SX1278 on ");
  Serial.print(LORA_FREQ / 1E6);
  Serial.println(" MHz...");

  if (!LoRa.begin(LORA_FREQ)) {
    Serial.println("ERROR: SX1278 initialization FAILED!");
    Serial.println("Check ESP Wiring: VCC=3.3V, GND=GND, SCK=D5, MISO=D6, MOSI=D7, CS=D8, RST=D3");
    while (true) {
      digitalWrite(LED_PIN, !digitalRead(LED_PIN));
      delay(200);
    }
  }

  // Set matching radio configuration
  LoRa.setSpreadingFactor(10);
  LoRa.setSignalBandwidth(125E3);
  LoRa.setCodingRate4(5);
  LoRa.setTxPower(14);
  LoRa.setSyncWord(0x12);
  LoRa.enableCrc();

  LoRa.receive();
  Serial.println("[Receiver READY] Listening for incoming packets...\n");
}

void loop() {
  int packetSize = LoRa.parsePacket();
  if (packetSize > 0) {
    rxCounter++;

    // Read payload string
    String incomingStr = "";
    while (LoRa.available()) {
      incomingStr += (char)LoRa.read();
    }

    int rssi = LoRa.packetRssi();
    float snr = LoRa.packetSnr();

    // Flash LED on receive
    digitalWrite(LED_PIN, LOW);
    delay(100);
    digitalWrite(LED_PIN, HIGH);

    Serial.println("\n==========================================");
    Serial.printf("📥 [RX RECEIVED #%u]\n", rxCounter);
    Serial.printf(" - Payload Data   : \"%s\"\n", incomingStr.c_str());
    Serial.printf(" - Packet Size    : %d bytes\n", packetSize);
    Serial.printf(" - Signal RSSI    : %d dBm\n", rssi);
    Serial.printf(" - Signal SNR     : %.1f dB\n", snr);
    Serial.println("==========================================");
  }

  delay(20);
}
