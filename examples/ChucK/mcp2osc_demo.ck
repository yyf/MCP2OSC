//-----------------------------------------------------------------------------
// MCP2OSC demo — ChucK
// Receives: /mcp2osc/demo/slider (f) /button (i) /preset (i 1-3)
// Listen: UDP 9500
//
//   chuck mcp2osc_demo.ck
//-----------------------------------------------------------------------------

// voice
SawOsc osc => LPF lpf => dac;
0.0 => osc.gain;
800.0 => lpf.freq;

// shared state
0.5 => float slider;
0 => int button;
1 => int preset;

// presets: soft / mid / full  →  [slider, button]
[[0.25, 0.0], [0.5, 1.0], [1.0, 1.0]] @=> float presets[][];

fun void apply()
{
    if( button )
        0.3 * slider => osc.gain;
    else
        0.0 => osc.gain;
    Std.mtof( 48.0 + slider * 24.0 ) => osc.freq;
    400.0 + slider * 4000.0 => lpf.freq;
}

fun void loadPreset( int n )
{
    if( n < 1 ) 1 => n;
    if( n > 3 ) 3 => n;
    n => preset;
    presets[n - 1][0] => slider;
    presets[n - 1][1] $ int => button;
    apply();
    <<< "preset", preset, "→ slider", slider, "button", button >>>;
}

// OSC
OscIn oin;
OscMsg msg;
9500 => oin.port;
oin.addAddress( "/mcp2osc/demo/slider" );
oin.addAddress( "/mcp2osc/demo/button" );
oin.addAddress( "/mcp2osc/demo/preset" );

<<< "MCP2OSC · ChucK demo — UDP", oin.port() >>>;
apply();

while( true )
{
    oin => now;
    while( oin.recv(msg) )
    {
        if( msg.address == "/mcp2osc/demo/slider" )
        {
            msg.getFloat(0) => slider;
            if( slider < 0.0 ) 0.0 => slider;
            if( slider > 1.0 ) 1.0 => slider;
            apply();
            <<< "slider →", slider >>>;
        }
        else if( msg.address == "/mcp2osc/demo/button" )
        {
            ( msg.getInt(0) != 0 ) => button;
            apply();
            <<< "button →", button >>>;
        }
        else if( msg.address == "/mcp2osc/demo/preset" )
        {
            loadPreset( msg.getInt(0) );
        }
    }
}
