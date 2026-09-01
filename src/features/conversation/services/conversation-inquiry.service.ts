import { Injectable, NotFoundException } from '@nestjs/common';
import { ConversationBodyFormat, ConversationSenderType } from '@prisma/client';

import { parseId } from '@/common/utils/id-parser';
import { cleanRequiredText } from '@/common/utils/text-cleaner';
import { CONVERSATION_ERRORS } from '@/features/conversation/constants/conversation-error-messages';
import { MAX_INQUIRY_BODY_TEXT_LENGTH } from '@/features/conversation/constants/conversation.constants';
import type { SendConversationFaqMessageInput } from '@/features/conversation/dto/inputs/send-conversation-faq-message.input';
import type { SendConversationMessageInput } from '@/features/conversation/dto/inputs/send-conversation-message.input';
import {
  ConversationRepository,
  type ConversationMessageEntry,
} from '@/features/conversation/repositories/conversation.repository';
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

@Injectable()
export class ConversationInquiryService extends ConversationBaseService {
  constructor(
    repo: ConversationRepository,
    private readonly events: ConversationEventsService,
  ) {
    super(repo);
  }

  async storeInquiryContext(
    accountId: bigint,
    storeIdRaw: string,
  ): Promise<StoreInquiryContextOutput> {
    const { nickname } = await this.requireActiveUser(accountId);
    const storeId = parseId(storeIdRaw);

    const store = await this.requireInquiryStore(storeId);
    const [faqTopics, conversation] = await Promise.all([
      this.repo.listActiveFaqTopics(storeId),
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
    const store = await this.requireInquiryStore(storeId);

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
    const store = await this.requireInquiryStore(storeId);

    const topic = await this.repo.findActiveFaqTopic({
      storeId,
      faqTopicId: parseId(input.faqTopicId),
    });
    if (!topic) {
      throw new NotFoundException(CONVERSATION_ERRORS.FAQ_TOPIC_NOT_FOUND);
    }

    // 칩 탭 = 유저 질문(칩 제목) + 매장 자동응답(FAQ 답변 스냅샷) 한 쌍 저장.
    // 이후 FAQ가 수정돼도 저장된 대화 이력은 당시 답변을 유지한다.
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
      // 첫 전송으로 대화가 생성될 때만 repository가 사용한다(치환 완료본 저장)
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

  /**
   * 실시간 이벤트 발행 — 대화방 메시지 + 양측 목록/배지 갱신.
   * 저장 트랜잭션 밖의 부수효과라 실패해도 전송 자체는 성공으로 남는다
   * (구독자는 폴백 재조회 가능).
   */
  private async publishBuyerSendEvents(args: {
    accountId: bigint;
    storeId: bigint;
    storeName: string;
    conversationId: bigint;
    messages: ConversationMessagesPayload['messages'];
  }): Promise<void> {
    const lastMessage = args.messages[args.messages.length - 1];
    if (!lastMessage) return;

    // 목록 이벤트는 "발행 시점의 최신 커밋 상태"를 단일 트랜잭션 스냅샷
    // 으로 다시 읽어 조립한다 — 독립 조회로 쪼개면 경쟁 커밋이 끼어들어
    // 혼합 상태(남의 미리보기 + 내 시각)가 나갈 수 있다(리뷰 반영).
    // 메시지 스트림 이벤트는 id를 실어 구독자가 정렬한다.
    const snapshot = await this.repo.getConversationEventSnapshot(
      args.conversationId,
    );

    const preview = snapshot
      ? toLastMessagePreview(snapshot.lastMessage)
      : toEventPreview(lastMessage);
    const lastMessageAtIso = (
      snapshot?.conversation.last_message_at ?? lastMessage.createdAt
    ).toISOString();
    const unreadCount = snapshot?.unreadCount ?? 0;

    await this.events.publishMessagesAdded(args.messages);
    await this.events.publishBuyerListUpdate(args.accountId.toString(), {
      conversationId: args.conversationId.toString(),
      storeId: args.storeId.toString(),
      storeName: args.storeName,
      lastMessagePreview: preview,
      lastMessageAt: lastMessageAtIso,
      unreadCount,
    });
    await this.events.publishSellerListUpdate(args.storeId.toString(), {
      conversationId: args.conversationId.toString(),
      accountId: args.accountId.toString(),
      lastMessagePreview: preview,
      lastMessageAt: lastMessageAtIso,
    });
  }

  private async requireInquiryStore(storeId: bigint) {
    const store = await this.repo.findInquiryStore(storeId);
    if (!store) {
      throw new NotFoundException(CONVERSATION_ERRORS.STORE_NOT_FOUND);
    }
    return store;
  }
}
