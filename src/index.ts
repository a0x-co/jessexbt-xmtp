import { Agent, filter } from "@xmtp/agent-sdk";
import { createSigner, createUser } from "@xmtp/agent-sdk/user";
import { getTestUrl } from "@xmtp/agent-sdk/debug";
import {
  RemoteAttachmentCodec,
  AttachmentCodec,
} from "@xmtp/content-type-remote-attachment";
import { ReactionCodec } from "@xmtp/content-type-reaction";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "./config/logger.js";
import { ENV } from "./config/env.js";
import { BackendApiService } from "./services/backend-api.service.js";
import { ReplyService } from "./services/reply.service.js";
import { ImageAnalysisService } from "./services/image-analysis.service.js";
import { GreetedGroupsService } from "./services/greeted-groups.service.js";
import { DBHealthService } from "./services/db-health.service.js";
import { createReplyRoutes } from "./routes/reply.routes.js";
import { messageFilterMiddleware } from "./middleware/message-filter.middleware.js";
import { errorHandlerMiddleware } from "./middleware/error-handler.middleware.js";
import { loggingMiddleware } from "./middleware/logging.middleware.js";

// Track processed messages for deduplication
const processedMessages = new Set<string>();

// Message batching system to group text + image messages
interface PendingMessage {
  conversationId: string;
  senderAddress: string;
  messages: Array<{
    id: string;
    type: "text" | "image";
    content: string;
    timestamp: number;
  }>;
  timeout: NodeJS.Timeout;
}

const pendingMessages = new Map<string, PendingMessage>();
const MESSAGE_BATCH_DELAY = 1000; // 1 second delay to batch messages

/**
 * Adds a message to the batch queue. If it's the first message from this sender,
 * starts a timer. If more messages arrive within the delay, they get batched together.
 */
function addMessageToBatch(
  conversationId: string,
  senderAddress: string,
  messageId: string,
  messageType: "text" | "image",
  content: string,
  processFn: (
    messages: Array<{ id: string; type: "text" | "image"; content: string }>
  ) => Promise<void>
) {
  const batchKey = `${conversationId}-${senderAddress}`;

  // Clear existing timeout if present
  const existing = pendingMessages.get(batchKey);
  if (existing) {
    clearTimeout(existing.timeout);
  }

  // Add message to batch
  const messages = existing?.messages || [];
  messages.push({
    id: messageId,
    type: messageType,
    content,
    timestamp: Date.now(),
  });

  logger.info("📦 Message added to batch", {
    conversationId,
    senderAddress: senderAddress.substring(0, 10) + "...",
    messageType,
    batchSize: messages.length,
  });

  // Set new timeout to process batch
  const timeout = setTimeout(async () => {
    logger.info("⏰ Processing batched messages", {
      conversationId,
      senderAddress: senderAddress.substring(0, 10) + "...",
      totalMessages: messages.length,
    });

    // Remove from pending
    pendingMessages.delete(batchKey);

    // Process all batched messages
    await processFn(messages);
  }, MESSAGE_BATCH_DELAY);

  // Update pending messages
  pendingMessages.set(batchKey, {
    conversationId,
    senderAddress,
    messages,
    timeout,
  });
}

async function main() {
  try {
    logger.info("🚀 Starting XMTP Agent with Agent SDK...");

    // Log environment configuration
    logger.info("📋 Environment Configuration:", {
      XMTP_ENV: ENV.XMTP_ENV,
      A0X_AGENT_API_URL: ENV.A0X_AGENT_API_URL,
      DEFAULT_AGENT_ID: ENV.DEFAULT_AGENT_ID,
      XMTP_WALLET_KEY: ENV.XMTP_WALLET_KEY
        ? "0x..." + ENV.XMTP_WALLET_KEY.slice(-8)
        : "NOT SET",
      XMTP_DB_ENCRYPTION_KEY: ENV.XMTP_DB_ENCRYPTION_KEY
        ? "..." + ENV.XMTP_DB_ENCRYPTION_KEY.slice(-8)
        : "NOT SET",
    });

    // Create user and signer
    const user = createUser(ENV.XMTP_WALLET_KEY as `0x${string}`);
    const signer = createSigner(user);

    logger.info("🔑 Wallet Address:", { address: user.account.address });

    // Create agent
    logger.info("🔧 Creating agent...");
    const agent = await Agent.create(signer, {
      env: ENV.XMTP_ENV,
      dbPath: (inboxId) => `./db/${ENV.XMTP_ENV}-${inboxId.slice(0, 8)}.db3`,
      dbEncryptionKey: Buffer.from(ENV.XMTP_DB_ENCRYPTION_KEY, "hex"),
      codecs: [
        new AttachmentCodec(),
        new RemoteAttachmentCodec(),
        new ReactionCodec(),
      ],
    });

    logger.info("✅ Agent created successfully", {
      address: agent.address,
      inboxId: agent.client.inboxId,
    });

    // Initialize services
    const backendService = new BackendApiService();
    const replyService = new ReplyService(agent.client as any);
    const imageAnalysisService = new ImageAnalysisService();
    const greetedGroupsService = new GreetedGroupsService(
      ENV.PROJECT_ID,
      ENV.GOOGLE_APPLICATION_CREDENTIALS
    );

    // Initialize DB health checker
    const dbPath = `./db/${ENV.XMTP_ENV}-${agent.client.inboxId.slice(0, 8)}.db3`;
    const dbHealthService = new DBHealthService(dbPath);

    // Check backend health
    logger.info("🏥 Checking backend health...");
    const isHealthy = await backendService.healthCheck();
    if (!isHealthy) {
      logger.warn("⚠️ Backend health check failed, but continuing...");
    }

    // Setup HTTP server for reply endpoints
    const app = new Hono();
    app.route("/api", createReplyRoutes(replyService, agent));

    const httpPort = process.env.HTTP_PORT
      ? parseInt(process.env.HTTP_PORT)
      : 3000;
    const server = serve({
      fetch: app.fetch,
      port: httpPort,
    });

    logger.info(`🌐 HTTP server started on port ${httpPort}`);

    // Register middlewares
    agent.use(loggingMiddleware);
    agent.use(messageFilterMiddleware);
    agent.errors.use(errorHandlerMiddleware);

    // Handle text messages
    agent.on("text", async (ctx) => {
      try {
        // Deduplication check
        if (processedMessages.has(ctx.message.id)) {
          logger.debug("⏭️ Skipping already processed message", {
            messageId: ctx.message.id,
          });
          return;
        }

        // Mark as processed
        processedMessages.add(ctx.message.id);

        // Clean up old entries if too many
        if (processedMessages.size > 1000) {
          const entries = Array.from(processedMessages);
          processedMessages.clear();
          entries.slice(-500).forEach((id) => processedMessages.add(id));
        }

        // Get sender address using context helper
        const senderAddress = await ctx.getSenderAddress();

        // Check if this is a group and if we need to send a greeting FIRST (before reply filter)
        if (filter.isGroup(ctx.conversation)) {
          const hasGreeted = await greetedGroupsService.hasGreeted(
            ctx.conversation.id
          );

          if (!hasGreeted) {
            logger.info("🔍 Checking if greeting needed for group...");

            // Check if agent has sent any messages in this group before
            try {
              const messages = await ctx.conversation.messages({ limit: 50 });

              // Check for stale DB
              const needsReset = dbHealthService.checkMessageArray(
                ctx.conversation.id,
                messages
              );
              if (needsReset) {
                logger.error("🚨 DB reset required - message array stuck!");
                await dbHealthService.resetDatabase();
                logger.info("🔄 Please restart the agent to resync the database");
                process.exit(1); // Exit to trigger restart
              }

              const agentHasSentMessages = messages.some(
                (msg) => msg.senderInboxId === agent.client.inboxId
              );

              if (!agentHasSentMessages) {
                logger.info("👋 First time in group, sending greeting...");

                // Send greeting first
                const greetingPrompt =
                  "User just added you to a new group chat. Please introduce yourself briefly and explain that in group chats you only respond when people reply to your messages. Keep it friendly and concise.";

                try {
                  const greeting = await backendService.processMessage(
                    greetingPrompt,
                    agent.address || "unknown",
                    ctx.conversation.id
                  );

                  await ctx.sendText(greeting);
                  logger.info("✅ Greeting sent to group");
                } catch (error) {
                  logger.error("❌ Error sending greeting", { error });
                  // Send fallback greeting
                  await ctx.sendText(
                    "👋 Hello! I'm your A0x agent. In group chats, I only respond when you reply to my messages. Reply to this message to start interacting with me!"
                  );
                }
              } else {
                logger.info(
                  "ℹ️ Agent has already sent messages in this group, skipping greeting"
                );
              }
            } catch (error) {
              logger.error("❌ Error checking message history", { error });
            }

            // Mark as greeted in Firestore
            await greetedGroupsService.markAsGreeted(ctx.conversation.id);

            // Return after sending greeting - don't process this message further
            return;
          }
        }

        // Get message content first
        const messageContent = ctx.message.content as string;

        // GROUP FILTER: In groups, only respond to:
        // 1. Replies to bot messages, OR
        // 2. Messages that mention the agent (for specific agent ID)
        if (filter.isGroup(ctx.conversation)) {
          const isReplyToBot =
            filter.isReply(ctx.message) &&
            ctx.message.content.referenceInboxId === agent.client.inboxId;

          // Check if this is the specific agent that uses mention filtering
          const useMentionFilter =
            ENV.DEFAULT_AGENT_ID === ENV.MENTION_FILTER_AGENT_ID;

          let hasMention = false;
          if (useMentionFilter && !isReplyToBot) {
            // Build regex pattern from configured mentions (case-insensitive)
            const mentionPattern = ENV.AGENT_MENTIONS.map((mention) =>
              mention.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
            ) // Escape special regex chars
              .join("|");
            const mentionRegex = new RegExp(mentionPattern, "i");

            hasMention = mentionRegex.test(messageContent);

            logger.debug("🔍 Checking for agent mention", {
              conversationId: ctx.conversation.id,
              from: senderAddress,
              hasMention,
              mentions: ENV.AGENT_MENTIONS,
            });
          }

          if (!isReplyToBot && !hasMention) {
            logger.debug(
              "⏭️ Group message without reply or mention - ignoring",
              {
                conversationId: ctx.conversation.id,
                from: senderAddress,
                isReplyToBot,
                hasMention,
                useMentionFilter,
              }
            );
            return;
          }

          logger.info("✅ Group message with reply or mention - processing", {
            conversationId: ctx.conversation.id,
            from: senderAddress,
            isReplyToBot,
            hasMention,
          });
        }

        logger.info("💬 Text message received", {
          from: senderAddress,
          messagePreview: messageContent.substring(0, 50),
          conversationId: ctx.conversation.id,
          isGroup: filter.isGroup(ctx.conversation),
        });

        // Send acknowledgment reaction if enabled
        if (ENV.ENABLE_REACTIONS) {
          try {
            await ctx.sendReaction(ENV.REACTION_EMOJI, "unicode");
            logger.debug(`${ENV.REACTION_EMOJI} Acknowledgment reaction sent`);
          } catch (error) {
            logger.warn("⚠️ Failed to send reaction", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Add to batch queue (wait for possible image attachment)
        addMessageToBatch(
          ctx.conversation.id,
          senderAddress,
          ctx.message.id,
          "text",
          messageContent,
          async (messages) => {
            // Process all batched messages together
            const textMessages = messages.filter((m) => m.type === "text");
            const imageMessages = messages.filter((m) => m.type === "image");

            // Combine text and image analysis
            let finalMessage = textMessages.map((m) => m.content).join("\n\n");
            if (imageMessages.length > 0) {
              finalMessage = `${finalMessage}\n\n${imageMessages
                .map((m) => m.content)
                .join("\n\n")}`;
            }

            logger.info("📤 Processing batched messages", {
              textCount: textMessages.length,
              imageCount: imageMessages.length,
              finalMessageLength: finalMessage.length,
            });

            // Add conversation mapping
            replyService.addMapping(
              ctx.conversation.id,
              ctx.conversation.id,
              senderAddress
            );

            // Process combined message
            try {
              const response = await backendService.processMessage(
                finalMessage,
                senderAddress,
                ctx.conversation.id
              );

              await ctx.sendText(response);

              logger.info("✅ Response sent successfully", {
                to: senderAddress,
                responsePreview: response.substring(0, 50),
              });
            } catch (error) {
              logger.error("❌ Error processing batched messages", {
                error: error instanceof Error ? error.message : String(error),
                conversationId: ctx.conversation.id,
                from: senderAddress,
              });

              // Try to send error message to user
              ctx
                .sendText(
                  "Sorry, I encountered an error processing your message. Please try again."
                )
                .catch((err) => {
                  logger.error("Failed to send error message", { err });
                });
            }
          }
        );

        // Log that message was added to batch
        logger.info("📩 Message added to batch queue", {
          from: senderAddress,
          conversationId: ctx.conversation.id,
        });
      } catch (error) {
        logger.error("❌ Error in text message handler", {
          error: error instanceof Error ? error.message : String(error),
          messageId: ctx.message.id,
        });

        // Send error message to user
        await ctx.sendText(
          "Sorry, I encountered an error processing your message. Please try again."
        );
      }
    });

    // Handle reply messages (in groups, we respond to replies to the bot)
    agent.on("reply", async (ctx) => {
      try {
        // Deduplication check
        if (processedMessages.has(ctx.message.id)) {
          logger.debug("⏭️ Skipping already processed reply", {
            messageId: ctx.message.id,
          });
          return;
        }

        // Mark as processed
        processedMessages.add(ctx.message.id);

        const senderAddress = await ctx.getSenderAddress();
        const replyContent = ctx.message.content;

        logger.info("📧 Reply received", {
          from: senderAddress,
          conversationId: ctx.conversation.id,
          replyTo: replyContent.reference,
          messageSenderInboxId: ctx.message.senderInboxId,
          replyContentKeys: Object.keys(replyContent),
          replyContentReferenceInboxId: replyContent.referenceInboxId,
          fullReplyContent: JSON.stringify(replyContent),
        });

        // In groups, verify the reply is to the bot
        if (filter.isGroup(ctx.conversation)) {
          // Get the referenced message to check who sent it
          let referencedMessageSenderInboxId: string | undefined;
          try {
            const messages = await ctx.conversation.messages({ limit: 300 });

            // Check for stale DB
            const needsReset = dbHealthService.checkMessageArray(
              ctx.conversation.id,
              messages
            );
            if (needsReset) {
              logger.error("🚨 DB reset required - message array stuck!");
              await dbHealthService.resetDatabase();
              logger.info("🔄 Please restart the agent to resync the database");
              process.exit(1); // Exit to trigger restart
            }

            logger.info('🔍 Searching for referenced message', {
              lookingFor: replyContent.reference,
              totalMessages: messages.length,
              first5: messages.slice(0, 5).map(m => ({ id: m.id, sender: m.senderInboxId })),
              last5: messages.slice(-5).map(m => ({ id: m.id, sender: m.senderInboxId }))
            });

            const referencedMessage = messages.find(msg => msg.id === replyContent.reference);
            if (referencedMessage) {
              referencedMessageSenderInboxId = referencedMessage.senderInboxId;
              logger.info('✅ Found referenced message', {
                messageId: referencedMessage.id,
                senderInboxId: referencedMessageSenderInboxId
              });
            } else {
              logger.warn('⚠️ Referenced message not found in last 300 messages');

              // Log all message IDs to debug
              logger.warn('📋 All message IDs in conversation:', {
                allIds: messages.map(m => m.id).join(', ')
              });
            }
          } catch (error) {
            logger.error("❌ Error fetching referenced message", {
              error: error instanceof Error ? error.message : String(error),
            });
          }

          logger.info("🔍 Checking if reply is to bot in group", {
            replyToInboxId: referencedMessageSenderInboxId,
            botInboxId: agent.client.inboxId,
            isMatch: referencedMessageSenderInboxId === agent.client.inboxId,
          });

          if (referencedMessageSenderInboxId !== agent.client.inboxId) {
            logger.info("⏭️ Reply not to bot - ignoring", {
              conversationId: ctx.conversation.id,
              replyToInboxId: referencedMessageSenderInboxId,
              botInboxId: agent.client.inboxId,
            });
            return;
          }

          logger.info("✅ Reply to bot in group - processing", {
            conversationId: ctx.conversation.id,
            from: senderAddress,
          });
        }

        // Extract the text content from the reply
        let messageContent = replyContent.content as string;

        // Fetch the original message to provide context (same as Telegram/Farcaster)
        let replyToText: string | undefined;
        try {
          const messages = await ctx.conversation.messages({ limit: 100 });

          // Check for stale DB
          const needsReset = dbHealthService.checkMessageArray(
            ctx.conversation.id,
            messages
          );
          if (needsReset) {
            logger.error("🚨 DB reset required - message array stuck!");
            await dbHealthService.resetDatabase();
            logger.info("🔄 Please restart the agent to resync the database");
            process.exit(1); // Exit to trigger restart
          }

          const originalMessage = messages.find(
            (msg) => msg.id === replyContent.reference
          );

          if (originalMessage && originalMessage.content) {
            // Handle different content types
            const content: any = originalMessage.content;
            if (typeof content === "string") {
              replyToText = content;
            } else if (content.content) {
              // Reply content type
              replyToText = content.content as string;
            }

            if (replyToText) {
              // Format message with reply context (same format as Farcaster)
              // Use format: [Immediate parent message]: "content"
              const truncatedText =
                replyToText.length > 200
                  ? replyToText.substring(0, 200) + "..."
                  : replyToText;
              messageContent = `[Immediate parent message]: "${truncatedText}"\n\n${messageContent}`;

              logger.info("✅ Added reply context to message", {
                originalLength: replyToText.length,
                truncated: replyToText.length > 200,
              });
            }
          }
        } catch (error) {
          logger.warn("⚠️ Could not fetch original message for context", {
            error: error instanceof Error ? error.message : String(error),
          });
          // Continue without context if fetch fails
        }

        logger.info("💬 Processing reply message", {
          from: senderAddress,
          messagePreview: messageContent.substring(0, 50),
          conversationId: ctx.conversation.id,
          hasReplyContext: !!replyToText,
        });

        // Send acknowledgment reaction if enabled
        if (ENV.ENABLE_REACTIONS) {
          try {
            await ctx.sendReaction(ENV.REACTION_EMOJI, "unicode");
            logger.debug(
              `${ENV.REACTION_EMOJI} Acknowledgment reaction sent to reply`
            );
          } catch (error) {
            logger.warn("⚠️ Failed to send reaction to reply", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Add conversation mapping
        replyService.addMapping(
          ctx.conversation.id,
          ctx.conversation.id,
          senderAddress
        );

        // Process message in background
        backendService
          .processMessage(messageContent, senderAddress, ctx.conversation.id)
          .then(async (response) => {
            await ctx.sendText(response);

            logger.info("✅ Reply response sent successfully", {
              to: senderAddress,
              responsePreview: response.substring(0, 50),
            });
          })
          .catch((error) => {
            logger.error("❌ Error processing reply in background", {
              error: error instanceof Error ? error.message : String(error),
              conversationId: ctx.conversation.id,
              from: senderAddress,
            });

            ctx
              .sendText(
                "Sorry, I encountered an error processing your reply. Please try again."
              )
              .catch((err) => {
                logger.error("Failed to send error message for reply", { err });
              });
          });

        logger.info("📩 Reply queued for processing");
      } catch (error) {
        logger.error("❌ Error in reply handler", {
          error: error instanceof Error ? error.message : String(error),
          messageId: ctx.message.id,
        });
      }
    });

    // Handle attachment messages (images)
    agent.on("attachment", async (ctx) => {
      try {
        logger.info("📎 Attachment received", {
          filename: ctx.message.content.filename,
          size: ctx.message.content.contentLength,
          url: ctx.message.content.url,
        });

        // Get sender address
        const senderAddress = await ctx.getSenderAddress();

        // Send acknowledgment reaction if enabled
        if (ENV.ENABLE_REACTIONS) {
          try {
            await ctx.sendReaction(ENV.REACTION_EMOJI, "unicode");
            logger.debug(`${ENV.REACTION_EMOJI} Acknowledgment reaction sent`);
          } catch (error) {
            logger.warn("⚠️ Failed to send reaction", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Download and decrypt the attachment
        logger.info("⬇️ Downloading and decrypting attachment...");

        const attachment = await RemoteAttachmentCodec.load<{
          filename: string;
          mimeType: string;
          data: Uint8Array;
        }>(ctx.message.content, ctx.client);

        logger.info("✅ Attachment loaded", {
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          dataSize: attachment.data.length,
        });

        // Analyze the image
        logger.info("🔍 Analyzing image with Gemini...");
        const analysisResult = await imageAnalysisService.analyzeAttachment(
          attachment
        );

        // Format message for backend
        const message = imageAnalysisService.formatForBackend(
          analysisResult,
          attachment.filename
        );

        logger.info("📝 Image analyzed", {
          messageLength: message.length,
          hasAnalysis: analysisResult.success,
        });

        // Add to batch queue (might be combined with text message)
        addMessageToBatch(
          ctx.conversation.id,
          senderAddress,
          ctx.message.id,
          "image",
          message,
          async (messages) => {
            // Process all batched messages together
            const textMessages = messages.filter((m) => m.type === "text");
            const imageMessages = messages.filter((m) => m.type === "image");

            // Combine text and image analysis
            let finalMessage = textMessages.map((m) => m.content).join("\n\n");
            if (imageMessages.length > 0) {
              finalMessage = finalMessage
                ? `${finalMessage}\n\n${imageMessages
                    .map((m) => m.content)
                    .join("\n\n")}`
                : imageMessages.map((m) => m.content).join("\n\n");
            }

            logger.info("📤 Processing batched messages", {
              textCount: textMessages.length,
              imageCount: imageMessages.length,
              finalMessageLength: finalMessage.length,
            });

            // Add conversation mapping
            replyService.addMapping(
              ctx.conversation.id,
              ctx.conversation.id,
              senderAddress
            );

            // Process combined message
            try {
              const response = await backendService.processMessage(
                finalMessage,
                senderAddress,
                ctx.conversation.id
              );

              await ctx.sendText(response);

              logger.info("✅ Response sent for batched messages", {
                to: senderAddress,
                responseLength: response.length,
              });
            } catch (error) {
              logger.error("❌ Error processing batched messages", {
                error: error instanceof Error ? error.message : String(error),
                conversationId: ctx.conversation.id,
                from: senderAddress,
              });

              // Try to send error message to user
              ctx
                .sendText(
                  "Sorry, I had trouble processing that. Please try again."
                )
                .catch((err) => {
                  logger.error("Failed to send error message", { err });
                });
            }
          }
        );

        // Log that attachment was added to batch
        logger.info("📩 Attachment added to batch queue", {
          from: senderAddress,
          conversationId: ctx.conversation.id,
          filename: attachment.filename,
        });
      } catch (error) {
        logger.error("❌ Error in attachment handler", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          messageId: ctx.message.id,
          errorType: error?.constructor?.name,
        });

        // Send error message to user
        try {
          await ctx.sendText(
            "Sorry, I couldn't process that attachment. Please try again."
          );
        } catch (sendError) {
          logger.error("Failed to send error message", { sendError });
        }
      }
    });

    // Handle new conversations (both DM and group)
    agent.on("conversation", async (ctx) => {
      try {
        if (ctx.isDm()) {
          logger.info("📱 New DM conversation started", {
            conversationId: ctx.conversation.id,
          });
        } else if (ctx.isGroup()) {
          logger.info("👥 New group conversation created", {
            conversationId: ctx.conversation.id,
          });

          // Check if we've already greeted this group
          const hasGreeted = await greetedGroupsService.hasGreeted(ctx.conversation.id);
          if (hasGreeted) {
            logger.info("ℹ️ Group already greeted, skipping greeting", {
              conversationId: ctx.conversation.id,
            });
            return;
          }

          // Send greeting when added to a new group
          // Use agent's own address since we don't have sender in this event
          const agentAddress = agent.address || "unknown";

          // Ask the backend to generate a greeting
          const greetingPrompt =
            "User just added you to a new group chat. Please introduce yourself briefly and explain that in group chats you only respond when people reply to your messages. Keep it friendly and concise.";

          // Add conversation mapping
          replyService.addMapping(
            ctx.conversation.id,
            ctx.conversation.id,
            agentAddress
          );

          try {
            logger.info("🤖 Generating welcome message for new group...");
            const greeting = await backendService.processMessage(
              greetingPrompt,
              agentAddress,
              ctx.conversation.id
            );

            await ctx.conversation.send(greeting);
            logger.info("✅ Welcome message sent to new group");

            // Mark as greeted in Firestore
            await greetedGroupsService.markAsGreeted(ctx.conversation.id);
          } catch (error) {
            logger.error("❌ Error generating greeting, using fallback", {
              error,
            });
            // Fallback hardcoded message if backend fails
            await ctx.conversation.send(
              "👋 Hello! I'm your A0x agent. In group chats, I only respond when you reply to my messages. Reply to this message to start interacting with me!"
            );
            // Mark as greeted even with fallback
            await greetedGroupsService.markAsGreeted(ctx.conversation.id);
          }
        }
      } catch (error) {
        logger.error("❌ Error handling new conversation", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Handle group updates (member added/removed, metadata changes)
    agent.on("group-update", async (ctx) => {
      try {
        const update = ctx.message.content as any;

        logger.info("📋 Group update received", {
          conversationId: ctx.conversation.id,
          hasAddedInboxes: !!update.addedInboxes,
          addedCount: update.addedInboxes?.length || 0,
          hasRemovedInboxes: !!update.removedInboxes,
          hasMetadataChanges: !!update.metadataFieldChanges,
          agentInboxId: agent.client.inboxId,
        });

        // Check if bot was added to the group
        const botWasAdded = update.addedInboxes?.some(
          (inbox: any) => inbox.inboxId === agent.client.inboxId
        );

        if (botWasAdded) {
          logger.info("🎉 Bot was added to group", {
            conversationId: ctx.conversation.id,
            addedBy: update.initiatedByInboxId,
          });

          // Check if we've already greeted this group
          const hasGreeted = await greetedGroupsService.hasGreeted(ctx.conversation.id);
          if (hasGreeted) {
            logger.info("ℹ️ Group already greeted, skipping greeting", {
              conversationId: ctx.conversation.id,
            });
            return;
          }

          // Get sender address who added the bot
          const senderAddress = await ctx.getSenderAddress();

          // Ask the backend to generate a greeting
          const greetingPrompt =
            "User just added you to a new group chat. Please introduce yourself briefly and explain that in group chats you only respond when people reply to your messages. Keep it friendly and concise.";

          // Add conversation mapping
          replyService.addMapping(
            ctx.conversation.id,
            ctx.conversation.id,
            senderAddress
          );

          try {
            const greeting = await backendService.processMessage(
              greetingPrompt,
              senderAddress,
              ctx.conversation.id
            );

            await ctx.conversation.send(greeting);
            logger.info("✅ Welcome message sent to group");

            // Mark as greeted in Firestore
            await greetedGroupsService.markAsGreeted(ctx.conversation.id);
          } catch (error) {
            logger.error("❌ Error generating greeting, using fallback", {
              error,
            });
            // Fallback hardcoded message if backend fails
            await ctx.conversation.send(
              "👋 Hello! I'm your A0x agent. In group chats, I only respond when you reply to my messages. Reply to this message to start interacting with me!"
            );
            // Mark as greeted even with fallback
            await greetedGroupsService.markAsGreeted(ctx.conversation.id);
          }
        }

        // Log other group changes
        if (update.removedInboxes && update.removedInboxes.length > 0) {
          logger.info("👋 Members removed from group", {
            conversationId: ctx.conversation.id,
            count: update.removedInboxes.length,
          });
        }

        if (
          update.metadataFieldChanges &&
          update.metadataFieldChanges.length > 0
        ) {
          logger.info("📝 Group metadata updated", {
            conversationId: ctx.conversation.id,
            changes: update.metadataFieldChanges.map((c: any) => c.fieldName),
          });
        }
      } catch (error) {
        logger.error("❌ Error handling group update", {
          error: error instanceof Error ? error.message : String(error),
          messageId: ctx.message.id,
        });
      }
    });

    // Handle unknown messages
    agent.on("unknownMessage", (ctx) => {
      logger.warn("⚠️ Unknown message type received", {
        messageId: ctx.message.id,
        contentType: ctx.message.contentType,
        contentTypeString: JSON.stringify(ctx.message.contentType),
        hasContent: !!ctx.message.content,
        contentPreview: ctx.message.content
          ? JSON.stringify(ctx.message.content).substring(0, 200)
          : "null",
      });

      // Log if this might be an attachment that we're not catching
      if (ctx.message.content && typeof ctx.message.content === "object") {
        const content: any = ctx.message.content;
        if (content.url || content.filename || content.contentDigest) {
          logger.warn(
            "🖼️ This looks like an attachment but attachment event did not fire!",
            {
              url: content.url,
              filename: content.filename,
              scheme: content.scheme,
            }
          );
        }
      }
    });

    // Handle unhandled errors
    agent.on("unhandledError", (error) => {
      logger.error("❌ Unhandled agent error", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    });

    // Handle agent start
    agent.on("start", (ctx) => {
      logger.info("✅ XMTP Agent started successfully!");
      logger.info(`📍 Agent Address: ${agent.address}`);
      logger.info(`🆔 Inbox ID: ${agent.client.inboxId}`);
      logger.info(`🔗 Test URL: ${getTestUrl(ctx.client)}`);
      logger.info(`🌐 Environment: ${ENV.XMTP_ENV}`);
      logger.info(`🎯 Backend: ${ENV.A0X_AGENT_API_URL}`);
    });

    // Handle agent stop
    agent.on("stop", () => {
      logger.info("🛑 XMTP Agent stopped");
    });

    // Start the agent
    await agent.start();

    // Handle graceful shutdown
    const shutdown = async () => {
      logger.info("🛑 Received shutdown signal, stopping agent...");
      await agent.stop();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    logger.error("❌ Failed to start agent", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

// Start the agent
main().catch((error) => {
  logger.error("❌ Unhandled error in main", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
