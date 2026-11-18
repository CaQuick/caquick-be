import { Inject, Injectable, Logger } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { parseId } from '@/common/utils/id-parser';
import { cleanRequiredText } from '@/common/utils/text-cleaner';
import { AccountUserRepository } from '@/features/auth';
import {
  CONVERSATION_IMAGE_ALT_TEXT,
  MAX_INQUIRY_BODY_TEXT_LENGTH,
} from '@/features/conversation/constants/conversation.constants';
import type { SendConversationFaqMessageInput } from '@/features/conversation/dto/inputs/send-conversation-faq-message.input';
import type { SendConversationImageMessageInput } from '@/features/conversation/dto/inputs/send-conversation-image-message.input';
import type { SendConversationMessageInput } from '@/features/conversation/dto/inputs/send-conversation-message.input';
import {
  ConversationRepository,
  type ConversationMessageEntry,
} from '@/features/conversation/repositories/conversation.repository';
import {
  orderCardAltText,
  requireOwnedConversationImageUrl,
} from '@/features/conversation/services/conversation-attachment.helper';
import { ConversationBaseService } from '@/features/conversation/services/conversation-base.service';
import { toLastMessagePreview } from '@/features/conversation/services/conversation-center-mappers.helper';
import { toEventPreview } from '@/features/conversation/services/conversation-events-mappers.helper';
import { ConversationEventsService } from '@/features/conversation/services/conversation-events.service';
import {
  renderGreeting,
  toConversationMessageOutput,
  toInquiryBusinessHour,
} from '@/features/conversation/services/conversation-inquiry-mappers.helper';
import type {
  ConversationMessagesPayload,
  StoreInquiryContextOutput,
} from '@/features/conversation/types/conversation-output.type';
import { OrderInquiryRepository } from '@/features/order';
import { CATALOG_QUERY, type ICatalogQuery } from '@/features/store';
import {
  ConversationBodyFormat,
  ConversationSenderType,
} from '@/generated/prisma/client';
import { S3Service } from '@/global/storage/s3.service';
import type { CreateUploadUrlOutput } from '@/global/storage/types/storage.types';

@Injectable()
export class ConversationInquiryService extends ConversationBaseService {
  private readonly logger = new Logger(ConversationInquiryService.name);

  constructor(
    repo: ConversationRepository,
    accounts: AccountUserRepository,
    private readonly events: ConversationEventsService,
    @Inject(CATALOG_QUERY) private readonly catalog: ICatalogQuery,
    private readonly orders: OrderInquiryRepository,
    private readonly s3: S3Service,
  ) {
    super(repo, accounts);
  }

  async storeInquiryContext(
    accountId: bigint,
    storeIdRaw: string,
  ): Promise<StoreInquiryContextOutput> {
    const { nickname } = await this.requireActiveUser(accountId);
    const storeId = parseId(storeIdRaw);

    const store = await this.requireInquiryStore(accountId, storeId);
    const [faqTopics, conversation] = await Promise.all([
      this.catalog.listActiveFaqTopics(storeId),
      this.repo.findConversationByAccountAndStore({ accountId, storeId }),
    ]);

    return {
      storeId: store.id.toString(),
      storeName: store.store_name,
      profileImageUrl: store.profile_image_url,
      businessHours: store.business_hours.map(toInquiryBusinessHour),
      greetingMessage: renderGreeting(store.greeting_message, {
        nickname,
        storeName: store.store_name,
      }),
      faqTopics: faqTopics.map((t) => ({
        id: t.id.toString(),
        title: t.title,
      })),
      conversationId: conversation?.id.toString() ?? null,
    };
  }

  async sendConversationMessage(
    accountId: bigint,
    input: SendConversationMessageInput,
  ): Promise<ConversationMessagesPayload> {
    const { nickname } = await this.requireActiveUser(accountId);
    const storeId = parseId(input.storeId);
    const store = await this.requireInquiryStore(accountId, storeId);

    const bodyText = cleanRequiredText(
      input.bodyText,
      MAX_INQUIRY_BODY_TEXT_LENGTH,
    );

    return this.saveBuyerMessages({
      accountId,
      storeId,
      nickname,
      storeName: store.store_name,
      greetingTemplate: store.greeting_message,
      entries: [
        {
          senderType: ConversationSenderType.USER,
          senderAccountId: accountId,
          bodyFormat: ConversationBodyFormat.TEXT,
          bodyText,
          bodyHtml: null,
        },
      ],
    });
  }

  async sendConversationFaqMessage(
    accountId: bigint,
    input: SendConversationFaqMessageInput,
  ): Promise<ConversationMessagesPayload> {
    const { nickname } = await this.requireActiveUser(accountId);
    const storeId = parseId(input.storeId);
    const store = await this.requireInquiryStore(accountId, storeId);

    const topic = await this.catalog.findActiveFaqTopic({
      storeId,
      faqTopicId: parseId(input.faqTopicId),
    });
    if (!topic) {
      throw new DomainException('FAQ_TOPIC_NOT_FOUND');
    }

    // 칩 탭 = 유저 질문(칩 제목) + 매장 자동응답(FAQ 답변 스냅샷) 한 쌍 — 이후 FAQ가 수정돼도 대화 이력은 당시 답변을 유지한다.
    return this.saveBuyerMessages({
      accountId,
      storeId,
      nickname,
      storeName: store.store_name,
      greetingTemplate: store.greeting_message,
      entries: [
        {
          senderType: ConversationSenderType.USER,
          senderAccountId: accountId,
          bodyFormat: ConversationBodyFormat.TEXT,
          bodyText: topic.title,
          bodyHtml: null,
        },
        {
          senderType: ConversationSenderType.STORE,
          senderAccountId: null,
          bodyFormat: ConversationBodyFormat.HTML,
          bodyText: null,
          bodyHtml: topic.answer_html,
        },
      ],
    });
  }

  async createConversationImageUploadUrl(
    accountId: bigint,
    input: { contentType: string; contentLength: number },
  ): Promise<CreateUploadUrlOutput> {
    await this.requireActiveUser(accountId);
    return this.s3.createUploadUrl({
      accountId,
      purpose: 'CONVERSATION_IMAGE',
      contentType: input.contentType,
      contentLength: input.contentLength,
    });
  }

  async sendConversationImageMessage(
    accountId: bigint,
    input: SendConversationImageMessageInput,
  ): Promise<ConversationMessagesPayload> {
    const { nickname } = await this.requireActiveUser(accountId);
    const storeId = parseId(input.storeId);
    const store = await this.requireInquiryStore(accountId, storeId);
    const imageUrl = requireOwnedConversationImageUrl(
      this.s3,
      input.imageUrl,
      accountId,
    );

    return this.saveBuyerMessages({
      accountId,
      storeId,
      nickname,
      storeName: store.store_name,
      greetingTemplate: store.greeting_message,
      entries: [
        {
          senderType: ConversationSenderType.USER,
          senderAccountId: accountId,
          bodyFormat: ConversationBodyFormat.IMAGE,
          bodyText: CONVERSATION_IMAGE_ALT_TEXT,
          bodyHtml: null,
          imageUrl,
        },
      ],
    });
  }

  /** 판매자가 볼 수 없는 입금 전 주문은 카드로 보낼 수 없다. 카드는 보낸 시점 값으로 남는다. */
  async sendConversationOrderCard(
    accountId: bigint,
    orderIdRaw: string,
  ): Promise<ConversationMessagesPayload> {
    const { nickname } = await this.requireActiveUser(accountId);
    const source = await this.orders.findOrderCardSource({
      orderId: parseId(orderIdRaw),
      accountId,
    });
    if (!source) throw new DomainException('ORDER_NOT_FOUND');
    if (source.submittedAt === null) {
      throw new DomainException('ORDER_INQUIRY_NOT_AVAILABLE');
    }
    const store = await this.requireInquiryStore(accountId, source.storeId);

    return this.saveBuyerMessages({
      accountId,
      storeId: source.storeId,
      nickname,
      storeName: store.store_name,
      greetingTemplate: store.greeting_message,
      entries: [
        {
          senderType: ConversationSenderType.USER,
          senderAccountId: accountId,
          bodyFormat: ConversationBodyFormat.ORDER_CARD,
          bodyText: orderCardAltText(source),
          bodyHtml: null,
          orderCard: {
            orderId: source.orderId,
            orderNumber: source.orderNumber,
            productName: source.productName,
            thumbnailUrl: source.thumbnailUrl,
            pickupAt: source.pickupAt,
          },
        },
      ],
    });
  }

  private async saveBuyerMessages(args: {
    accountId: bigint;
    storeId: bigint;
    nickname: string;
    storeName: string;
    greetingTemplate: string | null;
    entries: ConversationMessageEntry[];
  }): Promise<ConversationMessagesPayload> {
    const result = await this.repo.createBuyerMessages({
      accountId: args.accountId,
      storeId: args.storeId,
      // 닉네임 스냅샷·인사말(치환 완료본)은 첫 전송으로 대화가 생성될 때만 repository가 사용한다
      buyerNickname: args.nickname,
      greetingBodyText: renderGreeting(args.greetingTemplate, {
        nickname: args.nickname,
        storeName: args.storeName,
      }),
      entries: args.entries,
    });

    const messages = result.messages.map(toConversationMessageOutput);
    await this.publishBuyerSendEvents({
      accountId: args.accountId,
      storeId: args.storeId,
      storeName: args.storeName,
      conversationId: result.conversationId,
      messages,
    });

    return {
      conversationId: result.conversationId.toString(),
      messages,
    };
  }

  /** 저장 트랜잭션 밖의 부수효과라 실패해도 전송 자체는 성공으로 남는다(구독자는 폴백 재조회 가능). */
  private async publishBuyerSendEvents(args: {
    accountId: bigint;
    storeId: bigint;
    storeName: string;
    conversationId: bigint;
    messages: ConversationMessagesPayload['messages'];
  }): Promise<void> {
    // 커밋 이후의 부수효과 전체(스냅샷 조회 포함)를 격리한다 — 여기서 나는 예외가 mutation을 실패로
    // 둔갑시키면 클라이언트 재시도로 중복 전송이 난다. 실패는 경고 로그만 남긴다.
    try {
      await this.doPublishBuyerSendEvents(args);
    } catch (e) {
      this.logger.warn(
        `대화 이벤트 발행 실패 (conversationId=${args.conversationId}): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  private async doPublishBuyerSendEvents(args: {
    accountId: bigint;
    storeId: bigint;
    storeName: string;
    conversationId: bigint;
    messages: ConversationMessagesPayload['messages'];
  }): Promise<void> {
    const lastMessage = args.messages[args.messages.length - 1];
    if (!lastMessage) return;

    // 목록 이벤트는 "발행 시점의 최신 커밋 상태"를 단일 트랜잭션 스냅샷으로 다시 읽어 조립한다 — 독립 조회로
    // 쪼개면 경쟁 커밋이 끼어들어 혼합 상태(남의 미리보기 + 내 시각)가 나갈 수 있다. 메시지 스트림 이벤트는 id를 실어 구독자가 정렬한다.
    const snapshot = await this.repo.getConversationEventSnapshot(
      args.conversationId,
    );

    const preview = snapshot
      ? toLastMessagePreview(snapshot.lastMessage)
      : toEventPreview(lastMessage);
    const lastMessageAtIso = (
      snapshot?.conversation.last_message_at ?? lastMessage.createdAt
    ).toISOString();
    const lastReadAtIso =
      snapshot?.conversation.last_read_at?.toISOString() ?? null;
    const unreadCount = snapshot?.unreadCount ?? 0;
    // 매장명도 스냅샷 값을 우선한다 — 최초 조회 후 개명되면 최신 메시지 상태에 옛 이름이 실려 나갈 수 있다
    const storeName = snapshot?.conversation.store.store_name ?? args.storeName;

    await this.events.publishMessagesAdded(args.messages);
    await this.events.publishBuyerListUpdate(args.accountId.toString(), {
      conversationId: args.conversationId.toString(),
      storeId: args.storeId.toString(),
      storeName,
      lastMessagePreview: preview,
      lastMessageAt: lastMessageAtIso,
      lastReadAt: lastReadAtIso,
      unreadCount,
    });
    await this.events.publishSellerListUpdate(args.storeId.toString(), {
      conversationId: args.conversationId.toString(),
      accountId: args.accountId.toString(),
      buyerNickname: snapshot?.conversation.buyer_nickname_snapshot ?? null,
      lastMessagePreview: preview,
      lastMessageAt: lastMessageAtIso,
      sellerLastReadAt:
        snapshot?.conversation.seller_last_read_at?.toISOString() ?? null,
      unreadCount: snapshot?.sellerUnreadCount ?? 0,
    });
  }

  /** 숨김 매장은 진행 중인 주문이 있는 구매자만 문의할 수 있다(판매자 정지·매장 숨김 뒤에도 주문 문의 경로를 남긴다). */
  private async requireInquiryStore(accountId: bigint, storeId: bigint) {
    const store = await this.catalog.findInquiryStore(storeId);
    if (
      !store ||
      (!store.is_active &&
        !(await this.orders.existsInProgressOrderAtStore({
          accountId,
          storeId,
        })))
    ) {
      throw new DomainException('STORE_NOT_FOUND');
    }
    return store;
  }
}
