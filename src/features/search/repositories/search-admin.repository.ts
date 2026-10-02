import { Inject, Injectable } from '@nestjs/common';

import { uniqueConstraintName } from '@/common/utils/prisma-error';
import {
  AUDIT_LOG_REPOSITORY,
  type AuditEntry,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { Prisma, type SearchKeywordChip } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma';

export type SearchKeywordChipRow = SearchKeywordChip;

/** 노출 기간을 잠금 뒤 최종 값으로 검증하는 서비스 규칙. 위반이면 던져서 트랜잭션을 되돌린다. */
export type ChipWindowAssert = (final: {
  startsAt: Date | null;
  endsAt: Date | null;
}) => void;

function isActiveKeyTaken(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    uniqueConstraintName(error) === 'uk_search_keyword_chip_active'
  );
}

/** 관리자 검색 키워드 칩 CRUD·순서 변경. 조작과 감사 기록을 한 트랜잭션으로 묶는다. */
@Injectable()
export class SearchAdminRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogs: IAuditLogRepository,
  ) {}

  /** 서비스가 미리 읽은 값은 다른 관리자의 커밋으로 낡을 수 있어, 잠금 뒤 트랜잭션 안에서 다시 읽는다. */
  private async lockActiveChip(
    tx: Prisma.TransactionClient,
    id: bigint,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: bigint }[]>`
      SELECT id FROM search_keyword_chip
      WHERE id = ${id} AND deleted_at IS NULL
      FOR UPDATE`;
    return rows.length > 0;
  }

  async listChips(): Promise<SearchKeywordChipRow[]> {
    return this.prisma.searchKeywordChip.findMany({
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
    });
  }

  /** 새 칩은 맨 뒤(현재 최대 sort_order + 1). 동시 생성으로 값이 겹쳐도 id asc가 순서를 고정한다. */
  async createChip(
    args: {
      keyword: string;
      isActive: boolean;
      startsAt: Date | null;
      endsAt: Date | null;
    },
    audit: (row: SearchKeywordChipRow) => AuditEntry,
  ): Promise<SearchKeywordChipRow | 'keyword-taken'> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const max = await tx.searchKeywordChip.aggregate({
          _max: { sort_order: true },
        });
        const row = await tx.searchKeywordChip.create({
          data: {
            keyword: args.keyword,
            active_key: args.keyword,
            sort_order: (max._max.sort_order ?? -1) + 1,
            is_active: args.isActive,
            starts_at: args.startsAt,
            ends_at: args.endsAt,
          },
        });
        await this.auditLogs.recordAudit(tx, audit(row));
        return row;
      });
    } catch (error) {
      if (isActiveKeyTaken(error)) return 'keyword-taken';
      throw error;
    }
  }

  /** undefined 필드는 Prisma가 건너뛰므로 전달한 필드만 바뀐다. 키워드를 바꾸면 active_key도 함께 바꾼다. */
  async updateChip(
    args: {
      chipId: bigint;
      keyword?: string;
      isActive?: boolean;
      startsAt?: Date | null;
      endsAt?: Date | null;
    },
    assertWindow: ChipWindowAssert,
    audit: (
      before: SearchKeywordChipRow,
      after: SearchKeywordChipRow,
    ) => AuditEntry,
  ): Promise<SearchKeywordChipRow | 'not-found' | 'keyword-taken'> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (!(await this.lockActiveChip(tx, args.chipId))) return 'not-found';
        const before = await tx.searchKeywordChip.findFirstOrThrow({
          where: { id: args.chipId },
        });
        assertWindow({
          startsAt:
            args.startsAt !== undefined ? args.startsAt : before.starts_at,
          endsAt: args.endsAt !== undefined ? args.endsAt : before.ends_at,
        });
        const after = await tx.searchKeywordChip.update({
          where: { id: args.chipId },
          data: {
            keyword: args.keyword,
            active_key: args.keyword,
            is_active: args.isActive,
            starts_at: args.startsAt,
            ends_at: args.endsAt,
          },
        });
        await this.auditLogs.recordAudit(tx, audit(before, after));
        return after;
      });
    } catch (error) {
      if (isActiveKeyTaken(error)) return 'keyword-taken';
      throw error;
    }
  }

  /** active_key를 비워 같은 키워드로 새 칩을 다시 만들 수 있게 한다. */
  async softDeleteChip(
    chipId: bigint,
    audit: (before: SearchKeywordChipRow) => AuditEntry,
  ): Promise<'deleted' | 'not-found'> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await this.lockActiveChip(tx, chipId))) return 'not-found';
      const before = await tx.searchKeywordChip.findFirstOrThrow({
        where: { id: chipId },
      });
      await tx.searchKeywordChip.update({
        where: { id: chipId },
        data: { deleted_at: new Date(), active_key: null },
      });
      await this.auditLogs.recordAudit(tx, audit(before));
      return 'deleted';
    });
  }

  /**
   * 미삭제 칩 전체를 잠근 뒤 입력이 정확히 같은 집합인지 확인한다 — 화면을 연 사이 다른 관리자가
   * 추가·삭제했으면 거절해 FE가 다시 불러오게 한다. 순서가 바뀐 칩만 갱신하고 칩마다 감사를 남긴다.
   * 잠금은 PK 경로로만 잡는다. deleted_at 인덱스를 타면 그 보조 레코드를 먼저 잠가, PK를 잡은 채
   * deleted_at을 바꾸려는 삭제와 서로 기다리며 교착된다.
   */
  async reorderChips(
    chipIds: bigint[],
    audit: (
      before: SearchKeywordChipRow,
      after: SearchKeywordChipRow,
    ) => AuditEntry,
  ): Promise<SearchKeywordChipRow[] | 'length-mismatch' | 'invalid-ids'> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: bigint }[]>`
        SELECT id FROM search_keyword_chip FORCE INDEX (PRIMARY)
        WHERE deleted_at IS NULL
        ORDER BY id
        FOR UPDATE`;
      if (locked.length !== chipIds.length) return 'length-mismatch';
      const lockedIds = new Set(locked.map((row) => row.id.toString()));
      if (chipIds.some((id) => !lockedIds.has(id.toString()))) {
        return 'invalid-ids';
      }

      const befores = await tx.searchKeywordChip.findMany({
        where: { id: { in: chipIds } },
        orderBy: { id: 'asc' },
      });
      for (const before of befores) {
        const index = chipIds.findIndex((id) => id === before.id);
        if (before.sort_order === index) continue;
        const after = await tx.searchKeywordChip.update({
          where: { id: before.id },
          data: { sort_order: index },
        });
        await this.auditLogs.recordAudit(tx, audit(before, after));
      }

      return tx.searchKeywordChip.findMany({
        orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
      });
    });
  }
}
