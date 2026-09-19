import { Injectable } from '@nestjs/common';

import { type OutboxEventInput, OutboxPublisher } from '@/features/outbox';
import { AccountType, type Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma';

/** 관리자 일괄 발송의 대상 계정 조회와 발송 요청 이벤트 적재. */
@Injectable()
export class NotificationAdminRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxPublisher,
  ) {}

  async listActiveUserAccountIds(args: {
    afterId?: bigint;
    limit: number;
  }): Promise<bigint[]> {
    const rows = await this.prisma.account.findMany({
      where: {
        account_type: AccountType.USER,
        status: 'ACTIVE',
        ...(args.afterId !== undefined ? { id: { gt: args.afterId } } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: args.limit,
    });
    return rows.map((r) => r.id);
  }

  async filterActiveUserAccountIds(ids: bigint[]): Promise<bigint[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.account.findMany({
      where: {
        id: { in: ids },
        account_type: AccountType.USER,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /**
   * 발송 요청을 이벤트 1건으로 적재한다(fan-out은 소비자). 새로 적재된 경우에만 onCreated(감사 기록)를 같은 tx에서 실행해
   * "요청은 큐에 남고 감사만 빠지는" 상태를 막는다. 같은 eventId면 적재하지 않고 처음 payload를 돌려준다.
   * 같은 키의 동시 요청이 unique에 걸리면 tx 밖에서 승자의 이벤트를 다시 읽어 재생한다.
   */
  async requestBroadcast(
    event: OutboxEventInput & { eventId: string },
    onCreated: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ): Promise<{ created: boolean; payload: Prisma.JsonValue }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const result = await this.outbox.publishOnce(tx, event);
        if (result.created) await onCreated(tx);
        return result;
      });
    } catch (error) {
      if (OutboxPublisher.isDuplicateEvent(error)) {
        const winner = await this.outbox.findPublished(event.eventId);
        if (winner) return { created: false, payload: winner.payload };
      }
      throw error;
    }
  }
}
