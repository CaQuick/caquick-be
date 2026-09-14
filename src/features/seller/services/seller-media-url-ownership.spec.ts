import type { PrismaClient } from '@prisma/client';

import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { ProductRepository } from '@/features/product';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerCustomTemplateService } from '@/features/seller/services/seller-custom-template.service';
import { SellerOptionService } from '@/features/seller/services/seller-option.service';
import { SellerProductImageService } from '@/features/seller/services/seller-product-image.service';
import { SellerProductLifecycleService } from '@/features/seller/services/seller-product-lifecycle.service';
import { SellerStoreProfileService } from '@/features/seller/services/seller-store-profile.service';
import { S3Service } from '@/global/storage/s3.service';
import type { UploadPurpose } from '@/global/storage/types/storage.types';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { setupSellerWithStore } from '@/test/factories';
import type { S3ServiceMock } from '@/test/mocks/s3-service.mock';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

/**
 * 판매자가 URL 문자열을 직접 주는 저장 경로 8건의 **전수 표**.
 *
 * SDL 필드 목록과의 대조는 test/media-url-validation.spec.ts 가 담당하고, 여기서는
 * 각 경로가 실제로 소유권 검증을 "어떤 용도로" 호출하는지와 거절 여부를 고정한다.
 * URL 판정 규칙 자체(host·prefix·traversal)는 global/storage/s3.service.spec.ts 소관.
 *
 * 새 필드가 생기면 표에 줄을 추가한다 — 등록부 테스트가 먼저 깨져서 알려준다.
 */
describe('판매자 미디어 URL 소유권 (real DB)', () => {
  let prisma: PrismaClient;
  let s3: S3ServiceMock;
  let lifecycle: SellerProductLifecycleService;
  let images: SellerProductImageService;
  let options: SellerOptionService;
  let templates: SellerCustomTemplateService;
  let storeProfile: SellerStoreProfileService;

  const FOREIGN_URL = 'https://evil.example.com/someone-else.jpg';

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerProductLifecycleService,
        SellerProductImageService,
        SellerOptionService,
        SellerCustomTemplateService,
        SellerStoreProfileService,
        SellerRepository,
        ProductRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    prisma = p;
    s3 = module.get(S3Service);
    lifecycle = module.get(SellerProductLifecycleService);
    images = module.get(SellerProductImageService);
    options = module.get(SellerOptionService);
    templates = module.get(SellerCustomTemplateService);
    storeProfile = module.get(SellerStoreProfileService);
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
    jest.clearAllMocks();
    // FOREIGN_URL 만 거절한다 — 한 호출에서 URL 을 둘 검증하는 경로에서
    // 두 번째 필드가 첫 필드의 거절에 가려지지 않도록.
    s3.rejectUploadUrls({ only: FOREIGN_URL });
  });

  // [설명, 호출, 검증돼야 하는 URL, 용도]
  const CASES: {
    label: string;
    field: string;
    purpose: UploadPurpose;
    url: string;
    call: (accountId: bigint) => Promise<unknown>;
  }[] = [
    {
      label: 'sellerCreateProduct',
      field: 'initialImageUrl',
      purpose: 'PRODUCT_IMAGE',
      url: FOREIGN_URL,
      call: (accountId) =>
        lifecycle.sellerCreateProduct(accountId, {
          name: '상품',
          regularPrice: 10000,
          initialImageUrl: FOREIGN_URL,
        }),
    },
    {
      label: 'sellerCreateProduct',
      field: 'baseDesignImageUrl',
      purpose: 'PRODUCT_IMAGE',
      url: FOREIGN_URL,
      call: (accountId) =>
        lifecycle.sellerCreateProduct(accountId, {
          name: '상품',
          regularPrice: 10000,
          // initialImageUrl 은 통과시키고 baseDesignImageUrl 만 걸리게 한다
          initialImageUrl: 'https://ok.example/a.png',
          baseDesignImageUrl: FOREIGN_URL,
        }),
    },
    {
      label: 'sellerUpdateProduct',
      field: 'baseDesignImageUrl',
      purpose: 'PRODUCT_IMAGE',
      url: FOREIGN_URL,
      call: (accountId) =>
        lifecycle.sellerUpdateProduct(accountId, {
          productId: '1',
          baseDesignImageUrl: FOREIGN_URL,
        }),
    },
    {
      label: 'sellerAddProductImage',
      field: 'imageUrl',
      purpose: 'PRODUCT_IMAGE',
      url: FOREIGN_URL,
      call: (accountId) =>
        images.sellerAddProductImage(accountId, {
          productId: '1',
          imageUrl: FOREIGN_URL,
        }),
    },
    {
      label: 'sellerCreateOptionItem',
      field: 'imageUrl',
      purpose: 'PRODUCT_IMAGE',
      url: FOREIGN_URL,
      call: (accountId) =>
        options.sellerCreateOptionItem(accountId, {
          optionGroupId: '1',
          title: '옵션',
          imageUrl: FOREIGN_URL,
        }),
    },
    {
      label: 'sellerUpdateOptionItem',
      field: 'imageUrl',
      purpose: 'PRODUCT_IMAGE',
      url: FOREIGN_URL,
      call: (accountId) =>
        options.sellerUpdateOptionItem(accountId, {
          optionItemId: '1',
          imageUrl: FOREIGN_URL,
        }),
    },
    {
      label: 'sellerUpsertProductCustomTemplate',
      field: 'baseImageUrl',
      purpose: 'PRODUCT_IMAGE',
      url: FOREIGN_URL,
      call: (accountId) =>
        templates.sellerUpsertProductCustomTemplate(accountId, {
          productId: '1',
          baseImageUrl: FOREIGN_URL,
        }),
    },
    {
      label: 'sellerUpdateStoreBasicInfo',
      field: 'profileImageUrl',
      purpose: 'STORE_IMAGE',
      url: FOREIGN_URL,
      call: (accountId) =>
        storeProfile.sellerUpdateStoreBasicInfo(accountId, {
          profileImageUrl: FOREIGN_URL,
        }),
    },
  ];

  it('표가 8건을 덮는다', () => {
    expect(CASES).toHaveLength(8);
  });

  it.each(CASES)(
    '$label.$field 은 소유 URL 이 아니면 저장하지 않는다',
    async ({ url, purpose, call }) => {
      const { account } = await setupSellerWithStore(prisma);

      await expect(call(account.id)).rejects.toThrow('NOT_OWNED');

      // 어떤 용도로 검증했는지까지 고정한다 — 용도를 섞으면 교차 사용이 뚫린다.
      const calls = [
        ...s3.assertOwnedUploadUrl.mock.calls,
        ...s3.assertOwnedUploadUrlIfPresent.mock.calls,
      ];
      expect(calls).toContainEqual([url, purpose, account.id]);
    },
  );
});
