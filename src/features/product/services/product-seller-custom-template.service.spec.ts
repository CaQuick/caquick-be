import { DomainException } from '@/common/errors/error-catalog';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { SellerCustomTemplateService } from '@/features/product/services/product-seller-custom-template.service';
import type { SellerCustomTextTokenOutput } from '@/features/product/types/product-seller-output.type';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import type { PrismaClient, Product } from '@/generated/prisma/client';
import { S3Service } from '@/global/storage/s3.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createCustomTemplate,
  createCustomTextToken,
  createProduct,
  setupSellerWithStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import {
  FOREIGN_UPLOAD_URL,
  ownedUploadUrl,
  s3TestProviders,
} from '@/test/storage/s3-test.helper';

describe('SellerCustomTemplateService (real DB)', () => {
  let service: SellerCustomTemplateService;
  let prisma: PrismaClient;
  let readImageSize: jest.SpyInstance;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        ...s3TestProviders(),
        SellerCustomTemplateService,
        StoreSellerRepository,
        ProductRepository,
        {
          provide: AUDIT_LOG_REPOSITORY,
          useClass: AuditLogRepository,
        },
      ],
    });
    service = module.get(SellerCustomTemplateService);
    prisma = p;
    // 바탕 이미지 읽기는 S3 네트워크 호출이라 결과만 주입한다(읽기 자체는 S3Service spec이 본다)
    readImageSize = jest.spyOn(module.get(S3Service), 'readImageSize');
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
    readImageSize.mockReset();
    readImageSize.mockResolvedValue({ width: 1000, height: 1000 });
  });

  async function setupSellerWithProduct(): Promise<{
    accountId: bigint;
    storeId: bigint;
    product: Product;
  }> {
    const { account, store } = await setupSellerWithStore(prisma);
    const product = await createProduct(prisma, { store_id: store.id });
    return { accountId: account.id, storeId: store.id, product };
  }

  async function createTemplate(productId: bigint, freeEditEnabled = false) {
    return createCustomTemplate(prisma, {
      product_id: productId,
      free_edit_enabled: freeEditEnabled,
    });
  }

  /** 활성 슬롯 1개 + soft-delete된 슬롯 1개. */
  async function createTokensWithDeleted(templateId: bigint) {
    const live = await createCustomTextToken(prisma, {
      template_id: templateId,
    });
    await createCustomTextToken(prisma, {
      template_id: templateId,
      deleted_at: new Date(),
    });
    return live;
  }

  const AREA = { posX: 1000, posY: 1000, width: 8000, height: 1500 };
  const slot = (templateId: bigint, overrides: object = {}) => ({
    templateId: templateId.toString(),
    tokenKey: 'name',
    defaultText: '가',
    ...AREA,
    ...overrides,
  });

  describe('sellerSetProductCustomMode', () => {
    it('다른 매장 상품이면 404', async () => {
      const me = await setupSellerWithProduct();
      const other = await setupSellerWithProduct();
      await expect(
        service.sellerSetProductCustomMode(
          me.accountId,
          other.product.id,
          'NONE',
        ),
      ).rejects.toThrowDomain('PRODUCT_NOT_FOUND');
    });

    it.each([
      ['템플릿이 없는 슬롯형', 'SLOT', 'none'],
      ['문구 자리도 자유 편집도 없는 슬롯형', 'SLOT', 'empty'],
      ['3D 연결 그룹이 없는 3D', 'THREE_D', 'empty'],
    ] as const)(
      '%s으로는 바꿀 수 없고 방식·감사 기록이 그대로다',
      async (_label, mode, template) => {
        const { accountId, storeId, product } = await setupSellerWithProduct();
        if (template === 'empty') await createTemplate(product.id);

        await expect(
          service.sellerSetProductCustomMode(accountId, product.id, mode),
        ).rejects.toThrowDomain('CUSTOM_PRODUCT_NOT_READY');

        const after = await prisma.product.findUniqueOrThrow({
          where: { id: product.id },
        });
        expect(after.custom_mode).toBe('NONE');
        expect(
          await prisma.auditLog.count({ where: { store_id: storeId } }),
        ).toBe(0);
      },
    );

    it('삭제된 문구 자리만 남았고 자유 편집이 꺼졌으면 슬롯형으로 바꿀 수 없고, 준비 상태·응답 문구 자리에서도 삭제 자리를 세지 않는다', async () => {
      const { accountId, product } = await setupSellerWithProduct();
      const tpl = await createTemplate(product.id);
      await createCustomTextToken(prisma, {
        template_id: tpl.id,
        deleted_at: new Date(),
      });

      await expect(
        service.sellerSetProductCustomMode(accountId, product.id, 'SLOT'),
      ).rejects.toThrowDomain('CUSTOM_PRODUCT_NOT_READY');

      // 이미 슬롯형인 상품은 같은 방식 요청이 판매자 상품 출력을 그대로 돌려준다
      await prisma.product.update({
        where: { id: product.id },
        data: { custom_mode: 'SLOT' },
      });
      const result = await service.sellerSetProductCustomMode(
        accountId,
        product.id,
        'SLOT',
      );
      expect(
        result.customReadiness.find((r) => r.mode === 'SLOT')?.issues,
      ).toEqual([expect.objectContaining({ code: 'SLOT_NOTHING_TO_EDIT' })]);
      expect(result.customTemplate?.textTokens).toEqual([]);
    });

    it.each([
      ['문구 자리가 있으면', false, 1],
      ['자유 편집을 허용했으면', true, 0],
    ])(
      '%s 슬롯형으로 바꾸고 이전·이후 방식을 감사에 남긴다',
      async (_label, freeEdit, slots) => {
        const { accountId, storeId, product } = await setupSellerWithProduct();
        const tpl = await createTemplate(product.id, freeEdit);
        for (let i = 0; i < slots; i++) {
          await createCustomTextToken(prisma, { template_id: tpl.id });
        }

        const result = await service.sellerSetProductCustomMode(
          accountId,
          product.id,
          'SLOT',
        );

        expect(result.customMode).toBe('SLOT');
        expect(result.customReadiness.find((r) => r.mode === 'SLOT')).toEqual({
          mode: 'SLOT',
          ready: true,
          issues: [],
        });
        const audits = await prisma.auditLog.findMany({
          where: { store_id: storeId },
        });
        expect(audits.map((a) => [a.before_json, a.after_json])).toEqual([
          [{ customMode: 'NONE' }, { customMode: 'SLOT' }],
        ]);
      },
    );

    it('없음으로는 준비 상태와 무관하게 바꾼다', async () => {
      const { accountId, product } = await setupSellerWithProduct();
      await prisma.product.update({
        where: { id: product.id },
        data: { custom_mode: 'SLOT' },
      });

      const result = await service.sellerSetProductCustomMode(
        accountId,
        product.id,
        'NONE',
      );
      expect(result.customMode).toBe('NONE');
    });

    it('지금과 같은 방식이면 준비 상태를 보지 않고 감사 없이 그대로 돌려준다', async () => {
      const { accountId, storeId, product } = await setupSellerWithProduct();
      await prisma.product.update({
        where: { id: product.id },
        data: { custom_mode: 'SLOT' },
      });

      const result = await service.sellerSetProductCustomMode(
        accountId,
        product.id,
        'SLOT',
      );

      expect(result.customMode).toBe('SLOT');
      expect(result.customReadiness).toEqual([
        { mode: 'NONE', ready: true, issues: [] },
        {
          mode: 'SLOT',
          ready: false,
          issues: [
            {
              code: 'SLOT_TEMPLATE_MISSING',
              message: '바탕 이미지를 먼저 등록해 주세요.',
              optionGroupId: null,
            },
          ],
        },
        {
          mode: 'THREE_D',
          ready: false,
          issues: [expect.objectContaining({ code: 'THREE_D_GROUP_MISSING' })],
        },
      ]);
      expect(
        await prisma.auditLog.count({ where: { store_id: storeId } }),
      ).toBe(0);
    });
  });

  describe('sellerUpsertProductCustomTemplate', () => {
    it('없는 productId면 404', async () => {
      const { accountId } = await setupSellerWithProduct();
      await expect(
        service.sellerUpsertProductCustomTemplate(accountId, {
          productId: '999999',
          baseImageUrl: ownedUploadUrl('PRODUCT_IMAGE', accountId, 'x.png'),
        }),
      ).rejects.toThrowDomain(404);
    });

    it('처음 호출 시 template 생성, 두 번째 호출 시 같은 product_id의 template 갱신 (upsert)', async () => {
      const { accountId, storeId, product } = await setupSellerWithProduct();

      const first = await service.sellerUpsertProductCustomTemplate(accountId, {
        productId: product.id.toString(),
        baseImageUrl: ownedUploadUrl('PRODUCT_IMAGE', accountId, 'a.png'),
      });
      const second = await service.sellerUpsertProductCustomTemplate(
        accountId,
        {
          productId: product.id.toString(),
          baseImageUrl: ownedUploadUrl('PRODUCT_IMAGE', accountId, 'b.png'),
          freeEditEnabled: true,
        },
      );

      expect(second).toMatchObject({
        id: first.id,
        baseImageUrl: ownedUploadUrl('PRODUCT_IMAGE', accountId, 'b.png'),
        freeEditEnabled: true,
        revision: first.revision + 1,
      });
      expect(
        await prisma.productCustomTemplate.count({
          where: { product_id: product.id },
        }),
      ).toBe(1);
      const audits = await prisma.auditLog.findMany({
        where: { store_id: storeId },
        orderBy: { id: 'asc' },
      });
      expect(audits.map((a) => a.after_json)).toEqual([
        {
          templateId: first.id,
          baseImageUrl: first.baseImageUrl,
          freeEditEnabled: false,
        },
        {
          templateId: first.id,
          baseImageUrl: second.baseImageUrl,
          freeEditEnabled: true,
        },
      ]);
    });

    it('응답 textTokens에서 soft-delete된 슬롯은 제외한다', async () => {
      const { accountId, product } = await setupSellerWithProduct();
      const tpl = await createTemplate(product.id);
      const live = await createTokensWithDeleted(tpl.id);

      const result = await service.sellerUpsertProductCustomTemplate(
        accountId,
        {
          productId: product.id.toString(),
          baseImageUrl: ownedUploadUrl('PRODUCT_IMAGE', accountId, 'b.png'),
        },
      );

      expect(result.textTokens.map((t) => t.id)).toEqual([live.id.toString()]);
    });

    describe('바탕 이미지 1:1', () => {
      it.each([
        ['정사각', 1000, 1000, null],
        ['가로가 1px 길다', 1001, 1000, null],
        ['세로가 1px 길다', 1000, 1001, null],
        ['가로가 2px 길다', 1002, 1000, 'CUSTOM_BASE_IMAGE_NOT_SQUARE'],
        ['세로로 길다', 800, 1000, 'CUSTOM_BASE_IMAGE_NOT_SQUARE'],
      ] as const)('%s(%i×%i)', async (_label, width, height, error) => {
        const { accountId, product } = await setupSellerWithProduct();
        readImageSize.mockResolvedValue({ width, height });
        const upsert = service.sellerUpsertProductCustomTemplate(accountId, {
          productId: product.id.toString(),
          baseImageUrl: ownedUploadUrl('PRODUCT_IMAGE', accountId, 'b.png'),
        });

        if (error) await expect(upsert).rejects.toThrowDomain(error);
        else await expect(upsert).resolves.toBeDefined();
        expect(
          await prisma.productCustomTemplate.count({
            where: { product_id: product.id },
          }),
        ).toBe(error ? 0 : 1);
      });

      it('이미지로 읽을 수 없으면 CUSTOM_BASE_IMAGE_UNREADABLE', async () => {
        const { accountId, product } = await setupSellerWithProduct();
        readImageSize.mockResolvedValue(null);
        await expect(
          service.sellerUpsertProductCustomTemplate(accountId, {
            productId: product.id.toString(),
            baseImageUrl: ownedUploadUrl('PRODUCT_IMAGE', accountId, 'b.png'),
          }),
        ).rejects.toThrowDomain('CUSTOM_BASE_IMAGE_UNREADABLE');
      });

      it('저장소를 읽지 못하면 503(S3_READ_FAILED)을 그대로 낸다', async () => {
        const { accountId, product } = await setupSellerWithProduct();
        readImageSize.mockRejectedValue(new DomainException('S3_READ_FAILED'));
        await expect(
          service.sellerUpsertProductCustomTemplate(accountId, {
            productId: product.id.toString(),
            baseImageUrl: ownedUploadUrl('PRODUCT_IMAGE', accountId, 'b.png'),
          }),
        ).rejects.toThrowDomain(503);
      });

      it('바탕 URL이 그대로면 다시 읽지 않고, 바뀔 때만 읽는다', async () => {
        const { accountId, product } = await setupSellerWithProduct();
        const kept = ownedUploadUrl('PRODUCT_IMAGE', accountId, 'kept.png');
        await createCustomTemplate(prisma, {
          product_id: product.id,
          base_image_url: kept,
        });
        readImageSize.mockResolvedValue({ width: 300, height: 1000 });

        const result = await service.sellerUpsertProductCustomTemplate(
          accountId,
          {
            productId: product.id.toString(),
            baseImageUrl: kept,
            freeEditEnabled: true,
          },
        );
        expect(result.freeEditEnabled).toBe(true);
        expect(readImageSize).not.toHaveBeenCalled();

        const changed = ownedUploadUrl('PRODUCT_IMAGE', accountId, 'new.png');
        await expect(
          service.sellerUpsertProductCustomTemplate(accountId, {
            productId: product.id.toString(),
            baseImageUrl: changed,
          }),
        ).rejects.toThrowDomain('CUSTOM_BASE_IMAGE_NOT_SQUARE');
        expect(readImageSize).toHaveBeenCalledWith(changed);
      });
    });
  });

  describe('sellerUpsertProductCustomTextToken', () => {
    it('templateId가 없으면 404', async () => {
      const { accountId } = await setupSellerWithProduct();
      await expect(
        service.sellerUpsertProductCustomTextToken(accountId, slot(999999n)),
      ).rejects.toThrowDomain(404);
    });

    it('tokenId를 줬는데 다른 template 소속이면 404', async () => {
      const me = await setupSellerWithProduct();
      const other = await setupSellerWithProduct();
      const myTpl = await createTemplate(me.product.id);
      const othersTpl = await createTemplate(other.product.id);
      const othersToken = await createCustomTextToken(prisma, {
        template_id: othersTpl.id,
      });

      await expect(
        service.sellerUpsertProductCustomTextToken(
          me.accountId,
          slot(myTpl.id, { tokenId: othersToken.id.toString() }),
        ),
      ).rejects.toThrowDomain(404);
    });

    it('tokenId 없이 호출하면 새로 만들고 표시 이름·글자색·정렬은 기본값이다', async () => {
      const { accountId, product } = await setupSellerWithProduct();
      const tpl = await createTemplate(product.id);

      const result = await service.sellerUpsertProductCustomTextToken(
        accountId,
        slot(tpl.id, { tokenKey: 'name', defaultText: '홍길동' }),
      );

      expect(result).toMatchObject({
        tokenKey: 'name',
        label: 'name',
        maxLength: 20,
        textColor: '#000000',
        textAlign: 'CENTER',
        ...AREA,
      });
    });

    it('tokenId 포함 호출 → 기존 토큰 갱신, 생략한 표시 이름·글자색·정렬은 그대로 둔다', async () => {
      const { accountId, product } = await setupSellerWithProduct();
      const tpl = await createTemplate(product.id);
      const token = await createCustomTextToken(prisma, {
        template_id: tpl.id,
        token_key: 'a',
        label: '받는 사람',
        text_color: '#FF0000',
        text_align: 'RIGHT',
      });

      const result = await service.sellerUpsertProductCustomTextToken(
        accountId,
        slot(tpl.id, {
          tokenId: token.id.toString(),
          tokenKey: 'b',
          defaultText: '나',
        }),
      );

      expect(result).toMatchObject({
        id: token.id.toString(),
        tokenKey: 'b',
        label: '받는 사람',
        defaultText: '나',
        textColor: '#FF0000',
        textAlign: 'RIGHT',
      });
    });

    it('표시 이름·글자색(소문자는 대문자로)·정렬을 입력대로 저장한다', async () => {
      const { accountId, product } = await setupSellerWithProduct();
      const tpl = await createTemplate(product.id);

      const result = await service.sellerUpsertProductCustomTextToken(
        accountId,
        slot(tpl.id, {
          label: '  받는 사람 ',
          textColor: '#ff00aa',
          textAlign: 'LEFT',
        }),
      );

      expect(result).toMatchObject({
        label: '받는 사람',
        textColor: '#FF00AA',
        textAlign: 'LEFT',
      });
    });

    describe('입력 검증', () => {
      it.each([
        ['가득 찬 영역', 0, 0, 10000, 10000, true],
        ['최소 영역', 0, 0, 1, 1, true],
        ['오른쪽 아래 끝 1칸', 9999, 9999, 1, 1, true],
        ['x 음수', -1, 0, 10, 10, false],
        ['y 음수', 0, -1, 10, 10, false],
        ['너비 0', 0, 0, 0, 10, false],
        ['높이 0', 0, 0, 10, 0, false],
        ['x + 너비 10001', 5000, 0, 5001, 10, false],
        ['y + 높이 10001', 0, 5000, 10, 5001, false],
        ['x가 끝(10000)', 10000, 0, 1, 1, false],
        ['너비 10001', 0, 0, 10001, 1, false],
      ])(
        '좌표 경계 — %s(x=%i, y=%i, w=%i, h=%i)',
        async (_label, posX, posY, width, height, ok) => {
          const { accountId, product } = await setupSellerWithProduct();
          const tpl = await createTemplate(product.id);
          const upsert = service.sellerUpsertProductCustomTextToken(
            accountId,
            slot(tpl.id, { posX, posY, width, height }),
          );

          if (ok) await expect(upsert).resolves.toMatchObject({ posX, width });
          else
            await expect(upsert).rejects.toThrowDomain(
              'CUSTOM_AREA_OUT_OF_BOUNDS',
            );
        },
      );

      it.each([
        [0, 'FIELD_OUT_OF_RANGE'],
        [1, null],
        [50, null],
        [51, 'FIELD_OUT_OF_RANGE'],
      ] as const)('최대 글자 수 %i', async (maxLength, error) => {
        const { accountId, product } = await setupSellerWithProduct();
        const tpl = await createTemplate(product.id);
        const upsert = service.sellerUpsertProductCustomTextToken(
          accountId,
          slot(tpl.id, { maxLength }),
        );

        if (error) await expect(upsert).rejects.toThrowDomain(error);
        else await expect(upsert).resolves.toMatchObject({ maxLength });
      });

      it('기본 문구는 코드 포인트로 최대 글자 수까지다(이모지 1개 = 1자)', async () => {
        const { accountId, product } = await setupSellerWithProduct();
        const tpl = await createTemplate(product.id);

        await expect(
          service.sellerUpsertProductCustomTextToken(
            accountId,
            slot(tpl.id, { tokenKey: 'ok', maxLength: 2, defaultText: '🎂🎂' }),
          ),
        ).resolves.toMatchObject({ defaultText: '🎂🎂' });
        const tooLong = service.sellerUpsertProductCustomTextToken(
          accountId,
          slot(tpl.id, {
            tokenKey: 'long',
            label: '이름',
            maxLength: 2,
            defaultText: '🎂🎂🎂',
          }),
        );
        await expect(tooLong).rejects.toThrowDomain(
          'CUSTOM_TEXT_DEFAULT_TOO_LONG',
        );
        await expect(tooLong).rejects.toThrow(
          "'이름'의 기본 문구는 2자 이하여야 해요.",
        );
      });

      it.each([
        ['slot1', true],
        ['a'.repeat(60), true],
        ['a'.repeat(61), false],
        ['Name', false],
        ['slot_1', false],
        ['   ', false],
      ])('키 %s', async (tokenKey, ok) => {
        const { accountId, product } = await setupSellerWithProduct();
        const tpl = await createTemplate(product.id);
        const upsert = service.sellerUpsertProductCustomTextToken(
          accountId,
          slot(tpl.id, { tokenKey }),
        );

        if (ok) await expect(upsert).resolves.toMatchObject({ tokenKey });
        else
          await expect(upsert).rejects.toThrowDomain(
            'CUSTOM_TOKEN_KEY_INVALID',
          );
      });

      it('형식 규칙 전 키는 그대로 두면 수정할 수 있고, 다른 형식 밖 키로는 못 바꾼다', async () => {
        const { accountId, product } = await setupSellerWithProduct();
        const tpl = await createTemplate(product.id);
        const legacy = await createCustomTextToken(prisma, {
          template_id: tpl.id,
          token_key: 'NAME',
        });
        const update = (tokenKey: string) =>
          service.sellerUpsertProductCustomTextToken(
            accountId,
            slot(tpl.id, { tokenId: legacy.id.toString(), tokenKey }),
          );

        await expect(update('NAME')).resolves.toMatchObject({
          tokenKey: 'NAME',
        });
        await expect(update('NAME2')).rejects.toThrowDomain(
          'CUSTOM_TOKEN_KEY_INVALID',
        );
      });

      it.each([
        ['#FFF', 'INVALID_COLOR_FORMAT'],
        ['red', 'INVALID_COLOR_FORMAT'],
        ['#GGGGGG', 'INVALID_COLOR_FORMAT'],
      ])('글자색 %s', async (textColor, error) => {
        const { accountId, product } = await setupSellerWithProduct();
        const tpl = await createTemplate(product.id);
        await expect(
          service.sellerUpsertProductCustomTextToken(
            accountId,
            slot(tpl.id, { textColor }),
          ),
        ).rejects.toThrowDomain(error);
      });

      it.each([
        ['공백뿐', '   ', 'TEXT_REQUIRED'],
        ['31자', '가'.repeat(31), 'TEXT_TOO_LONG'],
      ])('표시 이름 %s', async (_label, label, error) => {
        const { accountId, product } = await setupSellerWithProduct();
        const tpl = await createTemplate(product.id);
        await expect(
          service.sellerUpsertProductCustomTextToken(
            accountId,
            slot(tpl.id, { label }),
          ),
        ).rejects.toThrowDomain(error);
      });
    });

    describe('같은 tokenKey 재사용', () => {
      it('삭제한 슬롯과 같은 키로 등록하면 그 슬롯을 복구해 입력값으로 갱신한다', async () => {
        const { accountId, storeId, product } = await setupSellerWithProduct();
        const tpl = await createTemplate(product.id);
        const first = await service.sellerUpsertProductCustomTextToken(
          accountId,
          slot(tpl.id, { textColor: '#FF0000' }),
        );
        await service.sellerDeleteProductCustomTextToken(
          accountId,
          BigInt(first.id),
        );

        const result = await service.sellerUpsertProductCustomTextToken(
          accountId,
          {
            templateId: tpl.id.toString(),
            tokenKey: 'name',
            label: '이름',
            defaultText: '나',
            maxLength: 12,
            sortOrder: 3,
            isRequired: false,
            posX: 1000,
            posY: 2000,
            width: 8000,
            height: 1500,
          },
        );

        // 복구도 등록이라 생략한 글자색은 기본값으로 돌아간다
        expect(result).toEqual({
          id: first.id,
          templateId: tpl.id.toString(),
          tokenKey: 'name',
          label: '이름',
          defaultText: '나',
          maxLength: 12,
          sortOrder: 3,
          isRequired: false,
          posX: 1000,
          posY: 2000,
          width: 8000,
          height: 1500,
          textColor: '#000000',
          textAlign: 'CENTER',
        });
        const rows = await prisma.productCustomTextToken.findMany({
          where: { template_id: tpl.id, deleted_at: undefined },
        });
        expect(rows).toHaveLength(1);
        expect(rows[0].deleted_at).toBeNull();
        const audits = await prisma.auditLog.findMany({
          where: { store_id: storeId, action: 'CREATE' },
          orderBy: { id: 'asc' },
        });
        expect(audits.map((a) => a.after_json)).toEqual([
          { tokenId: first.id, tokenKey: 'name' },
          { tokenId: first.id, tokenKey: 'name' },
        ]);
      });

      it('활성 슬롯과 키가 겹치면 CUSTOM_TEXT_TOKEN_KEY_TAKEN이고 아무것도 바뀌지 않는다', async () => {
        const { accountId, storeId, product } = await setupSellerWithProduct();
        const tpl = await createTemplate(product.id);
        const live = await createCustomTextToken(prisma, {
          template_id: tpl.id,
          token_key: 'name',
          default_text: '가',
        });

        await expect(
          service.sellerUpsertProductCustomTextToken(
            accountId,
            slot(tpl.id, { defaultText: '나' }),
          ),
        ).rejects.toThrowDomain('CUSTOM_TEXT_TOKEN_KEY_TAKEN');

        const after = await prisma.productCustomTextToken.findUniqueOrThrow({
          where: { id: live.id },
        });
        expect(after.default_text).toBe('가');
        expect(
          await prisma.auditLog.count({ where: { store_id: storeId } }),
        ).toBe(0);
      });

      it.each([
        ['활성 슬롯', null],
        ['삭제된 슬롯', new Date()],
      ])(
        '수정으로 %s의 키로 바꾸면 CUSTOM_TEXT_TOKEN_KEY_TAKEN',
        async (_label, deletedAt) => {
          const { accountId, product } = await setupSellerWithProduct();
          const tpl = await createTemplate(product.id);
          await createCustomTextToken(prisma, {
            template_id: tpl.id,
            token_key: 'taken',
            deleted_at: deletedAt,
          });
          const mine = await createCustomTextToken(prisma, {
            template_id: tpl.id,
            token_key: 'mine',
          });

          await expect(
            service.sellerUpsertProductCustomTextToken(
              accountId,
              slot(tpl.id, { tokenId: mine.id.toString(), tokenKey: 'taken' }),
            ),
          ).rejects.toThrowDomain('CUSTOM_TEXT_TOKEN_KEY_TAKEN');
        },
      );

      it('다른 템플릿의 같은 키는 활성이든 삭제든 무관하다', async () => {
        const me = await setupSellerWithProduct();
        const other = await setupSellerWithProduct();
        const myTpl = await createTemplate(me.product.id);
        const othersTpl = await createTemplate(other.product.id);
        const othersLive = await createCustomTextToken(prisma, {
          template_id: othersTpl.id,
          token_key: 'name',
        });
        const othersDeleted = await createCustomTextToken(prisma, {
          template_id: othersTpl.id,
          token_key: 'gone',
          deleted_at: new Date(),
        });

        const created = await Promise.all(
          ['name', 'gone'].map((tokenKey) =>
            service.sellerUpsertProductCustomTextToken(
              me.accountId,
              slot(myTpl.id, { tokenKey, defaultText: '내것' }),
            ),
          ),
        );

        expect(created.map((t) => t.templateId)).toEqual([
          myTpl.id.toString(),
          myTpl.id.toString(),
        ]);
        const createdIds = created.map((t) => t.id);
        expect(createdIds).not.toContain(othersLive.id.toString());
        expect(createdIds).not.toContain(othersDeleted.id.toString());
        const stillDeleted =
          await prisma.productCustomTextToken.findUniqueOrThrow({
            where: { id: othersDeleted.id },
          });
        expect(stillDeleted.deleted_at).not.toBeNull();
      });

      it.each([
        ['새 키', false],
        ['삭제된 슬롯의 키', true],
      ])(
        '%s로 동시에 2건을 등록하면 1건만 성공하고 나머지는 CUSTOM_TEXT_TOKEN_KEY_TAKEN',
        async (_label, withDeleted) => {
          const { accountId, storeId, product } =
            await setupSellerWithProduct();
          const tpl = await createTemplate(product.id);
          if (withDeleted) {
            await createCustomTextToken(prisma, {
              template_id: tpl.id,
              token_key: 'name',
              default_text: 'old',
              deleted_at: new Date(),
            });
          }

          const results = await Promise.allSettled(
            ['A', 'B'].map((defaultText) =>
              service.sellerUpsertProductCustomTextToken(
                accountId,
                slot(tpl.id, { defaultText }),
              ),
            ),
          );

          const fulfilled = results.filter(
            (r): r is PromiseFulfilledResult<SellerCustomTextTokenOutput> =>
              r.status === 'fulfilled',
          );
          const rejected = results.filter(
            (r): r is PromiseRejectedResult => r.status === 'rejected',
          );
          expect(fulfilled).toHaveLength(1);
          expect(rejected).toHaveLength(1);
          expect(rejected[0].reason).toThrowDomain(
            'CUSTOM_TEXT_TOKEN_KEY_TAKEN',
          );
          const rows = await prisma.productCustomTextToken.findMany({
            where: { template_id: tpl.id, deleted_at: undefined },
          });
          expect(rows).toHaveLength(1);
          expect(rows[0].deleted_at).toBeNull();
          expect(rows[0].default_text).toBe(fulfilled[0].value.defaultText);
          expect(
            await prisma.auditLog.count({
              where: { store_id: storeId, action: 'CREATE' },
            }),
          ).toBe(1);
        },
      );
    });
  });

  describe('sellerDeleteProductCustomTextToken', () => {
    it('없는 tokenId면 404', async () => {
      const { accountId } = await setupSellerWithProduct();
      await expect(
        service.sellerDeleteProductCustomTextToken(accountId, BigInt(999999)),
      ).rejects.toThrowDomain(404);
    });

    it('soft-delete + audit log', async () => {
      const { accountId, storeId, product } = await setupSellerWithProduct();
      const tpl = await createTemplate(product.id);
      const token = await createCustomTextToken(prisma, {
        template_id: tpl.id,
      });

      await service.sellerDeleteProductCustomTextToken(accountId, token.id);

      const after = await prisma.productCustomTextToken.findUnique({
        where: { id: token.id },
      });
      expect(after?.deleted_at).not.toBeNull();

      const auditLogs = await prisma.auditLog.findMany({
        where: { store_id: storeId, action: 'DELETE' },
      });
      expect(auditLogs).toHaveLength(1);
    });
  });

  describe('sellerReorderProductCustomTextTokens', () => {
    it('tokenIds 길이 불일치면 400', async () => {
      const { accountId, product } = await setupSellerWithProduct();
      const tpl = await createTemplate(product.id);
      await expect(
        service.sellerReorderProductCustomTextTokens(accountId, {
          templateId: tpl.id.toString(),
          tokenIds: ['1', '2'],
        }),
      ).rejects.toThrowDomain(400);
    });

    it('정상 재정렬', async () => {
      const { accountId, product } = await setupSellerWithProduct();
      const tpl = await createTemplate(product.id);
      const t1 = await createCustomTextToken(prisma, { template_id: tpl.id });
      const t2 = await createCustomTextToken(prisma, { template_id: tpl.id });

      const result = await service.sellerReorderProductCustomTextTokens(
        accountId,
        {
          templateId: tpl.id.toString(),
          tokenIds: [t2.id.toString(), t1.id.toString()],
        },
      );
      expect(result[0].id).toBe(t2.id.toString());
    });
  });

  describe('이미지 URL 소유권', () => {
    const rejected = [
      [
        '타 계정 prefix',
        (id: bigint) => ownedUploadUrl('PRODUCT_IMAGE', id + BigInt(1)),
      ],
      [
        '타 용도(STORE_IMAGE) prefix',
        (id: bigint) => ownedUploadUrl('STORE_IMAGE', id),
      ],
      ['외부 호스트', () => FOREIGN_UPLOAD_URL],
    ] as const;

    it.each(rejected)(
      'sellerUpsertProductCustomTemplate.baseImageUrl이 %s면 BadRequest',
      async (_label, url) => {
        const { accountId, product } = await setupSellerWithProduct();
        await expect(
          service.sellerUpsertProductCustomTemplate(accountId, {
            productId: product.id.toString(),
            baseImageUrl: url(accountId),
          }),
        ).rejects.toThrowDomain('INVALID_IMAGE_URL');
        expect(readImageSize).not.toHaveBeenCalled();
      },
    );
  });
});
