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
   * per-row 쿼리는 페이지 50건 기준 100쿼리로 풀을 압박한다(리뷰 반영) —
   * 최신 메시지 id 집계 → 본문 일괄 조회 → 안읽음 OR-분기 groupBy의
   * 고정 3쿼리로 배치한다.
   */
  async getConversationListExtras(
    rows: { id: bigint; last_read_at: Date | null }[],
  ) {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);

    const latestIdRows = await this.prisma.storeConversationMessage.groupBy({
      by: ['conversation_id'],
      where: { conversation_id: { in: ids } },
      _max: { id: true },
    });
    const latestIds = latestIdRows
      .map((row) => row._max.id)
      .filter((id): id is bigint => id !== null);

    const [latestMessages, unreadGroups] = await Promise.all([
      latestIds.length > 0
        ? this.prisma.storeConversationMessage.findMany({
            where: { id: { in: latestIds } },
            select: {
              conversation_id: true,
              body_format: true,
              body_text: true,
              body_html: true,
            },
          })
        : Promise.resolve([]),
      this.prisma.storeConversationMessage.groupBy({
        by: ['conversation_id'],
        where: {
          sender_type: { not: ConversationSenderType.USER },
          // 대화별 last_read_at이 달라 조건을 OR 분기로 배치한다(페이지 ≤50)
          OR: rows.map((row) => ({
            conversation_id: row.id,
            ...(row.last_read_at
              ? { created_at: { gt: row.last_read_at } }
              : {}),
          })),
        },
        _count: { _all: true },
      }),
    ]);

    const lastMessageById = new Map(
      latestMessages.map((m) => [m.conversation_id.toString(), m]),
    );
    const unreadById = new Map(
      unreadGroups.map((g) => [g.conversation_id.toString(), g._count._all]),
    );

    return rows.map((row) => ({
      conversationId: row.id,
      lastMessage: lastMessageById.get(row.id.toString()) ?? null,
      unreadCount: unreadById.get(row.id.toString()) ?? 0,
    }));
  }

  async findConversationByIdAndAccount(args: {
    conversationId: bigint;
    accountId: bigint;
  }) {
    return this.prisma.storeConversation.findFirst({
      where: { id: args.conversationId, account_id: args.accountId },
    });
  }

  /**
   * 구매자 채팅 상세 조회 + 읽음 마커 전진(한 트랜잭션).
   *
   * 전송 경로와 같은 대화 row 잠금을 잡는다 — 미커밋 전송이 있으면 커밋을
   * 기다린 뒤 조회하므로, "아직 안 보이는 메시지"를 건너뛰고 마커가
   * 전진하는 레이스가 없다(리뷰 반영). 마커는 실제 내려준 최신 메시지의
   * created_at까지만, 과거 페이지 조회로 후퇴하지 않게 단조 증가 조건으로
   * 갱신한다.
   */
  async listBuyerMessagesAndMarkRead(args: {
    conversationId: bigint;
    limit: number;
    cursor?: bigint;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM store_conversation WHERE id = ${args.conversationId} FOR UPDATE`;

      const [rows, totalCount] = await Promise.all([
        tx.storeConversationMessage.findMany({
          where: {
            conversation_id: args.conversationId,
            ...(args.cursor ? { id: { lt: args.cursor } } : {}),
          },
          orderBy: { id: 'desc' },
          take: args.limit + 1,
        }),
        tx.storeConversationMessage.count({
          where: { conversation_id: args.conversationId },
        }),
      ]);

      const newest = rows[0];
      if (newest) {
        await tx.storeConversation.updateMany({
          where: {
            id: args.conversationId,
            OR: [
              { last_read_at: null },
              { last_read_at: { lt: newest.created_at } },
            ],
          },
          data: { last_read_at: newest.created_at },
        });
      }

      return { rows, totalCount };
    });
  }

  /**
   * 목록 갱신 이벤트용 대화 스냅샷 — 한 트랜잭션(단일 REPEATABLE READ
   * 스냅샷)에서 대화·매장명·최신 메시지·안읽음 수를 함께 읽는다. 독립
   * 조회로 쪼개면 경쟁 커밋이 끼어들어 "B의 미리보기 + A의 시각" 같은
   * 혼합 상태가 이벤트로 나갈 수 있다(리뷰 반영).
   */
  async getConversationEventSnapshot(conversationId: bigint) {
    return this.prisma.$transaction(async (tx) => {
      const conversation = await tx.storeConversation.findFirst({
        where: { id: conversationId, deleted_at: undefined },
        select: {
          id: true,
          account_id: true,
          store_id: true,
          last_message_at: true,
          last_read_at: true,
          store: { select: { store_name: true } },
        },
      });
      if (!conversation) return null;

      const [lastMessage, unreadCount] = await Promise.all([
        tx.storeConversationMessage.findFirst({
          where: { conversation_id: conversationId },
          orderBy: { id: 'desc' },
          select: { body_format: true, body_text: true, body_html: true },
        }),
        tx.storeConversationMessage.count({
          where: {
            conversation_id: conversationId,
            sender_type: { not: ConversationSenderType.USER },
            ...(conversation.last_read_at
              ? { created_at: { gt: conversation.last_read_at } }
              : {}),
          },
        }),
      ]);

      return { conversation, lastMessage, unreadCount };
    });
  }

  /** subscription 구독 권한 판정용 — 대화 소유 구매자/해당 매장 판매자 확인. */
  async findConversationAccess(conversationId: bigint) {
    return this.prisma.storeConversation.findFirst({
      where: { id: conversationId },
      select: {
        id: true,
        account_id: true,
        store_id: true,
        store: { select: { seller_account_id: true } },
      },
    });
  }

  /** 판매자 구독 대상 매장(활성) 조회. */
  async findStoreBySellerAccount(sellerAccountId: bigint) {
    return this.prisma.store.findFirst({
      where: { seller_account_id: sellerAccountId, ...activeWhere },
      select: { id: true },
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
  }) {
    return this.prisma.$transaction(async (tx) => {
      const conversation = await this.lockOrCreateConversation(tx, args);
      const conversationId = conversation.id;
      // 메시지 시각은 대화 잠금 획득 "이후" DB 시계(NOW(3))로 채번한다 —
      // 앱 호스트 시계는 다중 인스턴스에서 노드 간 오차로 잠금 순서와
      // 어긋날 수 있다(릴리즈 리뷰 반영). DB가 단일 시계 소스이므로
      // 잠금 순서 = 시각 순서 = 커밋 순서가 대화 단위로 보장된다.
      const now = await this.fetchDbNow(tx);

      // 인사말 필요 여부는 실제 메시지 수로 판정한다 — "생성 여부" 플래그는
      // 동시 첫 전송·실패 재시도에서 인사말 계약(항상 첫 메시지)을 깨뜨린다.
      // 잠금 조회(FOR SHARE)로 최신 커밋 기준으로 센다(스냅샷 우회).
      const messageCountRows = await tx.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*) AS c FROM store_conversation_message
        WHERE conversation_id = ${conversationId} AND deleted_at IS NULL
        FOR SHARE`;
      const messageCount = Number(messageCountRows[0]?.c ?? 0n);

      // 이번 전송 "이전"의 미읽음 수신 메시지 — 읽음 마커 전진 가능 여부 판정용.
      // 잠금 조회(FOR SHARE)로 최신 커밋을 읽는다 — 트랜잭션 초입의 일반
      // 조회가 만든 REPEATABLE READ 스냅샷은 잠금 대기 중 커밋된 판매자
      // 답장을 못 본다(리뷰 반영). raw라 soft-delete 필터를 수동 명시.
      const unreadRows = conversation.lastReadAt
        ? await tx.$queryRaw<{ c: bigint }[]>`
            SELECT COUNT(*) AS c FROM store_conversation_message
            WHERE conversation_id = ${conversationId}
              AND sender_type <> 'USER'
              AND deleted_at IS NULL
              AND created_at > ${conversation.lastReadAt}
            FOR SHARE`
        : await tx.$queryRaw<{ c: bigint }[]>`
            SELECT COUNT(*) AS c FROM store_conversation_message
            WHERE conversation_id = ${conversationId}
              AND sender_type <> 'USER'
              AND deleted_at IS NULL
            FOR SHARE`;
      const pendingUnread = Number(unreadRows[0]?.c ?? 0n);

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
              created_at: now,
            },
          }),
        );
      }

      await tx.storeConversation.update({
        where: { id: conversationId },
        data: {
          last_message_at: now,
          updated_at: now,
          // 이번 mutation 응답으로 인사말·FAQ 자동응답까지 구매자에게 즉시
          // 표시되므로 여기까지 읽음으로 전진시키되, 이전에 쌓인 미읽음
          // 답장이 있으면 전진하지 않는다 — 단일 워터마크라 함께 읽음
          // 처리돼 버리기 때문(리뷰 반영). 그 경우 방금 받은 자동응답도
          // 미읽음에 포함되지만, 채팅 상세를 열면 함께 해소된다.
          ...(pendingUnread === 0 ? { last_read_at: now } : {}),
          // soft-delete된 대화를 재사용한 경우 복구한다 — 삭제 상태로 두면
          // 구매자·판매자 어느 조회에도 잡히지 않아 메시지가 유실돼 보인다
          // (리뷰 반영). 평상시엔 이미 null이라 no-op.
          deleted_at: null,
        },
      });

      return { conversationId, messages };
    });
  }

  /** DB 시계(NOW(3)) 조회 — 인스턴스 간 단일 시계 소스. 잠금 획득 후 호출 전제. */
  private async fetchDbNow(tx: Prisma.TransactionClient): Promise<Date> {
    const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT NOW(3) AS now`;
    const now = rows[0]?.now;
    if (!(now instanceof Date)) {
      // 드라이버가 Date 매핑에 실패하는 비정상 경로 — 전송을 막지 않는다
      return new Date();
    }
    return now;
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
    args: { accountId: bigint; storeId: bigint },
  ): Promise<{ id: bigint; lastReadAt: Date | null }> {
    // 잠금 조회가 돌려준 last_read_at을 그대로 쓴다 — 잠금 대기 중 커밋된
    // 변경까지 반영된 최신 값이다(일반 조회의 스냅샷과 달리).
    const lockExisting = async (): Promise<{
      id: bigint;
      lastReadAt: Date | null;
    } | null> => {
      const rows = await tx.$queryRaw<
        { id: bigint; last_read_at: Date | null }[]
      >`
        SELECT id, last_read_at FROM store_conversation
        WHERE account_id = ${args.accountId} AND store_id = ${args.storeId}
        FOR UPDATE`;
      const row = rows[0];
      return row ? { id: row.id, lastReadAt: row.last_read_at } : null;
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
        },
        select: { id: true },
      });
      return { id: created.id, lastReadAt: null };
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
  }) {
    return this.prisma.$transaction(async (tx) => {
      // 구매자 전송·읽음 처리와 같은 대화 잠금 아래에서 DB 시계로 시각을
      // 채번해 커밋 순서와 시각 순서를 대화 단위로 일치시킨다(읽음 마커
      // 정합 — 앱 호스트 시계는 다중 인스턴스 오차에 취약, 릴리즈 리뷰 반영).
      await tx.$queryRaw`SELECT id FROM store_conversation WHERE id = ${args.conversationId} FOR UPDATE`;
      const now = await this.fetchDbNow(tx);

      const message = await tx.storeConversationMessage.create({
        data: {
          conversation_id: args.conversationId,
          sender_type: ConversationSenderType.STORE,
          sender_account_id: args.sellerAccountId,
          body_format: args.bodyFormat,
          body_text: args.bodyText,
          body_html: args.bodyHtml,
          created_at: now,
        },
      });

      await tx.storeConversation.update({
        where: { id: args.conversationId },
        data: {
          last_message_at: now,
          updated_at: now,
        },
      });

      return message;
    });
  }
}
