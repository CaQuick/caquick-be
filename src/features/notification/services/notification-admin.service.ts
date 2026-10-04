import { Inject, Injectable } from '@nestjs/common';

import { ClockService } from '@/common/providers/clock.service';
import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { formatAccountLabel } from '@/common/utils/account-label';
import { activeOrNull } from '@/common/utils/active-or-null';
import { parseId } from '@/common/utils/id-parser';
import { parseIdCursor } from '@/common/utils/keyset-cursor';
import {
  normalizeCursorInput,
  sliceIdCursorPage,
  toCursorConnection,
} from '@/common/utils/pagination';
import { cleanRequiredText } from '@/common/utils/text-cleaner';
import { deterministicUuid } from '@/common/utils/uuid';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { AccountAdminRepository, AdminBaseService } from '@/features/auth';
import {
  MAX_NOTIFICATION_BODY_LENGTH,
  MAX_NOTIFICATION_TITLE_LENGTH,
} from '@/features/notification/constants/notification-admin.constants';
import type { AdminNotificationBroadcastListInput } from '@/features/notification/dto/inputs/admin-notification-broadcast-list.input';
import type { AdminSendNotificationInput } from '@/features/notification/dto/inputs/admin-send-notification.input';
import {
  audienceCount,
  type BroadcastAudience,
  NOTIFICATION_BROADCAST_NAMESPACE,
  type NotificationBroadcastRequestedPayload,
  notificationBroadcastRequestedEvent,
  parseNotificationBroadcastRequestedPayload,
} from '@/features/notification/events/notification-broadcast-requested.event';
import { NotificationAdminRepository } from '@/features/notification/repositories/notification-admin.repository';
import {
  needsLiveDeliveredCount,
  toAdminNotificationBroadcastOutput,
} from '@/features/notification/services/notification-admin-mappers.helper';
import type {
  AdminNotificationBroadcastOutput,
  AdminSendNotificationResultOutput,
} from '@/features/notification/types/notification-admin-output.type';
import { AuditActionType, AuditTargetType } from '@/generated/prisma/client';

/**
 * 대상은 요청 시점에 확정하고 이벤트 1건만 적재한다 — 저장(fan-out)은 outbox 소비자가 청크 단위로 한다.
 * 같은 관리자·같은 idempotencyKey는 이벤트를 다시 적재하지 않고 처음 응답을 재생한다(중복 발송 없음).
 */
@Injectable()
export class AdminNotificationService extends AdminBaseService {
  constructor(
    accounts: AccountAdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly repo: NotificationAdminRepository,
    private readonly clock: ClockService,
  ) {
    super(accounts, auditLogs);
  }

  async adminSendNotification(
    accountId: bigint,
    input: AdminSendNotificationInput,
  ): Promise<AdminSendNotificationResultOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const actorLabel = await this.actorLabel(ctx.accountId);
    const { audience, skippedAccountIds } = await this.resolveAudience(input);
    const sentCount = audienceCount(audience);
    const payload: NotificationBroadcastRequestedPayload = {
      type: input.type,
      title: cleanRequiredText(input.title, MAX_NOTIFICATION_TITLE_LENGTH),
      body: cleanRequiredText(input.body, MAX_NOTIFICATION_BODY_LENGTH),
      audience,
      skippedAccountIds,
    };
    const eventId = deterministicUuid(
      NOTIFICATION_BROADCAST_NAMESPACE,
      `${ctx.accountId}:${input.idempotencyKey}`,
    );

    const requestedAt = this.clock.now();

    // 이력·감사는 이벤트 적재와 같은 tx — 개별 알림 ID가 아니라 발송 요청 자체를 남긴다(대상은 afterJson)
    const result = await this.repo.requestBroadcast(
      notificationBroadcastRequestedEvent({
        eventId,
        actorAccountId: ctx.accountId,
        payload,
        occurredAt: requestedAt,
      }),
      {
        actorAccountId: ctx.accountId,
        actorLabel,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        targetKind: audience.kind,
        targetCount: sentCount,
        targetAccountIds:
          audience.kind === 'ACCOUNT_IDS' ? audience.accountIds : null,
        skippedAccountIds,
        requestedAt,
      },
      (tx) =>
        this.auditLogs.recordAudit(tx, {
          actorAccountId: ctx.accountId,
          storeId: null,
          targetType: AuditTargetType.NOTIFICATION,
          targetId: ctx.accountId,
          action: AuditActionType.CREATE,
          afterJson: {
            eventId,
            type: payload.type,
            title: payload.title,
            targetKind: input.targetKind,
            sentCount,
            skippedCount: skippedAccountIds.length,
          },
        }),
    );
    const broadcastId = result.broadcastId.toString();
    if (!result.created) {
      // 재생 — 처음 확정한 대상이 정답. 이번 입력으로 다시 계산한 대상은 버린다
      const first = parseNotificationBroadcastRequestedPayload(result.payload);
      return {
        sentCount: audienceCount(first.audience),
        skippedAccountIds: first.skippedAccountIds,
        broadcastId,
      };
    }
    return { sentCount, skippedAccountIds, broadcastId };
  }

  /** 상태는 조회 시각 기준 — 완료 기록이 없는 요청은 30분이 지나면 지연으로 보인다. */
  async adminNotificationBroadcasts(
    accountId: bigint,
    input?: AdminNotificationBroadcastListInput,
  ): Promise<CursorConnection<AdminNotificationBroadcastOutput>> {
    await this.requireAdminContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor != null ? parseIdCursor(input.cursor) : null,
    });
    const filter = {
      type: input?.type ?? undefined,
      targetKind: input?.targetKind ?? undefined,
    };
    const [rows, totalCount] = await Promise.all([
      this.repo.listBroadcasts({ ...filter, ...normalized }),
      this.repo.countBroadcasts(filter),
    ]);
    const page = sliceIdCursorPage(rows, normalized.limit);
    const liveDelivered = await this.repo.countDeliveredByEventIds(
      page.items.filter(needsLiveDeliveredCount).map((r) => r.event_id),
    );
    const now = this.clock.now();
    return toCursorConnection(page, totalCount, (row) =>
      toAdminNotificationBroadcastOutput(row, liveDelivered, now),
    );
  }

  /** 공유 링크용 단건 조회. 상태·저장 수 계산은 목록과 같다. */
  async adminNotificationBroadcast(
    accountId: bigint,
    broadcastId: bigint,
  ): Promise<AdminNotificationBroadcastOutput | null> {
    await this.requireAdminContext(accountId);
    const row = await this.repo.findBroadcastById(broadcastId);
    if (!row) return null;
    const liveDelivered = await this.repo.countDeliveredByEventIds(
      needsLiveDeliveredCount(row) ? [row.event_id] : [],
    );
    return toAdminNotificationBroadcastOutput(
      row,
      liveDelivered,
      this.clock.now(),
    );
  }

  /** 발송 시점 발송자 표시 라벨 스냅샷 — 삭제된 자격증명의 아이디는 쓰지 않는다. */
  private async actorLabel(accountId: bigint): Promise<string | null> {
    const actor = await this.accounts.findAdminAccountById(accountId);
    return formatAccountLabel(
      actor?.name,
      activeOrNull(actor?.credential)?.username,
    );
  }

  /**
   * ACCOUNT_IDS는 활성 USER만 남기고 나머지를 skipped로. ALL_USERS는 전원을 모으지 않고
   * 요청 시점 컷오프(최대 id)·건수만 확정한다 — 소비자가 컷오프 이하를 페이지로 훑는다(대상 규모에 무관하게 유계).
   */
  private async resolveAudience(
    input: AdminSendNotificationInput,
  ): Promise<{ audience: BroadcastAudience; skippedAccountIds: string[] }> {
    if (input.targetKind === 'ACCOUNT_IDS') {
      // DTO가 ACCOUNT_IDS일 때 비어 있지 않음을 보장한다. 중복은 한 번으로
      const requested = [
        ...new Set((input.accountIds ?? []).map((id) => parseId(id))),
      ];
      const eligible = new Set(
        (await this.repo.filterActiveUserAccountIds(requested)).map(String),
      );
      return {
        audience: {
          kind: 'ACCOUNT_IDS',
          accountIds: requested
            .filter((id) => eligible.has(String(id)))
            .map(String),
        },
        skippedAccountIds: requested
          .filter((id) => !eligible.has(String(id)))
          .map(String),
      };
    }
    const snapshot = await this.repo.snapshotActiveUserAudience();
    return {
      audience: {
        kind: 'ALL_USERS',
        maxAccountId: (snapshot.maxAccountId ?? 0n).toString(),
        count: snapshot.count,
      },
      skippedAccountIds: [],
    };
  }
}
