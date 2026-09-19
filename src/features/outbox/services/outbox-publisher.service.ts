import { Injectable } from '@nestjs/common';

import { ClockService } from '@/common/providers/clock.service';
import { IdGenerator } from '@/common/providers/id-generator.service';
import {
  normalizeIpForPersistence,
  normalizeUserAgentForPersistence,
} from '@/common/utils/http-meta';
import { OutboxRepository } from '@/features/outbox/repositories/outbox.repository';
import type { OutboxEventInput } from '@/features/outbox/types/outbox-event.type';
import type { Prisma } from '@/generated/prisma/client';
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
      eventId: this.ids.uuid(),
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
}
