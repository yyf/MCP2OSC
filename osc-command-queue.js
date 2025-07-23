/**
 * OSC Command Queue System - Plan 2: Scheduling & Automation
 */

class OSCCommandQueue {
  constructor() {
    this.queue = [];
    this.scheduledCommands = new Map(); // timestamp -> commands
    this.patterns = new Map(); // patternId -> pattern definition
    this.isRunning = false;
    this.tickInterval = 10; // 10ms precision
  }

  // Add command to queue
  queueCommand(command) {
    const queueItem = {
      id: this.generateId(),
      ...command,
      queuedAt: Date.now(),
      status: 'queued'
    };
    
    this.queue.push(queueItem);
    return queueItem.id;
  }

  // Schedule command for future execution
  scheduleCommand(command, executeAt) {
    const timestamp = typeof executeAt === 'number' ? executeAt : Date.now() + executeAt;
    
    if (!this.scheduledCommands.has(timestamp)) {
      this.scheduledCommands.set(timestamp, []);
    }
    
    this.scheduledCommands.get(timestamp).push({
      id: this.generateId(),
      ...command,
      scheduledFor: timestamp
    });
  }

  // Create repeating pattern
  createPattern(patternId, commands, options = {}) {
    const pattern = {
      id: patternId,
      commands,
      interval: options.interval || 1000,
      repeat: options.repeat || 'infinite',
      currentLoop: 0,
      isActive: false,
      startTime: null
    };
    
    this.patterns.set(patternId, pattern);
    return pattern;
  }

  // Start pattern execution
  startPattern(patternId) {
    const pattern = this.patterns.get(patternId);
    if (!pattern) throw new Error(`Pattern ${patternId} not found`);
    
    pattern.isActive = true;
    pattern.startTime = Date.now();
    pattern.currentLoop = 0;
    
    this.schedulePatternCommands(pattern);
  }

  schedulePatternCommands(pattern) {
    pattern.commands.forEach((command, index) => {
      const executeAt = pattern.startTime + (index * (pattern.interval / pattern.commands.length));
      this.scheduleCommand(command, executeAt);
    });
    
    // Schedule next loop if repeating
    if (pattern.repeat === 'infinite' || pattern.currentLoop < pattern.repeat) {
      const nextLoopTime = pattern.startTime + ((pattern.currentLoop + 1) * pattern.interval);
      setTimeout(() => {
        if (pattern.isActive) {
          pattern.currentLoop++;
          pattern.startTime = nextLoopTime;
          this.schedulePatternCommands(pattern);
        }
      }, pattern.interval);
    }
  }

  // Process queue and scheduled commands
  async tick() {
    const now = Date.now();
    
    // Process immediate queue
    const readyCommands = this.queue.filter(cmd => 
      cmd.status === 'queued' && (cmd.executeAt || 0) <= now
    );
    
    for (const command of readyCommands) {
      await this.executeCommand(command);
      command.status = 'executed';
      command.executedAt = now;
    }
    
    // Clean up executed commands
    this.queue = this.queue.filter(cmd => cmd.status !== 'executed');
    
    // Process scheduled commands
    const scheduledTimes = Array.from(this.scheduledCommands.keys())
      .filter(time => time <= now);
    
    for (const time of scheduledTimes) {
      const commands = this.scheduledCommands.get(time);
      for (const command of commands) {
        await this.executeCommand(command);
      }
      this.scheduledCommands.delete(time);
    }
  }

  // Start processing loop
  start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.processLoop = setInterval(() => {
      this.tick();
    }, this.tickInterval);
  }

  // Stop processing
  stop() {
    if (this.processLoop) {
      clearInterval(this.processLoop);
      this.processLoop = null;
    }
    this.isRunning = false;
    
    // Stop all patterns
    this.patterns.forEach(pattern => {
      pattern.isActive = false;
    });
  }
}