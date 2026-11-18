import { Inject, Injectable, Logger } from '@nestjs/common';

import type { CursorInput } from '@/common/dto/inputs/cursor.input';
import { DomainException } from '@/common/errors/error-catalog';
import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { parseId } from '@/common/utils/id-parser';
import {
  buildTimestampIdCursor,
  parseTimestampIdCursor,
  parseIdCursor,
} from '@/common/utils/keyset-cursor';
import {
  normalizeCursorInput,
  sliceIdCursorPage,
  sliceCursorPage,
  toCursorConnection,
} from '@/common/utils/pagination';
import { cleanNullableText } from '@/common/utils/text-cleaner';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import {
  CONVERSATION_IMAGE_ALT_TEXT,
  MAX_CONVERSATION_BODY_HTML_LENGTH,
  MAX_INQUIRY_BODY_TEXT_LENGTH,
} from '@/features/conversation/constants/conversation.constants';
import type { SellerSendConversationMessageInput } from '@/features/conversation/dto/inputs/seller-send-conversation-message.input';
import { ConversationRepository } from '@/features/conversation/repositories/conversation.repository';
import { requireOwnedConversationImageUrl } from '@/features/conversation/services/conversation-attachment.helper';
import { toLastMessagePreview } from '@/features/conversation/services/conversation-center-mappers.helper';
import { toEventPreview } from '@/features/conversation/services/conversation-events-mappers.helper';
import { ConversationEventsService } from '@/features/conversation/services/conversation-events.service';
import {
  toConversationMessageOutput,
  type ConversationMessageRow,
} from '@/features/conversation/services/conversation-inquiry-mappers.helper';
import type {
  SellerConversationMessageOutput,
  SellerConversationOutput,
} from '@/features/conversation/types/conversation-seller-output.type';
import { SellerBaseService, StoreSellerRepository } from '@/features/store';
import {
  AuditActionType,
  AuditTargetType,
  ConversationBodyFormat,
} from '@/generated/prisma/client';
import { S3Service } from '@/global/storage/s3.service';

@Injectable()
export class SellerConversationService extends SellerBaseService {
  private readonly logger = new Logger(SellerConversationService.name);

  constructor(
    repo: StoreSellerRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly conversationRepository: ConversationRepository,
    private readonly conversationEvents: ConversationEventsService,
    private readonly s3: S3Service,
  ) {
    super(repo, auditLogs);
  }
  /** 정렬 키 (updated_at, id)를 그대로 커서에 담는다. 근거는 repository 쪽 주석. */
  async sellerConversations(
    accountId: bigint,
    input?: CursorInput,
  ): Promise<CursorConnection<SellerConversationOutput>> {
    const ctx = await this.requireSellerContext(accountId);
    const limit = Math.min(Math.max(input?.limit ?? 20, 1), 100);
    const cursor = input?.cursor
      ? parseTimestampIdCursor(input.cursor)
      : undefined;

    const { rows, totalCount, extras } =
      await this.conversationRepository.getStoreConversationPageWithExtras({
        storeId: ctx.storeId,
        limit,
        ...(cursor
          ? { cursor: { updatedAt: cursor.timestamp, id: cursor.id } }
          : {}),
      });

    const page = sliceCursorPage(rows, limit, (last) =>
      buildTimestampIdCursor(last.updated_at, last.id),
    );
    const extraById = new Map(
      extras.map((e) => [e.conversationId.toString(), e]),
    );
    return toCursorConnection(page, totalCount, (row) =>
      this.toConversationOutput(row, extraById.get(row.id.toString())),
    );
  }

  /** 읽음은 앱이 명시 호출한다(조회 부수효과 없음). 이벤트는 내지 않는다. */
  async sellerMarkConversationRead(
    accountId: bigint,
    conversationIdRaw: string,
  ): Promise<SellerConversationOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const conversationId = parseId(conversationIdRaw);
    const conversation =
      await this.conversationRepository.findConversationByIdAndStore({
        conversationId,
        storeId: ctx.storeId,
      });
    if (!conversation) throw new DomainException('CONVERSATION_NOT_FOUND');

    const marked =
      await this.conversationRepository.markSellerRead(conversationId);
    if (!marked) throw new DomainException('CONVERSATION_NOT_FOUND');
    return this.toConversationOutput(marked.conversation, marked.extra);
  }

  async sellerConversationMessages(
    accountId: bigint,
    conversationId: bigint,
    input?: CursorInput,
  ): Promise<CursorConnection<SellerConversationMessageOutput>> {
    const ctx = await this.requireSellerContext(accountId);
    const conversation =
      await this.conversationRepository.findConversationByIdAndStore({
        conversationId,
        storeId: ctx.storeId,
      });
    if (!conversation) throw new DomainException('CONVERSATION_NOT_FOUND');

    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? parseIdCursor(input.cursor) : null,
    });

    const [rows, totalCount] = await Promise.all([
      this.conversationRepository.listConversationMessages({
        conversationId,
        limit: normalized.limit,
        cursor: normalized.cursor,
      }),
      this.conversationRepository.countConversationMessages(conversationId),
    ]);

    const paged = sliceIdCursorPage(rows, normalized.limit);
    return {
      items: paged.items.map((row) => this.toConversationMessageOutput(row)),
      nextCursor: paged.nextCursor,
      hasMore: paged.hasMore,
      totalCount,
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
    if (!conversation) throw new DomainException('CONVERSATION_NOT_FOUND');

    const body = this.toSellerMessageBody(input, ctx.accountId);

    // 감사 기록은 repository가 메시지 저장과 같은 트랜잭션에서 남긴다
    const row =
      await this.conversationRepository.createSellerConversationMessage(
        { conversationId, sellerAccountId: ctx.accountId, ...body },
        (created) => ({
          actorAccountId: ctx.accountId,
          storeId: ctx.storeId,
          targetType: AuditTargetType.CONVERSATION,
          targetId: conversationId,
          action: AuditActionType.CREATE,
          afterJson: {
            messageId: created.id.toString(),
          },
        }),
      );

    const output = this.toConversationMessageOutput(row);
    await this.publishSellerReplyEvents({
      conversation,
      storeId: ctx.storeId,
      message: output,
    });

    return output;
  }

  /** 저장 트랜잭션 밖의 부수효과라 실패해도 답장 자체는 성공으로 남는다. */
  private async publishSellerReplyEvents(args: {
    conversation: {
      id: bigint;
      account_id: bigint;
      last_read_at: Date | null;
    };
    storeId: bigint;
    message: SellerConversationMessageOutput;
  }): Promise<void> {
    // 커밋 이후의 부수효과 전체(스냅샷 조회 포함)를 격리한다 — 예외가 이미 저장된 답장을 실패로 둔갑시키면 재시도 중복이 난다.
    try {
      await this.doPublishSellerReplyEvents(args);
    } catch (e) {
      this.logger.warn(
        `대화 이벤트 발행 실패 (conversationId=${args.conversation.id}): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  private async doPublishSellerReplyEvents(args: {
    conversation: {
      id: bigint;
      account_id: bigint;
      last_read_at: Date | null;
    };
    storeId: bigint;
    message: SellerConversationMessageOutput;
  }): Promise<void> {
    const { message } = args;
    // 목록 이벤트는 발행 시점의 최신 커밋 상태를 단일 트랜잭션 스냅샷으로 조립한다 — 독립 조회로 쪼개면
    // 경쟁 커밋이 끼어들어 혼합 상태가 나갈 수 있다. 메시지 스트림은 id 정렬.
    const snapshot =
      await this.conversationRepository.getConversationEventSnapshot(
        args.conversation.id,
      );
    const preview = snapshot
      ? toLastMessagePreview(snapshot.lastMessage)
      : toEventPreview(message);
    const lastMessageAtIso = (
      snapshot?.conversation.last_message_at ?? args.message.createdAt
    ).toISOString();
    const storeName = snapshot?.conversation.store.store_name ?? '';
    const lastReadAtIso =
      snapshot?.conversation.last_read_at?.toISOString() ?? null;

    await this.conversationEvents.publishMessagesAdded([message]);
    await this.conversationEvents.publishBuyerListUpdate(
      args.conversation.account_id.toString(),
      {
        conversationId: args.conversation.id.toString(),
        storeId: args.storeId.toString(),
        storeName,
        lastMessagePreview: preview,
        lastMessageAt: lastMessageAtIso,
        lastReadAt: lastReadAtIso,
        unreadCount: snapshot?.unreadCount ?? 0,
      },
    );
    await this.conversationEvents.publishSellerListUpdate(
      args.storeId.toString(),
      {
        conversationId: args.conversation.id.toString(),
        accountId: args.conversation.account_id.toString(),
        buyerNickname: snapshot?.conversation.buyer_nickname_snapshot ?? null,
        lastMessagePreview: preview,
        lastMessageAt: lastMessageAtIso,
        sellerLastReadAt:
          snapshot?.conversation.seller_last_read_at?.toISOString() ?? null,
        unreadCount: snapshot?.sellerUnreadCount ?? 0,
      },
    );
  }

  /** IMAGE는 대체 문구만 본문으로 남긴다. 주문 카드는 구매자만 보낼 수 있다. */
  private toSellerMessageBody(
    input: SellerSendConversationMessageInput,
    sellerAccountId: bigint,
  ): {
    bodyFormat: ConversationBodyFormat;
    bodyText: string | null;
    bodyHtml: string | null;
    imageUrl: string | null;
  } {
    switch (input.bodyFormat) {
      case ConversationBodyFormat.IMAGE:
        return {
          bodyFormat: input.bodyFormat,
          bodyText: CONVERSATION_IMAGE_ALT_TEXT,
          bodyHtml: null,
          imageUrl: requireOwnedConversationImageUrl(
            this.s3,
            input.imageUrl,
            sellerAccountId,
          ),
        };
      case ConversationBodyFormat.TEXT:
      case ConversationBodyFormat.HTML: {
        const bodyText = cleanNullableText(
          input.bodyText,
          MAX_INQUIRY_BODY_TEXT_LENGTH,
        );
        const bodyHtml = cleanNullableText(
          input.bodyHtml,
          MAX_CONVERSATION_BODY_HTML_LENGTH,
        );
        if (input.bodyFormat === ConversationBodyFormat.TEXT && !bodyText) {
          throw new DomainException('BODY_TEXT_REQUIRED');
        }
        if (input.bodyFormat === ConversationBodyFormat.HTML && !bodyHtml) {
          throw new DomainException('BODY_HTML_REQUIRED');
        }
        return {
          bodyFormat: input.bodyFormat,
          bodyText,
          bodyHtml,
          imageUrl: null,
        };
      }
      default:
        throw new DomainException('INVALID_BODY_FORMAT');
    }
  }

  private toConversationOutput(
    row: {
      id: bigint;
      account_id: bigint;
      store_id: bigint;
      buyer_nickname_snapshot: string | null;
      last_message_at: Date | null;
      last_read_at: Date | null;
      seller_last_read_at: Date | null;
      updated_at: Date;
    },
    extra?: {
      lastMessage: Parameters<typeof toLastMessagePreview>[0];
      unreadCount: number;
    },
  ): SellerConversationOutput {
    return {
      id: row.id.toString(),
      accountId: row.account_id.toString(),
      storeId: row.store_id.toString(),
      buyerNickname: row.buyer_nickname_snapshot,
      lastMessagePreview: toLastMessagePreview(extra?.lastMessage ?? null),
      lastMessageAt: row.last_message_at,
      lastReadAt: row.last_read_at,
      sellerLastReadAt: row.seller_last_read_at,
      unreadCount: extra?.unreadCount ?? 0,
      updatedAt: row.updated_at,
    };
  }

  private toConversationMessageOutput(
    row: ConversationMessageRow & { sender_account_id: bigint | null },
  ): SellerConversationMessageOutput {
    return {
      ...toConversationMessageOutput(row),
      senderAccountId: row.sender_account_id?.toString() ?? null,
    };
  }
}
