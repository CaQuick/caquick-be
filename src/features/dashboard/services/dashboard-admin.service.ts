import { Inject, Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { toDate } from '@/common/utils/date-parser';
import { DAY_MS } from '@/common/utils/kst-time';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { AccountAdminRepository, AdminBaseService } from '@/features/auth';
import { MAX_DASHBOARD_RANGE_DAYS } from '@/features/dashboard/constants/dashboard.constants';
import type { AdminDashboardSummaryInput } from '@/features/dashboard/dto/inputs/admin-dashboard-summary.input';
import type { AdminSearchKeywordSnapshotInput } from '@/features/dashboard/dto/inputs/admin-search-keyword-snapshot.input';
import type {
  AdminDashboardSummaryOutput,
  AdminSearchKeywordSnapshotOutput,
} from '@/features/dashboard/types/dashboard-admin-output.type';
import { OrderRepository } from '@/features/order';
import { ProductAdminRepository } from '@/features/product';
import { ReviewAdminRepository } from '@/features/review';
import { SearchRepository } from '@/features/search';
import { StoreAdminRepository } from '@/features/store';

/** 요청 시 계산하며 스냅샷 테이블은 두지 않는다(운영 규모가 작고 기간 상한이 있다). 기간은 UTC created_at 기준 — KST 경계 환산은 클라이언트 몫. */
@Injectable()
export class AdminDashboardService extends AdminBaseService {
  constructor(
    accounts: AccountAdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly orders: OrderRepository,
    private readonly stores: StoreAdminRepository,
    private readonly products: ProductAdminRepository,
    private readonly reviews: ReviewAdminRepository,
    private readonly searchRepository: SearchRepository,
  ) {
    super(accounts, auditLogs);
  }

  async adminDashboardSummary(
    accountId: bigint,
    input: AdminDashboardSummaryInput,
  ): Promise<AdminDashboardSummaryOutput> {
    await this.requireAdminContext(accountId);
    const from = toDate(input.from);
    const to = toDate(input.to);
    if (!from || !to || from > to)
      throw new DomainException('INVALID_DATE_RANGE');
    if (to.getTime() - from.getTime() > MAX_DASHBOARD_RANGE_DAYS * DAY_MS) {
      throw new DomainException('DASHBOARD_RANGE_TOO_LONG');
    }

    const [
      newUserCount,
      newSellerCount,
      orders,
      activeStoreCount,
      activeProductCount,
      pendingReportCount,
    ] = await Promise.all([
      this.accounts.countAccountsCreatedBetween('USER', from, to),
      this.accounts.countAccountsCreatedBetween('SELLER', from, to),
      this.orders.aggregateOrdersBetween(from, to),
      this.stores.countActiveStores(),
      this.products.countActiveProducts(),
      this.reviews.countPendingReviewReports(),
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
