import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { toDate } from '@/common/utils/date-parser';
import { DAY_MS } from '@/common/utils/kst-time';
import {
  DASHBOARD_RANGE_TOO_LONG,
  INVALID_DATE_RANGE,
} from '@/features/admin/constants/admin-error-messages';
import { MAX_DASHBOARD_RANGE_DAYS } from '@/features/admin/constants/admin.constants';
import type { AdminDashboardSummaryInput } from '@/features/admin/dto/inputs/admin-dashboard-summary.input';
import type { AdminSearchKeywordSnapshotInput } from '@/features/admin/dto/inputs/admin-search-keyword-snapshot.input';
import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminBaseService } from '@/features/admin/services/admin-base.service';
import type {
  AdminDashboardSummaryOutput,
  AdminSearchKeywordSnapshotOutput,
} from '@/features/admin/types/admin-output.type';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { SearchRepository } from '@/features/search';

/**
 * 대시보드 집계. 요청 시 계산하며 스냅샷 테이블은 두지 않는다(운영 규모가 작고 기간 상한이 있다).
 * 기간은 UTC created_at 기준 — KST 경계 환산은 클라이언트 몫(픽업 달력 규약과 분리).
 */
@Injectable()
export class AdminDashboardService extends AdminBaseService {
  constructor(
    repo: AdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly searchRepository: SearchRepository,
  ) {
    super(repo, auditLogs);
  }

  async adminDashboardSummary(
    accountId: bigint,
    input: AdminDashboardSummaryInput,
  ): Promise<AdminDashboardSummaryOutput> {
    await this.requireAdminContext(accountId);
    const from = toDate(input.from);
    const to = toDate(input.to);
    if (!from || !to || from > to)
      throw new BadRequestException(INVALID_DATE_RANGE);
    if (to.getTime() - from.getTime() > MAX_DASHBOARD_RANGE_DAYS * DAY_MS) {
      throw new BadRequestException(DASHBOARD_RANGE_TOO_LONG);
    }

    const [
      newUserCount,
      newSellerCount,
      orders,
      activeStoreCount,
      activeProductCount,
      pendingReportCount,
    ] = await Promise.all([
      this.repo.countAccountsCreatedBetween('USER', from, to),
      this.repo.countAccountsCreatedBetween('SELLER', from, to),
      this.repo.aggregateOrdersBetween(from, to),
      this.repo.countActiveStores(),
      this.repo.countActiveProducts(),
      this.repo.countPendingReviewReports(),
    ]);

    return {
      from,
      to,
      newUserCount,
      newSellerCount,
      orderCounts: orders.counts,
      orderAmountSum: orders.amountSum,
      activeStoreCount,
      activeProductCount,
      pendingReportCount,
    };
  }

  async adminSearchKeywordSnapshot(
    accountId: bigint,
    input?: AdminSearchKeywordSnapshotInput,
  ): Promise<AdminSearchKeywordSnapshotOutput> {
    await this.requireAdminContext(accountId);
    const rankedAt =
      toDate(input?.rankedAt) ??
      (await this.searchRepository.findLatestSnapshotAt());
    if (!rankedAt) return { rankedAt: null, items: [] };

    const rows = await this.searchRepository.listSnapshotRows(
      rankedAt,
      input?.limit ?? 20,
    );
    return {
      rankedAt: rows.length > 0 ? rankedAt : null,
      items: rows.map((r) => ({
        rank: r.rank,
        keyword: r.keyword,
        searchCount: r.search_count,
      })),
    };
  }
}
