import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminTaxonomyService } from '@/features/admin/services/admin-taxonomy.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createCategory,
  createProduct,
  createTag,
  linkProductCategory,
  linkProductTag,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('AdminTaxonomyService (real DB)', () => {
  let service: AdminTaxonomyService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminTaxonomyService,
        AdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    service = module.get(AdminTaxonomyService);
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

  describe('adminCategories', () => {
    it('type·sortOrder·id 순으로 정렬하고 기본은 활성만, includeInactive면 전부, type 필터 적용', async () => {
      const b = await createCategory(prisma, {
        category_type: 'EVENT',
        name: 'B',
        sort_order: 2,
      });
      const a = await createCategory(prisma, {
        category_type: 'EVENT',
        name: 'A',
        sort_order: 1,
      });
      const inactive = await createCategory(prisma, {
        category_type: 'STYLE',
        name: 'X',
        is_active: false,
      });
      const product = await createProduct(prisma);
      await linkProductCategory(prisma, {
        productId: product.id,
        categoryId: a.id,
      });

      const active = await service.adminCategories(await admin());
      expect(active.map((c) => c.id)).toEqual([
        a.id.toString(),
        b.id.toString(),
      ]);
      expect(active[0].productCount).toBe(1);

      const all = await service.adminCategories(await admin(), {
        includeInactive: true,
      });
      expect(all.map((c) => c.id)).toContain(inactive.id.toString());

      const styleOnly = await service.adminCategories(await admin(), {
        categoryType: 'STYLE',
        includeInactive: true,
      });
      expect(styleOnly.map((c) => c.id)).toEqual([inactive.id.toString()]);
    });
  });

  describe('adminCreateCategory', () => {
    it('생성하고 audit(CATEGORY/CREATE)을 남긴다', async () => {
      const actor = await admin();
      const result = await service.adminCreateCategory(actor, {
        categoryType: 'EVENT',
        name: '  생일  ',
        description: '',
        sortOrder: 5,
      });
      expect(result.name).toBe('생일');
      expect(result.description).toBeNull();
      expect(result.sortOrder).toBe(5);
      expect(result.isActive).toBe(true);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { target_type: 'CATEGORY', target_id: BigInt(result.id) },
      });
      expect(audit.action).toBe('CREATE');
      expect(audit.actor_account_id).toBe(actor);
    });

    it('같은 type의 같은 이름이 활성 상태로 있으면 400, 다른 type이면 허용', async () => {
      await createCategory(prisma, { category_type: 'EVENT', name: '생일' });
      await expect(
        service.adminCreateCategory(await admin(), {
          categoryType: 'EVENT',
          name: '생일',
        }),
      ).rejects.toThrowDomain(400);
      const other = await service.adminCreateCategory(await admin(), {
        categoryType: 'STYLE',
        name: '생일',
      });
      expect(other.categoryType).toBe('STYLE');
    });

    it('삭제된 같은 이름이 있으면 새로 만들지 않고 복구한다(상품 연결은 복구하지 않음)', async () => {
      const old = await createCategory(prisma, {
        category_type: 'EVENT',
        name: '기념일',
      });
      const product = await createProduct(prisma);
      await linkProductCategory(prisma, {
        productId: product.id,
        categoryId: old.id,
      });
      await service.adminDeleteCategory(await admin(), old.id);

      const restored = await service.adminCreateCategory(await admin(), {
        categoryType: 'EVENT',
        name: '기념일',
        sortOrder: 9,
      });

      expect(restored.id).toBe(old.id.toString());
      expect(restored.sortOrder).toBe(9);
      expect(restored.productCount).toBe(0);
      expect(await prisma.category.count({ where: { name: '기념일' } })).toBe(
        1,
      );
    });
  });

  describe('adminUpdateCategory', () => {
    it('전달한 필드만 바꾸고 audit before/after를 남긴다', async () => {
      const category = await createCategory(prisma, {
        name: '옛',
        sort_order: 1,
      });
      const result = await service.adminUpdateCategory(await admin(), {
        categoryId: category.id.toString(),
        name: '새',
        isActive: false,
      });
      expect(result.name).toBe('새');
      expect(result.isActive).toBe(false);
      expect(result.sortOrder).toBe(1);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: {
          target_type: 'CATEGORY',
          target_id: category.id,
          action: 'UPDATE',
        },
      });
      expect(audit.before_json).toMatchObject({ name: '옛', isActive: true });
      expect(audit.after_json).toMatchObject({ name: '새', isActive: false });
    });

    it('이름 충돌이면 400, 없으면 404', async () => {
      await createCategory(prisma, { category_type: 'EVENT', name: '점유' });
      const mine = await createCategory(prisma, {
        category_type: 'EVENT',
        name: '내것',
      });
      await expect(
        service.adminUpdateCategory(await admin(), {
          categoryId: mine.id.toString(),
          name: '점유',
        }),
      ).rejects.toThrowDomain(400);
      await expect(
        service.adminUpdateCategory(await admin(), {
          categoryId: '999999',
          name: 'x',
        }),
      ).rejects.toThrowDomain(404);
    });
  });

  describe('adminDeleteCategory', () => {
    it('soft-delete하고 상품 연결도 끊으며 audit(DELETE)을 남긴다', async () => {
      const category = await createCategory(prisma);
      const product = await createProduct(prisma);
      await linkProductCategory(prisma, {
        productId: product.id,
        categoryId: category.id,
      });

      expect(
        await service.adminDeleteCategory(await admin(), category.id),
      ).toBe(true);

      const row = await prisma.category.findUnique({
        where: { id: category.id },
      });
      expect(row!.deleted_at).not.toBeNull();
      // 루트 READ는 soft-delete 자동 필터가 걸리므로 deleted_at 조건을 명시해 삭제 행을 본다
      const link = await prisma.productCategory.findFirst({
        where: { category_id: category.id, deleted_at: { not: null } },
      });
      expect(link).not.toBeNull();
      expect(
        await prisma.productCategory.count({
          where: { category_id: category.id },
        }),
      ).toBe(0);
      expect(
        await prisma.auditLog.count({
          where: {
            target_type: 'CATEGORY',
            target_id: category.id,
            action: 'DELETE',
          },
        }),
      ).toBe(1);
      await expect(
        service.adminDeleteCategory(await admin(), category.id),
      ).rejects.toThrowDomain(404);
    });
  });

  describe('adminTags', () => {
    it('최신순·keyword·페이지·연결 수', async () => {
      const a = await createTag(prisma, { name: 'alpha' });
      const b = await createTag(prisma, { name: 'beta' });
      const product = await createProduct(prisma);
      await linkProductTag(prisma, { productId: product.id, tagId: a.id });

      const all = await service.adminTags(await admin());
      expect(all.items.map((t) => t.id)).toEqual([
        b.id.toString(),
        a.id.toString(),
      ]);
      expect(all.items[1].productCount).toBe(1);

      const searched = await service.adminTags(await admin(), {
        keyword: 'alp',
      });
      expect(searched.totalCount).toBe(1);

      const page = await service.adminTags(await admin(), { limit: 1 });
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).toBe(b.id.toString());
    });
  });

  describe('adminCreateTag / adminUpdateTag / adminDeleteTag', () => {
    it('생성 → 이름 변경 → 삭제(연결 해제) → 같은 이름 재생성은 복구', async () => {
      const actor = await admin();
      const created = await service.adminCreateTag(actor, { name: '  딸기  ' });
      expect(created.name).toBe('딸기');

      const renamed = await service.adminUpdateTag(actor, {
        tagId: created.id,
        name: '생딸기',
      });
      expect(renamed.name).toBe('생딸기');

      const product = await createProduct(prisma);
      await linkProductTag(prisma, {
        productId: product.id,
        tagId: BigInt(created.id),
      });
      expect(await service.adminDeleteTag(actor, BigInt(created.id))).toBe(
        true,
      );
      const link = await prisma.productTag.findFirst({
        where: { tag_id: BigInt(created.id), deleted_at: { not: null } },
      });
      expect(link).not.toBeNull();

      const restored = await service.adminCreateTag(actor, { name: '생딸기' });
      expect(restored.id).toBe(created.id);
      expect(restored.productCount).toBe(0);
      expect(
        await prisma.auditLog.count({ where: { target_type: 'TAG' } }),
      ).toBe(4);
    });

    it('두 관리자가 동시에 삭제해도 감사는 1건이고 한쪽은 404', async () => {
      const tag = await createTag(prisma, { name: 'race' });
      const [a, b] = [await admin(), await admin()];
      const results = await Promise.allSettled([
        service.adminDeleteTag(a, tag.id),
        service.adminDeleteTag(b, tag.id),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      expect(
        await prisma.auditLog.count({
          where: { target_type: 'TAG', target_id: tag.id },
        }),
      ).toBe(1);
    });

    it('이름 충돌은 400, 없는 태그는 404', async () => {
      await createTag(prisma, { name: 'taken' });
      const mine = await createTag(prisma, { name: 'mine' });
      await expect(
        service.adminCreateTag(await admin(), { name: 'taken' }),
      ).rejects.toThrowDomain(400);
      await expect(
        service.adminUpdateTag(await admin(), {
          tagId: mine.id.toString(),
          name: 'taken',
        }),
      ).rejects.toThrowDomain(400);
      await expect(
        service.adminUpdateTag(await admin(), { tagId: '999999', name: 'x' }),
      ).rejects.toThrowDomain(404);
      await expect(
        service.adminDeleteTag(await admin(), BigInt(999_999)),
      ).rejects.toThrowDomain(404);
    });

    it('감사 기록이 실패하면 생성도 롤백된다(같은 트랜잭션)', async () => {
      const auditLogs = service['auditLogs'];
      const spy = jest
        .spyOn(auditLogs, 'createAuditLog')
        .mockRejectedValueOnce(new Error('audit down'));
      await expect(
        service.adminCreateTag(await admin(), { name: 'ghost' }),
      ).rejects.toThrow('audit down');
      expect(await prisma.tag.count({ where: { name: 'ghost' } })).toBe(0);
      spy.mockRestore();
    });
  });
});
