import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditActionType,
  AuditTargetType,
  ConversationBodyFormat,
} from '@prisma/client';

import { parseId } from '@/common/utils/id-parser';
import { cleanNullableText } from '@/common/utils/text-cleaner';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import {
  ConversationEventsService,
  ConversationRepository,
  toEventPreview,
  toLastMessagePreview,
} from '@/features/conversation';
import {
  BODY_HTML_REQUIRED,
  BODY_TEXT_REQUIRED,
  CONVERSATION_NOT_FOUND,
  INVALID_BODY_FORMAT,
} from '@/features/seller/constants/seller-error-messages';
import {
  MAX_CONVERSATION_BODY_HTML_LENGTH,
  MAX_CONVERSATION_BODY_TEXT_LENGTH,
} from '@/features/seller/constants/seller.constants';
import type { SellerCursorInput } from '@/features/seller/dto/inputs/seller-cursor.input';
import type { SellerSendConversationMessageInput } from '@/features/seller/dto/inputs/seller-send-conversation-message.input';
import {
  nextCursorOf,
  normalizeCursorInput,
  SellerRepository,
} from '@/features/seller/repositories/seller.repository';
import { SellerBaseService } from '@/features/seller/services/seller-base.service';
import type {
  SellerConversationMessageOutput,
  SellerConversationOutput,
  SellerCursorConnection,
} from '@/features/seller/types/seller-output.type';

@Injectable()
export class SellerConversationService extends SellerBaseService {
  constructor(
    repo: SellerRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly conversationRepository: ConversationRepository,
    private readonly conversationEvents: ConversationEventsService,
  ) {
    super(repo, auditLogs);
  }
  async sellerConversations(
    accountId: bigint,
    input?: SellerCursorInput,
  ): Promise<SellerCursorConnection<SellerConversationOutput>> {
    const ctx = await this.requireSellerContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? parseId(input.cursor) : null,
    });

    const rows = await this.conversationRepository.listConversationsByStore({
      storeId: ctx.storeId,
      limit: normalized.limit,
      cursor: normalized.cursor,
    });

    const paged = nextCursorOf(rows, normalized.limit);
    return {
      items: paged.items.map((row) => this.toConversationOutput(row)),
      nextCursor: paged.nextCursor,
    };
  }

  async sellerConversationMessages(
    accountId: bigint,
    conversationId: bigint,
    input?: SellerCursorInput,
  ): Promise<SellerCursorConnection<SellerConversationMessageOutput>> {
    const ctx = await this.requireSellerContext(accountId);
    const conversation =
      await this.conversationRepository.findConversationByIdAndStore({
        conversationId,
        storeId: ctx.storeId,
      });
    if (!conversation) throw new NotFoundException(CONVERSATION_NOT_FOUND);

    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? parseId(input.cursor) : null,
    });

    const rows = await this.conversationRepository.listConversationMessages({
      conversationId,
      limit: normalized.limit,
      cursor: normalized.cursor,
    });

    const paged = nextCursorOf(rows, normalized.limit);
    return {
      items: paged.items.map((row) => this.toConversationMessageOutput(row)),
      nextCursor: paged.nextCursor,
    };
  }

  async sellerSendConversationMessage(
    accountId: bigint,
    input: SellerSendConversationMessageInput,
  ): Promise<SellerConversationMessageOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const conversationId = parseId(input.conversationId);

    const conversation =
      await this.conversationRepository.findConversationByIdAndStore({
        conversationId,
        storeId: ctx.storeId,
      });
    if (!conversation) throw new NotFoundException(CONVERSATION_NOT_FOUND);

    const bodyFormat = this.toConversationBodyFormat(input.bodyFormat);
    const bodyText = cleanNullableText(
      input.bodyText,
      MAX_CONVERSATION_BODY_TEXT_LENGTH,
    );
    const bodyHtml = cleanNullableText(
      input.bodyHtml,
      MAX_CONVERSATION_BODY_HTML_LENGTH,
    );

    if (bodyFormat === ConversationBodyFormat.TEXT && !bodyText) {
      throw new BadRequestException(BODY_TEXT_REQUIRED);
    }
    if (bodyFormat === ConversationBodyFormat.HTML && !bodyHtml) {
      throw new BadRequestException(BODY_HTML_REQUIRED);
    }

    const row =
      await this.conversationRepository.createSellerConversationMessage({
        conversationId,
        sellerAccountId: ctx.accountId,
        bodyFormat,
        bodyText,
        bodyHtml,
      });

    await this.auditLogs.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.CONVERSATION,
      targetId: conversationId,
      action: AuditActionType.CREATE,
      afterJson: {
        messageId: row.id.toString(),
      },
    });

    const output = this.toConversationMessageOutput(row);
    await this.publishSellerReplyEvents({
      conversation,
      storeId: ctx.storeId,
      message: output,
    });

    return output;
  }

  /**
   * 실시간 이벤트 발행 — 대화방 메시지 + 구매자·판매자 목록 갱신.
   * 저장 트랜잭션 밖의 부수효과라 실패해도 답장 자체는 성공으로 남는다.
   */
  private async publishSellerReplyEvents(args: {
    conversation: {
      id: bigint;
      account_id: bigint;
      last_read_at: Date | null;
    };
    storeId: bigint;
    message: SellerConversationMessageOutput;
  }): Promise<void> {
    const message = {
      id: args.message.id,
      conversationId: args.message.conversationId,
      senderType: args.message.senderType,
      bodyFormat: args.message.bodyFormat,
      bodyText: args.message.bodyText,
      bodyHtml: args.message.bodyHtml,
      createdAt: args.message.createdAt,
    };
    // 목록 이벤트는 "발행 시점의 최신 커밋 상태"를 다시 읽어 조립한다 —
    // 동시 전송에서 발행 순서가 커밋 순서와 어긋나도 늦은 이벤트가 과거
    // 상태로 화면을 되돌리지 않는다(리뷰 반영). 메시지 스트림은 id 정렬.
    const [store, fresh] = await Promise.all([
      this.conversationRepository.findStoreNameById(args.storeId),
      this.conversationRepository.findConversationByIdAndStore({
        conversationId: args.conversation.id,
        storeId: args.storeId,
      }),
    ]);
    const [extras] =
      await this.conversationRepository.getConversationListExtras([
        {
          id: args.conversation.id,
          last_read_at: fresh?.last_read_at ?? args.conversation.last_read_at,
        },
      ]);
    const preview = extras
      ? toLastMessagePreview(extras.lastMessage)
      : toEventPreview(message);
    const lastMessageAtIso = (
      fresh?.last_message_at ?? args.message.createdAt
    ).toISOString();

    await this.conversationEvents.publishMessagesAdded([message]);
    await this.conversationEvents.publishBuyerListUpdate(
      args.conversation.account_id.toString(),
      {
        conversationId: args.conversation.id.toString(),
        storeId: args.storeId.toString(),
        storeName: store?.store_name ?? '',
        lastMessagePreview: preview,
        lastMessageAt: lastMessageAtIso,
        unreadCount: extras?.unreadCount ?? 0,
      },
    );
    await this.conversationEvents.publishSellerListUpdate(
      args.storeId.toString(),
      {
        conversationId: args.conversation.id.toString(),
        accountId: args.conversation.account_id.toString(),
        lastMessagePreview: preview,
        lastMessageAt: lastMessageAtIso,
      },
    );
  }

  private toConversationBodyFormat(raw: string): ConversationBodyFormat {
    if (raw === 'TEXT') return ConversationBodyFormat.TEXT;
    if (raw === 'HTML') return ConversationBodyFormat.HTML;
    throw new BadRequestException(INVALID_BODY_FORMAT);
  }

  private toConversationOutput(row: {
    id: bigint;
    account_id: bigint;
    store_id: bigint;
    last_message_at: Date | null;
    last_read_at: Date | null;
    updated_at: Date;
  }): SellerConversationOutput {
    return {
      id: row.id.toString(),
      accountId: row.account_id.toString(),
      storeId: row.store_id.toString(),
      lastMessageAt: row.last_message_at,
      lastReadAt: row.last_read_at,
      updatedAt: row.updated_at,
    };
  }

  private toConversationMessageOutput(row: {
    id: bigint;
    conversation_id: bigint;
    sender_type: 'USER' | 'STORE' | 'SYSTEM';
    sender_account_id: bigint | null;
    body_format: 'TEXT' | 'HTML';
    body_text: string | null;
    body_html: string | null;
    created_at: Date;
  }): SellerConversationMessageOutput {
    return {
      id: row.id.toString(),
      conversationId: row.conversation_id.toString(),
      senderType: row.sender_type,
      senderAccountId: row.sender_account_id?.toString() ?? null,
      bodyFormat: row.body_format,
      bodyText: row.body_text,
      bodyHtml: row.body_html,
      createdAt: row.created_at,
    };
  }
}
