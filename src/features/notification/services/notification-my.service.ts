import { Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import {
  buildTimestampIdCursor,
  parseTimestampIdCursor,
} from '@/common/utils/keyset-cursor';
import { sliceCursorPage } from '@/common/utils/pagination';
import { DEFAULT_PAGINATION_LIMIT } from '@/features/auth';
import { AccountUserRepository, UserBaseService } from '@/features/auth';
import type { MyNotificationsInput } from '@/features/notification/dto/inputs/my-notifications.input';
import { NotificationRepository } from '@/features/notification/repositories/notification.repository';
import { toNotificationItem } from '@/features/notification/services/notification-my-mappers.helper';
import { notificationVisibleSince } from '@/features/notification/services/notification-visibility.helper';
import type { NotificationConnection } from '@/features/notification/types/notification-my-output.type';

@Injectable()
export class UserNotificationService extends UserBaseService {
  constructor(
    accounts: AccountUserRepository,
    private readonly repo: NotificationRepository,
  ) {
    super(accounts);
  }

  async myNotifications(
    accountId: bigint,
    input?: MyNotificationsInput,
  ): Promise<NotificationConnection> {
    await this.requireActiveUser(accountId);

    const limit = input?.limit ?? DEFAULT_PAGINATION_LIMIT;
    const unreadOnly = Boolean(input?.unreadOnly);
    const cursor = input?.cursor
      ? this.parseNotificationCursor(input.cursor)
      : undefined;

    const result = await this.repo.listNotifications({
      accountId,
      unreadOnly,
      limit,
      since: notificationVisibleSince(),
      cursor,
    });

    // (created_at, id) desc 정렬과 결합된 커서 — 정렬이 바뀌면 무효다.
    const page = sliceCursorPage(result.items, limit, (last) =>
      buildTimestampIdCursor(last.created_at, last.id),
    );

    return {
      items: page.items.map(toNotificationItem),
      totalCount: result.totalCount,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
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
      throw new DomainException('NOTIFICATION_NOT_FOUND');
    }

    return true;
  }

  async markAllNotificationsRead(accountId: bigint): Promise<boolean> {
    await this.requireActiveUser(accountId);
    await this.repo.markAllNotificationsRead({ accountId, now: new Date() });
    return true;
  }

  private parseNotificationCursor(raw: string): {
    createdAt: Date;
    id: bigint;
  } {
    const cursor = parseTimestampIdCursor(raw);
    return { createdAt: cursor.timestamp, id: cursor.id };
  }
}
