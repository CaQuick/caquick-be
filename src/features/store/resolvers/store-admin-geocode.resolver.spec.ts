// 분기/집계 세부 검증은 store-admin-geocode.service.spec.ts에서 담당. 여기서는 리졸버→서비스 경로와 역할 거절만 본다.
import { ConfigService } from '@nestjs/config';

import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import { AdminGeocodeQueryResolver } from '@/features/store/resolvers/store-admin-geocode-query.resolver';
import { AdminGeocodeService } from '@/features/store/services/store-admin-geocode.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { KAKAO_LOCAL_TRANSPORT } from '@/global/kakao-local';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('AdminGeocodeQueryResolver (real DB)', () => {
  let resolver: AdminGeocodeQueryResolver;
  let prisma: PrismaClient;
  const transport = jest.fn<Promise<Response>, [string, RequestInit]>();

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminGeocodeQueryResolver,
        AdminGeocodeService,
        StoreSellerRepository,
        AccountAdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        {
          provide: ConfigService,
          useValue: { get: () => ({ restApiKey: 'rest-key' }) },
        },
        { provide: KAKAO_LOCAL_TRANSPORT, useValue: transport },
      ],
    });
    resolver = module.get(AdminGeocodeQueryResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
    transport.mockReset();
    transport.mockResolvedValue(
      new Response(
        JSON.stringify({
          documents: [
            {
              x: '127.0365086',
              y: '37.5000242',
              address: null,
              road_address: null,
            },
          ],
        }),
      ),
    );
  });

  it('관리자는 주소를 좌표로 변환한다', async () => {
    const actor = await createAccount(prisma, { account_type: 'ADMIN' });
    const result = await resolver.adminGeocodeAddress(
      { accountId: actor.id.toString(), accountType: 'ADMIN' },
      '테헤란로 152',
    );
    expect(result).toMatchObject({
      latitude: 37.5000242,
      longitude: 127.0365086,
    });
  });

  it.each(['USER', 'SELLER'] as const)(
    '%s 계정은 ADMIN_ONLY로 거절하고 카카오를 호출하지 않는다',
    async (accountType) => {
      const actor = await createAccount(prisma, { account_type: accountType });
      await expect(
        resolver.adminGeocodeAddress(
          { accountId: actor.id.toString(), accountType },
          '테헤란로 152',
        ),
      ).rejects.toThrowDomain('ADMIN_ONLY');
      expect(transport).not.toHaveBeenCalled();
    },
  );
});
