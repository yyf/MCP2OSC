/**
 * MCP2OSC demo — ESP32 (Arduino) / adapt for Teensy
 * Receives: /mcp2osc/demo/slider (f) /button (i) /preset (i 1-3)
 * Listen: UDP 9500
 *
 * Library: CNMAT OSC (Sketch → Include Library → Manage Libraries → "OSC")
 * Board: ESP32 Dev Module (or Teensy — see README for Ethernet notes)
 *
 * Point Claude Desktop OSC_HOST at this device's IP (not 127.0.0.1).
 */
#include <WiFi.h>
#include <WiFiUdp.h>
#include <OSCMessage.h>

// --- config ---
const char *WIFI_SSID = "YOUR_SSID";
const char *WIFI_PASS = "YOUR_PASSWORD";
const unsigned int OSC_PORT = 9500;

const int PIN_LED = 2;       // built-in LED on many ESP32 boards
const int PIN_PWM = 25;      // PWM / servo-ish output (0–255 from slider)

WiFiUDP Udp;

float slider = 0.5f;
int button = 0;
int preset = 1;

const float PRESETS[3][2] = {
  { 0.25f, 0 },
  { 0.5f, 1 },
  { 1.0f, 1 }
};

void applyOutputs() {
  digitalWrite(PIN_LED, button ? HIGH : LOW);
  analogWrite(PIN_PWM, (int)(constrain(slider, 0.f, 1.f) * 255.f));
}

void onSlider(OSCMessage &msg) {
  if (msg.size() < 1) return;
  slider = msg.getFloat(0);
  applyOutputs();
  Serial.printf("slider → %.3f\n", slider);
}

void onButton(OSCMessage &msg) {
  if (msg.size() < 1) return;
  button = msg.getInt(0) != 0 ? 1 : 0;
  applyOutputs();
  Serial.printf("button → %d\n", button);
}

void onPreset(OSCMessage &msg) {
  if (msg.size() < 1) return;
  preset = constrain(msg.getInt(0), 1, 3);
  slider = PRESETS[preset - 1][0];
  button = (int)PRESETS[preset - 1][1];
  applyOutputs();
  Serial.printf("preset %d loaded (slider=%.2f button=%d)\n", preset, slider, button);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_PWM, OUTPUT);
  applyOutputs();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());

  Udp.begin(OSC_PORT);
  Serial.printf("OSC listen UDP %u\n", OSC_PORT);
}

void loop() {
  int packetSize = Udp.parsePacket();
  if (packetSize <= 0) return;

  OSCMessage msg;
  while (packetSize--) {
    msg.fill(Udp.read());
  }
  if (msg.hasError()) return;

  msg.dispatch("/mcp2osc/demo/slider", onSlider);
  msg.dispatch("/mcp2osc/demo/button", onButton);
  msg.dispatch("/mcp2osc/demo/preset", onPreset);
}
