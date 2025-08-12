
/**
 * Shared state between MCP server and Dashboard server
 * This ensures OSC messages are accessible to both processes
 */

import fs from 'fs';
import path from 'path';

const STATE_FILE = './logs/shared-state.json';

export class SharedState {
    constructor() {
        this.data = this.load();
        this.saveInterval = setInterval(() => this.save(), 1000);
    }

    load() {
        try {
            if (fs.existsSync(STATE_FILE)) {
                return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            }
        } catch (e) {
            console.warn('Failed to load shared state:', e.message);
        }
        
        return {
            oscMessages: [],
            lastUpdate: new Date().toISOString()
        };
    }

    save() {
        try {
            this.data.lastUpdate = new Date().toISOString();
            fs.writeFileSync(STATE_FILE, JSON.stringify(this.data, null, 2));
        } catch (e) {
            console.warn('Failed to save shared state:', e.message);
        }
    }

    addOscMessage(address, args, source, port) {
        const message = {
            address,
            args: args || [],
            source,
            port,
            timestamp: new Date().toISOString()
        };
        
        this.data.oscMessages.push(message);
        
        // Keep only last N messages (configurable)
        const maxMessages = parseInt(process.env.MAX_OSC_MESSAGES || '1000');
        if (this.data.oscMessages.length > maxMessages) {
            this.data.oscMessages = this.data.oscMessages.slice(-maxMessages);
        }
        
        console.log(`[SHARED STATE] OSC stored: ${address} from ${source}:${port}`);
    }

    getOscMessages(count = 100) {
        return this.data.oscMessages.slice(-count);
    }

    cleanup() {
        if (this.saveInterval) {
            clearInterval(this.saveInterval);
        }
        this.save();
    }
}

// Global shared state instance
export const sharedState = new SharedState();

// Cleanup on exit
process.on('SIGINT', () => sharedState.cleanup());
process.on('SIGTERM', () => sharedState.cleanup());
