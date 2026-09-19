import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/prisma';

/**
 * order 소유 일일 capacity 복제본(D7-a). catalog의 StoreDailyCapacityChanged를 받아 갱신하며 FK 없음.
 * 주문 생성은 이 테이블만 잠근다(catalog 행 잠금 0).
 */
@Injectable()
export class OrderStoreDailyLimitRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 이벤트 적용. 같은 (매장, 날짜)에 더 새로운 원본(source_updated_at)이 이미 반영돼 있으면 무시한다 —
   * 파티션 FIFO에 더해 재전달·순서 역전에도 결과가 최신 설정으로 수렴한다. capacity null은 설정 삭제.
   */
  async applyCapacityChange(args: {
    storeId: bigint;
    bookingDate: Date;
    capacity: number | null;
    sourceUpdatedAt: Date;
  }): Promise<'applied' | 'stale'> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.orderStoreDailyLimit.findUnique({
        where: {
          store_id_booking_date: {
            store_id: args.storeId,
            booking_date: args.bookingDate,
          },
        },
        select: { id: true, source_updated_at: true },
      });
      if (current && current.source_updated_at > args.sourceUpdatedAt) {
        return 'stale';
      }
      if (args.capacity === null) {
        if (current) {
          await tx.orderStoreDailyLimit.delete({ where: { id: current.id } });
        }
        return 'applied';
      }
      if (current) {
        await tx.orderStoreDailyLimit.update({
          where: { id: current.id },
          data: {
            capacity: args.capacity,
            source_updated_at: args.sourceUpdatedAt,
          },
        });
      } else {
        await tx.orderStoreDailyLimit.create({
          data: {
            store_id: args.storeId,
            booking_date: args.bookingDate,
            capacity: args.capacity,
            source_updated_at: args.sourceUpdatedAt,
          },
        });
      }
      return 'applied';
    });
  }
}
