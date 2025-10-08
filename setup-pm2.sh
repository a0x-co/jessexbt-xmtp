#!/bin/bash

# PM2 Setup Script for XMTP Agent
# This script sets up PM2 to manage the XMTP agent process

set -e

echo "🔧 Setting up PM2 for XMTP Agent..."

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "📦 PM2 not found. Installing PM2 globally..."
    npm install -g pm2
fi

# Check if project is built
if [ ! -d "dist" ]; then
    echo "📦 Building project..."
    npm run build
fi

# Create necessary directories
mkdir -p logs
mkdir -p db

# Stop existing instance if running
pm2 delete xmtp-agent-sdk 2>/dev/null || true

# Start with PM2
echo "🚀 Starting XMTP Agent with PM2..."
pm2 start ecosystem.config.cjs

# Save PM2 configuration
echo "💾 Saving PM2 configuration..."
pm2 save

# Setup PM2 startup script
echo "🔧 Setting up PM2 startup script..."
echo "Run the following command with sudo:"
pm2 startup

echo ""
echo "✅ PM2 setup completed!"
echo ""
echo "Useful PM2 commands:"
echo "  pm2 status              - Check status"
echo "  pm2 logs xmtp-agent-sdk - View logs"
echo "  pm2 restart xmtp-agent-sdk - Restart agent"
echo "  pm2 stop xmtp-agent-sdk - Stop agent"
echo "  pm2 monit               - Monitor resources"