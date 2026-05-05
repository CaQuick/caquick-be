/**
 * 시드 매장 + 상품.
 *
 * 매장 2개 (각각 SELLER 계정 1개씩 생성), 상품 5개:
 *   p1 레터링 케이크 (sale_price 있음)
 *   p2 캐릭터 케이크 (sale_price 없음, 옵션 그룹 포함)
 *   p3 미니 케이크 세트
 *   p4 글레이즈드 도넛 (다른 매장)
 *   p5 비활성 상품 (찜 가시성 검증용)
 */
import type { PrismaClient, Product, Store } from '@prisma/client';

import { SEED_STORE_NAME_PREFIX } from './idempotent';

export interface SeededStores {
  stores: Store[];
  products: Product[];
  optionGroupIds: { p2GroupId: bigint; p2OptionItemId: bigint };
}

export async function seedStores(prisma: PrismaClient): Promise<SeededStores> {
  // 매장 1: 케이크샵 A (소속 seller 계정 자동 생성)
  const sellerA = await prisma.account.create({
    data: {
      account_type: 'SELLER',
      status: 'ACTIVE',
      email: 'seed-seller-a@dev.caquick',
      name: '케이크샵 A 운영자',
    },
  });
  const storeA = await prisma.store.create({
    data: {
      seller_account_id: sellerA.id,
      store_name: `${SEED_STORE_NAME_PREFIX}케이크샵 A`,
      store_phone: '02-1111-2222',
      address_full: '서울특별시 강남구 테헤란로 1길 10',
      address_city: '서울특별시',
      address_district: '강남구',
      address_neighborhood: '역삼동',
      latitude: 37.5012 as unknown as never,
      longitude: 127.0396 as unknown as never,
      business_hours_text: '매일 09:00 ~ 18:00 (화요일 정기 휴무)',
      is_active: true,
    },
  });

  // 매장 2: 도넛샵 B
  const sellerB = await prisma.account.create({
    data: {
      account_type: 'SELLER',
      status: 'ACTIVE',
      email: 'seed-seller-b@dev.caquick',
      name: '도넛샵 B 운영자',
    },
  });
  const storeB = await prisma.store.create({
    data: {
      seller_account_id: sellerB.id,
      store_name: `${SEED_STORE_NAME_PREFIX}도넛샵 B`,
      store_phone: '02-3333-4444',
      address_full: '서울특별시 마포구 와우산로 5',
      address_city: '서울특별시',
      address_district: '마포구',
      address_neighborhood: '서교동',
      business_hours_text: '평일 11:00 ~ 21:00',
      is_active: true,
    },
  });

  // 상품
  const p1 = await prisma.product.create({
    data: {
      store_id: storeA.id,
      name: '[SEED] 레터링 케이크',
      description: '원하는 글씨를 손글씨로 새겨주는 레터링 케이크입니다.',
      regular_price: 40000,
      sale_price: 35000,
      is_active: true,
      images: {
        create: [
          {
            image_url: 'https://placehold.co/600x600/png?text=Lettering+Cake',
            sort_order: 0,
          },
        ],
      },
    },
  });

  const p2 = await prisma.product.create({
    data: {
      store_id: storeA.id,
      name: '[SEED] 캐릭터 케이크',
      description: '원하시는 캐릭터를 케이크 위에 그려드립니다.',
      regular_price: 50000,
      sale_price: null,
      is_active: true,
      images: {
        create: [
          {
            image_url: 'https://placehold.co/600x600/png?text=Character+Cake',
            sort_order: 0,
          },
        ],
      },
    },
  });

  // p2에 옵션 그룹 1건 + 옵션 아이템 2건 (주문 상세 selectedOptions 검증)
  const p2OptionGroup = await prisma.productOptionGroup.create({
    data: {
      product_id: p2.id,
      name: '케이크 사이즈',
      is_required: true,
      min_select: 1,
      max_select: 1,
      sort_order: 0,
      is_active: true,
      option_items: {
        create: [
          { title: '미니 (4호)', price_delta: 0, sort_order: 0 },
          { title: '레귤러 (6호)', price_delta: 10000, sort_order: 1 },
        ],
      },
    },
    include: { option_items: true },
  });
  const p2RegularItem = p2OptionGroup.option_items.find(
    (i) => i.title === '레귤러 (6호)',
  )!;

  const p3 = await prisma.product.create({
    data: {
      store_id: storeA.id,
      name: '[SEED] 미니 케이크 세트',
      description: '한 입 크기의 미니 케이크 6종 세트.',
      regular_price: 25000,
      sale_price: 22000,
      is_active: true,
      images: {
        create: [
          {
            image_url: 'https://placehold.co/600x600/png?text=Mini+Cake+Set',
            sort_order: 0,
          },
        ],
      },
    },
  });

  const p4 = await prisma.product.create({
    data: {
      store_id: storeB.id,
      name: '[SEED] 글레이즈드 도넛',
      description: '갓 만든 글레이즈드 도넛 1개.',
      regular_price: 3000,
      is_active: true,
      images: {
        create: [
          {
            image_url: 'https://placehold.co/600x600/png?text=Glazed+Donut',
            sort_order: 0,
          },
        ],
      },
    },
  });

  const p5 = await prisma.product.create({
    data: {
      store_id: storeA.id,
      name: '[SEED] (비활성) 단종 상품',
      description: '판매 중단된 상품. 찜 가시성 정책 검증용.',
      regular_price: 10000,
      is_active: false,
    },
  });

  return {
    stores: [storeA, storeB],
    products: [p1, p2, p3, p4, p5],
    optionGroupIds: {
      p2GroupId: p2OptionGroup.id,
      p2OptionItemId: p2RegularItem.id,
    },
  };
}
