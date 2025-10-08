import { Client } from '@xmtp/node-sdk';
import { logger } from '../config/logger.js';
import type {
  XMTPReplyRequest,
  XMTPReplyResponse,
  XMTPConversationMapping,
} from '../types/reply.types.js';

export class ReplyService {
  private conversationMappings = new Map<string, XMTPConversationMapping>();
  private client: Client | null = null;

  constructor(client?: Client) {
    this.client = client || null;
  }

  setClient(client: Client): void {
    this.client = client;
  }

  hasClient(): boolean {
    return this.client !== null;
  }

  async sendReply(request: XMTPReplyRequest): Promise<XMTPReplyResponse> {
    try {
      const identifier = request.conversationId || request.threadId;
      logger.info(`📤 Sending reply for ${identifier}`);

      if (!this.client) {
        logger.error('❌ XMTP client not available');
        return { success: false, error: 'XMTP client not available' };
      }

      let conversation: any = null;

      // Try conversationId first
      if (request.conversationId) {
        try {
          conversation = await this.client.conversations.getConversationById(
            request.conversationId
          );
        } catch (error) {
          logger.error(`❌ Conversation not found: ${request.conversationId}`);
        }
      }

      // Fallback to threadId mapping
      if (!conversation && request.threadId) {
        const mapping = this.conversationMappings.get(request.threadId);
        if (mapping) {
          try {
            conversation = await this.client.conversations.getConversationById(
              mapping.conversationId
            );
            if (conversation) {
              mapping.lastActivity = new Date();
            }
          } catch (error) {
            logger.error(`❌ Mapped conversation not found: ${mapping.conversationId}`);
          }
        }
      }

      if (!conversation) {
        logger.error(`❌ No conversation found for ${identifier}`);
        return { success: false, error: 'Conversation not found' };
      }

      // Send message
      await conversation.send(request.message);

      logger.info(`✅ Reply sent successfully to ${identifier}`);
      return {
        success: true,
        conversationId: conversation.id,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Error sending reply: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  addMapping(
    threadId: string,
    conversationId: string,
    walletAddress: string,
    agentId?: string
  ): void {
    this.conversationMappings.set(threadId, {
      threadId,
      conversationId,
      walletAddress,
      lastActivity: new Date(),
      agentId,
    });
    logger.debug(`📝 Added mapping: ${threadId} → ${conversationId}`);
  }

  getMapping(threadId: string): XMTPConversationMapping | undefined {
    return this.conversationMappings.get(threadId);
  }

  cleanupOldMappings(maxAgeHours: number = 24): number {
    const now = new Date();
    const maxAge = maxAgeHours * 60 * 60 * 1000;
    let cleaned = 0;

    for (const [threadId, mapping] of this.conversationMappings.entries()) {
      const age = now.getTime() - mapping.lastActivity.getTime();
      if (age > maxAge) {
        this.conversationMappings.delete(threadId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`🧹 Cleaned up ${cleaned} old mappings`);
    }

    return cleaned;
  }

  getStats() {
    const mappings = Array.from(this.conversationMappings.values());
    return {
      totalMappings: mappings.length,
      oldestMapping: mappings.length > 0
        ? mappings.reduce((oldest, m) =>
            m.lastActivity < oldest.lastActivity ? m : oldest
          ).lastActivity
        : null,
      newestMapping: mappings.length > 0
        ? mappings.reduce((newest, m) =>
            m.lastActivity > newest.lastActivity ? m : newest
          ).lastActivity
        : null,
      agentBreakdown: mappings.reduce((acc, m) => {
        const agent = m.agentId || 'unknown';
        acc[agent] = (acc[agent] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    };
  }
}