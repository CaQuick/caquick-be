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

  /** 발송 요청을 이벤트 1건으로 적재한다(fan-out은 소비자). 같은 eventId면 적재하지 않고 처음 payload를 돌려준다. */
  async requestBroadcast(
    event: OutboxEventInput & { eventId: string },
  ): Promise<{ created: boolean; payload: Prisma.JsonValue }> {
    return this.prisma.$transaction((tx) => this.outbox.publishOnce(tx, event));
  }
}
