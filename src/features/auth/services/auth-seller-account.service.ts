import { Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { toSellerAccountOutput } from '@/features/auth/services/auth-seller-mappers.helper';
import type { SellerAccountOutput } from '@/features/auth/types/auth-seller-output.type';
import { AccountType } from '@/generated/prisma/client';

/** RolesGuard가 1차로 막고, 여기서 DB 기준으로 타입·상태를 한 번 더 확인한다(adminMe와 같은 역할). */
@Injectable()
export class SellerAccountService {
  constructor(private readonly accounts: AccountAdminRepository) {}

  async sellerMe(accountId: bigint): Promise<SellerAccountOutput> {
    const row = await this.accounts.findSellerSelfById(accountId);
    if (!row) throw new DomainException('SESSION_ACCOUNT_MISSING');
    if (row.account_type !== AccountType.SELLER) {
      throw new DomainException('SELLER_ONLY');
    }
    if (row.status !== 'ACTIVE') {
      throw new DomainException('ACCOUNT_NOT_ACTIVE');
    }
    // 매장이 없어도 계정 정보는 답한다(storeId null) — requireSellerContext의 STORE_NOT_FOUND와 다른 점
    return toSellerAccountOutput(row);
  }
}
