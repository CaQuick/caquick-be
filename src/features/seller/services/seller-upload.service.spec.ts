import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerUploadMutationResolver } from '@/features/seller/resolvers/seller-upload-mutation.resolver';
import { SellerUploadService } from '@/features/seller/services/seller-upload.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { s3TestProviders, TEST_S3_CONFIG } from '@/test/storage/s3-test.helper';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://mock-presigned-url.com'),
}));

// 리졸버 배선 1건은 여기서 함께 본다 — 서비스 호출 외 로직이 없다.
describe('SellerUploadService (real DB)', () => {
  let service: SellerUploadService;
  let resolver: SellerUploadMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        ...s3TestProviders(),
        SellerUploadService,
        SellerUploadMutationResolver,
        SellerRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    service = module.get(SellerUploadService);
    resolver = module.get(SellerUploadMutationResolver);
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
    ['PRODUCT_IMAGE', 'product-images'],
    ['STORE_IMAGE', 'store-images'],
  ] as const)(
    '%s 용도는 %s/{accountId}/ 아래 키로 발급된다',
    async (purpose, prefix) => {
      const { account } = await setupSellerWithStore(prisma);

      const result = await service.sellerCreateUploadUrl(account.id, {
        purpose,
        contentType: 'image/png',
        contentLength: 1024,
      });

      expect(result.uploadUrl).toBe('https://mock-presigned-url.com');
      expect(result.key).toMatch(
        new RegExp(
          `^${prefix}/${account.id}/\\d{4}-\\d{2}-\\d{2}/[a-f0-9-]+\\.png$`,
        ),
      );
      expect(result.publicUrl).toBe(
        `https://${TEST_S3_CONFIG.bucket}.s3.${TEST_S3_CONFIG.region}.amazonaws.com/${result.key}`,
      );
    },
  );

  it('발급 결과는 소유권 검증을 통과하는 URL이다 (발급 ↔ 검증 계약)', async () => {
    const { account } = await setupSellerWithStore(prisma);
    const s3 = service['s3'];

    const result = await service.sellerCreateUploadUrl(account.id, {
      purpose: 'PRODUCT_IMAGE',
      contentType: 'image/jpeg',
      contentLength: 1,
    });

    expect(
      s3.isOwnedUploadUrl(result.publicUrl, 'PRODUCT_IMAGE', account.id),
    ).toBe(true);
    expect(
      s3.isOwnedUploadUrl(result.publicUrl, 'STORE_IMAGE', account.id),
    ).toBe(false);
    expect(
      s3.isOwnedUploadUrl(
        result.publicUrl,
        'PRODUCT_IMAGE',
        account.id + BigInt(1),
      ),
    ).toBe(false);
  });

  it('SELLER가 아니면 ForbiddenException', async () => {
    const user = await createAccount(prisma, { account_type: 'USER' });
    await expect(
      service.sellerCreateUploadUrl(user.id, {
        purpose: 'PRODUCT_IMAGE',
        contentType: 'image/png',
        contentLength: 1,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('매장이 없는 판매자면 NotFoundException', async () => {
    const seller = await createAccount(prisma, { account_type: 'SELLER' });
    await expect(
      service.sellerCreateUploadUrl(seller.id, {
        purpose: 'STORE_IMAGE',
        contentType: 'image/png',
        contentLength: 1,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('Mutation.sellerCreateUploadUrl 배선', async () => {
    const { account } = await setupSellerWithStore(prisma);
    const result = await resolver.sellerCreateUploadUrl(
      { accountId: account.id.toString() },
      { purpose: 'STORE_IMAGE', contentType: 'image/webp', contentLength: 10 },
    );
    expect(result.key).toContain(`store-images/${account.id}/`);
  });
});
