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
   * 구매자 대화 목록 페이지. (last_message_at, id) desc 키셋.
   * 대화는 첫 메시지 전송 시에만 생성되지만, 방어적으로 메시지 없는
   * 대화(last_message_at null)는 목록에서 제외한다 — 커서 정렬 키가 없다.
   */
  async listConversationsByAccount(args: {
    accountId: bigint;
    limit: number;
    cursor?: { lastMessageAt: Date; id: bigint };
  }) {
    const where: Prisma.StoreConversationWhereInput = {
      account_id: args.accountId,
      last_message_at: { not: null },
    };
    return this.prisma.storeConversation.findMany({
      where: args.cursor
        ? {
            AND: [
              where,
              {
                OR: [
                  { last_message_at: { lt: args.cursor.lastMessageAt } },
                  {
                    last_message_at: args.cursor.lastMessageAt,
                    id: { lt: args.cursor.id },
                  },
                ],
              },
            ],
          }
        : where,
      orderBy: [{ last_message_at: 'desc' }, { id: 'desc' }],
      take: args.limit + 1,
      include: {
        store: { select: { store_name: true, profile_image_url: true } },
      },
    });
  }

  async countConversationsByAccount(accountId: bigint): Promise<number> {
    return this.prisma.storeConversation.count({
      where: { account_id: accountId, last_message_at: { not: null } },
    });
  }

  /**
   * 목록 아이템 부가 정보 — 대화별 마지막 메시지와 안읽은 수신 메시지 수.
   * 안읽음 = last_read_at 이후 도착한, 내가 보낸 것이 아닌 메시지.
   * 페이지 크기(≤50) 만큼의 소규모 병렬 조회라 per-row 쿼리로 충분하다.
   */
  async getConversationListExtras(
    rows: { id: bigint; last_read_at: Date | null }[],
  ) {
    return Promise.all(
      rows.map(async (row) => {
        const [lastMessage, unreadCount] = await Promise.all([
          this.prisma.storeConversationMessage.findFirst({
            where: { conversation_id: row.id },
            orderBy: { id: 'desc' },
            select: { body_format: true, body_text: true, body_html: true },
          }),
          this.prisma.storeConversationMessage.count({
            where: {
              conversation_id: row.id,
              sender_type: { not: ConversationSenderType.USER },
              ...(row.last_read_at
                ? { created_at: { gt: row.last_read_at } }
                : {}),
            },
          }),
        ]);
        return { conversationId: row.id, lastMessage, unreadCount };
      }),
    );
  }

  async findConversationByIdAndAccount(args: {
    conversationId: bigint;
    accountId: bigint;
  }) {
    return this.prisma.storeConversation.findFirst({
      where: { id: args.conversationId, account_id: args.accountId },
    });
  }

  async countConversationMessages(conversationId: bigint): Promise<number> {
    return this.prisma.storeConversationMessage.count({
      where: { conversation_id: conversationId },
    });
  }

  /** 구매자 읽음 처리 — last_read_at 갱신(메시지 조회의 부수효과로 호출된다). */
  async markConversationRead(args: {
    conversationId: bigint;
    now: Date;
  }): Promise<void> {
    await this.prisma.storeConversation.update({
      where: { id: args.conversationId },
      data: { last_read_at: args.now },
    });
  }

  /**
   * 구매자 메시지 저장. 대화가 없으면 같은 트랜잭션에서 생성하고, 인사말은
   * "대화의 첫 메시지"일 때만(메시지 0건) 유저 메시지보다 앞서 저장한다.
   *
   * 대화 생성과 메시지 저장을 한 트랜잭션으로 묶는다 — 대화 row가 먼저
   * 커밋되면 판매자 목록에 빈 대화가 노출되고, 이후 메시지 저장이 실패하면
   * 유령 대화가 남는다(리뷰 반영). 실패 시 전체가 롤백되므로 재시도에서
   * 인사말 계약도 유지된다.
   */
  async createBuyerMessages(args: {
    accountId: bigint;
    storeId: bigint;
    greetingBodyText: string;
    entries: ConversationMessageEntry[];
    now: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const conversationId = await this.lockOrCreateConversation(tx, args);

      // 인사말 필요 여부는 실제 메시지 수로 판정한다 — "생성 여부" 플래그는
      // 동시 첫 전송·실패 재시도에서 인사말 계약(항상 첫 메시지)을 깨뜨린다.
      // 위에서 row를 잠갔거나(기존 대화) 본 트랜잭션이 만들었으므로(신규)
      // count 판정은 직렬화된다.
      const messageCount = await tx.storeConversationMessage.count({
        where: { conversation_id: conversationId },
      });

      const toCreate: ConversationMessageEntry[] = [
        ...(messageCount === 0
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

      // createMany는 생성 row를 돌려주지 않아 순서 보존 개별 create로 저장한다
      // (한 호출당 최대 3건이라 비용 문제 없음)
      const messages = [];
      for (const entry of toCreate) {
        messages.push(
          await tx.storeConversationMessage.create({
            data: {
              conversation_id: conversationId,
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
        where: { id: conversationId },
        data: {
          last_message_at: args.now,
          updated_at: args.now,
          // soft-delete된 대화를 재사용한 경우 복구한다 — 삭제 상태로 두면
          // 구매자·판매자 어느 조회에도 잡히지 않아 메시지가 유실돼 보인다
          // (리뷰 반영). 평상시엔 이미 null이라 no-op.
          deleted_at: null,
        },
      });

      return { conversationId, messages };
    });
  }

  /**
   * 트랜잭션 안에서 (account_id, store_id) 대화를 잠그거나 생성한다.
   * - 기존 대화: id FOR UPDATE 잠금(초기화 직렬화). 유니크 제약은 soft-delete
   *   row도 잡으므로 조회 범위를 제약과 동일하게(deleted_at 필터 해제) 맞춘다.
   * - 부재: 본 트랜잭션에서 생성. 동시 첫 전송의 패자는 승자 커밋 후 P2002를
   *   받는데, REPEATABLE READ 스냅샷의 일반 재조회는 승자 row를 못 볼 수 있어
   *   FOR UPDATE 잠금 조회(locking read — MVCC 스냅샷 우회, 최신 커밋을 읽음)로
   *   복구한다.
   */
  private async lockOrCreateConversation(
    tx: Prisma.TransactionClient,
    args: { accountId: bigint; storeId: bigint; now: Date },
  ): Promise<bigint> {
    const lockExisting = async (): Promise<bigint | null> => {
      const rows = await tx.$queryRaw<{ id: bigint }[]>`
        SELECT id FROM store_conversation
        WHERE account_id = ${args.accountId} AND store_id = ${args.storeId}
        FOR UPDATE`;
      return rows[0]?.id ?? null;
    };

    // 사전 조회도 tx 경유 — 트랜잭션 안에서 루트 클라이언트를 쓰면 풀
    // 커넥션을 2개 점유해 동시 전송이 풀을 소진하면 상호 대기가 난다(리뷰
    // 반영). tx 스냅샷이 경쟁 커밋을 못 봐도 create → P2002 → 잠금 조회
    // 경로가 복구하므로 안전하다.
    const existing = await tx.storeConversation.findFirst({
      where: {
        account_id: args.accountId,
        store_id: args.storeId,
        deleted_at: undefined,
      },
      select: { id: true },
    });
    if (existing) {
      const locked = await lockExisting();
      if (locked !== null) return locked;
      // 조회와 잠금 사이 hard delete는 운영상 없는 경로 — 생성 재시도로 폴백
    }

    try {
      const created = await tx.storeConversation.create({
        data: {
          account_id: args.accountId,
          store_id: args.storeId,
          created_at: args.now,
        },
        select: { id: true },
      });
      return created.id;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const locked = await lockExisting();
        if (locked !== null) return locked;
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
