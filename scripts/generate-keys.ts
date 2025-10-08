#!/usr/bin/env tsx

import { randomBytes } from 'crypto';
import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';

console.log('🔑 Generating XMTP keys...\n');

// Generate wallet private key (64 hex chars = 32 bytes)
const walletKey = '0x' + randomBytes(32).toString('hex');
console.log('✅ Wallet Key generated');

// Generate encryption key (32 bytes)
const encryptionKey = randomBytes(32).toString('hex');
console.log('✅ Encryption Key generated');

// Prepare environment variables
const envContent = `# XMTP Configuration (Official Agent SDK format)
XMTP_WALLET_KEY=${walletKey}
XMTP_ENV=dev
XMTP_DB_ENCRYPTION_KEY=${encryptionKey}

# Backend API Configuration
A0X_AGENT_API_URL=https://services-a0x-agent-api-dev-679925931457.us-west1.run.app
DEFAULT_AGENT_ID=71f6f657-6800-0892-875f-f26e8c213756

# Agent Configuration
HTTP_PORT=3000
ENABLE_REACTIONS=false
ENABLE_LOGGING=true

# Debug
XMTP_FORCE_DEBUG=false
`;

// Check if .env exists
const envPath = join(process.cwd(), '.env');
const envExists = existsSync(envPath);

if (envExists) {
  console.log('\n⚠️  .env file already exists!');
  console.log('📝 Keys have been generated but NOT written to .env');
  console.log('🔒 Please manually add these keys to your .env file:\n');
  console.log('─'.repeat(70));
  console.log(`XMTP_WALLET_KEY=${walletKey}`);
  console.log(`XMTP_DB_ENCRYPTION_KEY=${encryptionKey}`);
  console.log('─'.repeat(70));
} else {
  writeFileSync(envPath, envContent);
  console.log('\n✅ Keys written to .env file');
  console.log('🔒 Keep these keys safe and never commit them to git!');
}

console.log('\n📋 Generated Keys:');
console.log('─'.repeat(70));
console.log(`Wallet Key: ${walletKey}`);
console.log(`Encryption Key: ${encryptionKey}`);
console.log('─'.repeat(70));
console.log('\n⚠️  IMPORTANT: Store these keys securely!');
console.log('   - Never share them publicly');
console.log('   - Never commit them to version control');
console.log('   - Use environment variables or secret managers in production');