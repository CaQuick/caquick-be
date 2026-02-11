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
  constructor(repo: SellerRepository) {
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

    const rows = await this.repo.listConversationsByStore({
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
    const conversation = await this.repo.findConversationByIdAndStore({
      conversationId,
      storeId: ctx.storeId,
    });
    if (!conversation) throw new NotFoundException('Conversation not found.');

    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? this.parseId(input.cursor) : null,
    });

    const rows = await this.repo.listConversationMessages({
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

    const conversation = await this.repo.findConversationByIdAndStore({
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

    const row = await this.repo.createSellerConversationMessage({
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
}
