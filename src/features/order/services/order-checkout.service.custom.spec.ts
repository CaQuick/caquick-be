import { ClockService } from '@/common/providers/clock.service';
import { RandomService } from '@/common/providers/random.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import type {
  CreateOrderCustomInput,
  CreateOrderSlotCustomInput,
  CreateOrderThreeDCustomInput,
} from '@/features/order/dto/inputs/create-order-custom.input';
import type { CreateOrderInput } from '@/features/order/dto/inputs/create-order.input';
import { OrderCustomUploadRepository } from '@/features/order/repositories/order-custom-upload.repository';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import { PaymentSettingRepository } from '@/features/order/repositories/payment-setting.repository';
import { OrderCheckoutService } from '@/features/order/services/order-checkout.service';
import { OrderCustomizationService } from '@/features/order/services/order-customization.service';
import { OutboxPublisher } from '@/features/outbox/services/outbox-publisher.service';
import { ProductRepository } from '@/features/product';
import { StorePickupScheduleService } from '@/features/store';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import type {
  Account,
  CustomImageKind,
  OrderCustomUploadPurpose,
  PrismaClient,
  Product,
} from '@/generated/prisma/client';
import { UPLOAD_POLICIES } from '@/global/storage/constants/storage.constants';
import { bookedQuantityProviders } from '@/test/booked-quantity';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createCustomTemplate,
  createCustomTextToken,
  createOrderCustomUpload,
  createPaymentSetting,
  createProduct,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { outboxPublisherProviders } from '@/test/outbox';
import { s3TestProviders, TEST_S3_CONFIG } from '@/test/storage/s3-test.helper';

// 2026-09-16(수) 16:00 KST 고정
const NOW = new Date('2026-09-16T07:00:00.000Z');
/** 2026-09-18(금) 14:00 KST */
const PICKUP_AT = new Date('2026-09-18T05:00:00.000Z');

const PURPOSE_POLICY = {
  RENDER: UPLOAD_POLICIES.ORDER_CUSTOM_RENDER,
  COMPOSITE: UPLOAD_POLICIES.ORDER_CUSTOM_COMPOSITE,
  REFERENCE: UPLOAD_POLICIES.ORDER_CUSTOM_REFERENCE,
} as const;
const RENDER_KINDS = [
  'THREE_D_TOP',
  'THREE_D_FRONT',
  'THREE_D_BACK',
  'THREE_D_LEFT',
  'THREE_D_RIGHT',
] as const satisfies readonly CustomImageKind[];

describe('OrderCheckoutService 커스텀 주문 (real DB)', () => {
  let service: OrderCheckoutService;
  let orderRepo: OrderRepository;
  let uploads: OrderCustomUploadRepository;
  let outbox: OutboxPublisher;
  let clock: ClockService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
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
        ...outboxPublisherProviders({ clock: true }),
        ...bookedQuantityProviders(),
      ],
    });
    service = module.get(OrderCheckoutService);
    orderRepo = module.get(OrderRepository);
    uploads = module.get(OrderCustomUploadRepository);
    outbox = module.get(OutboxPublisher);
    clock = module.get(ClockService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
    await createPaymentSetting(prisma);
    jest.spyOn(clock, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function makeOpenStoreId(): Promise<bigint> {
    const store = await createStore(prisma, {
      pickup_slot_interval_minutes: 30,
      min_lead_time_minutes: 60,
    });
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
    return store.id;
  }

  async function makeBuyer(): Promise<Account> {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, {
      account_id: account.id,
      phone_number: '010-1234-5678',
    });
    return account;
  }

  /** 발급 기록이 있는 본인 업로드의 공개 URL. */
  async function upload(
    buyer: Account,
    purpose: OrderCustomUploadPurpose,
    name: string,
    row: Parameters<typeof createOrderCustomUpload>[1] = {},
  ): Promise<string> {
    const key = `${PURPOSE_POLICY[purpose].keyPrefix}/${buyer.id}/2026-09-16/${name}`;
    await createOrderCustomUpload(prisma, {
      account_id: buyer.id,
      purpose,
      object_key: key,
      ...row,
    });
    return `https://${TEST_S3_CONFIG.bucket}.s3.${TEST_S3_CONFIG.region}.amazonaws.com/${key}`;
  }

  async function uploadStatuses() {
    const rows = await prisma.orderCustomUpload.findMany({
      orderBy: { object_key: 'asc' },
    });
    return rows.map((row) => [row.object_key.split('/').pop(), row.status]);
  }

  let idemSeq = 0;
  function input(
    product: Product,
    expectedTotalPrice: number,
    custom: CreateOrderCustomInput,
    overrides: Partial<CreateOrderInput> = {},
  ): CreateOrderInput {
    idemSeq += 1;
    return {
      idempotencyKey: `custom-idem-${idemSeq}`,
      productId: product.id.toString(),
      optionItemIds: [],
      pickupAt: PICKUP_AT,
      expectedTotalPrice,
      custom,
      ...overrides,
    };
  }

  describe('슬롯형', () => {
    /** 정가 30000·판매가 25000, 필수 자리(이름)·선택 자리(문구), 자유 편집 켜짐. */
    async function setup() {
      const buyer = await makeBuyer();
      const product = await createProduct(prisma, {
        store_id: await makeOpenStoreId(),
        regular_price: 30000,
        sale_price: 25000,
      });
      await prisma.product.update({
        where: { id: product.id },
        data: { custom_mode: 'SLOT' },
      });
      const template = await createCustomTemplate(prisma, {
        product_id: product.id,
        base_image_url: 'https://i.example/base-square.png',
        free_edit_enabled: true,
        revision: 4,
      });
      const name = await createCustomTextToken(prisma, {
        template_id: template.id,
        token_key: 'name',
        label: '이름',
        default_text: '민지',
        max_length: 10,
        sort_order: 0,
        pos_x: 1000,
        pos_y: 1000,
        width: 8000,
        height: 1000,
        text_color: '#FF8800',
        text_align: 'LEFT',
      });
      const phrase = await createCustomTextToken(prisma, {
        template_id: template.id,
        token_key: 'phrase',
        label: '문구',
        default_text: '축하해',
        is_required: false,
        sort_order: 1,
      });
      const composite = await upload(buyer, 'COMPOSITE', 'composite.png');
      const reference = await upload(buyer, 'REFERENCE', 'ref.png');
      const slot: CreateOrderSlotCustomInput = {
        templateRevision: 4,
        texts: [
          { tokenId: phrase.id.toString(), valueText: null },
          { tokenId: name.id.toString(), valueText: '지수\r\n🎂' },
        ],
        compositeImageUrl: composite,
        freeEdits: [
          {
            posX: 0,
            posY: 5000,
            width: 10000,
            height: 5000,
            descriptionText: ' 아래쪽에 꽃 ',
            referenceImageUrls: [reference],
          },
        ],
      };
      return { buyer, product, name, phrase, composite, reference, slot };
    }

    it('문구 자리·자유 편집·합성 이미지를 스냅샷하고 업로드를 ATTACHED로 바꾼다(추가 금액 없음)', async () => {
      const { buyer, product, name, phrase, composite, reference, slot } =
        await setup();

      const created = await service.createOrder(
        buyer.id,
        input(product, 25000, { slot }),
      );

      expect(created.totalPrice).toBe(25000);
      const item = await prisma.orderItem.findFirstOrThrow({
        where: { order_id: BigInt(created.orderId) },
        include: {
          custom_texts: { orderBy: { sort_order: 'asc' } },
          free_edits: { include: { attachments: true } },
          custom_images: true,
          custom_design: true,
        },
      });
      expect(item).toMatchObject({
        quantity: 1,
        item_subtotal_price: 25000,
        custom_mode_snapshot: 'SLOT',
        custom_base_image_url_snapshot: 'https://i.example/base-square.png',
        custom_preview_image_url: composite,
        custom_design: null,
        custom_images: [{ kind: 'SLOT_COMPOSITE', image_url: composite }],
      });
      expect(item.custom_texts).toMatchObject([
        {
          token_id: name.id,
          token_key_snapshot: 'name',
          label_snapshot: '이름',
          default_text_snapshot: '민지',
          value_text: '지수\n🎂',
          sort_order: 0,
          pos_x: 1000,
          pos_y: 1000,
          width: 8000,
          height: 1000,
          text_color: '#FF8800',
          text_align: 'LEFT',
        },
        {
          token_id: phrase.id,
          label_snapshot: '문구',
          default_text_snapshot: '축하해',
          value_text: null,
        },
      ]);
      expect(item.free_edits).toMatchObject([
        {
          pos_x: 0,
          pos_y: 5000,
          width: 10000,
          height: 5000,
          description_text: '아래쪽에 꽃',
          sort_order: 0,
          attachments: [{ image_url: reference, sort_order: 0 }],
        },
      ]);
      expect(await uploadStatuses()).toEqual([
        ['composite.png', 'ATTACHED'],
        ['ref.png', 'ATTACHED'],
      ]);
      const attached = await prisma.orderCustomUpload.findFirstOrThrow();
      expect(attached.attached_at).toEqual(NOW);
    });

    it('한 번 주문에 쓴 이미지는 다른 주문에 쓸 수 없다', async () => {
      const { buyer, product, slot } = await setup();
      await service.createOrder(buyer.id, input(product, 25000, { slot }));

      await expect(
        service.createOrder(buyer.id, input(product, 25000, { slot })),
      ).rejects.toThrowDomain('CUSTOM_UPLOAD_INVALID');
      expect(await prisma.order.count()).toBe(1);
    });

    it.each<[string, Parameters<typeof createOrderCustomUpload>[1], string]>([
      [
        '다른 주문에 붙은 업로드',
        { status: 'ATTACHED' },
        'CUSTOM_UPLOAD_INVALID',
      ],
      [
        '정리 중인 업로드',
        { status: 'PURGING', purge_started_at: NOW },
        'CUSTOM_UPLOAD_EXPIRED',
      ],
      [
        '기록의 용도가 다른 업로드',
        { purpose: 'RENDER' },
        'CUSTOM_UPLOAD_INVALID',
      ],
    ])('%s는 거절하고 주문·연결을 남기지 않는다', async (_case, row, code) => {
      const { buyer, product, slot } = await setup();
      slot.freeEdits![0].referenceImageUrls = [
        await upload(buyer, 'REFERENCE', 'bad.png', row),
      ];

      await expect(
        service.createOrder(buyer.id, input(product, 25000, { slot })),
      ).rejects.toThrowDomain(code);
      expect(await prisma.order.count()).toBe(0);
      expect(
        await prisma.orderCustomUpload.count({
          where: { status: 'ATTACHED', attached_at: NOW },
        }),
      ).toBe(0);
    });

    it('발급 기록이 없는 본인 경로 URL·다른 계정 기록·대소문자만 같은 키면 CUSTOM_UPLOAD_INVALID다', async () => {
      const { buyer, product, slot } = await setup();
      const other = await createAccount(prisma, { account_type: 'USER' });
      const unissued = `https://${TEST_S3_CONFIG.bucket}.s3.${TEST_S3_CONFIG.region}.amazonaws.com/order-custom/references/${buyer.id}/2026-09-16/none.png`;
      const othersRow = await upload(buyer, 'REFERENCE', 'other.png', {
        account_id: other.id,
      });
      // 키 컬럼 콜레이션은 대소문자를 가리지 않는다 — 다른 키로 같은 행을 붙이지 못해야 한다
      const caseVariant = (
        await upload(buyer, 'REFERENCE', 'case.png')
      ).replace('case.png', 'CASE.png');

      for (const url of [unissued, othersRow, caseVariant]) {
        slot.freeEdits![0].referenceImageUrls = [url];
        await expect(
          service.createOrder(buyer.id, input(product, 25000, { slot })),
        ).rejects.toThrowDomain('CUSTOM_UPLOAD_INVALID');
      }
      expect(await prisma.order.count()).toBe(0);
    });

    it('주문 tx가 연결 뒤에 실패하면 업로드는 PENDING으로 남는다', async () => {
      const { buyer, product, slot } = await setup();
      jest
        .spyOn(outbox, 'publish')
        .mockRejectedValueOnce(new Error('outbox down'));

      await expect(
        service.createOrder(buyer.id, input(product, 25000, { slot })),
      ).rejects.toThrow('outbox down');

      expect(await prisma.order.count()).toBe(0);
      expect(await prisma.orderItemCustomText.count()).toBe(0);
      expect(await uploadStatuses()).toEqual([
        ['composite.png', 'PENDING'],
        ['ref.png', 'PENDING'],
      ]);
      // 같은 업로드로 다시 주문할 수 있다
      await expect(
        service.createOrder(buyer.id, input(product, 25000, { slot })),
      ).resolves.toMatchObject({ status: 'PENDING_PAYMENT' });
    });

    it('주문 tx가 업로드를 잠근 동안 돈 정리 크론은 그 업로드를 잡지 못하고, 주문이 ATTACHED로 붙인다', async () => {
      const { buyer, product, slot } = await setup();
      // 잠금 검사와 ATTACHED 표시 사이에 크론이 끼어드는 경우를 재현한다(크론은 별도 커넥션)
      const repo = orderRepo as unknown as {
        insertPendingPaymentOrder: (...args: unknown[]) => Promise<unknown>;
      };
      const insert = repo.insertPendingPaymentOrder.bind(orderRepo);
      let claimed: unknown[] | undefined;
      jest
        .spyOn(repo, 'insertPendingPaymentOrder')
        .mockImplementation(async (...args) => {
          claimed = await uploads.claimForPurge({
            now: NOW,
            pendingCreatedBefore: new Date('2100-01-01T00:00:00.000Z'),
            purgingStartedBefore: NOW,
            limit: 10,
          });
          return insert(...args);
        });

      await service.createOrder(buyer.id, input(product, 25000, { slot }));

      expect(claimed).toEqual([]);
      expect(await uploadStatuses()).toEqual([
        ['composite.png', 'ATTACHED'],
        ['ref.png', 'ATTACHED'],
      ]);
    });

    it('같은 키·같은 커스텀 입력의 재요청은 기존 주문을 돌려주고, 커스텀만 달라도 IDEMPOTENCY_KEY_INPUT_MISMATCH다', async () => {
      const { buyer, product, slot } = await setup();
      const first = input(product, 25000, { slot });
      const created = await service.createOrder(buyer.id, first);

      await expect(
        service.createOrder(buyer.id, {
          ...first,
          custom: { slot: { ...slot, texts: [...slot.texts].reverse() } },
        }),
      ).resolves.toEqual(created);
      await expect(
        service.createOrder(buyer.id, {
          ...first,
          custom: {
            slot: {
              ...slot,
              texts: [slot.texts[0], { ...slot.texts[1], valueText: '지수' }],
            },
          },
        }),
      ).rejects.toThrowDomain('IDEMPOTENCY_KEY_INPUT_MISMATCH');
      expect(await prisma.order.count()).toBe(1);
    });

    it('같은 키 재시도가 사전 조회를 지나 업로드 잠금에서 걸리면 내 주문을 replay한다', async () => {
      const { buyer, product, slot } = await setup();
      const first = input(product, 25000, { slot });
      const created = await service.createOrder(buyer.id, first);

      const raceOnce = () =>
        jest
          .spyOn(orderRepo, 'findOrderByIdempotencyKey')
          .mockResolvedValueOnce(null);
      raceOnce();
      await expect(service.createOrder(buyer.id, first)).resolves.toEqual(
        created,
      );
      raceOnce();
      await expect(
        service.createOrder(buyer.id, { ...first, requestNote: '다른 메모' }),
      ).rejects.toThrowDomain('IDEMPOTENCY_KEY_INPUT_MISMATCH');
      expect(await prisma.order.count()).toBe(1);
    });

    it('판매자가 설정을 바꿨으면(revision) 주문을 만들지 않고 업로드도 그대로 둔다', async () => {
      const { buyer, product, slot } = await setup();
      await prisma.productCustomTemplate.update({
        where: { product_id: product.id },
        data: { revision: 5 },
      });

      await expect(
        service.createOrder(buyer.id, input(product, 25000, { slot })),
      ).rejects.toThrowDomain('CUSTOM_TEMPLATE_CHANGED');
      expect(await prisma.order.count()).toBe(0);
      expect(await uploadStatuses()).toEqual([
        ['composite.png', 'PENDING'],
        ['ref.png', 'PENDING'],
      ]);
    });
  });

  describe('3D', () => {
    /** 정가 20000, 모양(하트 +1000)·크기(1호 +5000) 필수 그룹. */
    async function setup() {
      const buyer = await makeBuyer();
      const product = await createProduct(prisma, {
        store_id: await makeOpenStoreId(),
        regular_price: 20000,
      });
      await prisma.product.update({
        where: { id: product.id },
        data: { custom_mode: 'THREE_D' },
      });
      const items: bigint[] = [];
      for (const [name, key, delta] of [
        ['모양', 'shape.heart', 1000],
        ['크기', 'size.no1', 5000],
      ] as const) {
        const group = await prisma.productOptionGroup.create({
          data: { product_id: product.id, name, min_select: 1, max_select: 1 },
        });
        const item = await prisma.productOptionItem.create({
          data: {
            option_group_id: group.id,
            title: name,
            price_delta: delta,
            three_d_key: key,
          },
        });
        items.push(item.id);
      }
      const renders: { kind: CustomImageKind; imageUrl: string }[] = [];
      for (const kind of RENDER_KINDS) {
        renders.push({
          kind,
          imageUrl: await upload(buyer, 'RENDER', `${kind}.png`),
        });
      }
      const threeD: CreateOrderThreeDCustomInput = {
        design: {
          schemaVersion: 1,
          basic: { shape: 'heart', size: 'no1', sheetColor: 'white' },
          top: [
            {
              kind: 'TEXT',
              x: 0.5,
              y: 0.5,
              size: 10,
              effect: { type: 'none', intensity: 50 },
              text: '축하해',
              color: '#ff0000',
            },
          ],
          side: [],
        },
        renderImages: renders,
      };
      return {
        buyer,
        product,
        optionItemIds: items.map(String),
        renders,
        threeD,
      };
    }

    it('디자인 JSON v1과 렌더 5장을 저장하고 윗면을 대표 이미지로 둔다(가격은 옵션 추가금만)', async () => {
      const { buyer, product, optionItemIds, renders, threeD } = await setup();

      const created = await service.createOrder(
        buyer.id,
        input(product, 26000, { threeD }, { optionItemIds }),
      );

      expect(created.totalPrice).toBe(26000);
      const item = await prisma.orderItem.findFirstOrThrow({
        where: { order_id: BigInt(created.orderId) },
        include: {
          custom_design: true,
          custom_images: { orderBy: { kind: 'asc' } },
          custom_texts: true,
          free_edits: true,
        },
      });
      expect(item).toMatchObject({
        custom_mode_snapshot: 'THREE_D',
        custom_base_image_url_snapshot: null,
        custom_preview_image_url: renders[0].imageUrl,
        custom_texts: [],
        free_edits: [],
        custom_design: {
          schema_version: 1,
          design_json: {
            schemaVersion: 1,
            basic: {
              shape: 'heart',
              size: 'no1',
              design: null,
              flavor: null,
              sheetColor: 'white',
            },
            top: [{ kind: 'TEXT', text: '축하해', color: '#FF0000' }],
            side: [],
          },
        },
      });
      expect(
        item.custom_images.map((image) => [image.kind, image.image_url]),
      ).toEqual(renders.map((r) => [r.kind, r.imageUrl]));
      expect(
        await prisma.orderCustomUpload.count({ where: { status: 'ATTACHED' } }),
      ).toBe(5);
    });

    it('고른 옵션과 디자인이 다르면 CUSTOM_3D_OPTIONS_CHANGED다', async () => {
      const { buyer, product, optionItemIds, threeD } = await setup();
      threeD.design.basic.size = 'mini';

      await expect(
        service.createOrder(
          buyer.id,
          input(product, 26000, { threeD }, { optionItemIds }),
        ),
      ).rejects.toThrowDomain('CUSTOM_3D_OPTIONS_CHANGED');
      expect(await prisma.order.count()).toBe(0);
    });

    it('3D 상품을 커스텀 없이 주문하면 CUSTOM_INPUT_REQUIRED다', async () => {
      const { buyer, product, optionItemIds } = await setup();

      await expect(
        service.createOrder(buyer.id, {
          ...input(product, 26000, {}, { optionItemIds }),
          custom: undefined,
        }),
      ).rejects.toThrowDomain('CUSTOM_INPUT_REQUIRED');
    });
  });
});
