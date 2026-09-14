import { BadRequestException, NotFoundException } from '@nestjs/common';

import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminBannerService } from '@/features/admin/services/admin-banner.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createCategory,
  createProduct,
  createStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('AdminBannerService (real DB)', () => {
  let service: AdminBannerService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminBannerService,
        AdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    service = module.get(AdminBannerService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function admin(): Promise<bigint> {
    return (await createAccount(prisma, { account_type: 'ADMIN' })).id;
  }

  /** 링크 없는 배너 1건. 판매자 API로는 만들 수 없던 플랫폼 배너 형태다. */
  async function makeBanner(
    overrides: Partial<{
      placement: 'HOME_MAIN' | 'HOME_SUB' | 'CATEGORY' | 'STORE' | 'SEARCH';
      is_active: boolean;
      link_type: 'NONE' | 'URL' | 'PRODUCT' | 'STORE' | 'CATEGORY';
      link_store_id: bigint | null;
      link_url: string | null;
    }> = {},
  ) {
    return prisma.banner.create({
      data: {
        placement: overrides.placement ?? 'HOME_MAIN',
        image_url: 'https://i.example/b.png',
        link_type: overrides.link_type ?? 'NONE',
        link_store_id: overrides.link_store_id ?? null,
        link_url: overrides.link_url ?? null,
        is_active: overrides.is_active ?? true,
      },
    });
  }

  async function auditCount(bannerId: bigint, action: string): Promise<number> {
    return prisma.auditLog.count({
      where: {
        target_type: 'BANNER',
        target_id: bannerId,
        action: action as never,
      },
    });
  }

  describe('adminBanners', () => {
    it('매장 소속과 무관하게 전체 배너를 최신순으로 반환하고 totalCount를 센다', async () => {
      const store = await createStore(prisma);
      const first = await makeBanner();
      const second = await makeBanner({
        placement: 'STORE',
        link_type: 'STORE',
        link_store_id: store.id,
      });

      const result = await service.adminBanners(await admin());

      expect(result.totalCount).toBe(2);
      expect(result.items.map((b) => b.id)).toEqual([
        second.id.toString(),
        first.id.toString(),
      ]);
    });

    it('placement·isActive 필터가 목록과 totalCount에 함께 적용된다', async () => {
      await makeBanner({ placement: 'HOME_MAIN', is_active: true });
      await makeBanner({ placement: 'HOME_MAIN', is_active: false });
      await makeBanner({ placement: 'SEARCH', is_active: true });

      const byPlacement = await service.adminBanners(await admin(), {
        placement: 'HOME_MAIN',
      });
      expect(byPlacement.totalCount).toBe(2);
      expect(byPlacement.items).toHaveLength(2);

      const active = await service.adminBanners(await admin(), {
        placement: 'HOME_MAIN',
        isActive: true,
      });
      expect(active.totalCount).toBe(1);
      expect(active.items[0].isActive).toBe(true);
    });

    it('limit+1 조회로 hasMore·nextCursor를 판정한다', async () => {
      const ids = [
        (await makeBanner()).id,
        (await makeBanner()).id,
        (await makeBanner()).id,
      ];

      const page1 = await service.adminBanners(await admin(), { limit: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).toBe(ids[1].toString());

      const page2 = await service.adminBanners(await admin(), {
        limit: 2,
        cursor: page1.nextCursor!,
      });
      expect(page2.items.map((b) => b.id)).toEqual([ids[0].toString()]);
      expect(page2.hasMore).toBe(false);
    });

    it('soft-delete된 배너는 목록·집계에서 빠진다', async () => {
      const banner = await makeBanner();
      await prisma.banner.update({
        where: { id: banner.id },
        data: { deleted_at: new Date() },
      });

      const result = await service.adminBanners(await admin());
      expect(result.totalCount).toBe(0);
      expect(result.items).toHaveLength(0);
    });
  });

  describe('adminBanner', () => {
    it('저장된 링크 값을 그대로 내린다', async () => {
      const banner = await makeBanner({
        link_type: 'URL',
        link_url: 'https://caquick.example/event',
      });

      const result = await service.adminBanner(await admin(), banner.id);

      expect(result.linkType).toBe('URL');
      expect(result.linkUrl).toBe('https://caquick.example/event');
      expect(result.linkStoreId).toBeNull();
    });

    it('없거나 삭제된 배너면 NotFoundException', async () => {
      await expect(
        service.adminBanner(await admin(), BigInt(999_999)),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('adminCreateBanner', () => {
    it('링크 없는 HOME_MAIN 배너를 만들고 audit(BANNER/CREATE)을 남긴다', async () => {
      const actor = await admin();

      const result = await service.adminCreateBanner(actor, {
        placement: 'HOME_MAIN',
        imageUrl: 'https://i.example/home.png',
        title: '  가을 이벤트  ',
        sortOrder: 3,
      });

      expect(result.placement).toBe('HOME_MAIN');
      expect(result.linkType).toBe('NONE');
      expect(result.title).toBe('가을 이벤트');
      expect(result.sortOrder).toBe(3);
      expect(result.isActive).toBe(true);
      expect(await auditCount(BigInt(result.id), 'CREATE')).toBe(1);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { target_type: 'BANNER', target_id: BigInt(result.id) },
      });
      expect(audit.actor_account_id).toBe(actor);
      expect(audit.store_id).toBeNull();
    });

    it.each([
      ['PRODUCT', 'linkProductId'],
      ['STORE', 'linkStoreId'],
      ['CATEGORY', 'linkCategoryId'],
    ] as const)(
      'linkType=%s에 존재하는 대상이면 어느 매장 것이든 허용한다',
      async (linkType, field) => {
        const store = await createStore(prisma);
        const targetId =
          linkType === 'PRODUCT'
            ? (await createProduct(prisma, { store_id: store.id })).id
            : linkType === 'STORE'
              ? store.id
              : (await createCategory(prisma)).id;

        const result = await service.adminCreateBanner(await admin(), {
          placement: 'HOME_MAIN',
          imageUrl: 'https://i.example/x.png',
          linkType,
          [field]: targetId.toString(),
        });

        expect(result.linkType).toBe(linkType);
        expect(result[field]).toBe(targetId.toString());
      },
    );

    it.each([
      ['PRODUCT', 'linkProductId'],
      ['STORE', 'linkStoreId'],
      ['CATEGORY', 'linkCategoryId'],
    ] as const)(
      'linkType=%s인데 대상이 없으면 NotFoundException',
      async (linkType, field) => {
        await expect(
          service.adminCreateBanner(await admin(), {
            placement: 'HOME_MAIN',
            imageUrl: 'https://i.example/x.png',
            linkType,
            [field]: '999999',
          }),
        ).rejects.toThrow(NotFoundException);
      },
    );

    // 노출 가능성(visibleWhere) 전수 — 구매자 조회가 거르는 대상은 저장 시점에 거절
    it.each([
      [
        '비활성 상품',
        async () => ({
          linkType: 'PRODUCT' as const,
          linkProductId: (
            await createProduct(prisma, { is_active: false })
          ).id.toString(),
        }),
      ],
      [
        '활성 상품이지만 매장이 비활성',
        async () => {
          const store = await createStore(prisma, { is_active: false });
          return {
            linkType: 'PRODUCT' as const,
            linkProductId: (
              await createProduct(prisma, { store_id: store.id })
            ).id.toString(),
          };
        },
      ],
      [
        '비활성 매장',
        async () => ({
          linkType: 'STORE' as const,
          linkStoreId: (
            await createStore(prisma, { is_active: false })
          ).id.toString(),
        }),
      ],
      [
        '비활성 카테고리',
        async () => ({
          linkType: 'CATEGORY' as const,
          linkCategoryId: (
            await createCategory(prisma, { is_active: false })
          ).id.toString(),
        }),
      ],
    ])('%s 링크는 NotFoundException(노출 불가)', async (_label, makeLink) => {
      await expect(
        service.adminCreateBanner(await admin(), {
          placement: 'HOME_MAIN',
          imageUrl: 'https://i.example/x.png',
          ...(await makeLink()),
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('CATEGORY 지면은 linkType CATEGORY가 아니면 BadRequestException', async () => {
      await expect(
        service.adminCreateBanner(await admin(), {
          placement: 'CATEGORY',
          imageUrl: 'https://i.example/x.png',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('CATEGORY 지면에 EVENT가 아닌 카테고리를 연결하면 BadRequestException', async () => {
      const style = await createCategory(prisma, { category_type: 'STYLE' });
      await expect(
        service.adminCreateBanner(await admin(), {
          placement: 'CATEGORY',
          imageUrl: 'https://i.example/x.png',
          linkType: 'CATEGORY',
          linkCategoryId: style.id.toString(),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('CATEGORY 지면 + EVENT 카테고리 링크는 허용된다', async () => {
      const event = await createCategory(prisma, { category_type: 'EVENT' });
      const result = await service.adminCreateBanner(await admin(), {
        placement: 'CATEGORY',
        imageUrl: 'https://i.example/x.png',
        linkType: 'CATEGORY',
        linkCategoryId: event.id.toString(),
      });
      expect(result.linkCategoryId).toBe(event.id.toString());
    });

    it('HOME_MAIN 지면은 STYLE 카테고리 링크도 허용된다(EVENT 제한은 CATEGORY 지면만)', async () => {
      const style = await createCategory(prisma, { category_type: 'STYLE' });
      const result = await service.adminCreateBanner(await admin(), {
        placement: 'HOME_MAIN',
        imageUrl: 'https://i.example/x.png',
        linkType: 'CATEGORY',
        linkCategoryId: style.id.toString(),
      });
      expect(result.placement).toBe('HOME_MAIN');
    });

    it.each([
      [
        '역전',
        new Date('2026-10-02T00:00:00Z'),
        new Date('2026-10-01T00:00:00Z'),
      ],
      [
        '동일',
        new Date('2026-10-01T00:00:00Z'),
        new Date('2026-10-01T00:00:00Z'),
      ],
    ])(
      '노출 기간 %s이면 BadRequestException',
      async (_label, startsAt, endsAt) => {
        await expect(
          service.adminCreateBanner(await admin(), {
            placement: 'HOME_MAIN',
            imageUrl: 'https://i.example/x.png',
            startsAt,
            endsAt,
          }),
        ).rejects.toThrow(BadRequestException);
      },
    );

    it('한쪽만 있는 노출 기간은 허용된다', async () => {
      const result = await service.adminCreateBanner(await admin(), {
        placement: 'HOME_MAIN',
        imageUrl: 'https://i.example/x.png',
        endsAt: new Date('2026-12-31T00:00:00Z'),
      });
      expect(result.startsAt).toBeNull();
      expect(result.endsAt).not.toBeNull();
    });

    it('linkType=PRODUCT인데 삭제된 상품이면 NotFoundException', async () => {
      const product = await createProduct(prisma);
      await prisma.product.update({
        where: { id: product.id },
        data: { deleted_at: new Date() },
      });

      await expect(
        service.adminCreateBanner(await admin(), {
          placement: 'HOME_MAIN',
          imageUrl: 'https://i.example/x.png',
          linkType: 'PRODUCT',
          linkProductId: product.id.toString(),
        }),
      ).rejects.toThrow(NotFoundException);
    });

    // linkType별 필수 값 누락 전수
    it.each([
      ['URL', {}],
      ['URL', { linkUrl: '   ' }],
      ['PRODUCT', {}],
      ['STORE', {}],
      ['CATEGORY', {}],
    ] as const)(
      'linkType=%s에 필수 링크 값이 없으면 BadRequestException (%o)',
      async (linkType, extra) => {
        await expect(
          service.adminCreateBanner(await admin(), {
            placement: 'HOME_MAIN',
            imageUrl: 'https://i.example/x.png',
            linkType,
            ...extra,
          }),
        ).rejects.toThrow(BadRequestException);
      },
    );

    // linkType과 무관한 링크 필드 혼입 전수
    it.each([
      ['NONE', { linkUrl: 'https://x.example' }],
      ['NONE', { linkStoreId: '1' }],
      ['URL', { linkUrl: 'https://x.example', linkProductId: '1' }],
      ['PRODUCT', { linkProductId: '1', linkUrl: 'https://x.example' }],
      ['STORE', { linkStoreId: '1', linkCategoryId: '1' }],
      ['CATEGORY', { linkCategoryId: '1', linkStoreId: '1' }],
    ] as const)(
      'linkType=%s에 무관한 링크 필드가 섞이면 BadRequestException (%o)',
      async (linkType, extra) => {
        await expect(
          service.adminCreateBanner(await admin(), {
            placement: 'HOME_MAIN',
            imageUrl: 'https://i.example/x.png',
            linkType,
            ...extra,
          }),
        ).rejects.toThrow(BadRequestException);
      },
    );

    it('감사 기록이 실패하면 배너 생성도 롤백된다(같은 트랜잭션)', async () => {
      const auditLogs = service['auditLogs'];
      const spy = jest
        .spyOn(auditLogs, 'createAuditLog')
        .mockRejectedValueOnce(new Error('audit down'));

      await expect(
        service.adminCreateBanner(await admin(), {
          placement: 'HOME_MAIN',
          imageUrl: 'https://i.example/x.png',
        }),
      ).rejects.toThrow('audit down');
      expect(await prisma.banner.count()).toBe(0);
      spy.mockRestore();
    });

    it('빈 문자열 링크 필드는 값 없음으로 보고 통과시킨다', async () => {
      const result = await service.adminCreateBanner(await admin(), {
        placement: 'SEARCH',
        imageUrl: 'https://i.example/x.png',
        linkType: 'NONE',
        linkUrl: '',
        linkProductId: '',
      });
      expect(result.linkType).toBe('NONE');
    });
  });

  describe('adminUpdateBanner', () => {
    it('존재하지 않는 bannerId면 NotFoundException', async () => {
      await expect(
        service.adminUpdateBanner(await admin(), {
          bannerId: '999999',
          title: 'x',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('전달한 필드만 바꾸고 audit(before/after)을 남긴다', async () => {
      const banner = await makeBanner({ placement: 'HOME_MAIN' });

      const result = await service.adminUpdateBanner(await admin(), {
        bannerId: banner.id.toString(),
        title: '새 문구',
        isActive: false,
      });

      expect(result.title).toBe('새 문구');
      expect(result.isActive).toBe(false);
      expect(result.placement).toBe('HOME_MAIN');
      expect(await auditCount(banner.id, 'UPDATE')).toBe(1);
    });

    it('linkType 변경 STORE → NONE이면 이전 링크 필드가 null로 정리된다', async () => {
      const store = await createStore(prisma);
      const banner = await makeBanner({
        link_type: 'STORE',
        link_store_id: store.id,
      });

      const result = await service.adminUpdateBanner(await admin(), {
        bannerId: banner.id.toString(),
        linkType: 'NONE',
      });

      expect(result.linkType).toBe('NONE');
      expect(result.linkStoreId).toBeNull();
    });

    it('linkType 변경 STORE → URL이면 linkUrl만 남는다', async () => {
      const store = await createStore(prisma);
      const banner = await makeBanner({
        link_type: 'STORE',
        link_store_id: store.id,
      });

      const result = await service.adminUpdateBanner(await admin(), {
        bannerId: banner.id.toString(),
        linkType: 'URL',
        linkUrl: 'https://caquick.example/promo',
      });

      expect(result.linkType).toBe('URL');
      expect(result.linkUrl).toBe('https://caquick.example/promo');
      expect(result.linkStoreId).toBeNull();
    });

    it('linkType 변경 NONE → STORE인데 대상 매장이 없으면 NotFoundException', async () => {
      const banner = await makeBanner();

      await expect(
        service.adminUpdateBanner(await admin(), {
          bannerId: banner.id.toString(),
          linkType: 'STORE',
          linkStoreId: '999999',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('병합 결과로 검증한다: 기존 startsAt보다 앞선 endsAt만 보내면 BadRequestException', async () => {
      const banner = await prisma.banner.create({
        data: {
          placement: 'HOME_MAIN',
          image_url: 'https://i.example/b.png',
          starts_at: new Date('2026-10-10T00:00:00Z'),
        },
      });

      await expect(
        service.adminUpdateBanner(await admin(), {
          bannerId: banner.id.toString(),
          endsAt: new Date('2026-10-01T00:00:00Z'),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('병합 결과로 검증한다: 링크 NONE인 배너를 CATEGORY 지면으로만 바꾸면 BadRequestException', async () => {
      const banner = await makeBanner({ placement: 'HOME_MAIN' });

      await expect(
        service.adminUpdateBanner(await admin(), {
          bannerId: banner.id.toString(),
          placement: 'CATEGORY',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('linkType 미변경 + 같은 타입의 링크 필드 부분 수정은 허용된다', async () => {
      const store = await createStore(prisma);
      const other = await createStore(prisma);
      const banner = await makeBanner({
        link_type: 'STORE',
        link_store_id: store.id,
      });

      const result = await service.adminUpdateBanner(await admin(), {
        bannerId: banner.id.toString(),
        linkStoreId: other.id.toString(),
      });

      expect(result.linkStoreId).toBe(other.id.toString());
    });

    it('linkType 미변경 + 무관한 링크 필드를 set하면 BadRequestException', async () => {
      const store = await createStore(prisma);
      const banner = await makeBanner({
        link_type: 'STORE',
        link_store_id: store.id,
      });

      await expect(
        service.adminUpdateBanner(await admin(), {
          bannerId: banner.id.toString(),
          linkProductId: '1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('linkType 미변경 + 필수 링크 값을 null로 지우면 BadRequestException', async () => {
      const store = await createStore(prisma);
      const banner = await makeBanner({
        link_type: 'STORE',
        link_store_id: store.id,
      });

      await expect(
        service.adminUpdateBanner(await admin(), {
          bannerId: banner.id.toString(),
          linkStoreId: null,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('adminDeleteBanner', () => {
    it('존재하지 않으면 NotFoundException', async () => {
      await expect(
        service.adminDeleteBanner(await admin(), BigInt(999_999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('두 관리자가 동시에 삭제해도 감사는 1건이고 한쪽은 NotFoundException', async () => {
      const banner = await makeBanner();
      const [a, b] = [await admin(), await admin()];
      const results = await Promise.allSettled([
        service.adminDeleteBanner(a, banner.id),
        service.adminDeleteBanner(b, banner.id),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      expect(await auditCount(banner.id, 'DELETE')).toBe(1);
    });

    it('soft-delete + audit(BANNER/DELETE), 재삭제는 NotFoundException', async () => {
      const banner = await makeBanner();
      const actor = await admin();

      expect(await service.adminDeleteBanner(actor, banner.id)).toBe(true);

      const row = await prisma.banner.findUnique({ where: { id: banner.id } });
      expect(row!.deleted_at).not.toBeNull();
      expect(await auditCount(banner.id, 'DELETE')).toBe(1);
      await expect(service.adminDeleteBanner(actor, banner.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
