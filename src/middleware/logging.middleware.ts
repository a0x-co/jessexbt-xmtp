import { AgentMiddleware } from '@xmtp/agent-sdk';
import { logger } from '../config/logger.js';

/**
 * Logging middleware to track message processing
 */
export const loggingMiddleware: AgentMiddleware = async (ctx, next) => {
  const startTime = Date.now();

  logger.info('📨 Message received', {
    messageId: ctx.message.id,
    senderInboxId: ctx.message.senderInboxId,
    conversationId: ctx.conversation.id,
    contentType: ctx.message.contentType?.typeId,
    contentTypeFull: JSON.stringify(ctx.message.contentType)
  });

  try {
    await next();

    const duration = Date.now() - startTime;
    logger.info('✅ Message processed successfully', {
      messageId: ctx.message.id,
      duration: `${duration}ms`
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('❌ Message processing failed', {
      messageId: ctx.message.id,
      duration: `${duration}ms`,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};