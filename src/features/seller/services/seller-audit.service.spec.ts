import { BadRequestException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';

import { AUDIT_LOG_REPOSITORY, AuditLogRepository } from '@/features/audit-log';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerAuditService } from '@/features/seller/services/seller-audit.service';
import { SellerFaqService } from '@/features/seller/services/seller-faq.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('SellerAuditService (real DB)', () => {
  let service: SellerAuditService;
  let faqService: SellerFaqService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerAuditService,
        SellerFaqService,
        SellerRepository,
        {
          provide: AUDIT_LOG_REPOSITORY,
          useClass: AuditLogRepository,
        },
      ],
    });
    service = module.get(SellerAuditService);
    faqService = module.get(SellerFaqService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe('sellerAuditLogs', () => {
    it('판매자 컨텍스트의 audit log를 cursor 페이지네이션으로 반환한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      // FAQ 생성 → audit log 1건 자동 생성
      await faqService.sellerCreateFaqTopic(account.id, {
        title: 'F',
        answerHtml: '<p>x</p>',
      });

      const result = await service.sellerAuditLogs(account.id);
      expect(result.items.length).toBeGreaterThanOrEqual(1);
      expect(result.items[0].storeId).toBe(store.id.toString());
    });

    it('targetType 필터링이 동작한다', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await faqService.sellerCreateFaqTopic(account.id, {
        title: 'F',
        answerHtml: '<p>x</p>',
      });

      const filtered = await service.sellerAuditLogs(account.id, {
        targetType: 'STORE',
      });
      expect(filtered.items.every((it) => it.targetType === 'STORE')).toBe(
        true,
      );
    });

    it('잘못된 targetType이면 BadRequestException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerAuditLogs(account.id, {
          targetType: 'INVALID' as never,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('cursor 기반 페이지네이션으로 두 번째 페이지를 반환한다', async () => {
      const { account } = await setupSellerWithStore(prisma);
      for (let i = 0; i < 3; i++) {
        await faqService.sellerCreateFaqTopic(account.id, {
          title: `F${i}`,
          answerHtml: `<p>${i}</p>`,
        });
      }

      const first = await service.sellerAuditLogs(account.id, { limit: 2 });
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();

      const second = await service.sellerAuditLogs(account.id, {
        limit: 2,
        cursor: first.nextCursor as string,
      });
      expect(second.items.length).toBeGreaterThanOrEqual(1);
    });

    it('audit targetType ORDER/CONVERSATION/CHANGE_PASSWORD가 enum으로 정확히 매핑되어 필터된다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);

      const types = ['ORDER', 'CONVERSATION', 'CHANGE_PASSWORD'] as const;
      const created = new Map<string, bigint>();
      for (const t of types) {
        const row = await prisma.auditLog.create({
          data: {
            actor_account_id: account.id,
            store_id: store.id,
            target_type: t,
            target_id: store.id,
            action: 'UPDATE',
          },
        });
        created.set(t, row.id);
      }

      for (const t of types) {
        const r = await service.sellerAuditLogs(account.id, { targetType: t });
        expect(r.items.length).toBeGreaterThan(0);
        expect(r.items.every((it) => it.targetType === t)).toBe(true);
        expect(r.items.some((it) => it.id === created.get(t)!.toString())).toBe(
          true,
        );
      }
    });

    it('before/after json이 null인 audit log도 정상 직렬화된다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const created = await prisma.auditLog.create({
        data: {
          actor_account_id: account.id,
          store_id: store.id,
          target_type: 'STORE',
          target_id: store.id,
          action: 'UPDATE',
          before_json: Prisma.JsonNull,
          after_json: Prisma.JsonNull,
        },
      });

      const result = await service.sellerAuditLogs(account.id);
      const target = result.items.find((it) => it.id === created.id.toString());
      expect(target).toBeDefined();
      expect(target!.beforeJson).toBeNull();
      expect(target!.afterJson).toBeNull();
    });
  });
});
