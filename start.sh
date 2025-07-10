#!/bin/bash

# MCP2OSC Setup and Start Script

echo "🚀 MCP2OSC Setup and Start Script"
echo "================================="

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 18.0+ required. Current version: $(node -v)"
    echo "Please install Node.js 18.0+ from https://nodejs.org"
    exit 1
fi

echo "✅ Node.js version: $(node -v)"

# Install main dependencies
echo ""
echo "📦 Installing main dependencies..."
npm install

# Check if web dashboard dependencies are installed
if [ ! -d "web-dashboard/node_modules" ]; then
    echo "📦 Installing web dashboard dependencies..."
    cd web-dashboard
    npm install
    cd ..
fi

# Create logs directory if it doesn't exist
if [ ! -d "logs" ]; then
    echo "📁 Creating logs directory..."
    mkdir -p logs
fi

# Start the application
echo ""
echo "🎯 Starting MCP2OSC..."
echo "====================="
echo ""
echo "Backend will start on: http://localhost:3001"
echo "Frontend will start on: http://localhost:3002"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Start backend in background
node mcp-server.js &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 2

# Start frontend development server
cd web-dashboard
npm run dev &
FRONTEND_PID=$!

# Wait for both processes
wait $BACKEND_PID $FRONTEND_PID