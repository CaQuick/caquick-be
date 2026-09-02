import { Injectable, NotFoundException } from '@nestjs/common';

import {
  buildTimestampIdCursor,
  parseTimestampIdCursor,
} from '@/common/utils/keyset-cursor';
import { sliceCursorPage } from '@/common/utils/pagination';
import { USER_NOTIFICATION_ERRORS } from '@/features/user/constants/user-notification-error-messages';
import {
  DEFAULT_PAGINATION_LIMIT,
  NOTIFICATION_VISIBLE_MONTHS,
} from '@/features/user/constants/user.constants';
import type { MyNotificationsInput } from '@/features/user/dto/inputs/my-notifications.input';
import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserBaseService } from '@/features/user/services/user-base.service';
import { toNotificationItem } from '@/features/user/services/user-notification-mappers.helper';
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
    return this.repo.getViewerCounts({
      accountId,
      notificationSince: this.notificationVisibleSince(),
    });
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
      since: this.notificationVisibleSince(),
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
      throw new NotFoundException(
        USER_NOTIFICATION_ERRORS.NOTIFICATION_NOT_FOUND,
      );
    }

    return true;
  }

  async markAllNotificationsRead(accountId: bigint): Promise<boolean> {
    await this.requireActiveUser(accountId);
    await this.repo.markAllNotificationsRead({ accountId, now: new Date() });
    return true;
  }

  /**
   * "최근 3개월" 노출 하한. setMonth는 대상 월에 없는 날짜를 다음 달로
   * 롤오버시키므로(예: 5/31 → 3/3) 하한이 며칠 늦어져 알림이 일찍 숨는다 —
   * 롤오버가 감지되면 대상 월의 말일로 클램프한다(릴리즈 리뷰 반영).
   */
  private notificationVisibleSince(): Date {
    const since = new Date();
    const dayOfMonth = since.getDate();
    since.setMonth(since.getMonth() - NOTIFICATION_VISIBLE_MONTHS);
    if (since.getDate() !== dayOfMonth) {
      // 롤오버 발생 — setDate(0)은 이전 달(=대상 월)의 말일로 되돌린다
      since.setDate(0);
    }
    return since;
  }

  /** 커서 파싱: "<createdAtMs>:<id>". 형식·범위 방어는 공용 유틸이 담당. */
  private parseNotificationCursor(raw: string): {
    createdAt: Date;
    id: bigint;
  } {
    const cursor = parseTimestampIdCursor(
      raw,
      USER_NOTIFICATION_ERRORS.INVALID_CURSOR,
    );
    return { createdAt: cursor.timestamp, id: cursor.id };
  }
}
