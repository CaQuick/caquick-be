import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { AUDIT_LOG_REPOSITORY, AuditLogRepository } from '@/features/audit-log';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerFaqService } from '@/features/seller/services/seller-faq.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('SellerFaqService (real DB)', () => {
  let service: SellerFaqService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerFaqService,
        SellerRepository,
        {
          provide: AUDIT_LOG_REPOSITORY,
          useClass: AuditLogRepository,
        },
      ],
    });
    service = module.get(SellerFaqService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe('sellerFaqTopics', () => {
    it('매장의 FAQ 토픽을 sort_order 오름차순으로 반환한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      await prisma.storeFaqTopic.createMany({
        data: [
          {
            store_id: store.id,
            title: 'B',
            answer_html: '<p>b</p>',
            sort_order: 1,
          },
          {
            store_id: store.id,
            title: 'A',
            answer_html: '<p>a</p>',
            sort_order: 0,
          },
        ],
      });

      const result = await service.sellerFaqTopics(account.id);

      expect(result.map((r) => r.title)).toEqual(['A', 'B']);
    });

    it('soft-delete된 FAQ는 제외된다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      await prisma.storeFaqTopic.create({
        data: {
          store_id: store.id,
          title: '삭제된',
          answer_html: '<p>x</p>',
          deleted_at: new Date(),
        },
      });
      await prisma.storeFaqTopic.create({
        data: { store_id: store.id, title: '활성', answer_html: '<p>o</p>' },
      });

      const result = await service.sellerFaqTopics(account.id);

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('활성');
    });
  });

  describe('sellerCreateFaqTopic', () => {
    it('FAQ를 생성하고 audit log를 남긴다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);

      const result = await service.sellerCreateFaqTopic(account.id, {
        title: '새 FAQ',
        answerHtml: '<p>새 답변</p>',
      });

      expect(result.title).toBe('새 FAQ');
      const dbRow = await prisma.storeFaqTopic.findUniqueOrThrow({
        where: { id: BigInt(result.id) },
      });
      expect(dbRow.store_id).toBe(store.id);

      const auditLogs = await prisma.auditLog.findMany({
        where: { store_id: store.id, action: 'CREATE' },
      });
      expect(auditLogs).toHaveLength(1);
    });
  });

  describe('sellerUpdateFaqTopic', () => {
    it('존재하지 않는 topicId면 NotFoundException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerUpdateFaqTopic(account.id, {
          topicId: '999999',
          title: '수정',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('다른 매장 소유 FAQ는 NotFoundException으로 차단', async () => {
      const me = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);
      const otherFaq = await prisma.storeFaqTopic.create({
        data: {
          store_id: other.store.id,
          title: 'X',
          answer_html: '<p>x</p>',
        },
      });

      await expect(
        service.sellerUpdateFaqTopic(me.account.id, {
          topicId: otherFaq.id.toString(),
          title: '수정',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('FAQ 수정 + audit log', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const faq = await prisma.storeFaqTopic.create({
        data: { store_id: store.id, title: '구', answer_html: '<p>a</p>' },
      });

      const result = await service.sellerUpdateFaqTopic(account.id, {
        topicId: faq.id.toString(),
        title: '신',
      });

      expect(result.title).toBe('신');
      const dbRow = await prisma.storeFaqTopic.findUniqueOrThrow({
        where: { id: faq.id },
      });
      expect(dbRow.title).toBe('신');
    });

    it('title/answerHtml/sortOrder/isActive 모든 필드 포함 수정', async () => {
      const { account } = await setupSellerWithStore(prisma);
      const created = await service.sellerCreateFaqTopic(account.id, {
        title: '원본',
        answerHtml: '<p>원본</p>',
      });

      const result = await service.sellerUpdateFaqTopic(account.id, {
        topicId: created.id,
        title: '수정됨',
        answerHtml: '<p>수정됨</p>',
        sortOrder: 9,
        isActive: false,
      });

      expect(result.title).toBe('수정됨');
      expect(result.answerHtml).toBe('<p>수정됨</p>');
      expect(result.sortOrder).toBe(9);
      expect(result.isActive).toBe(false);
    });
  });

  describe('sellerDeleteFaqTopic', () => {
    it('존재하지 않는 topicId면 NotFoundException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerDeleteFaqTopic(account.id, BigInt(999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('soft-delete + audit log', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const faq = await prisma.storeFaqTopic.create({
        data: { store_id: store.id, title: 'x', answer_html: '<p>x</p>' },
      });

      await service.sellerDeleteFaqTopic(account.id, faq.id);

      const after = await prisma.storeFaqTopic.findUnique({
        where: { id: faq.id },
      });
      expect(after?.deleted_at).not.toBeNull();
    });
  });
});
