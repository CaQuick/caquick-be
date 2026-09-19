import { Injectable } from '@nestjs/common';

import { type Outbox, OutboxStatus, Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma';

export type OutboxRow = Outbox;

@Injectable()
export class OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 도메인 write와 같은 tx에 적재한다 — 커밋되면 반드시 전달되고 롤백되면 이벤트도 사라진다. */
  async insert(
    tx: Prisma.TransactionClient,
    args: {
      eventId: string;
      aggregateType: string;
      aggregateId: string;
      eventType: string;
      payload: Prisma.InputJsonValue;
      occurredAt: Date;
      actorAccountId: bigint | null;
      clientIp: string | null;
      userAgent: string | null;
    },
  ): Promise<Pick<Outbox, 'id' | 'event_id'>> {
    return tx.outbox.create({
      data: {
        event_id: args.eventId,
        aggregate_type: args.aggregateType,
        aggregate_id: args.aggregateId,
        event_type: args.eventType,
        payload_json: args.payload,
        occurred_at: args.occurredAt,
        actor_account_id: args.actorAccountId,
        client_ip: args.clientIp,
        user_agent: args.userAgent,
        // 발생 즉시 전달 대상 — 재시도 시에만 뒤로 밀린다
        next_attempt_at: args.occurredAt,
      },
      select: { id: true, event_id: true },
    });
  }

  /** tx 안(존재 확인)과 tx 밖(충돌 뒤 재조회 — 같은 tx의 스냅샷엔 승자의 커밋이 안 보인다) 둘 다 쓴다. */
  async findByEventId(
    db: Pick<Prisma.TransactionClient, 'outbox'>,
    eventId: string,
  ): Promise<Pick<Outbox, 'id' | 'event_id' | 'payload_json'> | null> {
    return db.outbox.findUnique({
      where: { event_id: eventId },
      select: { id: true, event_id: true, payload_json: true },
    });
  }

  get reader(): Pick<Prisma.TransactionClient, 'outbox'> {
    return this.prisma;
  }

  /** 기한이 된 PENDING을 id 순으로 — 파티션 FIFO의 기준 순서. */
  async findDue(now: Date, limit: number): Promise<OutboxRow[]> {
    return this.prisma.outbox.findMany({
      where: { status: OutboxStatus.PENDING, next_attempt_at: { lte: now } },
      orderBy: { id: 'asc' },
      take: limit,
    });
  }

  /** 같은 파티션에 더 앞선 PENDING(백오프 대기 포함)이 있으면 FIFO를 지키려 이번 틱은 기다린다. FAILED는 막지 않는다. */
  async hasOlderPending(args: {
    aggregateType: string;
    aggregateId: string;
    beforeId: bigint;
  }): Promise<boolean> {
    const count = await this.prisma.outbox.count({
      where: {
        aggregate_type: args.aggregateType,
        aggregate_id: args.aggregateId,
        status: OutboxStatus.PENDING,
        id: { lt: args.beforeId },
      },
    });
    return count > 0;
  }

  async markPublished(id: bigint): Promise<void> {
    await this.prisma.outbox.update({
      where: { id },
      data: { status: OutboxStatus.PUBLISHED, attempts: { increment: 1 } },
    });
  }

  async markRetry(id: bigint, nextAttemptAt: Date): Promise<void> {
    await this.prisma.outbox.update({
      where: { id },
      data: { attempts: { increment: 1 }, next_attempt_at: nextAttemptAt },
    });
  }

  async markFailed(id: bigint): Promise<void> {
    await this.prisma.outbox.update({
      where: { id },
      data: { status: OutboxStatus.FAILED, attempts: { increment: 1 } },
    });
  }
}
