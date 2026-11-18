import type {
  AccountCipher,
  AccountCipherPurpose,
} from '@/global/crypto/account-cipher.service';
import type { PrismaService } from '@/prisma';

export interface ReencryptCounts {
  refund: number;
  storeSettlementAccount: number;
  settlement: number;
}

interface EncryptedRow {
  id: bigint;
  token: string;
}

/**
 * 키 회전용(`yarn accounts:reencrypt`). 첫 키가 아닌 키로 암호화된 계좌번호를 첫 키로 다시 암호화한다.
 * 행마다 읽은 토큰이 그대로일 때만 바꿔, 그사이 사용자가 새로 입력한 계좌를 옛 값으로 덮지 않는다.
 */
export class AccountNumberReencryptRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: AccountCipher,
  ) {}

  async countStale(): Promise<ReencryptCounts> {
    const rows = await this.staleRows();
    return {
      refund: rows.refund.length,
      storeSettlementAccount: rows.storeSettlementAccount.length,
      settlement: rows.settlement.length,
    };
  }

  async reencryptStale(): Promise<ReencryptCounts> {
    const rows = await this.staleRows();
    const counts: ReencryptCounts = {
      refund: 0,
      storeSettlementAccount: 0,
      settlement: 0,
    };
    for (const row of rows.refund) {
      const { count } = await this.prisma.refund.updateMany({
        where: { id: row.id, account_number_enc: row.token },
        data: { account_number_enc: this.rotate(row.token, 'refund-account') },
      });
      counts.refund += count;
    }
    for (const row of rows.storeSettlementAccount) {
      const { count } = await this.prisma.storeSettlementAccount.updateMany({
        where: { id: row.id, account_number_enc: row.token },
        data: {
          account_number_enc: this.rotate(row.token, 'settlement-account'),
        },
      });
      counts.storeSettlementAccount += count;
    }
    for (const row of rows.settlement) {
      const { count } = await this.prisma.settlement.updateMany({
        where: { id: row.id, paid_account_number_enc: row.token },
        data: {
          paid_account_number_enc: this.rotate(row.token, 'settlement-account'),
        },
      });
      counts.settlement += count;
    }
    return counts;
  }

  private rotate(token: string, purpose: AccountCipherPurpose): string {
    return this.cipher.encrypt(this.cipher.decrypt(token, purpose), purpose);
  }

  private async staleRows(): Promise<
    Record<keyof ReencryptCounts, EncryptedRow[]>
  > {
    const [refunds, accounts, settlements] = await Promise.all([
      this.prisma.refund.findMany({
        where: { account_number_enc: { not: null } },
        select: { id: true, account_number_enc: true },
        orderBy: { id: 'asc' },
      }),
      this.prisma.storeSettlementAccount.findMany({
        select: { id: true, account_number_enc: true },
        orderBy: { id: 'asc' },
      }),
      this.prisma.settlement.findMany({
        where: { paid_account_number_enc: { not: null } },
        select: { id: true, paid_account_number_enc: true },
        orderBy: { id: 'asc' },
      }),
    ]);
    const stale = (rows: { id: bigint; token: string | null }[]) =>
      rows.filter(
        (row): row is EncryptedRow =>
          row.token !== null && this.cipher.isStale(row.token),
      );
    return {
      refund: stale(
        refunds.map((r) => ({ id: r.id, token: r.account_number_enc })),
      ),
      storeSettlementAccount: stale(
        accounts.map((r) => ({ id: r.id, token: r.account_number_enc })),
      ),
      settlement: stale(
        settlements.map((r) => ({
          id: r.id,
          token: r.paid_account_number_enc,
        })),
      ),
    };
  }
}
