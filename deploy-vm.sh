#!/bin/bash

# XMTP Agent SDK Deployment Script for Google Cloud VM
# This script deploys the XMTP agent to a Google Cloud VM

set -e

echo "🚀 Starting XMTP Agent SDK deployment to Google Cloud VM..."

# Configuration
VM_NAME="${VM_NAME:-xmtp-agent-vm}"
VM_ZONE="${VM_ZONE:-us-west1-a}"
VM_MACHINE_TYPE="${VM_MACHINE_TYPE:-e2-small}"
PROJECT_DIR="/home/xmtp-agent"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}❌ gcloud CLI is not installed. Please install it first.${NC}"
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${RED}❌ .env file not found. Please create one from .env.example${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Prerequisites check passed${NC}"

# Build the project
echo "📦 Building TypeScript project..."
npm run build

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Build completed successfully${NC}"

# Create deployment package
echo "📦 Creating deployment package..."
rm -rf deploy-package
mkdir -p deploy-package
cp -r dist deploy-package/
cp package.json deploy-package/
cp package-lock.json deploy-package/
cp .env deploy-package/
cp ecosystem.config.cjs deploy-package/
cp -r scripts deploy-package/ 2>/dev/null || true

echo -e "${GREEN}✅ Deployment package created${NC}"

# Check if VM exists
echo "🔍 Checking if VM exists..."
if gcloud compute instances describe $VM_NAME --zone=$VM_ZONE &> /dev/null; then
    echo -e "${YELLOW}⚠️  VM already exists. Updating...${NC}"
    VM_EXISTS=true
else
    echo "🆕 Creating new VM..."
    VM_EXISTS=false

    # Create VM
    gcloud compute instances create $VM_NAME \
        --zone=$VM_ZONE \
        --machine-type=$VM_MACHINE_TYPE \
        --image-family=ubuntu-2204-lts \
        --image-project=ubuntu-os-cloud \
        --boot-disk-size=20GB \
        --boot-disk-type=pd-standard \
        --tags=xmtp-agent \
        --metadata=startup-script='#!/bin/bash
            # Install Node.js 20
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs

            # Install PM2
            sudo npm install -g pm2

            # Create app directory
            sudo mkdir -p /home/xmtp-agent
            sudo chown -R $USER:$USER /home/xmtp-agent

            # Create logs directory
            mkdir -p /home/xmtp-agent/logs
            mkdir -p /home/xmtp-agent/db
        '

    echo -e "${GREEN}✅ VM created successfully${NC}"
    echo "⏳ Waiting 60 seconds for VM to initialize..."
    sleep 60
fi

# Upload files to VM
echo "📤 Uploading files to VM..."
gcloud compute scp --recurse deploy-package/* $VM_NAME:$PROJECT_DIR --zone=$VM_ZONE

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to upload files to VM${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Files uploaded successfully${NC}"

# Install dependencies and start agent on VM
echo "🔧 Installing dependencies and starting agent on VM..."
gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command="
    cd $PROJECT_DIR && \
    npm ci --production && \
    pm2 delete xmtp-agent-sdk 2>/dev/null || true && \
    pm2 start ecosystem.config.cjs && \
    pm2 save && \
    pm2 startup | tail -n 1 | sudo bash || true
"

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to start agent on VM${NC}"
    exit 1
fi

# Cleanup
rm -rf deploy-package

echo -e "${GREEN}✅ Deployment completed successfully!${NC}"
echo ""
echo "📋 Useful commands:"
echo "  - Check logs: gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command='pm2 logs xmtp-agent-sdk'"
echo "  - Check status: gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command='pm2 status'"
echo "  - Restart agent: gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command='pm2 restart xmtp-agent-sdk'"
echo "  - Stop agent: gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command='pm2 stop xmtp-agent-sdk'"
echo "  - SSH to VM: gcloud compute ssh $VM_NAME --zone=$VM_ZONE"
echo ""
echo "🎉 XMTP Agent is now running on Google Cloud VM!"