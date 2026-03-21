import {
  BadRequestException,
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
import { ConversationRepository } from '@/features/conversation';
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
import {
  nextCursorOf,
  normalizeCursorInput,
  SellerRepository,
} from '@/features/seller/repositories/seller.repository';
import { SellerBaseService } from '@/features/seller/services/seller-base.service';
import type {
  SellerCursorInput,
  SellerSendConversationMessageInput,
} from '@/features/seller/types/seller-input.type';
import type {
  SellerConversationMessageOutput,
  SellerConversationOutput,
  SellerCursorConnection,
} from '@/features/seller/types/seller-output.type';

@Injectable()
export class SellerConversationService extends SellerBaseService {
  constructor(
    repo: SellerRepository,
    private readonly conversationRepository: ConversationRepository,
  ) {
    super(repo);
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
        now: new Date(),
      });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.CONVERSATION,
      targetId: conversationId,
      action: AuditActionType.CREATE,
      afterJson: {
        messageId: row.id.toString(),
      },
    });

    return this.toConversationMessageOutput(row);
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
