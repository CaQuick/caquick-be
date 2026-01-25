import type { AccountType, NotificationType } from '@prisma/client';

export interface UserProfileOutput {
  nickname: string;
  birthDate: Date | null;
  phoneNumber: string | null;
  profileImageUrl: string | null;
  onboardingCompletedAt: Date | null;
}

export interface MePayload {
  accountId: string;
  email: string | null;
  name: string | null;
  accountType: AccountType;
  profile: UserProfileOutput;
}

export interface ViewerCounts {
  unreadNotificationCount: number;
  cartItemCount: number;
  wishlistCount: number;
}

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationConnection {
  items: NotificationItem[];
  totalCount: number;
  hasMore: boolean;
}

export interface SearchHistoryItem {
  id: string;
  keyword: string;
  lastUsedAt: Date;
}

export interface SearchHistoryConnection {
  items: SearchHistoryItem[];
  totalCount: number;
  hasMore: boolean;
}
