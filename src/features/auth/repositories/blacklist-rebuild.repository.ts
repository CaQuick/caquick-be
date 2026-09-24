import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/prisma';

/**
 * 블랙리스트 재구축용 읽기(P2 03). "최근 TTL 창 안에서 정지·탈퇴·비밀번호 변경이 있었던 계정"만 — 그보다 오래된 건
 * 토큰이 이미 만료라 막을 필요가 없다. deleted_at 조건을 명시하면 soft-delete 확장이 `deleted_at: null`을 덮지 않는다.
 */
@Injectable()
export class BlacklistRebuildRepository {
  constructor(private readonly prisma: PrismaService) {}

  async suspendedSince(since: Date): Promise<bigint[]> {
    const rows = await this.prisma.account.findMany({
      where: { status: 'SUSPENDED', updated_at: { gte: since } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async deletedSince(since: Date): Promise<bigint[]> {
    const rows = await this.prisma.account.findMany({
      where: { deleted_at: { gte: since } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async credentialsChangedSince(
    since: Date,
  ): Promise<Array<{ accountId: bigint; changedAt: Date }>> {
    const rows = await this.prisma.accountCredential.findMany({
      where: { password_updated_at: { gte: since } },
      select: { account_id: true, password_updated_at: true },
    });
    return rows
      .filter(
        (r): r is typeof r & { password_updated_at: Date } =>
          r.password_updated_at !== null,
      )
      .map((r) => ({
        accountId: r.account_id,
        changedAt: r.password_updated_at,
      }));
  }
}
