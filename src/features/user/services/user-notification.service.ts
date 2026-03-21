import { Injectable, NotFoundException } from '@nestjs/common';

import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserBaseService } from '@/features/user/services/user-base.service';
import type { MyNotificationsInput } from '@/features/user/types/user-input.type';
import type {
  NotificationConnection,
  ViewerCounts,
} from '@/features/user/types/user-output.type';

@Injectable()
export class UserNotificationService extends UserBaseService {
  constructor(repo: UserRepository) {
    super(repo);
  }

  async viewerCounts(accountId: bigint): Promise<ViewerCounts> {
    await this.requireActiveUser(accountId);
    return this.repo.getViewerCounts(accountId);
  }

  async myNotifications(
    accountId: bigint,
    input?: MyNotificationsInput,
  ): Promise<NotificationConnection> {
    await this.requireActiveUser(accountId);

    const { offset, limit, unreadOnly } = this.normalizePaginationInput(input);
    const result = await this.repo.listNotifications({
      accountId,
      unreadOnly,
      offset,
      limit,
    });

    return {
      items: result.items.map((item) => ({
        id: item.id.toString(),
        type: item.type,
        title: item.title,
        body: item.body,
        readAt: item.read_at,
        createdAt: item.created_at,
      })),
      totalCount: result.totalCount,
      hasMore: offset + limit < result.totalCount,
    };
  }

  async markNotificationRead(
    accountId: bigint,
    notificationId: bigint,
  ): Promise<boolean> {
    await this.requireActiveUser(accountId);

    const updated = await this.repo.markNotificationRead({
      accountId,
      notificationId,
      now: new Date(),
    });

    if (!updated) {
      throw new NotFoundException('Notification not found.');
    }

    return true;
  }

  async markAllNotificationsRead(accountId: bigint): Promise<boolean> {
    await this.requireActiveUser(accountId);
    await this.repo.markAllNotificationsRead({ accountId, now: new Date() });
    return true;
  }
}
