import { Inject, Injectable } from '@nestjs/common';

import { retryOnceOnUniqueConflict } from '@/common/utils/prisma-error';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import {
  AuditActionType,
  AuditTargetType,
  type PaymentSetting,
} from '@/generated/prisma/client';
import { PrismaService } from '@/prisma';

const PAYMENT_SETTING_ID = 1;

export type PaymentSettingValues = Pick<
  PaymentSetting,
  | 'commission_rate_bps'
  | 'deposit_bank_code'
  | 'deposit_account_number'
  | 'deposit_account_holder'
>;

export type PaymentSettingRow = PaymentSettingValues & {
  updated_at: Date | null;
};

const DEFAULT_PAYMENT_SETTING: PaymentSettingValues = {
  commission_rate_bps: 0,
  deposit_bank_code: null,
  deposit_account_number: null,
  deposit_account_holder: null,
};

function valuesOf(row: PaymentSettingValues): PaymentSettingValues {
  return {
    commission_rate_bps: row.commission_rate_bps,
    deposit_bank_code: row.deposit_bank_code,
    deposit_account_number: row.deposit_account_number,
    deposit_account_holder: row.deposit_account_holder,
  };
}

/** 플랫폼 결제 설정 단일 행(id=1). 행이 없으면(테스트 truncate 등) 기본값으로 읽고, 쓰기는 upsert다. */
@Injectable()
export class PaymentSettingRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogs: IAuditLogRepository,
  ) {}

  async findPaymentSetting(): Promise<PaymentSettingRow> {
    const row = await this.prisma.paymentSetting.findUnique({
      where: { id: PAYMENT_SETTING_ID },
    });
    return row
      ? { ...valuesOf(row), updated_at: row.updated_at }
      : { ...DEFAULT_PAYMENT_SETTING, updated_at: null };
  }

  /** 준 필드만 바꾼다. 변경 전 값은 잠금 뒤에 읽어 감사에 남긴다(계좌는 케이퀵 공개 입금 계좌라 원문). */
  async updatePaymentSetting(args: {
    patch: Partial<PaymentSettingValues>;
    actorAccountId: bigint;
    reason: string;
  }): Promise<PaymentSettingRow> {
    return retryOnceOnUniqueConflict(async () => {
      const exists = await this.prisma.paymentSetting.findUnique({
        where: { id: PAYMENT_SETTING_ID },
        select: { id: true },
      });
      return this.prisma.$transaction(async (tx) => {
        let before = DEFAULT_PAYMENT_SETTING;
        if (exists) {
          await tx.$queryRaw`SELECT id FROM payment_setting WHERE id = ${PAYMENT_SETTING_ID} FOR UPDATE`;
          before = valuesOf(
            await tx.paymentSetting.findUniqueOrThrow({
              where: { id: PAYMENT_SETTING_ID },
            }),
          );
        }
        // undefined 필드는 Prisma가 건너뛴다(생략 = 그대로)
        const data = {
          commission_rate_bps: args.patch.commission_rate_bps,
          deposit_bank_code: args.patch.deposit_bank_code,
          deposit_account_number: args.patch.deposit_account_number,
          deposit_account_holder: args.patch.deposit_account_holder,
          updated_by_account_id: args.actorAccountId,
        };
        const after = exists
          ? await tx.paymentSetting.update({
              where: { id: PAYMENT_SETTING_ID },
              data,
            })
          : await tx.paymentSetting.create({
              data: { id: PAYMENT_SETTING_ID, ...data },
            });
        await this.auditLogs.recordAudit(tx, {
          actorAccountId: args.actorAccountId,
          targetType: AuditTargetType.PAYMENT_SETTING,
          targetId: BigInt(PAYMENT_SETTING_ID),
          action: AuditActionType.UPDATE,
          beforeJson: { ...before },
          afterJson: { ...valuesOf(after), reason: args.reason },
        });
        return { ...valuesOf(after), updated_at: after.updated_at };
      });
    });
  }
}
