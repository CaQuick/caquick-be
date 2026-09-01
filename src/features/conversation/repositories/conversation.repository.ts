import { Injectable } from '@nestjs/common';
import {
  ConversationBodyFormat,
  ConversationSenderType,
  Prisma,
} from '@prisma/client';

import { activeWhere, PrismaService, visibleWhere } from '@/prisma';

/** 구매자 메시지 전송 시 한 트랜잭션으로 저장할 메시지 명세. */
export interface ConversationMessageEntry {
  senderType: ConversationSenderType;
  senderAccountId: bigint | null;
  bodyFormat: ConversationBodyFormat;
  bodyText: string | null;
  bodyHtml: string | null;
}

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

  /** 활성 USER 계정 판정용 부분집합 조회(user feature 정책 헬퍼와 계약 공유). */
  async findUserAccountForInquiry(accountId: bigint) {
    return this.prisma.account.findFirst({
      where: { id: accountId },
      select: {
        id: true,
        account_type: true,
        deleted_at: true,
        user_profile: { select: { nickname: true, deleted_at: true } },
      },
    });
  }

  /** 문의 가능 매장(활성·미삭제) + 요일별 영업시간. 없으면 null. */
  async findInquiryStore(storeId: bigint) {
    return this.prisma.store.findFirst({
      where: { id: storeId, ...visibleWhere },
      select: {
        id: true,
        store_name: true,
        profile_image_url: true,
        greeting_message: true,
        business_hours: {
          where: activeWhere,
          orderBy: { day_of_week: 'asc' },
          select: {
            day_of_week: true,
            is_closed: true,
            open_time: true,
            close_time: true,
          },
        },
      },
    });
  }

  /** 질문 칩 노출용 활성 FAQ 목록(노출 순서). */
  async listActiveFaqTopics(storeId: bigint) {
    return this.prisma.storeFaqTopic.findMany({
      where: { store_id: storeId, is_active: true },
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
      select: { id: true, title: true },
    });
  }

  /** 칩 전송 대상 FAQ 단건(활성만). */
  async findActiveFaqTopic(args: { storeId: bigint; faqTopicId: bigint }) {
    return this.prisma.storeFaqTopic.findFirst({
      where: {
        id: args.faqTopicId,
        store_id: args.storeId,
        is_active: true,
      },
      select: { id: true, title: true, answer_html: true },
    });
  }

  async findConversationByAccountAndStore(args: {
    accountId: bigint;
    storeId: bigint;
  }) {
    return this.prisma.storeConversation.findFirst({
      where: { account_id: args.accountId, store_id: args.storeId },
    });
  }

  /**
   * 구매자 메시지 저장. 대화가 없으면 먼저 생성하고, 새로 생성한 경우에만
   * 인사말(STORE 발신)을 유저 메시지보다 앞서 저장한다 — 인사말은 대화당 1회.
   */
  async createBuyerMessages(args: {
    accountId: bigint;
    storeId: bigint;
    greetingBodyText: string;
    entries: ConversationMessageEntry[];
    now: Date;
  }) {
    // 대화 확보는 메시지 트랜잭션 밖에서 수행한다 — REPEATABLE READ 스냅샷
    // 안에서 P2002 복구 재조회를 하면 경쟁 트랜잭션이 커밋한 row가 보이지
    // 않을 수 있다(리뷰 반영). 메시지 삽입 전에 대화 row가 확정되면 충분하고,
    // 이후 메시지 트랜잭션이 실패해도 빈 대화 row는 목록에 노출되지 않는다
    // (last_message_at null).
    const { conversation, created } = await this.getOrCreateConversation(args);

    const toCreate: ConversationMessageEntry[] = [
      ...(created
        ? [
            {
              senderType: ConversationSenderType.STORE,
              senderAccountId: null,
              bodyFormat: ConversationBodyFormat.TEXT,
              bodyText: args.greetingBodyText,
              bodyHtml: null,
            },
          ]
        : []),
      ...args.entries,
    ];

    return this.prisma.$transaction(async (tx) => {
      // createMany는 생성 row를 돌려주지 않아 순서 보존 개별 create로 저장한다
      // (한 호출당 최대 3건이라 비용 문제 없음)
      const messages = [];
      for (const entry of toCreate) {
        messages.push(
          await tx.storeConversationMessage.create({
            data: {
              conversation_id: conversation.id,
              sender_type: entry.senderType,
              sender_account_id: entry.senderAccountId,
              body_format: entry.bodyFormat,
              body_text: entry.bodyText,
              body_html: entry.bodyHtml,
              created_at: args.now,
            },
          }),
        );
      }

      await tx.storeConversation.update({
        where: { id: conversation.id },
        data: {
          last_message_at: args.now,
          updated_at: args.now,
          // soft-delete된 대화를 재사용한 경우 복구한다 — 삭제 상태로 두면
          // 구매자·판매자 어느 조회에도 잡히지 않아 메시지가 유실돼 보인다
          // (리뷰 반영). 평상시엔 이미 null이라 no-op.
          deleted_at: null,
        },
      });

      return { conversationId: conversation.id, messages };
    });
  }

  /**
   * (account_id, store_id) 대화 확보. 유니크 제약은 soft-delete row도 잡으므로
   * 조회 범위를 제약과 동일하게(삭제 포함, deleted_at 필터 명시 해제) 맞춘다.
   * 동시 첫 전송 레이스는 P2002 후 새 문장(새 스냅샷) 재조회로 승자 row를 얻는다.
   */
  private async getOrCreateConversation(args: {
    accountId: bigint;
    storeId: bigint;
    now: Date;
  }) {
    const existing = await this.prisma.storeConversation.findFirst({
      where: {
        account_id: args.accountId,
        store_id: args.storeId,
        deleted_at: undefined,
      },
    });
    if (existing) return { conversation: existing, created: false };

    try {
      const conversation = await this.prisma.storeConversation.create({
        data: {
          account_id: args.accountId,
          store_id: args.storeId,
          created_at: args.now,
        },
      });
      return { conversation, created: true };
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const conversation =
          await this.prisma.storeConversation.findFirstOrThrow({
            where: {
              account_id: args.accountId,
              store_id: args.storeId,
              deleted_at: undefined,
            },
          });
        return { conversation, created: false };
      }
      throw e;
    }
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
