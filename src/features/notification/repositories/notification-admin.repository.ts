import { Injectable } from '@nestjs/common';

import { AccountType, type NotificationType } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma';

/** 관리자 일괄 발송의 대상 계정 조회와 알림 생성. 이벤트 기반 발송(outbox)은 08b에서 붙는다. */
@Injectable()
export class NotificationAdminRepository {
  constructor(private readonly prisma: PrismaService) {}

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

  /** event는 없다 — 시스템 이벤트가 아니다. */
  async createNotifications(
    accountIds: bigint[],
    payload: { type: NotificationType; title: string; body: string },
  ): Promise<number> {
    if (accountIds.length === 0) return 0;
    const result = await this.prisma.notification.createMany({
      data: accountIds.map((account_id) => ({
        account_id,
        type: payload.type,
        title: payload.title,
        body: payload.body,
      })),
    });
    return result.count;
  }
}
