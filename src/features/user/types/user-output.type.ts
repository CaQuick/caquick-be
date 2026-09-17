import type {
  CursorConnection,
  OffsetConnection,
} from '@/common/types/cursor-connection.type';
import type {
  AccountType,
  IdentityProvider,
  NotificationEvent,
  NotificationType,
} from '@/generated/prisma/client';

export interface UserProfileOutput {
  nickname: string;
  birthDate: Date | null;
  phoneNumber: string | null;
  profileImageUrl: string | null;
  onboardingCompletedAt: Date | null;
}

export interface LinkedIdentityOutput {
  provider: IdentityProvider;
  lastLoginAt: Date | null;
}

export interface MePayload {
  accountId: string;
  email: string | null;
  name: string | null;
  accountType: AccountType;
  profile: UserProfileOutput;
  linkedIdentities: LinkedIdentityOutput[];
}

export interface ViewerCounts {
  unreadNotificationCount: number;
  wishlistCount: number;
}

export interface NotificationItem {
  id: string;
  type: NotificationType;
  event: NotificationEvent | null;
  title: string;
  body: string;
  orderId: string | null;
  storeId: string | null;
  productId: string | null;
  reviewId: string | null;
  storeName: string | null;
  productName: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export type NotificationConnection = CursorConnection<NotificationItem>;

export interface SearchHistoryItem {
  id: string;
  keyword: string;
  lastUsedAt: Date;
}

export type SearchHistoryConnection = OffsetConnection<SearchHistoryItem>;

export interface NicknameAvailability {
  available: boolean;
  reason: string | null;
}
