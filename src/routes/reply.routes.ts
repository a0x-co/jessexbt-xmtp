import { Hono } from 'hono';
import { ReplyService } from '../services/reply.service.js';
import { logger } from '../config/logger.js';
import type { Agent } from '@xmtp/agent-sdk';

export function createReplyRoutes(replyService: ReplyService, agent?: Agent) {
  const app = new Hono();

  app.post('/reply', async (c) => {
    try {
      const body = await c.req.json();

      // Simple validation
      if ((!body.threadId && !body.conversationId) || !body.message) {
        return c.json({
          success: false,
          error: 'message and either threadId or conversationId are required',
        }, 400);
      }

      const result = await replyService.sendReply({
        threadId: body.threadId,
        conversationId: body.conversationId,
        message: body.message,
        processingId: body.processingId,
        metadata: body.metadata,
      });

      if (result.success) {
        return c.json(result);
      } else {
        return c.json(result, 500);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Error in reply endpoint: ${errorMessage}`);
      return c.json({
        success: false,
        error: 'Internal server error',
      }, 500);
    }
  });

  app.get('/reply/status', (c) => {
    try {
      const stats = replyService.getStats();

      return c.json({
        success: true,
        status: 'active',
        stats: {
          totalMappings: stats.totalMappings,
          oldestMapping: stats.oldestMapping?.toISOString(),
          newestMapping: stats.newestMapping?.toISOString(),
          agentBreakdown: stats.agentBreakdown,
        },
        endpoints: {
          reply: 'POST /api/reply',
          status: 'GET /api/reply/status',
          cleanup: 'POST /api/reply/cleanup',
          mapping: 'GET /api/reply/mapping/:threadId',
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Error getting status: ${errorMessage}`);
      return c.json({
        success: false,
        error: errorMessage,
      }, 500);
    }
  });

  app.post('/reply/cleanup', async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const maxAgeHours = body.maxAgeHours || 24;

      const cleanedCount = replyService.cleanupOldMappings(maxAgeHours);

      return c.json({
        success: true,
        cleanedCount,
        maxAgeHours,
        message: `Cleaned up ${cleanedCount} conversation mappings older than ${maxAgeHours} hours`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Error during cleanup: ${errorMessage}`);
      return c.json({
        success: false,
        error: errorMessage,
      }, 500);
    }
  });

  app.get('/reply/mapping/:threadId', (c) => {
    try {
      const threadId = c.req.param('threadId');
      const mapping = replyService.getMapping(threadId);

      if (mapping) {
        return c.json({
          success: true,
          mapping: {
            threadId: mapping.threadId,
            conversationId: mapping.conversationId,
            walletAddress: mapping.walletAddress,
            lastActivity: mapping.lastActivity.toISOString(),
            agentId: mapping.agentId,
          },
        });
      } else {
        return c.json({
          success: false,
          error: 'Mapping not found',
          threadId,
        }, 404);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Error getting mapping: ${errorMessage}`);
      return c.json({
        success: false,
        error: errorMessage,
      }, 500);
    }
  });

  /**
   * POST /api/send-message
   * Send a message to an address or inboxId directly
   */
  app.post('/send-message', async (c) => {
    try {
      if (!agent) {
        return c.json({
          success: false,
          error: 'Agent not available',
        }, 503);
      }

      const body = await c.req.json();
      const { address, inboxId, message } = body;

      // Validate required fields
      if (!message) {
        return c.json({
          success: false,
          error: 'message is required',
        }, 400);
      }

      if (!address && !inboxId) {
        return c.json({
          success: false,
          error: 'Either address or inboxId is required',
        }, 400);
      }

      logger.info('📤 Sending message', {
        address: address || 'N/A',
        inboxId: inboxId || 'N/A',
        messagePreview: message.substring(0, 50),
      });

      let dm;

      // Try to send using address first (Agent SDK method)
      if (address) {
        try {
          logger.info(`🔍 Creating/finding DM with address: ${address}`);
          dm = await agent.createDmWithAddress(address);
          logger.info('✅ DM found/created with address');
        } catch (error) {
          logger.error('❌ Failed to create DM with address', {
            error: error instanceof Error ? error.message : String(error),
          });
          return c.json({
            success: false,
            error: `Failed to create DM with address: ${error instanceof Error ? error.message : String(error)}`,
          }, 500);
        }
      }
      // Fallback to inboxId (Node SDK method via agent.client)
      else if (inboxId) {
        try {
          logger.info(`🔍 Creating/finding DM with inboxId: ${inboxId}`);
          dm = await agent.client.conversations.newDm(inboxId);
          logger.info('✅ DM found/created with inboxId');
        } catch (error) {
          logger.error('❌ Failed to create DM with inboxId', {
            error: error instanceof Error ? error.message : String(error),
          });
          return c.json({
            success: false,
            error: `Failed to create DM with inboxId: ${error instanceof Error ? error.message : String(error)}`,
          }, 500);
        }
      }

      if (!dm) {
        return c.json({
          success: false,
          error: 'Failed to create conversation',
        }, 500);
      }

      // Send the message
      try {
        await dm.send(message);
        logger.info('✅ Message sent successfully', {
          conversationId: dm.id,
          messageLength: message.length,
        });

        return c.json({
          success: true,
          conversationId: dm.id,
          message: 'Message sent successfully',
        });
      } catch (error) {
        logger.error('❌ Failed to send message', {
          error: error instanceof Error ? error.message : String(error),
        });
        return c.json({
          success: false,
          error: `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
        }, 500);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Error in send-message endpoint: ${errorMessage}`);
      return c.json({
        success: false,
        error: 'Internal server error',
      }, 500);
    }
  });

  return app;
}