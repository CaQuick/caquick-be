import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/prisma';

/**
 * 블랙리스트 재구축용 읽기. "최근 TTL 창 안에서 정지·탈퇴·비밀번호 변경이 있었던 계정"만 — 그보다 오래된 건
 * 토큰이 이미 만료라 막을 필요가 없다. deleted_at 조건을 명시하면 soft-delete 확장이 `deleted_at: null`을 덮지 않는다.
 * 시각을 함께 돌려주는 이유: Redis 쓰기가 "버전이 더 새로울 때만"이라 훅과 겹쳐도 최근 변경이 이긴다. 정지·복구의 버전은
 * status_changed_at — updated_at은 무관한 쓰기(프로필·OIDC 로그인)로도 올라가 선후를 뒤집는다.
 */
@Injectable()
export class BlacklistRebuildRepository {
  constructor(private readonly prisma: PrismaService) {}

  async suspendedSince(
    since: Date,
  ): Promise<Array<{ accountId: bigint; changedAt: Date }>> {
    const rows = await this.prisma.account.findMany({
      where: { status: 'SUSPENDED', status_changed_at: { gte: since } },
      select: { id: true, status_changed_at: true },
    });
    return rows
      .filter(
        (r): r is typeof r & { status_changed_at: Date } =>
          r.status_changed_at !== null,
      )
      .map((r) => ({ accountId: r.id, changedAt: r.status_changed_at }));
  }

  async deletedSince(
    since: Date,
  ): Promise<Array<{ accountId: bigint; changedAt: Date }>> {
    const rows = await this.prisma.account.findMany({
      where: { deleted_at: { gte: since } },
      select: { id: true, deleted_at: true, status_changed_at: true },
    });
    // 버전은 탈퇴가 기록한 status_changed_at(단조). 컬럼 도입 전 탈퇴는 deleted_at
    return rows
      .filter(
        (r): r is typeof r & { deleted_at: Date } => r.deleted_at !== null,
      )
      .map((r) => ({
        accountId: r.id,
        changedAt: r.status_changed_at ?? r.deleted_at,
      }));
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

  /**
   * 조정용 — 주어진 계정 중 지금 활성(ACTIVE·미삭제)인 것과 복구 시각. Redis에 정지·탈퇴로 남아 있으면 복구로 덮는다.
   * 상태 변경 기록이 없는 계정(컬럼 도입 전 복구)은 updated_at으로 대신한다.
   */
  async activeAmong(
    accountIds: bigint[],
  ): Promise<Array<{ accountId: bigint; changedAt: Date }>> {
    if (accountIds.length === 0) return [];
    const rows = await this.prisma.account.findMany({
      where: { id: { in: accountIds }, status: 'ACTIVE', deleted_at: null },
      select: { id: true, status_changed_at: true, updated_at: true },
    });
    return rows.map((r) => ({
      accountId: r.id,
      changedAt: r.status_changed_at ?? r.updated_at,
    }));
  }
}
