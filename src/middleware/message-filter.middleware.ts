import { AgentMiddleware, filter as f } from '@xmtp/agent-sdk';
import { logger } from '../config/logger.js';

/**
 * Middleware to filter out messages that shouldn't be processed
 */
export const messageFilterMiddleware: AgentMiddleware = async (ctx, next) => {
  // Skip if message is undefined or doesn't have content
  if (!f.hasContent(ctx.message)) {
    logger.debug('⏭️ Skipping message without content');
    return;
  }

  // Skip messages from self
  if (f.fromSelf(ctx.message, ctx.client)) {
    logger.debug('⏭️ Skipping message from self');
    return;
  }

  // Allow text messages, attachments, and replies
  const isTextMessage = f.isText(ctx.message);
  const isAttachment = f.isRemoteAttachment(ctx.message);
  const isReply = f.isReply(ctx.message);

  if (!isTextMessage && !isAttachment && !isReply) {
    logger.debug('⏭️ Skipping non-text/non-attachment/non-reply message', {
      contentType: ctx.message.contentType
    });
    return;
  }

  // Log valid message
  if (isTextMessage) {
    logger.info('📥 Processing valid message', {
      messageId: ctx.message.id,
      senderInboxId: ctx.message.senderInboxId,
      contentPreview: ctx.message.content?.toString().substring(0, 50)
    });
  } else if (isAttachment) {
    logger.info('📥 Processing attachment message', {
      messageId: ctx.message.id,
      senderInboxId: ctx.message.senderInboxId
    });
  } else if (isReply) {
    logger.info('📥 Processing reply message', {
      messageId: ctx.message.id,
      senderInboxId: ctx.message.senderInboxId
    });
  }

  // Continue to next middleware
  await next();
};