import type { PrismaClient } from '@prisma/client';

import { ClockService } from '@/common/providers/clock.service';
import { RandomService } from '@/common/providers/random.service';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import { OrderCheckoutMutationResolver } from '@/features/order/resolvers/order-checkout-mutation.resolver';
import { OrderCheckoutService } from '@/features/order/services/order-checkout.service';
import { ProductRepository } from '@/features/product';
import { StorePickupScheduleService } from '@/features/store';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import type { JwtUser } from '@/global/auth';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createProduct,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 2026-09-16(수) 16:00 KST 고정
const NOW = new Date('2026-09-16T07:00:00.000Z');

/**
 * Resolver ↔ Service ↔ Repository ↔ DB 통합 경로 검증.
 * 옵션·픽업·가격 분기 세부 검증은 service.spec.ts에서 담당.
 */
describe('OrderCheckout Mutation Resolver (real DB)', () => {
  let resolver: OrderCheckoutMutationResolver;
  let clock: ClockService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        OrderCheckoutMutationResolver,
        OrderCheckoutService,
        OrderRepository,
        ProductRepository,
        StorePickupScheduleService,
        StoreRepository,
        ClockService,
        RandomService,
      ],
    });
    resolver = module.get(OrderCheckoutMutationResolver);
    clock = module.get(ClockService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
    jest.spyOn(clock, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('createOrder: ID 문자열을 파싱해 주문을 생성하고 요약을 반환한다', async () => {
    const store = await createStore(prisma);
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
      await prisma.storeBusinessHour.create({
        data: {
          store_id: store.id,
          day_of_week: dayOfWeek,
          is_closed: false,
          open_time: new Date(Date.UTC(1970, 0, 1, 10)),
          close_time: new Date(Date.UTC(1970, 0, 1, 20)),
        },
      });
    }
    const product = await createProduct(prisma, {
      store_id: store.id,
      regular_price: 20000,
    });
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, {
      account_id: account.id,
      phone_number: '010-1111-2222',
    });
    const user = { accountId: account.id.toString() } as JwtUser;

    const result = await resolver.createOrder(user, {
      productId: product.id.toString(),
      optionItemIds: [],
      pickupAt: new Date('2026-09-18T05:00:00.000Z'), // 9/18(금) 14:00 KST
    });

    expect(result.status).toBe('SUBMITTED');
    expect(result.totalPrice).toBe(20000);
    const saved = await prisma.order.findUniqueOrThrow({
      where: { id: BigInt(result.orderId) },
    });
    expect(saved.account_id).toBe(account.id);
  });
});
