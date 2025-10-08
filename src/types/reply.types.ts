export interface XMTPReplyRequest {
  threadId?: string;
  conversationId?: string;
  message: string;
  processingId?: string;
  metadata?: Record<string, any>;
}

export interface XMTPReplyResponse {
  success: boolean;
  error?: string;
  conversationId?: string;
}

export interface XMTPConversationMapping {
  threadId: string;
  conversationId: string;
  walletAddress: string;
  lastActivity: Date;
  agentId?: string;
}