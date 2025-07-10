import React, { useState, useEffect, useRef } from 'react'
import './App.css'

function App() {
  const [connectionStatus, setConnectionStatus] = useState('disconnected')
  const [stats, setStats] = useState({
    mcpMessages: 0,
    oscMessages: 0,
    errors: 0,
    uptime: 0
  })
  const [logs, setLogs] = useState([])
  const [patterns, setPatterns] = useState([])
  const [testOsc, setTestOsc] = useState({
    address: '/test/message',
    args: '[440, 0.5]'
  })
  const [testResult, setTestResult] = useState('')
  const wsRef = useRef(null)
  const reconnectIntervalRef = useRef(null)

  useEffect(() => {
    connectWebSocket()
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
      if (reconnectIntervalRef.current) {
        clearInterval(reconnectIntervalRef.current)
      }
    }
  }, [])

  const connectWebSocket = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.hostname}:3001`)
    
    ws.onopen = () => {
      setConnectionStatus('connected')
      wsRef.current = ws
      if (reconnectIntervalRef.current) {
        clearInterval(reconnectIntervalRef.current)
        reconnectIntervalRef.current = null
      }
    }
    
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      handleWebSocketMessage(message)
    }
    
    ws.onclose = () => {
      setConnectionStatus('disconnected')
      wsRef.current = null
      if (!reconnectIntervalRef.current) {
        reconnectIntervalRef.current = setInterval(connectWebSocket, 5000)
      }
    }
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
    }
  }

  const handleWebSocketMessage = (message) => {
    switch (message.type) {
      case 'initial_state':
        setStats(message.data.stats)
        setLogs(message.data.logs || [])
        setPatterns(message.data.patterns || [])
        break
      case 'log':
        setLogs(prev => [...prev.slice(-99), message.data])
        break
      case 'stats':
        setStats(message.data)
        break
    }
  }

  const sendTestOSC = async () => {
    try {
      const args = testOsc.args ? JSON.parse(testOsc.args) : []
      
      const response = await fetch('/api/test-osc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          address: testOsc.address, 
          args 
        })
      })
      
      const result = await response.json()
      
      if (result.success) {
        setTestResult(`✓ ${result.message}`)
      } else {
        setTestResult(`✗ ${result.error}`)
      }
    } catch (error) {
      setTestResult(`✗ ${error.message}`)
    }
  }

  const formatUptime = (uptime) => {
    const seconds = Math.floor(uptime / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`
    } else {
      return `${seconds}s`
    }
  }

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString()
  }

  return (
    <div className="App">
      <div className={`connection-status ${connectionStatus}`}>
        {connectionStatus === 'connected' ? '● Connected' : '○ Disconnected'}
      </div>

      <h1>MCP2OSC Dashboard</h1>
      
      <div className="card">
        <h2>System Status</h2>
        <div className="status-grid">
          <div className="status-item">
            <div className="status-value">{formatUptime(stats.uptime)}</div>
            <div>Uptime</div>
          </div>
          <div className="status-item">
            <div className="status-value">{stats.mcpMessages}</div>
            <div>MCP Messages</div>
          </div>
          <div className="status-item">
            <div className="status-value">{stats.oscMessages}</div>
            <div>OSC Messages</div>
          </div>
          <div className="status-item">
            <div className="status-value">{stats.errors}</div>
            <div>Errors</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Test OSC Messages</h2>
        <div className="test-form">
          <div className="form-group">
            <label>OSC Address:</label>
            <input
              type="text"
              value={testOsc.address}
              onChange={(e) => setTestOsc(prev => ({ ...prev, address: e.target.value }))}
              placeholder="/test/message"
            />
          </div>
          <div className="form-group">
            <label>Arguments (JSON array):</label>
            <input
              type="text"
              value={testOsc.args}
              onChange={(e) => setTestOsc(prev => ({ ...prev, args: e.target.value }))}
              placeholder='[440, 0.5, "hello"]'
            />
          </div>
          <button 
            className="btn" 
            onClick={sendTestOSC}
            disabled={connectionStatus !== 'connected'}
          >
            Send OSC Message
          </button>
          {testResult && (
            <div style={{ 
              padding: '0.5rem', 
              borderRadius: '4px',
              background: testResult.startsWith('✓') ? '#4caf50' : '#f44336',
              color: 'white'
            }}>
              {testResult}
            </div>
          )}
        </div>
      </div>

      {patterns.length > 0 && (
        <div className="card">
          <h2>OSC Patterns</h2>
          <div className="patterns-list">
            {patterns.map((pattern, index) => (
              <div key={index} className="pattern-item">
                <div>
                  <div className="pattern-address">{pattern.address}</div>
                  <div className="pattern-description">{pattern.description}</div>
                </div>
                <div style={{ fontSize: '0.8em', color: '#999' }}>
                  {pattern.args?.join(', ')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2>Live Logs</h2>
        <div className="logs-container">
          {logs.length === 0 ? (
            <div style={{ color: '#999' }}>No logs yet...</div>
          ) : (
            logs.map((log, index) => (
              <div key={index} className={`log-entry log-${log.level.toLowerCase()}`}>
                <span style={{ color: '#999' }}>{formatTimestamp(log.timestamp)}</span>{' '}
                <span style={{ fontWeight: 'bold' }}>[{log.level}]</span>{' '}
                {log.message}
                {log.data && (
                  <span style={{ color: '#666' }}> {log.data}</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default App