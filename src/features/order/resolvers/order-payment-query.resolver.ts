import { Query, Resolver } from '@nestjs/graphql';

import { PAYMENT_BANKS } from '@/features/order/constants/payment-banks';
import type { BankOutput } from '@/features/order/types/order-payment-output.type';

/** 계좌 입력 화면의 은행 목록. 고정 목록이라 로그인 없이 연다. */
@Resolver('Query')
export class PaymentQueryResolver {
  @Query('paymentBanks')
  paymentBanks(): readonly BankOutput[] {
    return PAYMENT_BANKS;
  }
}
