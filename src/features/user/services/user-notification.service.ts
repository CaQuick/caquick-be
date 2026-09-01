import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { sliceCursorPage } from '@/common/utils/pagination';
import { USER_NOTIFICATION_ERRORS } from '@/features/user/constants/user-notification-error-messages';
import {
  DEFAULT_PAGINATION_LIMIT,
  MAX_UNSIGNED_BIGINT,
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
    const page = sliceCursorPage(
      result.items,
      limit,
      (last) => `${last.created_at.getTime()}:${last.id.toString()}`,
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
   * "최근 3개월" 노출 하한. setMonth 롤오버(예: 5/31 → 3/1 아님, 3/3)로
   * 말일 경계가 며칠 어긋날 수 있으나 안내 문구 수준의 정밀도로 충분하다.
   */
  private notificationVisibleSince(): Date {
    const since = new Date();
    since.setMonth(since.getMonth() - NOTIFICATION_VISIBLE_MONTHS);
    return since;
  }

  /** 커서 파싱: "<createdAtMs>:<id>". 형식·안전 정수 범위를 벗어나면 거부. */
  private parseNotificationCursor(raw: string): {
    createdAt: Date;
    id: bigint;
  } {
    const match = /^(\d+):(\d+)$/.exec(raw);
    if (!match) {
      throw new BadRequestException(USER_NOTIFICATION_ERRORS.INVALID_CURSOR);
    }
    const createdAtMs = Number(match[1]);
    if (!Number.isSafeInteger(createdAtMs)) {
      throw new BadRequestException(USER_NOTIFICATION_ERRORS.INVALID_CURSOR);
    }
    const createdAt = new Date(createdAtMs);
    // 안전 정수여도 Date 지원 범위(±8.64e15ms) 밖이면 Invalid Date가 되어
    // Prisma 필터에서 내부 오류로 번진다 — 형식 오류로 선제 거부한다.
    if (Number.isNaN(createdAt.getTime())) {
      throw new BadRequestException(USER_NOTIFICATION_ERRORS.INVALID_CURSOR);
    }
    const id = BigInt(match[2]);
    // id 컬럼은 UNSIGNED BIGINT — 그 최댓값을 넘는 값도 커넥터 범위 오류로
    // 번지기 전에 형식 오류로 거부한다.
    if (id > MAX_UNSIGNED_BIGINT) {
      throw new BadRequestException(USER_NOTIFICATION_ERRORS.INVALID_CURSOR);
    }
    return { createdAt, id };
  }
}
