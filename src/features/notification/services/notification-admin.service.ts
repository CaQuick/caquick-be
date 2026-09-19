import { Inject, Injectable } from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';
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
  NOTIFICATION_FANOUT_BATCH_SIZE,
} from '@/features/notification/constants/notification-admin.constants';
import type { AdminSendNotificationInput } from '@/features/notification/dto/inputs/admin-send-notification.input';
import {
  NOTIFICATION_BROADCAST_NAMESPACE,
  type NotificationBroadcastRequestedPayload,
  notificationBroadcastRequestedEvent,
  parseNotificationBroadcastRequestedPayload,
} from '@/features/notification/events/notification-broadcast-requested.event';
import { NotificationAdminRepository } from '@/features/notification/repositories/notification-admin.repository';
import type { AdminSendNotificationResultOutput } from '@/features/notification/types/notification-admin-output.type';
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
  ) {
    super(accounts, auditLogs);
  }

  async adminSendNotification(
    accountId: bigint,
    input: AdminSendNotificationInput,
  ): Promise<AdminSendNotificationResultOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const { targets, skippedAccountIds } = await this.resolveTargets(input);
    const payload: NotificationBroadcastRequestedPayload = {
      type: input.type,
      title: cleanRequiredText(input.title, MAX_NOTIFICATION_TITLE_LENGTH),
      body: cleanRequiredText(input.body, MAX_NOTIFICATION_BODY_LENGTH),
      targetAccountIds: targets.map((id) => id.toString()),
      skippedAccountIds,
    };
    const eventId = deterministicUuid(
      NOTIFICATION_BROADCAST_NAMESPACE,
      `${ctx.accountId}:${input.idempotencyKey}`,
    );

    // 감사는 이벤트 적재와 같은 tx — 개별 알림 ID가 아니라 발송 요청 자체를 남긴다(대상은 afterJson)
    const result = await this.repo.requestBroadcast(
      notificationBroadcastRequestedEvent({
        eventId,
        actorAccountId: ctx.accountId,
        payload,
      }),
      (tx) =>
        this.auditLogs.createAuditLog(
          {
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
              sentCount: targets.length,
              skippedCount: skippedAccountIds.length,
            },
          },
          tx,
        ),
    );
    if (!result.created) {
      // 재생 — 처음 확정한 대상이 정답. 이번 입력으로 다시 계산한 대상은 버린다
      const first = parseNotificationBroadcastRequestedPayload(result.payload);
      return {
        sentCount: first.targetAccountIds.length,
        skippedAccountIds: first.skippedAccountIds,
      };
    }
    return { sentCount: targets.length, skippedAccountIds };
  }

  /** ACCOUNT_IDS는 활성 USER만 남기고 나머지를 skipped로, ALL_USERS는 활성 USER 전체를 키셋으로 모은다. */
  private async resolveTargets(
    input: AdminSendNotificationInput,
  ): Promise<{ targets: bigint[]; skippedAccountIds: string[] }> {
    if (input.targetKind === 'ACCOUNT_IDS') {
      // DTO가 ACCOUNT_IDS일 때 비어 있지 않음을 보장한다. 중복은 한 번으로
      const requested = [
        ...new Set((input.accountIds ?? []).map((id) => parseId(id))),
      ];
      const eligible = new Set(
        (await this.repo.filterActiveUserAccountIds(requested)).map(String),
      );
      return {
        targets: requested.filter((id) => eligible.has(String(id))),
        skippedAccountIds: requested
          .filter((id) => !eligible.has(String(id)))
          .map(String),
      };
    }
    const targets: bigint[] = [];
    let afterId: bigint | undefined;
    for (;;) {
      const ids = await this.repo.listActiveUserAccountIds({
        afterId,
        limit: NOTIFICATION_FANOUT_BATCH_SIZE,
      });
      targets.push(...ids);
      if (ids.length < NOTIFICATION_FANOUT_BATCH_SIZE) break;
      afterId = ids[ids.length - 1];
    }
    return { targets, skippedAccountIds: [] };
  }
}
