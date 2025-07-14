#!/usr/bin/env node

/**
 * Shared storage for OSC messages between MCP server and dashboard
 * Uses file-based storage for inter-process communication
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_FILE = path.join(__dirname, 'logs', 'osc-messages.json');

// Ensure logs directory exists
function ensureLogsDir() {
    const logsDir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }
}

// Load messages from file with retry logic
function loadMessages() {
    let retries = 3;
    while (retries > 0) {
        try {
            ensureLogsDir();
            if (fs.existsSync(STORAGE_FILE)) {
                const data = fs.readFileSync(STORAGE_FILE, 'utf8');
                if (data.trim()) {
                    const messages = JSON.parse(data);
                    console.log(`[SHARED STORAGE] Successfully loaded ${messages.length} messages from ${STORAGE_FILE}`);
                    return messages;
                }
            }
            console.log(`[SHARED STORAGE] File not found or empty: ${STORAGE_FILE}`);
            return [];
        } catch (error) {
            retries--;
            console.warn(`[SHARED STORAGE] Failed to load messages (${retries} retries left):`, error.message);
            if (retries === 0) {
                console.error(`[SHARED STORAGE] All retries exhausted for loading: ${STORAGE_FILE}`);
                return [];
            }
            // Wait 100ms before retry
            const start = Date.now();
            while (Date.now() - start < 100) {
                // Busy wait
            }
        }
    }
    return [];
}

// Save messages to file
function saveMessages(messages) {
    try {
        ensureLogsDir();
        
        // Atomic write: write to temp file first, then rename
        const tempFile = STORAGE_FILE + '.tmp';
        const data = JSON.stringify(messages, null, 2);
        
        fs.writeFileSync(tempFile, data);
        fs.renameSync(tempFile, STORAGE_FILE);
        
        console.log(`[SHARED STORAGE] Successfully saved ${messages.length} messages to ${STORAGE_FILE}`);
    } catch (error) {
        console.error('[SHARED STORAGE] Failed to save OSC messages:', error.message);
        console.error('[SHARED STORAGE] Storage file path:', STORAGE_FILE);
    }
}

export function addOSCMessage(address, args, source, port) {
    const message = {
        address,
        args,
        source,
        port,
        timestamp: new Date().toISOString()
    };
    
    // Load existing messages
    const messages = loadMessages();
    messages.push(message);
    
    // Keep only last 1000 messages
    if (messages.length > 1000) {
        messages.splice(0, messages.length - 1000);
    }
    
    // Save back to file
    saveMessages(messages);
    
    console.log(`[SHARED STORAGE FILE] OSC stored: ${address} from ${source}:${port} (total: ${messages.length})`);
    console.log(`[SHARED STORAGE FILE] Absolute path: ${STORAGE_FILE}`);
    
    return message;
}

export function getOSCMessages(limit = 100) {
    const messages = loadMessages();
    return messages.slice(-limit);
}

export function getOSCMessageCount() {
    const messages = loadMessages();
    return messages.length;
}

export function clearOSCMessages() {
    saveMessages([]);
}
