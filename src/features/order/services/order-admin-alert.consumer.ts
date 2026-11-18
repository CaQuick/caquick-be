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
  parseRefundAccountSubmittedPayload,
  REFUND_ACCOUNT_SUBMITTED,
} from '@/features/order/events/refund-account-submitted.event';
import {
  parseRefundRequestedPayload,
  REFUND_REQUESTED,
} from '@/features/order/events/refund-requested.event';
import {
  parseSettlementCreatedPayload,
  SETTLEMENT_CREATED,
} from '@/features/order/events/settlement-created.event';
import {
  buildDepositClaimedAlert,
  buildDepositPendingAlert,
  buildRefundReadyAlert,
  buildSettlementCreatedAlert,
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
@SubscribeOutbox(
  ORDER_PAYMENT_PENDING,
  PAYMENT_DEPOSIT_CLAIMED,
  REFUND_REQUESTED,
  REFUND_ACCOUNT_SUBMITTED,
  SETTLEMENT_CREATED,
)
export class OrderAdminAlertConsumer implements OutboxConsumer {
  constructor(
    private readonly alerts: AlertService,
    private readonly config: ConfigService,
  ) {}

  async handle(event: OutboxEvent): Promise<void> {
    const message = this.messageOf(event);
    if (message) await this.alerts.notify(message);
  }

  private messageOf(event: OutboxEvent): AlertMessage | null {
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
      case REFUND_REQUESTED: {
        const p = parseRefundRequestedPayload(event.payload);
        // 계좌가 아직 없으면 구매자 계좌 요청 알림만 간다(알림 소비자)
        return p.accountSubmitted ? buildRefundReadyAlert(p, baseUrl) : null;
      }
      case REFUND_ACCOUNT_SUBMITTED:
        return buildRefundReadyAlert(
          parseRefundAccountSubmittedPayload(event.payload),
          baseUrl,
        );
      case SETTLEMENT_CREATED:
        return buildSettlementCreatedAlert(
          parseSettlementCreatedPayload(event.payload),
          baseUrl,
        );
      default:
        throw new Error(`구독하지 않은 outbox 이벤트: ${event.eventType}`);
    }
  }
}
