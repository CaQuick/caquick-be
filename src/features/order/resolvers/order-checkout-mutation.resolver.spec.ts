import { ClockService } from '@/common/providers/clock.service';
import { RandomService } from '@/common/providers/random.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { OrderCustomUploadRepository } from '@/features/order/repositories/order-custom-upload.repository';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import { PaymentSettingRepository } from '@/features/order/repositories/payment-setting.repository';
import { OrderCheckoutMutationResolver } from '@/features/order/resolvers/order-checkout-mutation.resolver';
import { OrderCheckoutService } from '@/features/order/services/order-checkout.service';
import { OrderCustomizationService } from '@/features/order/services/order-customization.service';
import { ProductRepository } from '@/features/product';
import { StorePickupScheduleService } from '@/features/store';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import type { JwtUser } from '@/global/auth';
import { bookedQuantityProviders } from '@/test/booked-quantity';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createPaymentSetting,
  createProduct,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { outboxPublisherProviders } from '@/test/outbox';
import { s3TestProviders } from '@/test/storage/s3-test.helper';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://mock-presigned-url.com'),
}));

// 2026-09-16(수) 16:00 KST 고정
const NOW = new Date('2026-09-16T07:00:00.000Z');

// 옵션·픽업·가격 분기 세부 검증은 service.spec.ts에서 담당. 여기서는 리졸버→서비스→DB 경로만 본다.
describe('OrderCheckout Mutation Resolver (real DB)', () => {
  let resolver: OrderCheckoutMutationResolver;
  let clock: ClockService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        OrderCheckoutMutationResolver,
        OrderCheckoutService,
        OrderCustomizationService,
        OrderRepository,
        OrderCustomUploadRepository,
        ...s3TestProviders(),
        PaymentSettingRepository,
        ProductRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        StorePickupScheduleService,
        StoreRepository,
        ClockService,
        RandomService,
        // 발행 repository가 OutboxPublisher를 주입받는다(08b)
        ...outboxPublisherProviders({ clock: true }),
        ...bookedQuantityProviders(),
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
    // truncateAll이 마이그레이션이 넣은 결제 설정 행까지 지운다
    await createPaymentSetting(prisma);
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
      idempotencyKey: 'resolver-idem-key-1',
      productId: product.id.toString(),
      optionItemIds: [],
      pickupAt: new Date('2026-09-18T05:00:00.000Z'), // 9/18(금) 14:00 KST
      expectedTotalPrice: 20000,
      requestNote: '초는 빼 주세요',
    });

    expect(result.status).toBe('PENDING_PAYMENT');
    expect(result.totalPrice).toBe(20000);
    expect(result.payment).toMatchObject({ amount: 20000, status: 'PENDING' });
    const saved = await prisma.order.findUniqueOrThrow({
      where: { id: BigInt(result.orderId) },
    });
    expect(saved.account_id).toBe(account.id);
    expect(saved.request_note).toBe('초는 빼 주세요');
  });

  it('createOrderCustomUploadUrl: 구매자에게 용도별 업로드 URL을 발급하고 기록한다', async () => {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: account.id });
    const user = { accountId: account.id.toString() } as JwtUser;

    const result = await resolver.createOrderCustomUploadUrl(
      user,
      'COMPOSITE',
      'image/png',
      1024,
    );

    expect(result.key).toMatch(
      new RegExp(`^order-custom/composites/${account.id}/`),
    );
    await expect(
      prisma.orderCustomUpload.findUniqueOrThrow({
        where: { object_key: result.key },
      }),
    ).resolves.toMatchObject({ account_id: account.id, purpose: 'COMPOSITE' });
  });
});
