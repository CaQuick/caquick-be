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

export interface SellerConversationMessageOutput {
  id: string;
  conversationId: string;
  senderType: 'USER' | 'STORE' | 'SYSTEM';
  senderAccountId: string | null;
  bodyFormat: 'TEXT' | 'HTML';
  bodyText: string | null;
  bodyHtml: string | null;
  createdAt: Date;
}
