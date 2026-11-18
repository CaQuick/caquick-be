import type { ConversationMessageOutput } from '@/features/conversation/types/conversation-output.type';

export interface SellerConversationOutput {
  id: string;
  accountId: string;
  storeId: string;
  buyerNickname: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: Date | null;
  lastReadAt: Date | null;
  sellerLastReadAt: Date | null;
  unreadCount: number;
  updatedAt: Date;
}

export interface SellerConversationMessageOutput extends ConversationMessageOutput {
  senderAccountId: string | null;
}
