import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { ProductRepository } from '@/features/product';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerCustomTemplateService } from '@/features/seller/services/seller-custom-template.service';
import type { PrismaClient, Product } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createProduct, setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import {
  FOREIGN_UPLOAD_URL,
  ownedUploadUrl,
  s3TestProviders,
} from '@/test/storage/s3-test.helper';

describe('SellerCustomTemplateService (real DB)', () => {
  let service: SellerCustomTemplateService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        ...s3TestProviders(),
        SellerCustomTemplateService,
        SellerRepository,
        ProductRepository,
        {
          provide: AUDIT_LOG_REPOSITORY,
          useClass: AuditLogRepository,
        },
      ],
    });
    service = module.get(SellerCustomTemplateService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
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

  async function createTemplate(productId: bigint) {
    return prisma.productCustomTemplate.create({
      data: {
        product_id: productId,
        base_image_url: 'https://i.example/base.png',
      },
    });
  }

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
      const { accountId, product } = await setupSellerWithProduct();

      const first = await service.sellerUpsertProductCustomTemplate(accountId, {
        productId: product.id.toString(),
        baseImageUrl: ownedUploadUrl('PRODUCT_IMAGE', accountId, 'a.png'),
      });

      const second = await service.sellerUpsertProductCustomTemplate(
        accountId,
        {
          productId: product.id.toString(),
          baseImageUrl: ownedUploadUrl('PRODUCT_IMAGE', accountId, 'b.png'),
        },
      );

      expect(second.id).toBe(first.id);
      expect(second.baseImageUrl).toBe(
        ownedUploadUrl('PRODUCT_IMAGE', accountId, 'b.png'),
      );

      const templates = await prisma.productCustomTemplate.findMany({
        where: { product_id: product.id },
      });
      expect(templates).toHaveLength(1);
    });
  });

  describe('sellerSetProductCustomTemplateActive', () => {
    it('없는 templateId면 404', async () => {
      const { accountId } = await setupSellerWithProduct();
      await expect(
        service.sellerSetProductCustomTemplateActive(accountId, {
          templateId: '999999',
          isActive: false,
        }),
      ).rejects.toThrowDomain(404);
    });

    it('다른 매장 template이면 404', async () => {
      const me = await setupSellerWithProduct();
      const other = await setupSellerWithProduct();
      const othersTemplate = await createTemplate(other.product.id);

      await expect(
        service.sellerSetProductCustomTemplateActive(me.accountId, {
          templateId: othersTemplate.id.toString(),
          isActive: false,
        }),
      ).rejects.toThrowDomain(404);
    });

    it('is_active 토글 + audit log STATUS_CHANGE', async () => {
      const { accountId, storeId, product } = await setupSellerWithProduct();
      const tpl = await createTemplate(product.id);

      await service.sellerSetProductCustomTemplateActive(accountId, {
        templateId: tpl.id.toString(),
        isActive: false,
      });

      const after = await prisma.productCustomTemplate.findUniqueOrThrow({
        where: { id: tpl.id },
      });
      expect(after.is_active).toBe(false);

      const auditLogs = await prisma.auditLog.findMany({
        where: { store_id: storeId, action: 'STATUS_CHANGE' },
      });
      expect(auditLogs).toHaveLength(1);
    });
  });

  describe('sellerUpsertProductCustomTextToken', () => {
    it('templateId가 없으면 404', async () => {
      const { accountId } = await setupSellerWithProduct();
      await expect(
        service.sellerUpsertProductCustomTextToken(accountId, {
          templateId: '999999',
          tokenKey: 'NAME',
          defaultText: 'X',
        }),
      ).rejects.toThrowDomain(404);
    });

    it('tokenId를 줬는데 다른 template 소속이면 404', async () => {
      const me = await setupSellerWithProduct();
      const other = await setupSellerWithProduct();
      const myTpl = await createTemplate(me.product.id);
      const othersTpl = await createTemplate(other.product.id);
      const othersToken = await prisma.productCustomTextToken.create({
        data: {
          template_id: othersTpl.id,
          token_key: 'X',
          default_text: 'x',
        },
      });

      await expect(
        service.sellerUpsertProductCustomTextToken(me.accountId, {
          templateId: myTpl.id.toString(),
          tokenId: othersToken.id.toString(),
          tokenKey: 'Y',
          defaultText: 'y',
        }),
      ).rejects.toThrowDomain(404);
    });

    it('tokenId 없이 호출 → 신규 생성', async () => {
      const { accountId, product } = await setupSellerWithProduct();
      const tpl = await createTemplate(product.id);

      const result = await service.sellerUpsertProductCustomTextToken(
        accountId,
        {
          templateId: tpl.id.toString(),
          tokenKey: 'NAME',
          defaultText: '홍길동',
        },
      );
      expect(result.tokenKey).toBe('NAME');

      const tokens = await prisma.productCustomTextToken.findMany({
        where: { template_id: tpl.id },
      });
      expect(tokens).toHaveLength(1);
    });

    it('tokenId 포함 호출 → 기존 토큰 갱신', async () => {
      const { accountId, product } = await setupSellerWithProduct();
      const tpl = await createTemplate(product.id);
      const token = await prisma.productCustomTextToken.create({
        data: { template_id: tpl.id, token_key: 'A', default_text: '가' },
      });

      const result = await service.sellerUpsertProductCustomTextToken(
        accountId,
        {
          templateId: tpl.id.toString(),
          tokenId: token.id.toString(),
          tokenKey: 'B',
          defaultText: '나',
        },
      );
      expect(result.id).toBe(token.id.toString());
      expect(result.tokenKey).toBe('B');
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
      const token = await prisma.productCustomTextToken.create({
        data: { template_id: tpl.id, token_key: 'A', default_text: '가' },
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
      const t1 = await prisma.productCustomTextToken.create({
        data: { template_id: tpl.id, token_key: 'A', default_text: 'a' },
      });
      const t2 = await prisma.productCustomTextToken.create({
        data: { template_id: tpl.id, token_key: 'B', default_text: 'b' },
      });

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
      },
    );
  });
});
