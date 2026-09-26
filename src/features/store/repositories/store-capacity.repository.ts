import { Inject, Injectable } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type AuditEntry,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { OutboxPublisher } from '@/features/outbox';
import { storeDailyCapacityChangedEvent } from '@/features/store/events/store-daily-capacity-changed.event';
import type { Prisma, StoreDailyCapacity } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma';

/**
 * 일일 capacity 설정의 write 진입점. 변경마다 같은 tx에 StoreDailyCapacityChanged를 적재해
 * order의 복제본(order_store_daily_limit)이 따라오게 한다. 조회는 StoreSellerRepository.
 */
@Injectable()
export class StoreCapacityRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxPublisher,
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogs: IAuditLogRepository,
  ) {}

  /** 같은 매장·날짜의 soft-delete row가 있으면 복구한다(unique 충돌 회피). */
  async upsertStoreDailyCapacity(
    args: {
      storeId: bigint;
      capacityDate: Date;
      capacity: number;
      actorAccountId: bigint;
    },
    audit: (row: StoreDailyCapacity) => AuditEntry,
  ): Promise<StoreDailyCapacity> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.storeDailyCapacity.upsert({
        where: {
          store_id_capacity_date: {
            store_id: args.storeId,
            capacity_date: args.capacityDate,
          },
        },
        create: {
          store_id: args.storeId,
          capacity_date: args.capacityDate,
          capacity: args.capacity,
        },
        update: { deleted_at: null, capacity: args.capacity },
      });
      await this.publishChanged(tx, row, row.capacity, args.actorAccountId);
      await this.auditLogs.recordAudit(tx, audit(row));
      return row;
    });
  }

  /** 날짜가 바뀌면 이전 날짜의 복제본은 삭제 이벤트로, 새 날짜는 설정 이벤트로 알린다. */
  async updateStoreDailyCapacity(
    args: {
      capacityId: bigint;
      capacityDate: Date;
      capacity: number;
      actorAccountId: bigint;
    },
    audit: (row: StoreDailyCapacity) => AuditEntry,
  ): Promise<StoreDailyCapacity> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.storeDailyCapacity.findUniqueOrThrow({
        where: { id: args.capacityId },
        select: { capacity_date: true },
      });
      const row = await tx.storeDailyCapacity.update({
        where: { id: args.capacityId },
        data: { capacity_date: args.capacityDate, capacity: args.capacity },
      });
      if (before.capacity_date.getTime() !== row.capacity_date.getTime()) {
        await this.outbox.publish(
          tx,
          storeDailyCapacityChangedEvent({
            storeId: row.store_id,
            capacityDate: before.capacity_date,
            capacity: null,
            updatedAt: row.updated_at,
            actorAccountId: args.actorAccountId,
          }),
        );
      }
      await this.publishChanged(tx, row, row.capacity, args.actorAccountId);
      await this.auditLogs.recordAudit(tx, audit(row));
      return row;
    });
  }

  async softDeleteStoreDailyCapacity(
    args: {
      capacityId: bigint;
      actorAccountId: bigint;
    },
    audit: (row: StoreDailyCapacity) => AuditEntry,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.storeDailyCapacity.update({
        where: { id: args.capacityId },
        data: { deleted_at: new Date() },
      });
      await this.publishChanged(tx, row, null, args.actorAccountId);
      await this.auditLogs.recordAudit(tx, audit(row));
    });
  }

  private publishChanged(
    tx: Prisma.TransactionClient,
    row: StoreDailyCapacity,
    capacity: number | null,
    actorAccountId: bigint,
  ): Promise<unknown> {
    return this.outbox.publish(
      tx,
      storeDailyCapacityChangedEvent({
        storeId: row.store_id,
        capacityDate: row.capacity_date,
        capacity,
        updatedAt: row.updated_at,
        actorAccountId,
      }),
    );
  }
}
