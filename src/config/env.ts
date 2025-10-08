import { config } from "dotenv";
import { logger } from "./logger.js";

// Load environment variables
config();

// Validate required environment variables
const requiredEnvVars = [
  "XMTP_WALLET_KEY",
  "XMTP_ENV",
  "XMTP_DB_ENCRYPTION_KEY",
  "A0X_AGENT_API_URL",
];

const missingEnvVars = requiredEnvVars.filter(
  (varName) => !process.env[varName]
);

if (missingEnvVars.length > 0) {
  logger.error(
    `Missing required environment variables: ${missingEnvVars.join(", ")}`
  );
  process.exit(1);
}

export const ENV = {
  // XMTP Configuration
  XMTP_WALLET_KEY: process.env.XMTP_WALLET_KEY as string,
  XMTP_ENV: process.env.XMTP_ENV as "local" | "dev" | "production",
  XMTP_DB_ENCRYPTION_KEY: process.env.XMTP_DB_ENCRYPTION_KEY as string,

  // Backend API Configuration
  A0X_AGENT_API_URL: process.env.A0X_AGENT_API_URL as string,
  DEFAULT_AGENT_ID:
    process.env.DEFAULT_AGENT_ID || "71f6f657-6800-0892-875f-f26e8c213756",

  // Google Cloud Configuration
  PROJECT_ID: process.env.PROJECT_ID || "a0x-co",
  GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,

  // Agent Configuration
  XMTP_SERVICE_URL: process.env.XMTP_SERVICE_URL || "http://localhost:3000",
  ENABLE_REACTIONS: process.env.ENABLE_REACTIONS === "true",
  REACTION_EMOJI: process.env.REACTION_EMOJI || "👀", // Default "eyes" emoji
  ENABLE_LOGGING: process.env.ENABLE_LOGGING !== "false",

  // Group Mention Filter Configuration
  // Agent mentions to look for in group messages (case-insensitive)
  AGENT_MENTIONS: process.env.AGENT_MENTIONS
    ? process.env.AGENT_MENTIONS.split(",").map((m) => m.trim())
    : ["@jessexbt", "@jessexbtai.base.eth"],

  // Specific agent ID that uses mention filtering
  MENTION_FILTER_AGENT_ID:
    process.env.MENTION_FILTER_AGENT_ID ||
    "71f6f657-6800-0892-875f-f26e8c213756",

  // Debug
  XMTP_FORCE_DEBUG: process.env.XMTP_FORCE_DEBUG === "true",
};

logger.info("Environment configuration loaded", {
  xmtpEnv: ENV.XMTP_ENV,
  backendUrl: ENV.A0X_AGENT_API_URL,
  defaultAgentId: ENV.DEFAULT_AGENT_ID,
  enableReactions: ENV.ENABLE_REACTIONS,
  reactionEmoji: ENV.REACTION_EMOJI,
  agentMentions: ENV.AGENT_MENTIONS,
  mentionFilterAgentId: ENV.MENTION_FILTER_AGENT_ID,
});
