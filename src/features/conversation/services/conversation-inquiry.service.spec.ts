import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { ConversationRepository } from '@/features/conversation/repositories/conversation.repository';
import { ConversationInquiryService } from '@/features/conversation/services/conversation-inquiry.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('ConversationInquiryService (real DB)', () => {
  let service: ConversationInquiryService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [ConversationInquiryService, ConversationRepository],
    });
    service = module.get(ConversationInquiryService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function setupBuyer(nickname = '김현진') {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: account.id, nickname });
    return account;
  }

  async function createFaq(
    storeId: bigint,
    overrides: {
      title?: string;
      answer_html?: string;
      sort_order?: number;
      is_active?: boolean;
    } = {},
  ) {
    return prisma.storeFaqTopic.create({
      data: {
        store_id: storeId,
        title: overrides.title ?? '케이크 보관 방법',
        answer_html: overrides.answer_html ?? '<p>냉장보관시 최대 3일</p>',
        sort_order: overrides.sort_order ?? 0,
        is_active: overrides.is_active ?? true,
      },
    });
  }

  async function messagesOf(conversationId: bigint) {
    return prisma.storeConversationMessage.findMany({
      where: { conversation_id: conversationId },
      orderBy: { id: 'asc' },
    });
  }

  // ─── storeInquiryContext ───
  describe('storeInquiryContext', () => {
    it('매장 정보·기본 인사말·FAQ 칩·요일별 상담시간을 반환한다', async () => {
      const buyer = await setupBuyer('김현진');
      const store = await createStore(prisma, { store_name: '해즈 케이크' });
      await prisma.storeBusinessHour.createMany({
        data: [
          {
            store_id: store.id,
            day_of_week: 1,
            is_closed: false,
            open_time: new Date('1970-01-01T10:00:00Z'),
            close_time: new Date('1970-01-01T18:00:00Z'),
          },
          { store_id: store.id, day_of_week: 0, is_closed: true },
        ],
      });
      await createFaq(store.id, { title: '날짜 변경', sort_order: 2 });
      await createFaq(store.id, { title: '케이크 보관 방법', sort_order: 1 });
      await createFaq(store.id, { title: '비활성 칩', is_active: false });

      const result = await service.storeInquiryContext(
        buyer.id,
        store.id.toString(),
      );

      expect(result.storeName).toBe('해즈 케이크');
      // 매장 인사말 미설정 → 기본 문구에 닉네임·매장명 치환
      expect(result.greetingMessage).toContain('김현진 고객님');
      expect(result.greetingMessage).toContain('해즈 케이크');
      expect(result.greetingMessage).not.toContain('{nickname}');
      // 활성 FAQ만 sort_order 순으로
      expect(result.faqTopics.map((t) => t.title)).toEqual([
        '케이크 보관 방법',
        '날짜 변경',
      ]);
      // 요일 오름차순 + 휴무일은 시각 null
      expect(result.businessHours).toEqual([
        { dayOfWeek: 0, isClosed: true, openTime: null, closeTime: null },
        {
          dayOfWeek: 1,
          isClosed: false,
          openTime: '10:00',
          closeTime: '18:00',
        },
      ]);
      expect(result.conversationId).toBeNull();
    });

    it('커스텀 인사말 템플릿을 치환해 반환하고, 기존 대화 ID를 채운다', async () => {
      const buyer = await setupBuyer('현진');
      const store = await createStore(prisma, {
        store_name: '달콤 케이크',
        greeting_message: '{storeName}에 오신 {nickname}님 환영!',
      });
      const conv = await prisma.storeConversation.create({
        data: { account_id: buyer.id, store_id: store.id },
      });

      const result = await service.storeInquiryContext(
        buyer.id,
        store.id.toString(),
      );

      expect(result.greetingMessage).toBe('달콤 케이크에 오신 현진님 환영!');
      expect(result.conversationId).toBe(conv.id.toString());
    });

    it('비활성/삭제 매장은 NotFoundException', async () => {
      const buyer = await setupBuyer();
      const inactive = await createStore(prisma, { is_active: false });
      const deleted = await createStore(prisma, { deleted_at: new Date() });

      await expect(
        service.storeInquiryContext(buyer.id, inactive.id.toString()),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.storeInquiryContext(buyer.id, deleted.id.toString()),
      ).rejects.toThrow(NotFoundException);
    });

    it('없는 계정은 Unauthorized, SELLER 계정은 Forbidden', async () => {
      const store = await createStore(prisma);
      const seller = await createAccount(prisma, { account_type: 'SELLER' });

      await expect(
        service.storeInquiryContext(BigInt(999999), store.id.toString()),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.storeInquiryContext(seller.id, store.id.toString()),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── sendConversationMessage ───
  describe('sendConversationMessage', () => {
    it('첫 전송이면 대화를 생성하고 인사말(STORE) → 유저 메시지 순으로 저장한다', async () => {
      const buyer = await setupBuyer('김현진');
      const store = await createStore(prisma, { store_name: '해즈 케이크' });

      const result = await service.sendConversationMessage(buyer.id, {
        storeId: store.id.toString(),
        bodyText: '  픽업 시간 변경 가능한가요?  ',
      });

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].senderType).toBe('STORE');
      expect(result.messages[0].bodyText).toContain('김현진 고객님');
      expect(result.messages[1].senderType).toBe('USER');
      // 앞뒤 공백은 정리해 저장한다
      expect(result.messages[1].bodyText).toBe('픽업 시간 변경 가능한가요?');

      const conversation = await prisma.storeConversation.findFirstOrThrow({
        where: { account_id: buyer.id, store_id: store.id },
      });
      expect(result.conversationId).toBe(conversation.id.toString());
      expect(conversation.last_message_at).not.toBeNull();
      expect(await messagesOf(conversation.id)).toHaveLength(2);
    });

    it('대화가 이미 있으면 인사말 없이 유저 메시지 1건만 저장한다', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma);
      await service.sendConversationMessage(buyer.id, {
        storeId: store.id.toString(),
        bodyText: '첫 메시지',
      });

      const second = await service.sendConversationMessage(buyer.id, {
        storeId: store.id.toString(),
        bodyText: '두 번째 메시지',
      });

      expect(second.messages).toHaveLength(1);
      expect(second.messages[0].senderType).toBe('USER');

      const conversations = await prisma.storeConversation.findMany({
        where: { account_id: buyer.id, store_id: store.id },
      });
      // 계정당 매장당 대화 1개 유지(중복 생성 없음)
      expect(conversations).toHaveLength(1);
      expect(await messagesOf(conversations[0].id)).toHaveLength(3);
    });

    it('soft-delete된 대화가 있으면 유니크 충돌 없이 그 대화를 재사용한다', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma);
      const softDeleted = await prisma.storeConversation.create({
        data: {
          account_id: buyer.id,
          store_id: store.id,
          deleted_at: new Date(),
        },
      });

      const result = await service.sendConversationMessage(buyer.id, {
        storeId: store.id.toString(),
        bodyText: '다시 문의드립니다',
      });

      // 유니크 제약 범위(삭제 포함)와 동일하게 기존 row를 찾아 이어간다
      expect(result.conversationId).toBe(softDeleted.id.toString());
      // 기존 대화 재사용이므로 인사말은 다시 저장하지 않는다
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].senderType).toBe('USER');
      // 재사용 시 복구 — 삭제 상태로 두면 어느 조회에도 잡히지 않는다
      const restored = await prisma.storeConversation.findUniqueOrThrow({
        where: { id: softDeleted.id },
      });
      expect(restored.deleted_at).toBeNull();
    });

    it('공백뿐인 본문·2000자 초과 본문은 거절한다', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma);

      await expect(
        service.sendConversationMessage(buyer.id, {
          storeId: store.id.toString(),
          bodyText: '   ',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.sendConversationMessage(buyer.id, {
          storeId: store.id.toString(),
          bodyText: 'a'.repeat(2001),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('비활성 매장에는 전송할 수 없다', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma, { is_active: false });

      await expect(
        service.sendConversationMessage(buyer.id, {
          storeId: store.id.toString(),
          bodyText: '안녕하세요',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── sendConversationFaqMessage ───
  describe('sendConversationFaqMessage', () => {
    it('첫 전송이면 인사말 → 유저 질문(TEXT) → 자동응답(HTML) 3건을 저장한다', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma);
      const faq = await createFaq(store.id, {
        title: '케이크 보관 방법',
        answer_html: '<p>냉장보관시 최대 3일</p>',
      });

      const result = await service.sendConversationFaqMessage(buyer.id, {
        storeId: store.id.toString(),
        faqTopicId: faq.id.toString(),
      });

      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].senderType).toBe('STORE');
      expect(result.messages[0].bodyFormat).toBe('TEXT');
      expect(result.messages[1]).toMatchObject({
        senderType: 'USER',
        bodyFormat: 'TEXT',
        bodyText: '케이크 보관 방법',
      });
      expect(result.messages[2]).toMatchObject({
        senderType: 'STORE',
        bodyFormat: 'HTML',
        bodyHtml: '<p>냉장보관시 최대 3일</p>',
      });
    });

    it('기존 대화가 있으면 질문+자동응답 2건만 저장한다', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma);
      const faq = await createFaq(store.id);
      await service.sendConversationMessage(buyer.id, {
        storeId: store.id.toString(),
        bodyText: '먼저 보낸 메시지',
      });

      const result = await service.sendConversationFaqMessage(buyer.id, {
        storeId: store.id.toString(),
        faqTopicId: faq.id.toString(),
      });

      expect(result.messages).toHaveLength(2);
      expect(result.messages.map((m) => m.senderType)).toEqual([
        'USER',
        'STORE',
      ]);
    });

    it('비활성 FAQ·다른 매장 FAQ는 NotFoundException', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma);
      const otherStore = await createStore(prisma);
      const inactiveFaq = await createFaq(store.id, { is_active: false });
      const othersFaq = await createFaq(otherStore.id);

      await expect(
        service.sendConversationFaqMessage(buyer.id, {
          storeId: store.id.toString(),
          faqTopicId: inactiveFaq.id.toString(),
        }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.sendConversationFaqMessage(buyer.id, {
          storeId: store.id.toString(),
          faqTopicId: othersFaq.id.toString(),
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
