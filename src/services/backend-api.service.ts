import axios from "axios";
import { logger } from "../config/logger.js";
import { ENV } from "../config/env.js";

export interface BackendMessageRequest {
  message: string;
  userAddress: string;
  ensName?: string;
  chainId: number;
  conversationId: string;
  xmtpServiceUrl?: string;
}

export interface BackendMessageResponse {
  success: boolean;
  data?: {
    response: string;
    agentId: string;
    walletAddress: string;
    threadId?: string;
  };
  error?: string;
}

export class BackendApiService {
  private apiUrl: string;
  private defaultAgentId: string;

  constructor(apiUrl?: string, defaultAgentId?: string) {
    this.apiUrl = apiUrl || ENV.A0X_AGENT_API_URL;
    this.defaultAgentId = defaultAgentId || ENV.DEFAULT_AGENT_ID;
  }

  /**
   * Send a message to the backend API for processing
   */
  async processMessage(
    message: string,
    senderAddress: string,
    conversationId: string,
    agentId?: string
  ): Promise<string> {
    try {
      const targetAgentId = agentId || this.defaultAgentId;

      logger.info("📤 Sending message to backend", {
        agentId: targetAgentId,
        senderAddress,
        conversationId,
        messagePreview: message.substring(0, 50),
      });

      const request: BackendMessageRequest = {
        message,
        userAddress: senderAddress,
        ensName: "",
        chainId: 8453, // Base mainnet
        conversationId,
        xmtpServiceUrl: ENV.XMTP_SERVICE_URL,
      };

      const response = await axios.post<BackendMessageResponse>(
        `${this.apiUrl}/api/v1/agents/${targetAgentId}/xmtp`,
        request,
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 120000, // 120 second timeout
        }
      );

      if (!response.data.success) {
        throw new Error(
          response.data.error || "Backend returned unsuccessful response"
        );
      }

      const responseText = response.data.data?.response || "Response received";

      // Clean markdown formatting that doesn't work well in XMTP
      const cleanedText = responseText.replace(/\*\*/g, "");

      logger.info("✅ Backend response received", {
        agentId: targetAgentId,
        responseLength: cleanedText.length,
      });

      return cleanedText;
    } catch (error: any) {
      logger.error("❌ Backend API error", {
        error: error.message,
        senderAddress,
        conversationId,
      });

      // Return user-friendly error message
      return "Sorry, I'm experiencing technical difficulties. Please try again in a moment.";
    }
  }

  /**
   * Health check for backend API
   */
  async healthCheck(): Promise<boolean> {
    try {
      logger.info(`🏥 Checking backend health at: ${this.apiUrl}/health`);
      const response = await axios.get(`${this.apiUrl}/health`, {
        timeout: 5000,
      });
      logger.info(`✅ Backend health check passed: ${response.status}`);
      return response.status === 200;
    } catch (error: any) {
      logger.error("❌ Backend health check failed", {
        url: `${this.apiUrl}/health`,
        error: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
      });
      return false;
    }
  }
}
