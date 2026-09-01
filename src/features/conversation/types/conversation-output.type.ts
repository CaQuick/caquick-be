import type {
  ConversationBodyFormat,
  ConversationSenderType,
} from '@prisma/client';

export interface InquiryBusinessHourOutput {
  dayOfWeek: number;
  isClosed: boolean;
  openTime: string | null;
  closeTime: string | null;
}

export interface InquiryFaqTopicOutput {
  id: string;
  title: string;
}

export interface StoreInquiryContextOutput {
  storeId: string;
  storeName: string;
  profileImageUrl: string | null;
  businessHours: InquiryBusinessHourOutput[];
  greetingMessage: string;
  faqTopics: InquiryFaqTopicOutput[];
  conversationId: string | null;
}

export interface ConversationMessageOutput {
  id: string;
  conversationId: string;
  senderType: ConversationSenderType;
  bodyFormat: ConversationBodyFormat;
  bodyText: string | null;
  bodyHtml: string | null;
  createdAt: Date;
}

export interface ConversationMessagesPayload {
  conversationId: string;
  messages: ConversationMessageOutput[];
}

export interface MyConversationItemOutput {
  id: string;
  storeId: string;
  storeName: string;
  storeProfileImageUrl: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: Date;
  unreadCount: number;
}

export interface MyConversationConnection {
  items: MyConversationItemOutput[];
  totalCount: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface ConversationMessageConnection {
  items: ConversationMessageOutput[];
  totalCount: number;
  hasMore: boolean;
  nextCursor: string | null;
}
