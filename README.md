# XMTP Agent SDK

Modern XMTP agent implementation using the official `@xmtp/agent-sdk` with event-driven architecture and middleware support.

## 🚀 Features

- ✅ **Official Agent SDK** - Uses `@xmtp/agent-sdk` for modern, event-driven message handling
- 🎯 **Backend Integration** - Connects to A0x backend API for agent processing
- 🖼️ **Image Analysis** - Automatic image analysis with Gemini Vision API
- 🔧 **Middleware Support** - Extensible with custom middleware
- 📊 **Comprehensive Logging** - Winston-based logging with log files
- 🔄 **Auto-reconnection** - Handled automatically by Agent SDK
- 👥 **Group Support** - Reply-based interaction in group chats
- 📡 **HTTP Reply Endpoint** - Receive intermediate responses from backend
- 🚀 **Easy Deployment** - Scripts for Google Cloud VM deployment
- 📦 **PM2 Ready** - Process management with PM2

## 📁 Project Structure

```
xmtp-agent/
├── src/
│   ├── config/
│   │   ├── env.ts           # Environment configuration
│   │   └── logger.ts        # Winston logger setup
│   ├── middleware/
│   │   ├── error-handler.middleware.ts
│   │   ├── logging.middleware.ts
│   │   └── message-filter.middleware.ts
│   ├── services/
│   │   └── backend-api.service.ts  # Backend API integration
│   └── index.ts             # Main agent entry point
├── scripts/
│   └── generate-keys.ts     # Key generation utility
├── deploy-vm.sh             # Google Cloud VM deployment
├── deploy-production.sh     # Production deployment
├── setup-pm2.sh             # PM2 setup script
├── ecosystem.config.cjs     # PM2 configuration
└── package.json
```

## 🔧 Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Generate Keys

```bash
npm run gen:keys
```

This will create a `.env` file with:
- `XMTP_WALLET_KEY` - Private key for the agent wallet
- `XMTP_DB_ENCRYPTION_KEY` - Database encryption key

### 3. Configure Environment

Edit `.env` and set your backend URL:

```env
XMTP_WALLET_KEY=0x...  # Generated
XMTP_ENV=dev
XMTP_DB_ENCRYPTION_KEY=...  # Generated

# Backend API Configuration
A0X_AGENT_API_URL=https://services-a0x-agent-api-dev-679925931457.us-west1.run.app
DEFAULT_AGENT_ID=71f6f657-6800-0892-875f-f26e8c213756

# Image Analysis (Optional - for image support)
GEMINI_API_KEY=your_gemini_api_key_here

# Optional
ENABLE_REACTIONS=false
ENABLE_LOGGING=true
```

### 4. Image Analysis Setup (Optional)

To enable automatic image analysis when users send images:

1. Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Add it to your `.env`:
   ```env
   GEMINI_API_KEY=your_key_here
   ```

**How it works:**
- Users send images via XMTP
- Agent downloads and decrypts the image
- Compresses if > 20MB using Sharp
- Analyzes with Gemini Vision API
- Sends analysis to backend as `[Image Analysis: ...]`
- Backend automatically detects and uses image context

**Without Gemini API key:**
- Images still work, but without analysis
- Message sent as: `[Image received but analysis unavailable]`
```

## 🚀 Running

### Development

```bash
npm run dev
```

### Production (Local)

```bash
npm run build
npm start
```

### With PM2

```bash
npm run setup-pm2
```

## 📦 Deployment

### Deploy to Google Cloud VM

```bash
# Development environment
npm run deploy:vm

# Production environment
npm run deploy:production
```

### Manual Deployment

1. Build the project:
```bash
npm run build
```

2. Copy to server:
```bash
scp -r dist/ package.json .env user@server:/path/to/agent
```

3. On server:
```bash
cd /path/to/agent
npm ci --production
npm start
```

## 🔑 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `XMTP_WALLET_KEY` | ✅ | Private key for agent wallet (0x...) |
| `XMTP_ENV` | ✅ | XMTP environment: `dev` or `production` |
| `XMTP_DB_ENCRYPTION_KEY` | ✅ | Database encryption key (64 hex chars) |
| `A0X_AGENT_API_URL` | ✅ | Backend API URL |
| `DEFAULT_AGENT_ID` | ✅ | Default agent ID for routing |
| `XMTP_SERVICE_URL` | ❌ | XMTP service URL (optional) |
| `ENABLE_REACTIONS` | ❌ | Enable reactions (default: false) |
| `ENABLE_LOGGING` | ❌ | Enable logging (default: true) |
| `XMTP_FORCE_DEBUG` | ❌ | Force debug mode (default: false) |

## 🏗️ Architecture

### Event-Driven Message Handling

```typescript
agent.on('text', async (ctx) => {
  const senderAddress = ctx.getSenderAddress();
  await ctx.sendText('Reply');
});
```

### Middleware Chain

1. **Logging Middleware** - Logs all messages
2. **Filter Middleware** - Filters invalid messages
3. **Error Handler** - Catches and handles errors

### Backend Integration

Messages are sent to the A0x backend API:
```
User → XMTP Agent → Backend API → Agent Processing → Response
```

## 📊 Monitoring

### PM2 Commands

```bash
pm2 status              # Check status
pm2 logs xmtp-agent-sdk # View logs
pm2 monit               # Monitor resources
pm2 restart xmtp-agent-sdk
```

### Log Files

- `logs/error.log` - Error logs
- `logs/combined.log` - All logs
- `logs/pm2-error.log` - PM2 error logs
- `logs/pm2-out.log` - PM2 output logs

## 🔄 Comparison with Legacy XMTP

### Old Implementation (`xmtp/`)
- Manual message streaming loop
- Custom reconnection logic (100+ lines)
- Manual error handling
- No middleware support
- ~873 lines of agent code

### New Implementation (`xmtp-agent/`)
- Event-driven handlers
- Auto-reconnection (SDK handles it)
- Middleware-based architecture
- Context helpers built-in
- ~300 lines of agent code

## 🤝 Contributing

1. Make changes in `src/`
2. Test locally: `npm run dev`
3. Build: `npm run build`
4. Deploy to dev: `npm run deploy:vm`

## 📝 License

MIT

## 🔗 Links

- [XMTP Agent SDK Docs](https://docs.xmtp.org/agents/build-agents)
- [A0x Backend API](https://services-a0x-agent-api-dev-679925931457.us-west1.run.app)