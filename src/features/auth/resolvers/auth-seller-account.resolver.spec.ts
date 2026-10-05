// 분기 세부 검증은 service.spec.ts에서 담당. 여기서는 리졸버→서비스→DB 경로와 가드 계약만 본다.

import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { SellerAccountQueryResolver } from '@/features/auth/resolvers/auth-seller-account-query.resolver';
import { SellerAccountService } from '@/features/auth/services/auth-seller-account.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { RolesGuard, type JwtUser } from '@/global/auth';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccountCredential,
  setupSellerWithStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('Seller Account Resolvers (real DB)', () => {
  let resolver: SellerAccountQueryResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerAccountQueryResolver,
        SellerAccountService,
        AccountAdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    resolver = module.get(SellerAccountQueryResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('Query.sellerMe: 본인 판매자 계정과 매장 ID를 반환한다', async () => {
    const { account, store } = await setupSellerWithStore(prisma);
    const credential = await createAccountCredential(prisma, {
      account_id: account.id,
      username: 'me.seller',
    });

    const result = await resolver.sellerMe({
      accountId: account.id.toString(),
      accountType: 'SELLER',
    });

    expect(result.accountId).toBe(account.id.toString());
    expect(result.username).toBe(credential.username);
    expect(result.storeId).toBe(store.id.toString());
  });

  it('초기 비밀번호 상태의 판매자는 RolesGuard가 PASSWORD_CHANGE_REQUIRED로 막는다', () => {
    const user: JwtUser = {
      accountId: '1',
      accountType: 'SELLER',
      mustChangePassword: true,
    };
    const gqlArgs = [undefined, {}, { req: { user } }, {}];
    const ctx = {
      getType: () => 'graphql',
      getArgs: () => gqlArgs,
      getArgByIndex: (i: number) => gqlArgs[i],
      getHandler: () => SellerAccountQueryResolver.prototype.sellerMe,
      getClass: () => SellerAccountQueryResolver,
    } as unknown as ExecutionContext;

    expect(() =>
      new RolesGuard(new Reflector()).canActivate(ctx),
    ).toThrowDomain('PASSWORD_CHANGE_REQUIRED');
  });
});
