import { PubSub } from 'graphql-subscriptions';

import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountUserRepository } from '@/features/auth';
import {
  CONVERSATION_BUYER_MESSAGE_SENT,
  parseConversationBuyerMessageSentPayload,
} from '@/features/conversation/events/conversation-buyer-message-sent.event';
import { ConversationRepository } from '@/features/conversation/repositories/conversation.repository';
import { ConversationEventsService } from '@/features/conversation/services/conversation-events.service';
import { ConversationInquiryService } from '@/features/conversation/services/conversation-inquiry.service';
import { OrderInquiryRepository } from '@/features/order';
import { CATALOG_QUERY } from '@/features/store';
import { StoreCatalogQueryRepository } from '@/features/store/repositories/store-catalog-query.repository';
import type { OrderStatus, PrismaClient } from '@/generated/prisma/client';
import { PUB_SUB } from '@/global/pubsub';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { outboxPublisherProviders } from '@/test/outbox';
import {
  FOREIGN_UPLOAD_URL,
  ownedUploadUrl,
  s3TestProviders,
  TEST_S3_CONFIG,
} from '@/test/storage/s3-test.helper';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://mock-presigned-url.com'),
}));

describe('ConversationInquiryService (real DB)', () => {
  let service: ConversationInquiryService;
  let events: ConversationEventsService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        ConversationInquiryService,
        ConversationRepository,
        // 발행 repository가 OutboxPublisher를 주입받는다
        ...outboxPublisherProviders(),
        ConversationEventsService,
        OrderInquiryRepository,
        ...s3TestProviders(),
        AccountUserRepository,
        { provide: CATALOG_QUERY, useClass: StoreCatalogQueryRepository },
        // 발행 경로 실검증은 events service spec(실 Redis) 담당 — 여기선 in-memory
        { provide: PUB_SUB, useValue: new PubSub() },
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    service = module.get(ConversationInquiryService);
    events = module.get(ConversationEventsService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  /** DB 시계(NOW(3)). 테스트 컨테이너는 TZ 미설정(UTC)이라 Prisma의 UTC DATETIME 매핑과 일치한다. */
  async function fetchDbNow(): Promise<Date> {
    const rows = await prisma.$queryRaw<{ now: Date }[]>`SELECT NOW(3) AS now`;
    return rows[0].now;
  }

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
      ).rejects.toThrowDomain(404);
      await expect(
        service.storeInquiryContext(buyer.id, deleted.id.toString()),
      ).rejects.toThrowDomain(404);
    });

    it('없는 계정은 Unauthorized, SELLER 계정은 Forbidden', async () => {
      const store = await createStore(prisma);
      const seller = await createAccount(prisma, { account_type: 'SELLER' });

      await expect(
        service.storeInquiryContext(BigInt(999999), store.id.toString()),
      ).rejects.toThrowDomain(401);
      await expect(
        service.storeInquiryContext(seller.id, store.id.toString()),
      ).rejects.toThrowDomain(403);
    });
  });

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
      // 응답으로 인사말까지 즉시 표시되므로 여기까지 읽음 처리돼야 한다
      expect(conversation.last_read_at?.getTime()).toBe(
        conversation.last_message_at?.getTime(),
      );
      expect(await messagesOf(conversation.id)).toHaveLength(2);
    });

    it('첫 전송 시점 닉네임을 스냅샷으로 저장하고, 이후 닉네임이 바뀌어도 유지한다', async () => {
      const buyer = await setupBuyer('첫닉네임');
      const store = await createStore(prisma);

      await service.sendConversationMessage(buyer.id, {
        storeId: store.id.toString(),
        bodyText: '첫 문의',
      });
      await prisma.userProfile.update({
        where: { account_id: buyer.id },
        data: { nickname: '바뀐닉네임' },
      });
      await service.sendConversationMessage(buyer.id, {
        storeId: store.id.toString(),
        bodyText: '두 번째 문의',
      });

      const conversation = await prisma.storeConversation.findFirstOrThrow({
        where: { account_id: buyer.id, store_id: store.id },
      });
      expect(conversation.buyer_nickname_snapshot).toBe('첫닉네임');
    });

    it('판매자 이벤트에 닉네임 스냅샷과 판매자 기준 미읽음 수(USER만)를 싣는다', async () => {
      const buyer = await setupBuyer('현진');
      const store = await createStore(prisma);
      const publishSeller = jest.spyOn(events, 'publishSellerListUpdate');

      const result = await service.sendConversationMessage(buyer.id, {
        storeId: store.id.toString(),
        bodyText: '픽업 문의',
      });

      // 인사말(STORE)은 판매자 미읽음에 안 센다
      expect(publishSeller).toHaveBeenCalledWith(store.id.toString(), {
        conversationId: result.conversationId,
        accountId: buyer.id.toString(),
        buyerNickname: '현진',
        lastMessagePreview: '픽업 문의',
        lastMessageAt: result.messages[1].createdAt.toISOString(),
        sellerLastReadAt: null,
        unreadCount: 1,
      });
      publishSeller.mockRestore();
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

    it('미읽음 판매자 답장이 있는 대화에 전송해도 읽음 마커를 전진시키지 않는다', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma);
      await service.sendConversationMessage(buyer.id, {
        storeId: store.id.toString(),
        bodyText: '첫 문의',
      });
      const conversation = await prisma.storeConversation.findFirstOrThrow({
        where: { account_id: buyer.id, store_id: store.id },
      });
      // 판매자 답장(미읽음) 도착 재현. 마커 판정은 DB NOW(3) 기준이라 호스트 시계로 심으면
      // (DB − 호스트) ≥ 1s인 환경에서 답장이 마커보다 과거가 되어 케이스가 무너진다 → DB 시계 기준.
      const dbNow = await fetchDbNow();
      await prisma.storeConversationMessage.create({
        data: {
          conversation_id: conversation.id,
          sender_type: 'STORE',
          body_format: 'TEXT',
          body_text: '아직 안 읽은 답장',
          created_at: new Date(dbNow.getTime() + 1000),
        },
      });
      const markerBefore = conversation.last_read_at;

      await service.sendConversationMessage(buyer.id, {
        storeId: store.id.toString(),
        bodyText: '추가 문의',
      });

      // 백로그가 있으면 마커 유지 — 안 본 답장이 읽음 처리되면 안 된다
      const after = await prisma.storeConversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      expect(after.last_read_at?.getTime()).toBe(markerBefore?.getTime());
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
      // 인사말 여부는 "메시지 0건" 기준 — 빈 대화 재사용이면 인사말부터 저장한다
      expect(result.messages).toHaveLength(2);
      expect(result.messages.map((m) => m.senderType)).toEqual([
        'STORE',
        'USER',
      ]);
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
      ).rejects.toThrowDomain(400);
      await expect(
        service.sendConversationMessage(buyer.id, {
          storeId: store.id.toString(),
          bodyText: 'a'.repeat(2001),
        }),
      ).rejects.toThrowDomain(400);
    });

    it('비활성 매장에는 전송할 수 없다', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma, { is_active: false });

      await expect(
        service.sendConversationMessage(buyer.id, {
          storeId: store.id.toString(),
          bodyText: '안녕하세요',
        }),
      ).rejects.toThrowDomain(404);
    });
  });

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
      ).rejects.toThrowDomain(404);
      await expect(
        service.sendConversationFaqMessage(buyer.id, {
          storeId: store.id.toString(),
          faqTopicId: othersFaq.id.toString(),
        }),
      ).rejects.toThrowDomain(404);
    });
  });

  describe('구매자 메시지 이벤트(conversation.buyer_message_sent)', () => {
    it('텍스트 전송은 USER 메시지 기준 1건을 남긴다(인사말 제외, 본문은 정리본)', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma);

      const result = await service.sendConversationMessage(buyer.id, {
        storeId: store.id.toString(),
        bodyText: '  픽업 시간 변경 가능한가요?  ',
      });

      const events = await prisma.outbox.findMany();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event_type: CONVERSATION_BUYER_MESSAGE_SENT,
        aggregate_id: result.conversationId,
        actor_account_id: buyer.id,
      });
      expect(
        parseConversationBuyerMessageSentPayload(events[0].payload_json),
      ).toEqual({
        conversationId: result.conversationId,
        storeId: store.id.toString(),
        buyerAccountId: buyer.id.toString(),
        messageId: result.messages[1].id,
        preview: '픽업 시간 변경 가능한가요?',
        messageCreatedAt: result.messages[1].createdAt.toISOString(),
      });
    });

    it('FAQ 칩은 자동응답을 빼고 USER 질문 기준 1건을 남긴다', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma);
      const faq = await createFaq(store.id, { title: '케이크 보관 방법' });

      const result = await service.sendConversationFaqMessage(buyer.id, {
        storeId: store.id.toString(),
        faqTopicId: faq.id.toString(),
      });

      const events = await prisma.outbox.findMany();
      expect(events).toHaveLength(1);
      expect(
        parseConversationBuyerMessageSentPayload(events[0].payload_json),
      ).toMatchObject({
        messageId: result.messages[1].id,
        preview: '케이크 보관 방법',
      });
    });
  });

  /** 매장의 상품 1개짜리 주문. 주문 1건 = 상품 1개 = 매장 1곳. */
  async function orderAt(
    accountId: bigint,
    storeId: bigint,
    overrides: {
      status?: OrderStatus;
      submitted_at?: Date | null;
      product_name_snapshot?: string;
      product_thumbnail_url_snapshot?: string | null;
      custom_preview_image_url?: string | null;
    } = {},
  ) {
    const { status, submitted_at, ...item } = overrides;
    const order = await createOrder(prisma, {
      account_id: accountId,
      ...(status ? { status } : {}),
      ...(submitted_at !== undefined ? { submitted_at } : {}),
    });
    await createOrderItem(prisma, {
      order_id: order.id,
      store_id: storeId,
      ...item,
    });
    return order;
  }

  describe('숨김 매장 문의(그 매장에 진행 중인 주문이 있는 구매자만)', () => {
    it('진행 중인 주문이 있으면 문의 컨텍스트 조회·텍스트·FAQ 전송을 허용한다', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma, { is_active: false });
      const faq = await createFaq(store.id);
      await orderAt(buyer.id, store.id, { status: 'CONFIRMED' });

      await expect(
        service.storeInquiryContext(buyer.id, store.id.toString()),
      ).resolves.toMatchObject({ storeId: store.id.toString() });
      await service.sendConversationMessage(buyer.id, {
        storeId: store.id.toString(),
        bodyText: '정지됐다는데 케이크는 받을 수 있나요?',
      });
      const faqResult = await service.sendConversationFaqMessage(buyer.id, {
        storeId: store.id.toString(),
        faqTopicId: faq.id.toString(),
      });
      expect(faqResult.messages).toHaveLength(2);
    });

    it.each([
      ['끝난 주문만 있음', 'PICKED_UP'],
      ['취소된 주문만 있음', 'CANCELED'],
    ] as const)('%s이면 STORE_NOT_FOUND', async (_label, status) => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma, { is_active: false });
      await orderAt(buyer.id, store.id, { status });

      await expect(
        service.storeInquiryContext(buyer.id, store.id.toString()),
      ).rejects.toThrowDomain('STORE_NOT_FOUND');
      await expect(
        service.sendConversationMessage(buyer.id, {
          storeId: store.id.toString(),
          bodyText: '문의',
        }),
      ).rejects.toThrowDomain('STORE_NOT_FOUND');
    });

    it('다른 구매자·다른 매장의 진행 주문은 허용 근거가 아니고, 삭제된 매장은 진행 주문이 있어도 거절한다', async () => {
      const buyer = await setupBuyer();
      const other = await setupBuyer('다른 구매자');
      const hidden = await createStore(prisma, { is_active: false });
      const elsewhere = await createStore(prisma);
      const deleted = await createStore(prisma, { deleted_at: new Date() });
      await orderAt(other.id, hidden.id, { status: 'SUBMITTED' });
      await orderAt(buyer.id, elsewhere.id, { status: 'SUBMITTED' });
      await orderAt(buyer.id, deleted.id, { status: 'SUBMITTED' });

      for (const store of [hidden, deleted]) {
        await expect(
          service.storeInquiryContext(buyer.id, store.id.toString()),
        ).rejects.toThrowDomain('STORE_NOT_FOUND');
      }
    });
  });

  describe('createConversationImageUploadUrl', () => {
    it('conversation-images/{accountId}/ 아래로 10MB까지 발급한다', async () => {
      const buyer = await setupBuyer();

      const result = await service.createConversationImageUploadUrl(buyer.id, {
        contentType: 'image/png',
        contentLength: 10 * 1024 * 1024,
      });

      expect(result.key).toMatch(
        new RegExp(
          `^conversation-images/${buyer.id}/\\d{4}-\\d{2}-\\d{2}/[a-f0-9-]+\\.png$`,
        ),
      );
      expect(result.publicUrl).toBe(
        `https://${TEST_S3_CONFIG.bucket}.s3.${TEST_S3_CONFIG.region}.amazonaws.com/${result.key}`,
      );
    });

    it.each([
      ['10MB 초과', 'image/png', 10 * 1024 * 1024 + 1, 'FILE_TOO_LARGE'],
      ['0바이트', 'image/png', 0, 'INVALID_CONTENT_LENGTH'],
      ['이미지가 아닌 형식', 'video/mp4', 1, 'INVALID_CONTENT_TYPE'],
    ] as const)('%s는 %s', async (_label, contentType, contentLength, code) => {
      const buyer = await setupBuyer();
      await expect(
        service.createConversationImageUploadUrl(buyer.id, {
          contentType,
          contentLength,
        }),
      ).rejects.toThrowDomain(code);
    });

    it('구매자 계정이 아니면 USER_ONLY', async () => {
      const seller = await createAccount(prisma, { account_type: 'SELLER' });
      await expect(
        service.createConversationImageUploadUrl(seller.id, {
          contentType: 'image/png',
          contentLength: 1,
        }),
      ).rejects.toThrowDomain('USER_ONLY');
    });
  });

  describe('sendConversationImageMessage', () => {
    it('첫 전송이면 인사말 → 이미지 메시지를 저장하고 본문·푸시 미리보기는 대체 문구다', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma);
      const imageUrl = ownedUploadUrl('CONVERSATION_IMAGE', buyer.id);

      const result = await service.sendConversationImageMessage(buyer.id, {
        storeId: store.id.toString(),
        imageUrl,
      });

      expect(result.messages.map((m) => m.bodyFormat)).toEqual([
        'TEXT',
        'IMAGE',
      ]);
      expect(result.messages[1]).toMatchObject({
        senderType: 'USER',
        bodyText: '사진을 보냈습니다.',
        bodyHtml: null,
        imageUrl,
        orderCard: null,
      });
      const rows = await messagesOf(BigInt(result.conversationId));
      expect(rows[1]).toMatchObject({
        body_format: 'IMAGE',
        image_url: imageUrl,
      });
      const [event] = await prisma.outbox.findMany();
      expect(
        parseConversationBuyerMessageSentPayload(event.payload_json).preview,
      ).toBe('사진을 보냈습니다.');
    });

    const HOST = `${TEST_S3_CONFIG.bucket}.s3.${TEST_S3_CONFIG.region}.amazonaws.com`;
    it.each([
      [
        '다른 계정 경로',
        (_me: bigint, other: bigint) =>
          ownedUploadUrl('CONVERSATION_IMAGE', other),
      ],
      ['다른 용도 경로', (me: bigint) => ownedUploadUrl('REVIEW_IMAGE', me)],
      [
        '인코딩된 dot(%2e) 우회',
        (me: bigint, other: bigint) =>
          `https://${HOST}/conversation-images/${me}/%2e%2e/${other}/a.jpg`,
      ],
      ['외부 URL', () => FOREIGN_UPLOAD_URL],
      [
        '2048자 초과',
        (me: bigint) =>
          ownedUploadUrl('CONVERSATION_IMAGE', me, `${'a'.repeat(2048)}.jpg`),
      ],
    ])('%s는 INVALID_IMAGE_URL', async (_label, urlOf) => {
      const buyer = await setupBuyer();
      const other = await setupBuyer('다른 구매자');
      const store = await createStore(prisma);

      await expect(
        service.sendConversationImageMessage(buyer.id, {
          storeId: store.id.toString(),
          imageUrl: urlOf(buyer.id, other.id),
        }),
      ).rejects.toThrowDomain('INVALID_IMAGE_URL');
      expect(await prisma.storeConversationMessage.count()).toBe(0);
    });

    it('공백 URL은 IMAGE_URL_REQUIRED', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma);
      await expect(
        service.sendConversationImageMessage(buyer.id, {
          storeId: store.id.toString(),
          imageUrl: '   ',
        }),
      ).rejects.toThrowDomain('IMAGE_URL_REQUIRED');
    });
  });

  describe('sendConversationOrderCard', () => {
    it('주문 매장 대화에 보낸 시점 카드(커스텀 대표 이미지 우선)와 대체 문구를 저장한다', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma);
      const order = await orderAt(buyer.id, store.id, {
        status: 'SUBMITTED',
        product_name_snapshot: '딸기 케이크',
        product_thumbnail_url_snapshot: 'https://cdn.example.com/product.jpg',
        custom_preview_image_url: 'https://cdn.example.com/custom.jpg',
      });
      const altText = `주문 문의: 딸기 케이크 (${order.order_number})`;

      const result = await service.sendConversationOrderCard(
        buyer.id,
        order.id.toString(),
      );

      const conversation = await prisma.storeConversation.findFirstOrThrow({
        where: { account_id: buyer.id },
      });
      expect(conversation.store_id).toBe(store.id);
      expect(result.messages[1]).toMatchObject({
        senderType: 'USER',
        bodyFormat: 'ORDER_CARD',
        bodyText: altText,
        imageUrl: null,
        orderCard: {
          orderId: order.id.toString(),
          orderNumber: order.order_number,
          productName: '딸기 케이크',
          thumbnailUrl: 'https://cdn.example.com/custom.jpg',
          pickupAt: order.pickup_at,
        },
      });
      const [event] = await prisma.outbox.findMany();
      expect(
        parseConversationBuyerMessageSentPayload(event.payload_json).preview,
      ).toBe(altText);
    });

    it('입금 확인 뒤 취소된 주문도 판매자가 볼 수 있어 보낼 수 있다', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma);
      const order = await orderAt(buyer.id, store.id, {
        status: 'CANCELED',
        submitted_at: new Date(),
      });

      const result = await service.sendConversationOrderCard(
        buyer.id,
        order.id.toString(),
      );
      expect(result.messages.at(-1)?.bodyFormat).toBe('ORDER_CARD');
    });

    it('다른 구매자의 주문·삭제된 주문·없는 주문은 ORDER_NOT_FOUND', async () => {
      const buyer = await setupBuyer();
      const other = await setupBuyer('다른 구매자');
      const store = await createStore(prisma);
      const others = await orderAt(other.id, store.id);
      const deleted = await orderAt(buyer.id, store.id);
      await prisma.order.update({
        where: { id: deleted.id },
        data: { deleted_at: new Date() },
      });

      for (const id of [others.id.toString(), deleted.id.toString(), '0']) {
        await expect(
          service.sendConversationOrderCard(buyer.id, id),
        ).rejects.toThrowDomain('ORDER_NOT_FOUND');
      }
    });

    it.each([
      ['입금 대기', 'PENDING_PAYMENT'],
      ['입금 전 취소', 'CANCELED'],
    ] as const)(
      '%s 주문(입금 확인 전)은 ORDER_INQUIRY_NOT_AVAILABLE',
      async (_label, status) => {
        const buyer = await setupBuyer();
        const store = await createStore(prisma);
        const order = await orderAt(buyer.id, store.id, {
          status,
          submitted_at: null,
        });

        await expect(
          service.sendConversationOrderCard(buyer.id, order.id.toString()),
        ).rejects.toThrowDomain('ORDER_INQUIRY_NOT_AVAILABLE');
        expect(await prisma.storeConversationMessage.count()).toBe(0);
      },
    );

    it('숨김 매장은 카드 주문이 진행 중이면 보내고, 끝난 주문이면 STORE_NOT_FOUND', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma, { is_active: false });
      const made = await orderAt(buyer.id, store.id, { status: 'MADE' });
      const pickedUp = await orderAt(buyer.id, store.id, {
        status: 'PICKED_UP',
      });

      await expect(
        service.sendConversationOrderCard(buyer.id, pickedUp.id.toString()),
      ).resolves.toMatchObject({ messages: expect.any(Array) });

      await prisma.order.update({
        where: { id: made.id },
        data: { status: 'PICKED_UP' },
      });
      await expect(
        service.sendConversationOrderCard(buyer.id, pickedUp.id.toString()),
      ).rejects.toThrowDomain('STORE_NOT_FOUND');
    });
  });
});
