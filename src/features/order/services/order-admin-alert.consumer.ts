import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AdminWebConfig } from '@/config/admin-web.config';
import {
  ORDER_PAYMENT_PENDING,
  parseOrderPaymentPendingPayload,
} from '@/features/order/events/order-payment-pending.event';
import {
  parsePaymentDepositClaimedPayload,
  PAYMENT_DEPOSIT_CLAIMED,
} from '@/features/order/events/payment-deposit-claimed.event';
import {
  buildDepositClaimedAlert,
  buildDepositPendingAlert,
} from '@/features/order/services/order-admin-alert-messages.helper';
import {
  type OutboxConsumer,
  type OutboxEvent,
  SubscribeOutbox,
} from '@/features/outbox';
import { AlertService, type AlertMessage } from '@/global/alerting';

/**
 * 관리자 처리 대기 알림(디스코드, info). 상태를 바꾸지 않는다 — 재전달 중복은 AlertService 억제 창(건별 key) 안에서만
 * 막고, 창이 지난 재전달은 같은 알림이 다시 갈 수 있다(진실은 adminTaskCounts·처리 대기 목록).
 */
@Injectable()
@SubscribeOutbox(ORDER_PAYMENT_PENDING, PAYMENT_DEPOSIT_CLAIMED)
export class OrderAdminAlertConsumer implements OutboxConsumer {
  constructor(
    private readonly alerts: AlertService,
    private readonly config: ConfigService,
  ) {}

  async handle(event: OutboxEvent): Promise<void> {
    await this.alerts.notify(this.messageOf(event));
  }

  private messageOf(event: OutboxEvent): AlertMessage {
    const { baseUrl } = this.config.getOrThrow<AdminWebConfig>('adminWeb');
    switch (event.eventType) {
      case ORDER_PAYMENT_PENDING:
        return buildDepositPendingAlert(
          parseOrderPaymentPendingPayload(event.payload),
          baseUrl,
        );
      case PAYMENT_DEPOSIT_CLAIMED:
        return buildDepositClaimedAlert(
          parsePaymentDepositClaimedPayload(event.payload),
          baseUrl,
        );
      default:
        throw new Error(`구독하지 않은 outbox 이벤트: ${event.eventType}`);
    }
  }
}
