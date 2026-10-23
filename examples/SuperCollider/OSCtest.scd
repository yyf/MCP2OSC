// OSC sender
b = NetAddr.new("127.0.0.1", 9501);
b.sendMsg("/hello", "there");

// OSC receiver
NetAddr.localAddr
n = NetAddr.new("127.0.0.1", 9500);

o = OSCdef(\myMonitor, { |msg, time, addr, recvPort|
    ("Received value: " + msg[1]).postln;
}, '/fader1', n);

OSCFunc.trace(true);
o.free;    