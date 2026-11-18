import { Inject, Injectable } from '@nestjs/common';

import { retryOnceOnUniqueConflict } from '@/common/utils/prisma-error';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import {
  AuditActionType,
  AuditTargetType,
  type OrderActor,
  type StoreSettlementAccount,
} from '@/generated/prisma/client';
import { AccountCipher } from '@/global/crypto/account-cipher.service';
import { PrismaService } from '@/prisma';

/** 감사에는 계좌번호 끝 4자리만 남긴다. */
function maskedSnapshot(row: StoreSettlementAccount) {
  return {
    bank_code: row.bank_code,
    account_holder: row.account_holder,
    account_number_last4: row.account_number_last4,
  };
}

@Injectable()
export class StoreSettlementAccountRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogs: IAuditLogRepository,
    private readonly cipher: AccountCipher,
  ) {}

  async findByStoreId(storeId: bigint): Promise<StoreSettlementAccount | null> {
    return this.prisma.storeSettlementAccount.findUnique({
      where: { store_id: storeId },
    });
  }

  /**
   * 매장당 1행. 판매자 본인·관리자 대리 수정이 같은 경로다. 계좌번호는 암호문과 끝 4자리로만 저장하고,
   * 감사는 매장 ID를 달아 판매자 감사 로그에도 보인다.
   */
  async upsertByStore(args: {
    storeId: bigint;
    account: { bankCode: string; accountHolder: string; accountNumber: string };
    actorAccountId: bigint;
    actorRole: OrderActor;
    reason?: string;
  }): Promise<StoreSettlementAccount> {
    const data = {
      bank_code: args.account.bankCode,
      account_holder: args.account.accountHolder,
      account_number_enc: this.cipher.encrypt(
        args.account.accountNumber,
        'settlement-account',
      ),
      account_number_last4: args.account.accountNumber.slice(-4),
      updated_by_account_id: args.actorAccountId,
      updated_by_role: args.actorRole,
    };
    return retryOnceOnUniqueConflict(async () => {
      const exists = await this.findByStoreId(args.storeId);
      return this.prisma.$transaction(async (tx) => {
        let before: StoreSettlementAccount | null = null;
        if (exists) {
          await tx.$queryRaw`SELECT id FROM store_settlement_account WHERE id = ${exists.id} FOR UPDATE`;
          before = await tx.storeSettlementAccount.findUniqueOrThrow({
            where: { id: exists.id },
          });
        }
        const after = before
          ? await tx.storeSettlementAccount.update({
              where: { id: before.id },
              data,
            })
          : await tx.storeSettlementAccount.create({
              data: { store_id: args.storeId, ...data },
            });
        await this.auditLogs.recordAudit(tx, {
          actorAccountId: args.actorAccountId,
          storeId: args.storeId,
          targetType: AuditTargetType.SETTLEMENT_ACCOUNT,
          targetId: after.id,
          action: before ? AuditActionType.UPDATE : AuditActionType.CREATE,
          beforeJson: before ? maskedSnapshot(before) : null,
          afterJson: {
            ...maskedSnapshot(after),
            ...(args.reason ? { reason: args.reason } : {}),
          },
        });
        return after;
      });
    });
  }
}
