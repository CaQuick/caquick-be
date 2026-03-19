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

import { ConversationRepository } from '../../conversation';
import {
  nextCursorOf,
  normalizeCursorInput,
  SellerRepository,
} from '../repositories/seller.repository';
import type {
  SellerCursorInput,
  SellerSendConversationMessageInput,
} from '../types/seller-input.type';
import type {
  SellerConversationMessageOutput,
  SellerConversationOutput,
  SellerCursorConnection,
} from '../types/seller-output.type';

import { SellerBaseService } from './seller-base.service';

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
      cursor: input?.cursor ? this.parseId(input.cursor) : null,
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
    if (!conversation) throw new NotFoundException('Conversation not found.');

    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? this.parseId(input.cursor) : null,
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
    const conversationId = this.parseId(input.conversationId);

    const conversation =
      await this.conversationRepository.findConversationByIdAndStore({
        conversationId,
        storeId: ctx.storeId,
      });
    if (!conversation) throw new NotFoundException('Conversation not found.');

    const bodyFormat = this.toConversationBodyFormat(input.bodyFormat);
    const bodyText = this.cleanNullableText(input.bodyText, 2000);
    const bodyHtml = this.cleanNullableText(input.bodyHtml, 100000);

    if (bodyFormat === ConversationBodyFormat.TEXT && !bodyText) {
      throw new BadRequestException('bodyText is required for TEXT format.');
    }
    if (bodyFormat === ConversationBodyFormat.HTML && !bodyHtml) {
      throw new BadRequestException('bodyHtml is required for HTML format.');
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
    throw new BadRequestException('Invalid body format.');
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
