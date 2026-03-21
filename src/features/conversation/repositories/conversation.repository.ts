import { Injectable } from '@nestjs/common';
import { ConversationBodyFormat, ConversationSenderType } from '@prisma/client';

import { PrismaService } from '@/prisma';

@Injectable()
export class ConversationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listConversationsByStore(args: {
    storeId: bigint;
    limit: number;
    cursor?: bigint;
  }) {
    return this.prisma.storeConversation.findMany({
      where: {
        store_id: args.storeId,
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
      },
      orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
      take: args.limit + 1,
    });
  }

  async findConversationByIdAndStore(args: {
    conversationId: bigint;
    storeId: bigint;
  }) {
    return this.prisma.storeConversation.findFirst({
      where: {
        id: args.conversationId,
        store_id: args.storeId,
      },
    });
  }

  async listConversationMessages(args: {
    conversationId: bigint;
    limit: number;
    cursor?: bigint;
  }) {
    return this.prisma.storeConversationMessage.findMany({
      where: {
        conversation_id: args.conversationId,
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }

  async createSellerConversationMessage(args: {
    conversationId: bigint;
    sellerAccountId: bigint;
    bodyFormat: ConversationBodyFormat;
    bodyText: string | null;
    bodyHtml: string | null;
    now: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const message = await tx.storeConversationMessage.create({
        data: {
          conversation_id: args.conversationId,
          sender_type: ConversationSenderType.STORE,
          sender_account_id: args.sellerAccountId,
          body_format: args.bodyFormat,
          body_text: args.bodyText,
          body_html: args.bodyHtml,
          created_at: args.now,
        },
      });

      await tx.storeConversation.update({
        where: { id: args.conversationId },
        data: {
          last_message_at: args.now,
          updated_at: args.now,
        },
      });

      return message;
    });
  }
}
