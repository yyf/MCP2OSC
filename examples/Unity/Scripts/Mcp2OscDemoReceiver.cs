// MCP2OSC demo receiver for Unity + OSC Jack (Keijiro)
// https://github.com/keijiro/OscJack
//
// 1. Install OscJack via Package Manager (git URL) or .unitypackage
// 2. Add this component to an empty GameObject
// 3. Play — listens on UDP 9500

using UnityEngine;
using OscJack;

public class Mcp2OscDemoReceiver : MonoBehaviour
{
    [SerializeField] int listenPort = 9500;
    [Range(0f, 1f)] public float slider = 0.5f;
    public bool button;
    public int preset = 1;

    static readonly float[,] Presets = {
        { 0.25f, 0f },
        { 0.5f, 1f },
        { 1f, 1f }
    };

    OscServer _server;

    void OnEnable()
    {
        _server = new OscServer(listenPort);
        _server.MessageDispatcher.AddCallback("/mcp2osc/demo/slider", OnSlider);
        _server.MessageDispatcher.AddCallback("/mcp2osc/demo/button", OnButton);
        _server.MessageDispatcher.AddCallback("/mcp2osc/demo/preset", OnPreset);
        Debug.Log($"MCP2OSC demo listening on UDP {listenPort}");
    }

    void OnDisable()
    {
        _server?.Dispose();
        _server = null;
    }

    void OnSlider(string address, OscDataHandle data)
    {
        slider = data.GetElementAsFloat(0);
        Debug.Log($"[slider] {slider:F3}");
    }

    void OnButton(string address, OscDataHandle data)
    {
        button = data.GetElementAsInt(0) != 0;
        Debug.Log($"[button] {(button ? "ON" : "OFF")}");
    }

    void OnPreset(string address, OscDataHandle data)
    {
        preset = Mathf.Clamp(data.GetElementAsInt(0), 1, 3);
        slider = Presets[preset - 1, 0];
        button = Presets[preset - 1, 1] > 0.5f;
        Debug.Log($"[preset] {preset} → slider={slider} button={button}");
    }

    void OnGUI()
    {
        GUILayout.BeginArea(new Rect(12, 12, 320, 120));
        GUILayout.Label("MCP2OSC · Unity demo");
        GUILayout.Label($"slider: {slider:F3}");
        GUILayout.Label($"button: {(button ? "ON" : "OFF")}");
        GUILayout.Label($"preset: {preset}");
        GUILayout.EndArea();
    }
}
