import { Injectable } from '@nestjs/common';

import { AccountUserRepository, UserBaseService } from '@/features/auth';
import type { ViewerCounts } from '@/features/mypage/types/mypage-viewer-counts-output.type';
import {
  NotificationRepository,
  notificationVisibleSince,
} from '@/features/notification';
import { WishlistRepository } from '@/features/review';

/** 상단/하단 공통 UI 카운트(미읽 알림 + 찜). 다도메인 집계라 05c에서 mypage feature로 간다. */
@Injectable()
export class UserViewerCountsService extends UserBaseService {
  constructor(
    accounts: AccountUserRepository,
    private readonly notifications: NotificationRepository,
    private readonly wishlists: WishlistRepository,
  ) {
    super(accounts);
  }

  async viewerCounts(accountId: bigint): Promise<ViewerCounts> {
    await this.requireActiveUser(accountId);
    const [unreadNotificationCount, wishlistCount] = await Promise.all([
      this.notifications.countUnreadNotifications({
        accountId,
        notificationSince: notificationVisibleSince(),
      }),
      this.wishlists.countWishlistItems(accountId),
    ]);
    return { unreadNotificationCount, wishlistCount };
  }
}
