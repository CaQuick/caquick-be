import { Injectable } from '@nestjs/common';

import {
  OrderCustomUploadStatus,
  type OrderCustomUploadPurpose,
} from '@/generated/prisma/client';
import { PrismaService } from '@/prisma';

export interface PurgeClaim {
  id: bigint;
  object_key: string;
}

@Injectable()
export class OrderCustomUploadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(args: {
    accountId: bigint;
    purpose: OrderCustomUploadPurpose;
    objectKey: string;
    contentType: string;
    contentLength: number;
  }): Promise<void> {
    await this.prisma.orderCustomUpload.create({
      data: {
        account_id: args.accountId,
        purpose: args.purpose,
        object_key: args.objectKey,
        content_type: args.contentType,
        content_length: args.contentLength,
      },
    });
  }

  /**
   * 정리 대상(오래된 PENDING, 지우다 만 PURGING)을 PURGING으로 표시하고 커밋한다. 표시 뒤에는 주문이 이 업로드를
   * 붙이지 못하므로 S3에서 지워도 된다. 주문 tx가 잡고 있는 행은 SKIP LOCKED로 건너뛴다(다음 정리에서 다시 본다).
   */
  async claimForPurge(args: {
    now: Date;
    pendingCreatedBefore: Date;
    purgingStartedBefore: Date;
    limit: number;
  }): Promise<PurgeClaim[]> {
    return this.prisma.$transaction(async (tx) => {
      // 상태별 인덱스 범위만 잠그도록 두 번 나눠 읽는다
      const retries = await tx.$queryRaw<PurgeClaim[]>`
        SELECT id, object_key FROM order_custom_upload
        WHERE status = ${OrderCustomUploadStatus.PURGING}
          AND purge_started_at <= ${args.purgingStartedBefore}
        ORDER BY purge_started_at, id
        LIMIT ${args.limit}
        FOR UPDATE SKIP LOCKED`;
      const fresh =
        retries.length < args.limit
          ? await tx.$queryRaw<PurgeClaim[]>`
              SELECT id, object_key FROM order_custom_upload
              WHERE status = ${OrderCustomUploadStatus.PENDING}
                AND created_at <= ${args.pendingCreatedBefore}
              ORDER BY created_at, id
              LIMIT ${args.limit - retries.length}
              FOR UPDATE SKIP LOCKED`
          : [];
      const claimed = [...retries, ...fresh];
      if (claimed.length > 0) {
        await tx.orderCustomUpload.updateMany({
          where: { id: { in: claimed.map((row) => row.id) } },
          data: {
            status: OrderCustomUploadStatus.PURGING,
            purge_started_at: args.now,
          },
        });
      }
      return claimed;
    });
  }

  /** S3에서 지운 업로드 기록을 지운다. 정리 중인 행만 대상이다. */
  async deletePurged(ids: bigint[]): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.orderCustomUpload.deleteMany({
      where: { id: { in: ids }, status: OrderCustomUploadStatus.PURGING },
    });
  }
}
