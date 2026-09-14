import type { PrismaClient } from '@prisma/client';

import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminBannerService } from '@/features/admin/services/admin-banner.service';
import { AdminStoreService } from '@/features/admin/services/admin-store.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { S3Service } from '@/global/storage/s3.service';
import type { UploadPurpose } from '@/global/storage/types/storage.types';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createStore } from '@/test/factories';
import type { S3ServiceMock } from '@/test/mocks/s3-service.mock';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

/**
 * 관리자가 URL 문자열을 직접 주는 저장 경로 3건의 **전수 표**.
 * 대응 관계는 판매자판(seller-media-url-ownership.spec.ts)과 동일하다.
 */
describe('관리자 미디어 URL 소유권 (real DB)', () => {
  let prisma: PrismaClient;
  let s3: S3ServiceMock;
  let banners: AdminBannerService;
  let stores: AdminStoreService;

  const FOREIGN_URL = 'https://evil.example.com/someone-else.jpg';

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminBannerService,
        AdminStoreService,
        AdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    prisma = p;
    s3 = module.get(S3Service);
    banners = module.get(AdminBannerService);
    stores = module.get(AdminStoreService);
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
    jest.clearAllMocks();
    s3.rejectUploadUrls({ only: FOREIGN_URL });
  });

  async function adminAccountId(): Promise<bigint> {
    return (await createAccount(prisma, { account_type: 'ADMIN' })).id;
  }

  /** 수정 경로용 배너 1건 */
  async function makeBanner(): Promise<bigint> {
    const row = await prisma.banner.create({
      data: {
        placement: 'HOME_MAIN',
        image_url: 'https://ok.example/b.png',
        link_type: 'NONE',
        sort_order: 0,
        is_active: true,
      },
    });
    return row.id;
  }

  const CASES: {
    label: string;
    field: string;
    purpose: UploadPurpose;
    call: (
      accountId: bigint,
      ids: { bannerId: bigint; storeId: bigint },
    ) => Promise<unknown>;
  }[] = [
    {
      label: 'adminCreateBanner',
      field: 'imageUrl',
      purpose: 'BANNER_IMAGE',
      call: (accountId) =>
        banners.adminCreateBanner(accountId, {
          placement: 'HOME_MAIN',
          imageUrl: FOREIGN_URL,
        }),
    },
    {
      label: 'adminUpdateBanner',
      field: 'imageUrl',
      purpose: 'BANNER_IMAGE',
      call: (accountId, ids) =>
        banners.adminUpdateBanner(accountId, {
          bannerId: ids.bannerId.toString(),
          imageUrl: FOREIGN_URL,
        }),
    },
    {
      label: 'adminUpdateStoreBasicInfo',
      field: 'profileImageUrl',
      purpose: 'STORE_IMAGE',
      call: (accountId, ids) =>
        stores.adminUpdateStoreBasicInfo(accountId, {
          storeId: ids.storeId.toString(),
          profileImageUrl: FOREIGN_URL,
        }),
    },
  ];

  it('표가 3건을 덮는다', () => {
    expect(CASES).toHaveLength(3);
  });

  it.each(CASES)(
    '$label.$field 은 소유 URL 이 아니면 저장하지 않는다',
    async ({ purpose, call }) => {
      const accountId = await adminAccountId();
      const bannerId = await makeBanner();
      const sellerAccount = await createAccount(prisma, {
        account_type: 'SELLER',
      });
      const store = await createStore(prisma, {
        seller_account_id: sellerAccount.id,
      });

      await expect(
        call(accountId, { bannerId, storeId: store.id }),
      ).rejects.toThrow('NOT_OWNED');

      const calls = [
        ...s3.assertOwnedUploadUrl.mock.calls,
        ...s3.assertOwnedUploadUrlIfPresent.mock.calls,
      ];
      expect(calls).toContainEqual([FOREIGN_URL, purpose, accountId]);
    },
  );
});
