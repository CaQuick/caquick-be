import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaClient, Product } from '@prisma/client';

import { ProductRepository } from '@/features/product';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerOptionService } from '@/features/seller/services/seller-option.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createProduct, setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('SellerOptionService (real DB)', () => {
  let service: SellerOptionService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [SellerOptionService, SellerRepository, ProductRepository],
    });
    service = module.get(SellerOptionService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function setupProductForSeller(): Promise<{
    accountId: bigint;
    storeId: bigint;
    product: Product;
  }> {
    const { account, store } = await setupSellerWithStore(prisma);
    const product = await createProduct(prisma, { store_id: store.id });
    return { accountId: account.id, storeId: store.id, product };
  }

  async function createOptionGroup(productId: bigint) {
    return prisma.productOptionGroup.create({
      data: { product_id: productId, name: '사이즈' },
    });
  }

  // ─── OptionGroup ──
  describe('sellerCreateOptionGroup', () => {
    it('존재하지 않는 productId면 NotFoundException', async () => {
      const { accountId } = await setupProductForSeller();
      await expect(
        service.sellerCreateOptionGroup(accountId, {
          productId: '999999',
          name: 'X',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('maxSelect < minSelect면 BadRequestException', async () => {
      const { accountId, product } = await setupProductForSeller();
      await expect(
        service.sellerCreateOptionGroup(accountId, {
          productId: product.id.toString(),
          name: 'X',
          minSelect: 3,
          maxSelect: 1,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('정상 생성 + audit log', async () => {
      const { accountId, storeId, product } = await setupProductForSeller();
      const result = await service.sellerCreateOptionGroup(accountId, {
        productId: product.id.toString(),
        name: '사이즈',
      });
      expect(result.name).toBe('사이즈');

      const groups = await prisma.productOptionGroup.findMany({
        where: { product_id: product.id },
      });
      expect(groups).toHaveLength(1);

      const auditLogs = await prisma.auditLog.findMany({
        where: { store_id: storeId, action: 'CREATE' },
      });
      expect(auditLogs).toHaveLength(1);
    });
  });

  describe('sellerUpdateOptionGroup', () => {
    it('존재하지 않는 optionGroupId면 NotFoundException', async () => {
      const { accountId } = await setupProductForSeller();
      await expect(
        service.sellerUpdateOptionGroup(accountId, {
          optionGroupId: '999999',
          name: 'X',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('다른 매장 소유 group이면 NotFoundException', async () => {
      const me = await setupProductForSeller();
      const other = await setupProductForSeller();
      const othersGroup = await createOptionGroup(other.product.id);

      await expect(
        service.sellerUpdateOptionGroup(me.accountId, {
          optionGroupId: othersGroup.id.toString(),
          name: 'X',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('maxSelect < minSelect(기존값+신규값 조합)면 BadRequestException', async () => {
      const { accountId, product } = await setupProductForSeller();
      const group = await prisma.productOptionGroup.create({
        data: {
          product_id: product.id,
          name: 'G',
          min_select: 2,
          max_select: 5,
        },
      });

      await expect(
        service.sellerUpdateOptionGroup(accountId, {
          optionGroupId: group.id.toString(),
          maxSelect: 1,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('정상 수정', async () => {
      const { accountId, product } = await setupProductForSeller();
      const group = await createOptionGroup(product.id);

      const result = await service.sellerUpdateOptionGroup(accountId, {
        optionGroupId: group.id.toString(),
        name: '신규명',
      });
      expect(result.name).toBe('신규명');
    });
  });

  describe('sellerDeleteOptionGroup', () => {
    it('없으면 NotFoundException', async () => {
      const { accountId } = await setupProductForSeller();
      await expect(
        service.sellerDeleteOptionGroup(accountId, BigInt(999999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('soft-delete + audit log', async () => {
      const { accountId, storeId, product } = await setupProductForSeller();
      const group = await createOptionGroup(product.id);

      await service.sellerDeleteOptionGroup(accountId, group.id);

      const after = await prisma.productOptionGroup.findUnique({
        where: { id: group.id },
      });
      expect(after?.deleted_at).not.toBeNull();

      const auditLogs = await prisma.auditLog.findMany({
        where: { store_id: storeId, action: 'DELETE' },
      });
      expect(auditLogs).toHaveLength(1);
    });
  });

  describe('sellerReorderOptionGroups', () => {
    it('optionGroupIds 길이 불일치면 BadRequestException', async () => {
      const { accountId, product } = await setupProductForSeller();
      await expect(
        service.sellerReorderOptionGroups(accountId, {
          productId: product.id.toString(),
          optionGroupIds: ['1', '2'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('정상 재정렬', async () => {
      const { accountId, product } = await setupProductForSeller();
      const g1 = await createOptionGroup(product.id);
      const g2 = await prisma.productOptionGroup.create({
        data: { product_id: product.id, name: '색상', sort_order: 1 },
      });

      const result = await service.sellerReorderOptionGroups(accountId, {
        productId: product.id.toString(),
        optionGroupIds: [g2.id.toString(), g1.id.toString()],
      });
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(g2.id.toString());
    });
  });

  // ─── OptionItem ──
  describe('sellerCreateOptionItem', () => {
    it('없는 optionGroupId면 NotFoundException', async () => {
      const { accountId } = await setupProductForSeller();
      await expect(
        service.sellerCreateOptionItem(accountId, {
          optionGroupId: '999999',
          title: 'L',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('정상 생성', async () => {
      const { accountId, product } = await setupProductForSeller();
      const group = await createOptionGroup(product.id);

      const result = await service.sellerCreateOptionItem(accountId, {
        optionGroupId: group.id.toString(),
        title: 'L',
        priceDelta: 3000,
      });
      expect(result.title).toBe('L');
      expect(result.priceDelta).toBe(3000);
    });
  });

  describe('sellerUpdateOptionItem', () => {
    it('없는 optionItemId면 NotFoundException', async () => {
      const { accountId } = await setupProductForSeller();
      await expect(
        service.sellerUpdateOptionItem(accountId, {
          optionItemId: '999999',
          title: 'X',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('다른 매장 item이면 NotFoundException', async () => {
      const me = await setupProductForSeller();
      const other = await setupProductForSeller();
      const othersGroup = await createOptionGroup(other.product.id);
      const othersItem = await prisma.productOptionItem.create({
        data: { option_group_id: othersGroup.id, title: 'T' },
      });

      await expect(
        service.sellerUpdateOptionItem(me.accountId, {
          optionItemId: othersItem.id.toString(),
          title: 'X',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('정상 수정', async () => {
      const { accountId, product } = await setupProductForSeller();
      const group = await createOptionGroup(product.id);
      const item = await prisma.productOptionItem.create({
        data: { option_group_id: group.id, title: 'S' },
      });

      const result = await service.sellerUpdateOptionItem(accountId, {
        optionItemId: item.id.toString(),
        title: 'XL',
      });
      expect(result.title).toBe('XL');
    });
  });

  describe('sellerDeleteOptionItem', () => {
    it('없으면 NotFoundException', async () => {
      const { accountId } = await setupProductForSeller();
      await expect(
        service.sellerDeleteOptionItem(accountId, BigInt(999999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('soft-delete', async () => {
      const { accountId, product } = await setupProductForSeller();
      const group = await createOptionGroup(product.id);
      const item = await prisma.productOptionItem.create({
        data: { option_group_id: group.id, title: 'S' },
      });

      await service.sellerDeleteOptionItem(accountId, item.id);

      const after = await prisma.productOptionItem.findUnique({
        where: { id: item.id },
      });
      expect(after?.deleted_at).not.toBeNull();
    });
  });

  describe('sellerReorderOptionItems', () => {
    it('optionItemIds 길이 불일치면 BadRequestException', async () => {
      const { accountId, product } = await setupProductForSeller();
      const group = await createOptionGroup(product.id);
      await expect(
        service.sellerReorderOptionItems(accountId, {
          optionGroupId: group.id.toString(),
          optionItemIds: ['1'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('정상 재정렬', async () => {
      const { accountId, product } = await setupProductForSeller();
      const group = await createOptionGroup(product.id);
      const i1 = await prisma.productOptionItem.create({
        data: { option_group_id: group.id, title: 'A' },
      });
      const i2 = await prisma.productOptionItem.create({
        data: { option_group_id: group.id, title: 'B' },
      });

      const result = await service.sellerReorderOptionItems(accountId, {
        optionGroupId: group.id.toString(),
        optionItemIds: [i2.id.toString(), i1.id.toString()],
      });
      expect(result[0].id).toBe(i2.id.toString());
    });
  });

  describe('sellerUpdateOptionGroup 모든 선택 필드 분기', () => {
    it('name/isRequired/minSelect/maxSelect/sortOrder/isActive/optionRequires* 전체 포함 수정', async () => {
      const { accountId, product } = await setupProductForSeller();
      const group = await prisma.productOptionGroup.create({
        data: {
          product_id: product.id,
          name: '사이즈',
          is_required: true,
          min_select: 1,
          max_select: 2,
        },
      });

      const result = await service.sellerUpdateOptionGroup(accountId, {
        optionGroupId: group.id.toString(),
        name: '사이즈(수정)',
        isRequired: false,
        minSelect: 0,
        maxSelect: 3,
        sortOrder: 5,
        isActive: false,
        optionRequiresDescription: true,
        optionRequiresImage: true,
      });

      expect(result.name).toBe('사이즈(수정)');
      expect(result.isRequired).toBe(false);
      expect(result.minSelect).toBe(0);
      expect(result.maxSelect).toBe(3);
      expect(result.sortOrder).toBe(5);
      expect(result.isActive).toBe(false);
      expect(result.optionRequiresDescription).toBe(true);
      expect(result.optionRequiresImage).toBe(true);
    });
  });

  describe('sellerUpdateOptionItem 모든 선택 필드 분기', () => {
    it('title/description/imageUrl/priceDelta/sortOrder/isActive 전체 포함 수정', async () => {
      const { accountId, product } = await setupProductForSeller();
      const group = await createOptionGroup(product.id);
      const item = await prisma.productOptionItem.create({
        data: { option_group_id: group.id, title: 'S' },
      });

      const result = await service.sellerUpdateOptionItem(accountId, {
        optionItemId: item.id.toString(),
        title: 'L',
        description: '대사이즈',
        imageUrl: 'https://i.example/l.png',
        priceDelta: 2000,
        sortOrder: 3,
        isActive: false,
      });

      expect(result.title).toBe('L');
      expect(result.description).toBe('대사이즈');
      expect(result.imageUrl).toBe('https://i.example/l.png');
      expect(result.priceDelta).toBe(2000);
      expect(result.sortOrder).toBe(3);
      expect(result.isActive).toBe(false);
    });
  });

  describe('sellerReorderOptionGroups 추가 예외', () => {
    it('존재하지 않는 productId면 NotFoundException', async () => {
      const { accountId } = await setupProductForSeller();
      await expect(
        service.sellerReorderOptionGroups(accountId, {
          productId: '999999',
          optionGroupIds: [],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('매장 그룹 집합에 없는 id가 섞이면 BadRequestException(invalidIds)', async () => {
      const { accountId, product } = await setupProductForSeller();
      // 길이 일치 분기(idsMismatchError) 대신 invalidIds 분기를 타도록
      // 본인 product에 그룹 1개를 미리 만들어 둔다.
      await createOptionGroup(product.id);
      const otherProduct = await createProduct(prisma, {
        store_id: product.store_id,
        name: 'other',
      });
      const otherGroup = await createOptionGroup(otherProduct.id);

      await expect(
        service.sellerReorderOptionGroups(accountId, {
          productId: product.id.toString(),
          optionGroupIds: [otherGroup.id.toString()],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('sellerCreateOptionItem 타 매장 그룹 접근', () => {
    it('다른 매장의 group이면 NotFoundException', async () => {
      const me = await setupProductForSeller();
      const other = await setupProductForSeller();
      const othersGroup = await createOptionGroup(other.product.id);

      await expect(
        service.sellerCreateOptionItem(me.accountId, {
          optionGroupId: othersGroup.id.toString(),
          title: 'X',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('sellerDeleteOptionItem 타 매장 접근', () => {
    it('다른 매장의 item이면 NotFoundException', async () => {
      const me = await setupProductForSeller();
      const other = await setupProductForSeller();
      const othersGroup = await createOptionGroup(other.product.id);
      const othersItem = await prisma.productOptionItem.create({
        data: { option_group_id: othersGroup.id, title: 'T' },
      });

      await expect(
        service.sellerDeleteOptionItem(me.accountId, othersItem.id),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('sellerReorderOptionItems 추가 예외', () => {
    it('없는 optionGroupId면 NotFoundException', async () => {
      const { accountId } = await setupProductForSeller();
      await expect(
        service.sellerReorderOptionItems(accountId, {
          optionGroupId: '999999',
          optionItemIds: [],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('매장 item 집합에 없는 id가 섞이면 BadRequestException(invalidIds)', async () => {
      const { accountId, product } = await setupProductForSeller();
      const group = await createOptionGroup(product.id);
      const otherProduct = await createProduct(prisma, {
        store_id: product.store_id,
        name: 'o',
      });
      const otherGroup = await createOptionGroup(otherProduct.id);
      const foreignItem = await prisma.productOptionItem.create({
        data: { option_group_id: otherGroup.id, title: 'F' },
      });
      // 내 group에 item 하나 생성하여 length는 맞추고, 섞인 id만 foreign
      await prisma.productOptionItem.create({
        data: { option_group_id: group.id, title: 'Mine' },
      });

      await expect(
        service.sellerReorderOptionItems(accountId, {
          optionGroupId: group.id.toString(),
          optionItemIds: [foreignItem.id.toString()],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
