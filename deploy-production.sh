#!/bin/bash

# XMTP Agent SDK Production Deployment Script
# Simplified deployment for production environment

set -e

echo "🚀 Starting XMTP Agent SDK production deployment..."

# Configuration
VM_NAME="${VM_NAME:-xmtp-agent-prod}"
VM_ZONE="${VM_ZONE:-us-west1-a}"
VM_MACHINE_TYPE="${VM_MACHINE_TYPE:-e2-medium}"
PROJECT_DIR="/home/xmtp-agent"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Pre-flight checks
echo "🔍 Running pre-flight checks..."

if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}❌ gcloud CLI not found${NC}"
    exit 1
fi

if [ ! -f .env ]; then
    echo -e "${RED}❌ .env file not found${NC}"
    exit 1
fi

# Confirm production deployment
echo -e "${YELLOW}⚠️  You are about to deploy to PRODUCTION${NC}"
read -p "Continue? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
    echo "Deployment cancelled"
    exit 0
fi

# Update XMTP_ENV to production in .env
if grep -q "XMTP_ENV=dev" .env; then
    echo "📝 Updating XMTP_ENV to production..."
    sed -i 's/XMTP_ENV=dev/XMTP_ENV=production/' .env
fi

# Build
echo "📦 Building..."
npm run build || { echo -e "${RED}❌ Build failed${NC}"; exit 1; }

# Package
echo "📦 Creating package..."
rm -rf deploy-package
mkdir -p deploy-package
cp -r dist package.json package-lock.json .env ecosystem.config.cjs deploy-package/

# Check if VM exists, create if not
if ! gcloud compute instances describe $VM_NAME --zone=$VM_ZONE &> /dev/null; then
    echo "🆕 Creating production VM..."
    gcloud compute instances create $VM_NAME \
        --zone=$VM_ZONE \
        --machine-type=$VM_MACHINE_TYPE \
        --image-family=ubuntu-2204-lts \
        --image-project=ubuntu-os-cloud \
        --boot-disk-size=30GB \
        --boot-disk-type=pd-ssd \
        --tags=xmtp-agent-prod \
        --metadata=startup-script='#!/bin/bash
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs
            sudo npm install -g pm2
            sudo mkdir -p /home/xmtp-agent
            sudo chown -R $USER:$USER /home/xmtp-agent
            mkdir -p /home/xmtp-agent/{logs,db}
        '

    echo "⏳ Waiting for VM initialization..."
    sleep 60
fi

# Deploy
echo "📤 Deploying to VM..."
gcloud compute scp --recurse deploy-package/* $VM_NAME:$PROJECT_DIR --zone=$VM_ZONE

# Start/Restart service
echo "🔧 Starting service..."
gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command="
    cd $PROJECT_DIR && \
    npm ci --production && \
    pm2 delete xmtp-agent-sdk 2>/dev/null || true && \
    pm2 start ecosystem.config.cjs && \
    pm2 save && \
    pm2 startup | tail -n 1 | sudo bash || true
"

# Cleanup
rm -rf deploy-package

echo -e "${GREEN}✅ Production deployment completed!${NC}"
echo ""
echo "📊 Monitor: gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command='pm2 monit'"
echo "📋 Logs: gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command='pm2 logs xmtp-agent-sdk --lines 100'"