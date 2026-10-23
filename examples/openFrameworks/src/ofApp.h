#pragma once
#include "ofMain.h"
#include "ofxOsc.h"

class ofApp : public ofBaseApp {
public:
  void setup() override;
  void update() override;
  void draw() override;

  ofxOscReceiver receiver;
  float slider = 0.5f;
  int button = 0;
  int preset = 1;
  std::string status = "waiting…";
};
