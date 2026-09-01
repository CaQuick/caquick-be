import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
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
import {
  renderGreeting,
  toConversationMessageOutput,
  toInquiryBusinessHour,
} from '@/features/conversation/services/conversation-inquiry-mappers.helper';
import type {
  ConversationMessagesPayload,
  StoreInquiryContextOutput,
} from '@/features/conversation/types/conversation-output.type';
import { evaluateActiveUserAccount } from '@/features/user';

@Injectable()
export class ConversationInquiryService {
  constructor(private readonly repo: ConversationRepository) {}

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
      now: new Date(),
    });

    return {
      conversationId: result.conversationId.toString(),
      messages: result.messages.map(toConversationMessageOutput),
    };
  }

  /** user feature의 활성 USER 판정 정책을 공유한다(메시지 매핑만 도메인별). */
  private async requireActiveUser(
    accountId: bigint,
  ): Promise<{ nickname: string }> {
    const account = await this.repo.findUserAccountForInquiry(accountId);
    switch (evaluateActiveUserAccount(account)) {
      case 'ACCOUNT_NOT_FOUND':
        throw new UnauthorizedException(CONVERSATION_ERRORS.ACCOUNT_NOT_FOUND);
      case 'ACCOUNT_DELETED':
        throw new UnauthorizedException(CONVERSATION_ERRORS.ACCOUNT_DELETED);
      case 'NOT_USER':
        throw new ForbiddenException(CONVERSATION_ERRORS.NOT_USER);
      case 'PROFILE_INACTIVE':
        throw new UnauthorizedException(CONVERSATION_ERRORS.PROFILE_INACTIVE);
      case null:
        break;
    }
    // evaluate 통과 시 user_profile 존재가 보장된다
    return { nickname: account!.user_profile!.nickname };
  }

  private async requireInquiryStore(storeId: bigint) {
    const store = await this.repo.findInquiryStore(storeId);
    if (!store) {
      throw new NotFoundException(CONVERSATION_ERRORS.STORE_NOT_FOUND);
    }
    return store;
  }
}
