import type { CursorConnection } from '@/common/types/cursor-connection.type';
import type {
  ConversationBodyFormat,
  ConversationSenderType,
} from '@/generated/prisma/client';

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

export type MyConversationConnection =
  CursorConnection<MyConversationItemOutput>;

export type ConversationMessageConnection =
  CursorConnection<ConversationMessageOutput>;

/** Redis JSON 직렬화를 거치므로 날짜는 ISO 문자열로 나른다(DateTime 스칼라가 문자열도 직렬화 가능). */
export interface ConversationMessageEvent {
  id: string;
  conversationId: string;
  senderType: ConversationSenderType;
  bodyFormat: ConversationBodyFormat;
  bodyText: string | null;
  bodyHtml: string | null;
  createdAt: string;
}

export interface ConversationListUpdateEvent {
  conversationId: string;
  storeId: string;
  storeName: string;
  lastMessagePreview: string | null;
  lastMessageAt: string;
  lastReadAt: string | null;
  unreadCount: number;
}

export interface SellerConversationListUpdateEvent {
  conversationId: string;
  accountId: string;
  lastMessagePreview: string | null;
  lastMessageAt: string;
}
