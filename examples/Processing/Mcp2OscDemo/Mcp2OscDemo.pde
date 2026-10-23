/**
 * MCP2OSC demo — Processing
 * Receives: /mcp2osc/demo/slider (f) /button (i) /preset (i 1-3)
 * Listen: UDP 9500  |  Reply (optional): 9501
 *
 * Requires: oscP5 (Sketch → Import Library → oscP5)
 */
import oscP5.*;
import netP5.*;

OscP5 osc;
float slider = 0.5;
int button = 0;
int preset = 1;
String status = "waiting…";

float[][] presets = {
  { 0.25, 0 },
  { 0.5, 1 },
  { 1.0, 1 }
};

void setup() {
  size(420, 280);
  osc = new OscP5(this, 9500);
  textFont(createFont("SansSerif", 14));
}

void draw() {
  background(button == 1 ? color(40, 90, 50) : color(30));
  fill(220);
  text("MCP2OSC · Processing demo", 20, 28);
  text("slider: " + nf(slider, 1, 3), 20, 60);
  text("button: " + (button == 1 ? "ON" : "OFF"), 20, 84);
  text("preset: " + preset, 20, 108);
  text(status, 20, 140);

  // slider bar
  noStroke();
  fill(80);
  rect(20, 170, 380, 18);
  fill(180, 220, 255);
  rect(20, 170, 380 * constrain(slider, 0, 1), 18);
}

void oscEvent(OscMessage m) {
  String addr = m.addrPattern();
  if (addr.equals("/mcp2osc/demo/slider")) {
    slider = m.get(0).floatValue();
    status = "slider → " + nf(slider, 1, 3);
  } else if (addr.equals("/mcp2osc/demo/button")) {
    button = m.get(0).intValue() != 0 ? 1 : 0;
    status = "button → " + button;
  } else if (addr.equals("/mcp2osc/demo/preset")) {
    preset = constrain(m.get(0).intValue(), 1, 3);
    slider = presets[preset - 1][0];
    button = int(presets[preset - 1][1]);
    status = "preset " + preset + " loaded";
  }
}
