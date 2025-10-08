import { Firestore } from "@google-cloud/firestore";
import { logger } from "../config/logger.js";

/**
 * Service to track which groups have been greeted
 * Uses Firestore to persist state across restarts
 */
export class GreetedGroupsService {
  private firestore: Firestore;
  private cache: Set<string>;

  constructor(projectId: string, keyFilename?: string) {
    this.firestore = new Firestore({
      projectId,
      ...(keyFilename && { keyFilename }),
    });
    this.cache = new Set<string>();
    logger.info("🔥 Firestore initialized for greeted groups", {
      projectId,
      usingKeyFile: !!keyFilename,
    });
  }

  /**
   * Check if a group has been greeted
   */
  async hasGreeted(conversationId: string): Promise<boolean> {
    // Check cache first
    if (this.cache.has(conversationId)) {
      return true;
    }

    // Check Firestore
    try {
      const doc = await this.firestore
        .collection("xmtp-greeted-groups")
        .doc(conversationId)
        .get();

      const exists = doc.exists;

      // Update cache if exists
      if (exists) {
        this.cache.add(conversationId);
      }

      return exists;
    } catch (error) {
      logger.error("❌ Error checking greeted group", {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Mark a group as greeted
   */
  async markAsGreeted(conversationId: string): Promise<void> {
    try {
      await this.firestore
        .collection("xmtp-greeted-groups")
        .doc(conversationId)
        .set({
          conversationId,
          greetedAt: new Date(),
        });

      // Update cache
      this.cache.add(conversationId);

      logger.info("✅ Group marked as greeted", { conversationId });
    } catch (error) {
      logger.error("❌ Error marking group as greeted", {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Clean up old greeted groups (optional maintenance)
   */
  async cleanup(olderThanDays: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const snapshot = await this.firestore
        .collection("xmtp-greeted-groups")
        .where("greetedAt", "<", cutoffDate)
        .get();

      const batch = this.firestore.batch();
      snapshot.docs.forEach((doc: any) => {
        batch.delete(doc.ref);
        this.cache.delete(doc.id);
      });

      await batch.commit();

      logger.info("🧹 Cleaned up old greeted groups", {
        count: snapshot.size,
        olderThanDays,
      });

      return snapshot.size;
    } catch (error) {
      logger.error("❌ Error cleaning up greeted groups", {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }
}
