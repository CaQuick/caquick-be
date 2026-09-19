import { Injectable } from '@nestjs/common';

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
    return { eventId: row.event_id };
  }

  /**
   * 멱등 발행 — 같은 eventId가 이미 있으면 적재하지 않고 그 payload를 돌려준다(요청 재생용).
   * 존재 확인 뒤 적재하고, 그 사이 경쟁으로 unique에 걸리면 다시 읽는다.
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
    try {
      await this.publish(tx, event);
      return {
        eventId: event.eventId,
        created: true,
        payload: event.payload as Prisma.JsonValue,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        uniqueConstraintName(error) === 'uk_outbox_event'
      ) {
        const raced = await this.repo.findByEventId(tx, event.eventId);
        if (raced) {
          return {
            eventId: raced.event_id,
            created: false,
            payload: raced.payload_json,
          };
        }
      }
      throw error;
    }
  }
}
