import { Inject, Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { parseId } from '@/common/utils/id-parser';
import { cleanRequiredText } from '@/common/utils/text-cleaner';
import {
  MAX_NOTIFICATION_BODY_LENGTH,
  MAX_NOTIFICATION_TITLE_LENGTH,
  NOTIFICATION_FANOUT_BATCH_SIZE,
} from '@/features/admin/constants/admin.constants';
import type { AdminSendNotificationInput } from '@/features/admin/dto/inputs/admin-send-notification.input';
import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminBaseService } from '@/features/admin/services/admin-base.service';
import type { AdminSendNotificationResultOutput } from '@/features/admin/types/admin-output.type';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { AuditActionType, AuditTargetType } from '@/generated/prisma/client';

/** ALL_USERS는 키셋으로 활성 USER를 훑어 청크 단위 createMany — 청크 사이 트랜잭션은 없다(부분 실패 시 sentCount까지 저장된 상태, 재실행은 중복). 멱등 키·배치 잡은 범위 밖. */
@Injectable()
export class AdminNotificationService extends AdminBaseService {
  constructor(
    repo: AdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
  ) {
    super(repo, auditLogs);
  }

  async adminSendNotification(
    accountId: bigint,
    input: AdminSendNotificationInput,
  ): Promise<AdminSendNotificationResultOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const payload = {
      type: input.type,
      title: cleanRequiredText(input.title, MAX_NOTIFICATION_TITLE_LENGTH),
      body: cleanRequiredText(input.body, MAX_NOTIFICATION_BODY_LENGTH),
    };

    let sentCount = 0;
    const skippedAccountIds: string[] = [];

    if (input.targetKind === 'ACCOUNT_IDS') {
      // DTO가 ACCOUNT_IDS일 때 비어 있지 않음을 보장한다. 중복은 한 번으로
      const requested = [
        ...new Set((input.accountIds ?? []).map((id) => parseId(id))),
      ];
      const eligible = new Set(
        (await this.repo.filterActiveUserAccountIds(requested)).map(String),
      );
      const targets = requested.filter((id) => eligible.has(String(id)));
      for (const id of requested) {
        if (!eligible.has(String(id))) skippedAccountIds.push(id.toString());
      }
      sentCount = await this.repo.createNotifications(targets, payload);
    } else {
      let afterId: bigint | undefined;
      let interrupted = false;
      try {
        for (;;) {
          const ids = await this.repo.listActiveUserAccountIds({
            afterId,
            limit: NOTIFICATION_FANOUT_BATCH_SIZE,
          });
          if (ids.length === 0) break;
          sentCount += await this.repo.createNotifications(ids, payload);
          afterId = ids[ids.length - 1];
          if (ids.length < NOTIFICATION_FANOUT_BATCH_SIZE) break;
        }
      } catch {
        // 앞 청크는 이미 커밋됐다. 조용히 실패하면 재시도가 그만큼 중복 발송이 되므로
        // 저장된 건수를 감사에 남기고 그 사실을 오류로 알린다
        interrupted = true;
      }
      if (interrupted) {
        await this.audit(
          ctx.accountId,
          payload,
          input.targetKind,
          sentCount,
          0,
          true,
        );
        throw new DomainException('NOTIFICATION_FANOUT_INTERRUPTED', {
          sentCount,
        });
      }
    }

    await this.audit(
      ctx.accountId,
      payload,
      input.targetKind,
      sentCount,
      skippedAccountIds.length,
      false,
    );
    return { sentCount, skippedAccountIds };
  }

  /** 개별 알림 ID가 아니라 발송 행위 자체를 남긴다(대상은 afterJson). */
  private audit(
    actorAccountId: bigint,
    payload: { type: string; title: string },
    targetKind: string,
    sentCount: number,
    skippedCount: number,
    interrupted: boolean,
  ): Promise<unknown> {
    return this.auditLogs.createAuditLog({
      actorAccountId,
      storeId: null,
      targetType: AuditTargetType.NOTIFICATION,
      targetId: actorAccountId,
      action: AuditActionType.CREATE,
      afterJson: {
        type: payload.type,
        title: payload.title,
        targetKind,
        sentCount,
        skippedCount,
        interrupted,
      },
    });
  }
}
