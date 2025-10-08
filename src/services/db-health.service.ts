import { logger } from "../config/logger.js";
import * as fs from "fs";
import * as path from "path";

/**
 * Service to detect stale message arrays and trigger DB reset
 * If the same array is returned 3 times in a row, the DB is likely stuck
 */
export class DBHealthService {
  private conversationHashes: Map<
    string,
    {
      hash: string;
      repeatCount: number;
      lastMessageIds: string[];
    }
  >;
  private readonly REPEAT_THRESHOLD = 3; // Reset after 3 identical arrays
  private dbPath: string;
  private shouldRestart: boolean = false;

  constructor(dbPath: string) {
    this.conversationHashes = new Map();
    this.dbPath = dbPath;
    logger.info("🏥 DB Health service initialized", {
      repeatThreshold: this.REPEAT_THRESHOLD,
      dbPath,
    });
  }

  /**
   * Check if message array has changed. Returns true if DB needs reset.
   */
  checkMessageArray(conversationId: string, messages: any[]): boolean {
    // Create a hash from message IDs
    const messageIds = messages.map((m) => m.id).sort();
    const hash = messageIds.join("|");

    const cached = this.conversationHashes.get(conversationId);

    if (!cached) {
      // First time seeing this conversation
      this.conversationHashes.set(conversationId, {
        hash,
        repeatCount: 1,
        lastMessageIds: messageIds,
      });
      return false;
    }

    // Check if array is identical to last time
    if (cached.hash === hash) {
      cached.repeatCount++;

      logger.warn("⚠️ Identical message array detected", {
        conversationId: conversationId.substring(0, 10) + "...",
        repeatCount: cached.repeatCount,
        messageCount: messageIds.length,
        threshold: this.REPEAT_THRESHOLD,
      });

      // Check if we've hit the threshold
      if (cached.repeatCount >= this.REPEAT_THRESHOLD) {
        logger.error("🚨 DB appears stuck! Array repeated 3+ times", {
          conversationId: conversationId.substring(0, 10) + "...",
          repeatCount: cached.repeatCount,
          messageIds: messageIds.slice(0, 5),
        });

        return true; // Needs reset
      }
    } else {
      // Array changed - reset counter
      logger.debug("✅ Message array updated normally", {
        conversationId: conversationId.substring(0, 10) + "...",
        previousCount: cached.lastMessageIds.length,
        newCount: messageIds.length,
      });

      cached.hash = hash;
      cached.repeatCount = 1;
      cached.lastMessageIds = messageIds;
    }

    return false;
  }

  /**
   * Reset the database by deleting the file
   */
  async resetDatabase(): Promise<boolean> {
    try {
      logger.warn("🔄 Attempting to reset XMTP database...", {
        dbPath: this.dbPath,
      });

      // Check if file exists
      if (fs.existsSync(this.dbPath)) {
        // Delete the database file
        fs.unlinkSync(this.dbPath);
        logger.info("✅ Database file deleted", { dbPath: this.dbPath });

        // Mark for restart
        this.shouldRestart = true;

        return true;
      } else {
        logger.warn("⚠️ Database file not found", { dbPath: this.dbPath });
        return false;
      }
    } catch (error) {
      logger.error("❌ Failed to reset database", {
        error: error instanceof Error ? error.message : String(error),
        dbPath: this.dbPath,
      });
      return false;
    }
  }

  /**
   * Check if agent should restart
   */
  needsRestart(): boolean {
    return this.shouldRestart;
  }

  /**
   * Clear tracking for a conversation
   */
  clearConversation(conversationId: string): void {
    this.conversationHashes.delete(conversationId);
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      trackedConversations: this.conversationHashes.size,
      conversations: Array.from(this.conversationHashes.entries()).map(
        ([id, data]) => ({
          id: id.substring(0, 10) + "...",
          repeatCount: data.repeatCount,
          messageCount: data.lastMessageIds.length,
          isStuck: data.repeatCount >= this.REPEAT_THRESHOLD,
        })
      ),
    };
  }
}
