import { Injectable, Logger } from '@nestjs/common';

import { ClockService } from '@/common/providers/clock.service';
import { IdGenerator } from '@/common/providers/id-generator.service';
import {
  normalizeIpForPersistence,
  normalizeUserAgentForPersistence,
} from '@/common/utils/http-meta';
import { uniqueConstraintName } from '@/common/utils/prisma-error';
import { OutboxRepository } from '@/features/outbox/repositories/outbox.repository';
import type { OutboxEventInput } from '@/features/outbox/types/outbox-event.type';
import { Prisma } from '@/generated/prisma/client';
import { RequestContextService } from '@/global/request-context';

/**
 * 발행 진입점. 도메인 repository가 본 조작 tx를 넘겨 부르면 이벤트가 같은 tx에 적재된다.
 * ip/ua는 요청 컨텍스트(ALS)에서 보강한다 — 도메인 서비스가 transport 메타데이터를 들고 다니지 않게.
 */
@Injectable()
export class OutboxPublisher {
  private readonly logger = new Logger(OutboxPublisher.name);

  constructor(
    private readonly repo: OutboxRepository,
    private readonly clock: ClockService,
    private readonly ids: IdGenerator,
    private readonly requestContext: RequestContextService,
  ) {}

  async publish(
    tx: Prisma.TransactionClient,
    event: OutboxEventInput,
  ): Promise<{ eventId: string }> {
    const occurredAt = event.occurredAt ?? this.clock.now();
    const ctx = this.requestContext.get();
    const row = await this.repo.insert(tx, {
      eventId: event.eventId ?? this.ids.uuid(),
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      payload: event.payload,
      occurredAt,
      actorAccountId: event.actorAccountId ?? null,
      clientIp: normalizeIpForPersistence(ctx?.clientIp),
      userAgent: normalizeUserAgentForPersistence(ctx?.userAgent),
    });
    // 요청 컨텍스트(requestId) 안에서 eventId를 최상위 필드로 남긴다 — worker 소비 로그(eventId)와 이어 보는 조인 키(P2 E8)
    this.logger.log('outbox 발행', {
      eventId: row.event_id,
      eventType: event.eventType,
      aggregate: `${event.aggregateType}#${String(event.aggregateId)}`,
    });
    return { eventId: row.event_id };
  }

  /**
   * 멱등 발행 — 같은 eventId가 이미 있으면 적재하지 않고 그 payload를 돌려준다(요청 재생용).
   * 존재 확인과 적재 사이에 같은 키의 동시 요청이 끼면 unique(uk_outbox_event)로 실패한다. 이 tx의 스냅샷에는
   * 승자의 커밋이 보이지 않으므로 호출자는 tx 밖에서 `findPublished()`로 다시 읽어 재생한다(isDuplicateEvent).
   */
  async publishOnce(
    tx: Prisma.TransactionClient,
    event: OutboxEventInput & { eventId: string },
  ): Promise<{ eventId: string; created: boolean; payload: Prisma.JsonValue }> {
    const existing = await this.repo.findByEventId(tx, event.eventId);
    if (existing) {
      return {
        eventId: existing.event_id,
        created: false,
        payload: existing.payload_json,
      };
    }
    await this.publish(tx, event);
    return {
      eventId: event.eventId,
      created: true,
      payload: event.payload as Prisma.JsonValue,
    };
  }

  /** tx 밖 조회 — 동시 멱등 요청에서 진 쪽이 승자의 이벤트를 재생할 때. */
  async findPublished(
    eventId: string,
  ): Promise<{ eventId: string; payload: Prisma.JsonValue } | null> {
    const row = await this.repo.findByEventId(this.repo.reader, eventId);
    return row ? { eventId: row.event_id, payload: row.payload_json } : null;
  }

  static isDuplicateEvent(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      uniqueConstraintName(error) === 'uk_outbox_event'
    );
  }
}
