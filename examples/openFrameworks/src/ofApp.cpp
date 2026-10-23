#include "ofApp.h"

namespace {
const float PRESETS[3][2] = {
  { 0.25f, 0.f },
  { 0.5f, 1.f },
  { 1.0f, 1.f }
};
}

void ofApp::setup() {
  ofSetWindowTitle("MCP2OSC · openFrameworks demo");
  receiver.setup(9500);
}

void ofApp::update() {
  while (receiver.hasWaitingMessages()) {
    ofxOscMessage m;
    receiver.getNextMessage(m);
    const std::string& addr = m.getAddress();

    if (addr == "/mcp2osc/demo/slider" && m.getNumArgs() > 0) {
      slider = m.getArgAsFloat(0);
      status = "slider → " + ofToString(slider, 3);
    } else if (addr == "/mcp2osc/demo/button" && m.getNumArgs() > 0) {
      button = m.getArgAsInt(0) != 0 ? 1 : 0;
      status = "button → " + ofToString(button);
    } else if (addr == "/mcp2osc/demo/preset" && m.getNumArgs() > 0) {
      preset = ofClamp(m.getArgAsInt(0), 1, 3);
      slider = PRESETS[preset - 1][0];
      button = static_cast<int>(PRESETS[preset - 1][1]);
      status = "preset " + ofToString(preset) + " loaded";
    }
  }
}

void ofApp::draw() {
  ofBackground(button ? ofColor(40, 90, 50) : ofColor(30));
  ofSetColor(220);
  ofDrawBitmapString("MCP2OSC · openFrameworks demo", 20, 28);
  ofDrawBitmapString("slider: " + ofToString(slider, 3), 20, 60);
  ofDrawBitmapString(std::string("button: ") + (button ? "ON" : "OFF"), 20, 84);
  ofDrawBitmapString("preset: " + ofToString(preset), 20, 108);
  ofDrawBitmapString(status, 20, 140);

  ofSetColor(80);
  ofDrawRectangle(20, 170, 380, 18);
  ofSetColor(180, 220, 255);
  ofDrawRectangle(20, 170, 380 * ofClamp(slider, 0.f, 1.f), 18);
}
