import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ClockService } from '@/common/providers/clock.service';
import { parseId } from '@/common/utils/id-parser';
import type { ExpoPushConfig } from '@/config/expo-push.config';
import {
  CONVERSATION_BUYER_MESSAGE_SENT,
  parseConversationBuyerMessageSentPayload,
} from '@/features/conversation';
import {
  EXPO_ERROR_DEVICE_NOT_REGISTERED,
  EXPO_ERROR_UNKNOWN,
  PUSH_DEVICE_DISABLED_REASON,
} from '@/features/notification/constants/seller-push.constants';
import {
  SellerPushDeliveryRepository,
  type TicketResult,
} from '@/features/notification/repositories/seller-push-delivery.repository';
import { SellerPushDeviceRepository } from '@/features/notification/repositories/seller-push-device.repository';
import {
  buildBuyerMessagePush,
  buildOrderSubmittedPush,
  SELLER_PUSH_CHANNEL_ID,
  type SellerPushContent,
} from '@/features/notification/services/seller-push-messages.helper';
import { ORDER_SUBMITTED, parseOrderSubmittedPayload } from '@/features/order';
import {
  type OutboxConsumer,
  type OutboxEvent,
  SubscribeOutbox,
} from '@/features/outbox';
import { AlertService } from '@/global/alerting';
import {
  EXPO_PUSH_SEND_LIMIT,
  EXPO_PUSH_TRANSPORT,
  ExpoPushAuthError,
  type ExpoPushTicket,
  type ExpoPushTransport,
} from '@/global/expo-push';
import { MetricsService } from '@/global/metrics';

/**
 * 판매자 앱 푸시 전송(outbox 소비자, worker). 이벤트 payload 스냅샷으로 메시지를 만들고 매장의 활성 디바이스에 보낸다.
 * 재전달은 (source_event_id, push_device_id) 행으로 흡수한다 — ticket이 기록된 디바이스에는 다시 보내지 않는다.
 * 전송 실패(네트워크·5xx·429)는 던져 호스트의 retry/DLQ에 맡기고, 인증 실패는 경보를 낸 뒤 던진다.
 */
@Injectable()
@SubscribeOutbox(ORDER_SUBMITTED, CONVERSATION_BUYER_MESSAGE_SENT)
export class SellerPushOutboxConsumer implements OutboxConsumer {
  private readonly logger = new Logger(SellerPushOutboxConsumer.name);

  constructor(
    private readonly config: ConfigService,
    private readonly devices: SellerPushDeviceRepository,
    private readonly deliveries: SellerPushDeliveryRepository,
    private readonly clock: ClockService,
    private readonly alerts: AlertService,
    private readonly metrics: MetricsService,
    @Inject(EXPO_PUSH_TRANSPORT) private readonly transport: ExpoPushTransport,
  ) {}

  async handle(event: OutboxEvent): Promise<void> {
    const cfg = this.config.getOrThrow<ExpoPushConfig>('expoPush');
    if (!cfg.enabled) {
      // 꺼진 동안의 이벤트는 복구하지 않는다 — retry 큐에 쌓이면 상한 뒤 DLQ 경보만 는다
      this.logger.debug(
        `EXPO_PUSH_ENABLED=false — ${event.eventType}#${event.eventId} 전송 생략`,
      );
      return;
    }
    const { storeId, content } = this.contentOf(event);
    const devices = await this.devices.listActiveByStore(storeId);
    if (devices.length === 0) return;

    const pending = await this.deliveries.claim(
      event.eventId,
      devices.map((device) => device.id),
    );
    const tokenByDevice = new Map(
      devices.map((device) => [device.id.toString(), device.expo_push_token]),
    );
    const options = {
      accessToken: cfg.accessToken,
      timeoutMs: cfg.requestTimeoutMs,
    };
    for (let i = 0; i < pending.length; i += EXPO_PUSH_SEND_LIMIT) {
      const chunk = pending.slice(i, i + EXPO_PUSH_SEND_LIMIT);
      const messages = chunk.map((row) => ({
        to: tokenByDevice.get(row.push_device_id.toString()) as string,
        ...content,
        channelId: SELLER_PUSH_CHANNEL_ID,
      }));
      let tickets: ExpoPushTicket[];
      try {
        tickets = await this.transport.send(messages, options);
      } catch (error) {
        if (error instanceof ExpoPushAuthError) {
          this.metrics.expoPushSends.inc(
            { result: 'AUTH_ERROR' },
            messages.length,
          );
          await this.alerts.notify({
            level: 'error',
            title: 'Expo 푸시 인증 실패',
            key: 'expo-push:auth',
            detail: `${error.message} — EXPO_PUSH_ACCESS_TOKEN 확인. 이벤트 ${event.eventId}`,
          });
        }
        throw error;
      }
      const sentAt = this.clock.now();
      const results: TicketResult[] = [];
      const notRegistered: bigint[] = [];
      const codes: string[] = [];
      chunk.forEach((row, index) => {
        const ticket = tickets[index];
        if (ticket.status === 'ok') {
          results.push({
            id: row.id,
            status: 'TICKET_OK',
            ticketId: ticket.id,
            sentAt,
          });
          return;
        }
        const errorCode = ticket.details?.error ?? EXPO_ERROR_UNKNOWN;
        results.push({ id: row.id, status: 'TICKET_ERROR', errorCode, sentAt });
        codes.push(errorCode);
        if (errorCode === EXPO_ERROR_DEVICE_NOT_REGISTERED)
          notRegistered.push(row.push_device_id);
      });
      await this.deliveries.markTickets(results);
      await this.devices.disableByIds(
        notRegistered,
        PUSH_DEVICE_DISABLED_REASON.DEVICE_NOT_REGISTERED,
        sentAt,
      );
      for (const result of results) {
        this.metrics.expoPushSends.inc({ result: result.status });
      }
      if (codes.length > 0) {
        this.logger.warn(`Expo ticket 오류 ${codes.length}건`, {
          eventId: event.eventId,
          codes,
        });
      }
    }
  }

  private contentOf(event: OutboxEvent): {
    storeId: bigint;
    content: SellerPushContent;
  } {
    switch (event.eventType) {
      case ORDER_SUBMITTED: {
        const p = parseOrderSubmittedPayload(event.payload);
        return {
          storeId: parseId(p.storeId),
          content: buildOrderSubmittedPush(p),
        };
      }
      case CONVERSATION_BUYER_MESSAGE_SENT: {
        const p = parseConversationBuyerMessageSentPayload(event.payload);
        return {
          storeId: parseId(p.storeId),
          content: buildBuyerMessagePush(p),
        };
      }
      default:
        throw new Error(`구독하지 않은 outbox 이벤트: ${event.eventType}`);
    }
  }
}
