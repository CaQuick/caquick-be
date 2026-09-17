import { ForbiddenException } from '@nestjs/common';

import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminUploadMutationResolver } from '@/features/admin/resolvers/admin-upload-mutation.resolver';
import { AdminUploadService } from '@/features/admin/services/admin-upload.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { s3TestProviders } from '@/test/storage/s3-test.helper';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://mock-presigned-url.com'),
}));

// 리졸버 배선 1건은 여기서 함께 본다 — 서비스 호출 외 로직이 없다.
describe('AdminUploadService (real DB)', () => {
  let service: AdminUploadService;
  let resolver: AdminUploadMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        ...s3TestProviders(),
        AdminUploadService,
        AdminUploadMutationResolver,
        AdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    service = module.get(AdminUploadService);
    resolver = module.get(AdminUploadMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it.each([
    ['BANNER_IMAGE', 'banner-images'],
    ['STORE_IMAGE', 'store-images'],
  ] as const)(
    '%s 용도는 %s/{accountId}/ 아래 키로 발급되고 같은 용도·계정으로만 검증을 통과한다',
    async (purpose, prefix) => {
      const admin = await createAccount(prisma, { account_type: 'ADMIN' });

      const result = await service.adminCreateUploadUrl(admin.id, {
        purpose,
        contentType: 'image/png',
        contentLength: 1024,
      });

      expect(result.key).toMatch(
        new RegExp(
          `^${prefix}/${admin.id}/\\d{4}-\\d{2}-\\d{2}/[a-f0-9-]+\\.png$`,
        ),
      );
      const s3 = service['s3'];
      expect(s3.isOwnedUploadUrl(result.publicUrl, purpose, admin.id)).toBe(
        true,
      );
      expect(
        s3.isOwnedUploadUrl(result.publicUrl, purpose, admin.id + BigInt(1)),
      ).toBe(false);
    },
  );

  it('ADMIN이 아니면 ForbiddenException', async () => {
    const seller = await createAccount(prisma, { account_type: 'SELLER' });
    await expect(
      service.adminCreateUploadUrl(seller.id, {
        purpose: 'BANNER_IMAGE',
        contentType: 'image/png',
        contentLength: 1,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('Mutation.adminCreateUploadUrl 배선', async () => {
    const admin = await createAccount(prisma, { account_type: 'ADMIN' });
    const result = await resolver.adminCreateUploadUrl(
      { accountId: admin.id.toString() },
      { purpose: 'BANNER_IMAGE', contentType: 'image/jpeg', contentLength: 10 },
    );
    expect(result.key).toContain(`banner-images/${admin.id}/`);
  });
});
