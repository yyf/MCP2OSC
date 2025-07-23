/**
 * Enhanced OSC Manager - Plan 1: Persistent Socket Pool
 */

class EnhancedOSCManager {
  constructor() {
    this.connections = new Map(); // connectionId -> socket
    this.socketPool = new Map();  // host:port -> socket
    this.messageQueue = [];
    this.batchSize = 10;
    this.flushInterval = 16; // ~60fps for real-time
  }

  // Create persistent connection
  async setupConnection(connectionId, host, port, options = {}) {
    const key = `${host}:${port}`;
    
    if (!this.socketPool.has(key)) {
      const socket = createSocket('udp4');
      socket.on('error', (error) => this.handleSocketError(key, error));
      this.socketPool.set(key, socket);
    }
    
    this.connections.set(connectionId, { host, port, options });
    return { success: true, connectionId };
  }

  // Send batch of OSC messages
  async sendOSCBatch(messages, connectionId = 'default') {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    const results = [];
    const socket = this.socketPool.get(`${connection.host}:${connection.port}`);
    
    for (const msg of messages) {
      try {
        const oscBuffer = this.createOSCMessage(msg.address, msg.args || []);
        await this.sendUDP(socket, oscBuffer, connection.port, connection.host);
        results.push({ success: true, address: msg.address });
      } catch (error) {
        results.push({ success: false, address: msg.address, error: error.message });
      }
    }
    
    return { success: true, results, count: messages.length };
  }

  // Real-time streaming (buffered)
  async streamOSCMessage(address, args, connectionId = 'default') {
    this.messageQueue.push({ address, args, connectionId, timestamp: Date.now() });
    
    if (this.messageQueue.length >= this.batchSize) {
      await this.flushMessageQueue();
    }
  }

  async flushMessageQueue() {
    if (this.messageQueue.length === 0) return;
    
    const batches = this.groupMessagesByConnection(this.messageQueue);
    this.messageQueue = [];
    
    const promises = Array.from(batches.entries()).map(([connectionId, messages]) =>
      this.sendOSCBatch(messages, connectionId)
    );
    
    await Promise.all(promises);
  }

  // Start real-time flush timer
  startRealTimeMode() {
    this.flushTimer = setInterval(() => {
      this.flushMessageQueue();
    }, this.flushInterval);
  }
}