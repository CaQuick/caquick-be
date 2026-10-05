import { Injectable } from '@nestjs/common';

import type { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma';

const pendingSelect = {
  id: true,
  push_device_id: true,
} satisfies Prisma.SellerPushDeliverySelect;
export type PendingDeliveryRow = Prisma.SellerPushDeliveryGetPayload<{
  select: typeof pendingSelect;
}>;

const receiptSelect = {
  id: true,
  push_device_id: true,
  ticket_id: true,
  sent_at: true,
} satisfies Prisma.SellerPushDeliverySelect;
export type ReceiptCandidateRow = Prisma.SellerPushDeliveryGetPayload<{
  select: typeof receiptSelect;
}> & { ticket_id: string; sent_at: Date };

export type TicketResult =
  | { id: bigint; status: 'TICKET_OK'; ticketId: string; sentAt: Date }
  | { id: bigint; status: 'TICKET_ERROR'; errorCode: string; sentAt: Date };

export type ReceiptResult =
  | { id: bigint; status: 'RECEIPT_OK' | 'RECEIPT_UNKNOWN' }
  | { id: bigint; status: 'RECEIPT_ERROR'; errorCode: string };

/** outbox 이벤트 1건 × 디바이스 1개 = 1행. at-least-once 재전달의 dedupe 키이자 ticket → receipt 추적 행. */
@Injectable()
export class SellerPushDeliveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 재전달 흡수: 같은 이벤트로 이미 들어간 디바이스는 빼고 넣는다(unique (source_event_id, push_device_id)가 최종 방어).
   * skipDuplicates(INSERT IGNORE)는 FK 위반 같은 다른 오류까지 삼켜 조용히 0건이 되므로 쓰지 않는다.
   * 반환은 이 디바이스들 중 아직 전송 전(PENDING)인 행 — 전송은 했는데 ticket 기록 전에 죽은 행은 다시 보내진다(허용 범위).
   */
  async claim(
    sourceEventId: string,
    deviceIds: bigint[],
  ): Promise<PendingDeliveryRow[]> {
    if (deviceIds.length === 0) return [];
    const claimed = new Set(
      (
        await this.prisma.sellerPushDelivery.findMany({
          where: {
            source_event_id: sourceEventId,
            push_device_id: { in: deviceIds },
          },
          select: { push_device_id: true },
        })
      ).map((row) => row.push_device_id.toString()),
    );
    const fresh = deviceIds.filter((id) => !claimed.has(id.toString()));
    if (fresh.length > 0) {
      await this.prisma.sellerPushDelivery.createMany({
        data: fresh.map((push_device_id) => ({
          source_event_id: sourceEventId,
          push_device_id,
        })),
      });
    }
    return this.prisma.sellerPushDelivery.findMany({
      where: {
        source_event_id: sourceEventId,
        push_device_id: { in: deviceIds },
        status: 'PENDING',
      },
      select: pendingSelect,
      orderBy: { push_device_id: 'asc' },
    });
  }

  async markTickets(results: TicketResult[]): Promise<void> {
    if (results.length === 0) return;
    await this.prisma.$transaction(
      results.map((result) =>
        this.prisma.sellerPushDelivery.update({
          where: { id: result.id },
          data:
            result.status === 'TICKET_OK'
              ? {
                  status: 'TICKET_OK',
                  ticket_id: result.ticketId,
                  sent_at: result.sentAt,
                }
              : {
                  status: 'TICKET_ERROR',
                  error_code: result.errorCode,
                  sent_at: result.sentAt,
                },
        }),
      ),
    );
  }

  /** 영수증을 아직 안 본 TICKET_OK 행 — 오래된 것부터. */
  async listForReceipt(args: {
    sentBefore: Date;
    limit: number;
  }): Promise<ReceiptCandidateRow[]> {
    const rows = await this.prisma.sellerPushDelivery.findMany({
      where: {
        status: 'TICKET_OK',
        sent_at: { lt: args.sentBefore },
        receipt_checked_at: null,
        ticket_id: { not: null },
      },
      select: receiptSelect,
      orderBy: { sent_at: 'asc' },
      take: args.limit,
    });
    return rows as ReceiptCandidateRow[];
  }

  async markReceipts(results: ReceiptResult[], checkedAt: Date): Promise<void> {
    if (results.length === 0) return;
    await this.prisma.$transaction(
      results.map((result) =>
        this.prisma.sellerPushDelivery.update({
          where: { id: result.id },
          data: {
            status: result.status,
            error_code:
              result.status === 'RECEIPT_ERROR' ? result.errorCode : undefined,
            receipt_checked_at: checkedAt,
          },
        }),
      ),
    );
  }
}
