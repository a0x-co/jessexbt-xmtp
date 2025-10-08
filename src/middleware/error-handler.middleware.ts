import { AgentErrorMiddleware } from '@xmtp/agent-sdk';
import { logger } from '../config/logger.js';

/**
 * Error handling middleware for the agent
 */
export const errorHandlerMiddleware: AgentErrorMiddleware = async (error, ctx, next) => {
  logger.error('❌ Error in agent middleware', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    messageId: ctx.message?.id,
    senderInboxId: ctx.message?.senderInboxId
  });

  // Mark error as handled (error handlers don't have sendText capability)
  // The error will be logged but not sent to the user to avoid exposing internals
  await next();
};