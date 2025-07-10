#!/usr/bin/env node

/**
 * MCP2OSC Database Manager
 * Simple SQLite database for logging MCP and OSC activities
 */

import pkg from 'sqlite3';
const { Database } = pkg;
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

class MCP2OSCDatabase {
  constructor() {
    this.dbPath = join(__dirname, 'logs', 'mcp2osc.db');
    this.ensureDirectories();
    this.db = null;
  }

  ensureDirectories() {
    const logsDir = dirname(this.dbPath);
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true });
    }
  }

  async initialize() {
    return new Promise((resolve, reject) => {
      this.db = new Database(this.dbPath, (error) => {
        if (error) {
          reject(error);
        } else {
          this.createTables().then(resolve).catch(reject);
        }
      });
    });
  }

  async createTables() {
    const tables = [
      // MCP Messages table
      `CREATE TABLE IF NOT EXISTS mcp_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
        method TEXT,
        message_id TEXT,
        content TEXT NOT NULL,
        user_query TEXT,
        response_content TEXT,
        processing_time_ms INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // OSC Messages table
      `CREATE TABLE IF NOT EXISTS osc_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        direction TEXT NOT NULL CHECK(direction IN ('outbound', 'inbound')),
        address TEXT NOT NULL,
        args TEXT, -- JSON string of arguments
        host TEXT DEFAULT '127.0.0.1',
        port INTEGER DEFAULT 7500,
        mcp_message_id INTEGER,
        delivery_confirmed BOOLEAN DEFAULT FALSE,
        confirmation_time_ms INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (mcp_message_id) REFERENCES mcp_messages (id)
      )`,

      // System Events table
      `CREATE TABLE IF NOT EXISTS system_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        event_type TEXT NOT NULL,
        description TEXT,
        metadata TEXT, -- JSON string
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // OSC Patterns table
      `CREATE TABLE IF NOT EXISTS osc_patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        address TEXT UNIQUE NOT NULL,
        description TEXT,
        expected_args TEXT, -- JSON string
        usage_count INTEGER DEFAULT 0,
        last_used DATETIME,
        created_by TEXT, -- 'user' or 'generated'
        intent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    for (const sql of tables) {
      await new Promise((resolve, reject) => {
        this.db.run(sql, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }

    // Create indexes for better performance
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_mcp_timestamp ON mcp_messages (timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_mcp_direction ON mcp_messages (direction)',
      'CREATE INDEX IF NOT EXISTS idx_osc_timestamp ON osc_messages (timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_osc_address ON osc_messages (address)',
      'CREATE INDEX IF NOT EXISTS idx_system_timestamp ON system_events (timestamp)'
    ];

    for (const sql of indexes) {
      await new Promise((resolve, reject) => {
        this.db.run(sql, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  }

  // MCP Message logging
  async logMCPMessage(direction, method, messageId, content, userQuery = null, responseContent = null, processingTimeMs = null) {
    return new Promise((resolve, reject) => {
      const sql = `INSERT INTO mcp_messages (direction, method, message_id, content, user_query, response_content, processing_time_ms)
                   VALUES (?, ?, ?, ?, ?, ?, ?)`;
      
      this.db.run(sql, [direction, method, messageId, JSON.stringify(content), userQuery, responseContent, processingTimeMs], function(error) {
        if (error) reject(error);
        else resolve(this.lastID);
      });
    });
  }

  // OSC Message logging
  async logOSCMessage(direction, address, args, host = '127.0.0.1', port = 7500, mcpMessageId = null) {
    return new Promise((resolve, reject) => {
      const sql = `INSERT INTO osc_messages (direction, address, args, host, port, mcp_message_id)
                   VALUES (?, ?, ?, ?, ?, ?)`;
      
      this.db.run(sql, [direction, address, JSON.stringify(args), host, port, mcpMessageId], function(error) {
        if (error) reject(error);
        else resolve(this.lastID);
      });
    });
  }

  // Update OSC delivery confirmation
  async confirmOSCDelivery(oscMessageId, confirmationTimeMs) {
    return new Promise((resolve, reject) => {
      const sql = `UPDATE osc_messages SET delivery_confirmed = TRUE, confirmation_time_ms = ? WHERE id = ?`;
      
      this.db.run(sql, [confirmationTimeMs, oscMessageId], function(error) {
        if (error) reject(error);
        else resolve(this.changes);
      });
    });
  }

  // System event logging
  async logSystemEvent(eventType, description, metadata = null) {
    return new Promise((resolve, reject) => {
      const sql = `INSERT INTO system_events (event_type, description, metadata)
                   VALUES (?, ?, ?)`;
      
      this.db.run(sql, [eventType, description, JSON.stringify(metadata)], function(error) {
        if (error) reject(error);
        else resolve(this.lastID);
      });
    });
  }

  // OSC Pattern management
  async saveOSCPattern(address, description, expectedArgs, createdBy = 'user', intent = null) {
    return new Promise((resolve, reject) => {
      const sql = `INSERT OR REPLACE INTO osc_patterns (address, description, expected_args, created_by, intent, updated_at)
                   VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`;
      
      this.db.run(sql, [address, description, JSON.stringify(expectedArgs), createdBy, intent], function(error) {
        if (error) reject(error);
        else resolve(this.lastID);
      });
    });
  }

  async updatePatternUsage(address) {
    return new Promise((resolve, reject) => {
      const sql = `UPDATE osc_patterns SET usage_count = usage_count + 1, last_used = CURRENT_TIMESTAMP WHERE address = ?`;
      
      this.db.run(sql, [address], function(error) {
        if (error) reject(error);
        else resolve(this.changes);
      });
    });
  }

  // Query methods
  async getRecentMCPMessages(limit = 100) {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM mcp_messages ORDER BY timestamp DESC LIMIT ?`;
      
      this.db.all(sql, [limit], (error, rows) => {
        if (error) reject(error);
        else resolve(rows.map(row => ({
          ...row,
          content: JSON.parse(row.content),
          timestamp: new Date(row.timestamp)
        })));
      });
    });
  }

  async getRecentOSCMessages(limit = 100) {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM osc_messages ORDER BY timestamp DESC LIMIT ?`;
      
      this.db.all(sql, [limit], (error, rows) => {
        if (error) reject(error);
        else resolve(rows.map(row => ({
          ...row,
          args: JSON.parse(row.args || '[]'),
          timestamp: new Date(row.timestamp)
        })));
      });
    });
  }

  async getOSCPatterns() {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM osc_patterns ORDER BY usage_count DESC, last_used DESC`;
      
      this.db.all(sql, [], (error, rows) => {
        if (error) reject(error);
        else resolve(rows.map(row => ({
          ...row,
          expected_args: JSON.parse(row.expected_args || '[]'),
          last_used: row.last_used ? new Date(row.last_used) : null
        })));
      });
    });
  }

  async getSystemStats() {
    return new Promise((resolve, reject) => {
      const queries = [
        `SELECT COUNT(*) as total_mcp_messages FROM mcp_messages`,
        `SELECT COUNT(*) as total_osc_messages FROM osc_messages`,
        `SELECT COUNT(*) as confirmed_osc_messages FROM osc_messages WHERE delivery_confirmed = TRUE`,
        `SELECT COUNT(*) as total_patterns FROM osc_patterns`,
        `SELECT AVG(processing_time_ms) as avg_processing_time FROM mcp_messages WHERE processing_time_ms IS NOT NULL`
      ];

      Promise.all(queries.map(sql => 
        new Promise((resolve, reject) => {
          this.db.get(sql, [], (error, row) => {
            if (error) reject(error);
            else resolve(row);
          });
        })
      )).then(results => {
        resolve({
          totalMCPMessages: results[0].total_mcp_messages,
          totalOSCMessages: results[1].total_osc_messages,
          confirmedOSCMessages: results[2].confirmed_osc_messages,
          totalPatterns: results[3].total_patterns,
          avgProcessingTime: Math.round(results[4].avg_processing_time || 0)
        });
      }).catch(reject);
    });
  }

  async close() {
    return new Promise((resolve) => {
      if (this.db) {
        this.db.close(() => {
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

export default MCP2OSCDatabase;