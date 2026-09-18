import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  collectCrossReadsInFeatures,
  loadSchema,
} from '@/test/model-ownership.helper';

// 서비스 경계를 넘는 읽기(nested include/select/_count, relation 필터, raw JOIN)를 허용 목록으로 고정한다.
// P1 07x가 스냅샷·포트로 바꾸면 줄을 지우고, P4 federation 이관분만 남긴다. 새 항목은 늘리지 않는다.
// 한계: Prisma.raw(table)처럼 테이블명이 동적인 raw SQL은 보지 못한다(admin.repository lockActiveRow — D2 해체로 소멸).

const schema = loadSchema();

/** 'file|kind|key' — nested/filter는 Root.path->Target, raw는 method:table,... */
const CROSS_READ_ALLOWLIST: string[] = [
  'src/features/admin/repositories/admin.repository.ts|nested|Account._count.orders->Order',
  'src/features/admin/repositories/admin.repository.ts|nested|Account._count.reviews->Review',
  'src/features/admin/repositories/admin.repository.ts|nested|Account.store->Store',
  'src/features/admin/repositories/admin.repository.ts|nested|Product._count.order_items->OrderItem',
  'src/features/admin/repositories/admin.repository.ts|nested|Product._count.reviews->Review',
  'src/features/admin/repositories/admin.repository.ts|nested|Review.account->Account',
  'src/features/admin/repositories/admin.repository.ts|nested|Review.account.user_profile->UserProfile',
  'src/features/admin/repositories/admin.repository.ts|nested|Review.store->Store',
  'src/features/admin/repositories/admin.repository.ts|nested|ReviewComment.account->Account',
  'src/features/admin/repositories/admin.repository.ts|nested|ReviewComment.account.user_profile->UserProfile',
  'src/features/admin/repositories/admin.repository.ts|nested|ReviewReport.review.account->Account',
  'src/features/admin/repositories/admin.repository.ts|nested|ReviewReport.review.account.user_profile->UserProfile',
  'src/features/admin/repositories/admin.repository.ts|nested|ReviewReport.review_comment.account->Account',
  'src/features/admin/repositories/admin.repository.ts|nested|ReviewReport.review_comment.account.user_profile->UserProfile',
  'src/features/admin/repositories/admin.repository.ts|nested|Store._count.order_items->OrderItem',
  'src/features/admin/repositories/admin.repository.ts|nested|Store.seller_account->Account',
  'src/features/admin/repositories/admin.repository.ts|nested|Store.seller_account.credential->AccountCredential',
  'src/features/conversation/repositories/conversation.repository.ts|nested|StoreConversation.store->Store',
  'src/features/order/repositories/order.repository.ts|filter|OrderItem.review->Review',
  'src/features/order/repositories/order.repository.ts|nested|Order.account->Account',
  'src/features/order/repositories/order.repository.ts|nested|Order.account.user_profile->UserProfile',
  'src/features/order/repositories/order.repository.ts|nested|Order.items.product->Product',
  'src/features/order/repositories/order.repository.ts|nested|Order.items.product.images->ProductImage',
  'src/features/order/repositories/order.repository.ts|nested|Order.items.review->Review',
  'src/features/order/repositories/order.repository.ts|nested|Order.items.store->Store',
  'src/features/order/repositories/order.repository.ts|nested|Order.items.store.business_hours->StoreBusinessHour',
  'src/features/order/repositories/order.repository.ts|nested|OrderItem.product->Product',
  'src/features/order/repositories/order.repository.ts|nested|OrderItem.product.images->ProductImage',
  'src/features/order/repositories/order.repository.ts|nested|OrderItem.store->Store',
  'src/features/order/repositories/order.repository.ts|nested|OrderItem.store.region->Region',
  'src/features/order/repositories/order.repository.ts|raw|isCapacityExceededLocked:store_daily_capacity',
  'src/features/product/repositories/product-review.repository.ts|nested|Review.account->Account',
  'src/features/product/repositories/product-review.repository.ts|nested|Review.account.user_profile->UserProfile',
  'src/features/product/repositories/product-review.repository.ts|nested|Review.order_item->OrderItem',
  'src/features/product/repositories/product-review.repository.ts|nested|Review.order_item.option_items->OrderItemOptionItem',
  'src/features/product/repositories/product-review.repository.ts|nested|Review.product->Product',
  'src/features/product/repositories/product-review.repository.ts|nested|Review.product.images->ProductImage',
  'src/features/product/repositories/product-review.repository.ts|nested|Review.product.store->Store',
  'src/features/product/repositories/product-review.repository.ts|nested|Review.product.store.region->Region',
  'src/features/product/repositories/product-review.repository.ts|nested|ReviewComment.account->Account',
  'src/features/product/repositories/product-review.repository.ts|nested|ReviewComment.account.user_profile->UserProfile',
  'src/features/product/repositories/product.repository.ts|filter|WishlistItem.product->Product',
  'src/features/product/repositories/product.repository.ts|filter|WishlistItem.product.store->Store',
  'src/features/review/repositories/review-read.repository.ts|nested|Review.account->Account',
  'src/features/review/repositories/review-read.repository.ts|nested|Review.account.user_profile->UserProfile',
  'src/features/review/repositories/review-read.repository.ts|nested|Review.order_item->OrderItem',
  'src/features/review/repositories/review-read.repository.ts|nested|Review.order_item.free_edits->OrderItemCustomFreeEdit',
  'src/features/review/repositories/review-read.repository.ts|nested|Review.order_item.option_items->OrderItemOptionItem',
  'src/features/review/repositories/review-read.repository.ts|raw|listReviewIdsByLikes:product,store',
  'src/features/review/repositories/review-read.repository.ts|raw|listReviewIdsByLikes:store',
  'src/features/review/repositories/review-read.repository.ts|raw|listShowcaseReviewIdsByLikes:order_item_custom_free_edit,product,review,review_like,review_media,store',
  'src/features/seller/repositories/seller.repository.ts|nested|Account.store->Store',
  'src/features/store/repositories/store-wishlist.repository.ts|filter|StoreWishlistItem.store->Store',
  'src/features/store/repositories/store-wishlist.repository.ts|nested|StoreWishlistItem.store->Store',
  'src/features/store/repositories/store-wishlist.repository.ts|nested|StoreWishlistItem.store.region->Region',
  'src/features/store/repositories/store.repository.ts|raw|sumPickupQuantitiesByKstDate:order,order_item',
  'src/features/store/repositories/store.repository.ts|raw|sumPickupQuantitiesInRange:order,order_item',
  'src/features/user/repositories/recent-product-view.repository.ts|filter|RecentProductView.product->Product',
  'src/features/user/repositories/recent-product-view.repository.ts|filter|RecentProductView.product.store->Store',
  'src/features/user/repositories/recent-product-view.repository.ts|nested|RecentProductView.product->Product',
  'src/features/user/repositories/recent-product-view.repository.ts|nested|RecentProductView.product.images->ProductImage',
  'src/features/user/repositories/recent-product-view.repository.ts|nested|RecentProductView.product.store->Store',
  'src/features/user/repositories/recent-product-view.repository.ts|nested|RecentProductView.product.store.region->Region',
  'src/features/user/repositories/review-report.repository.ts|raw|lockReportableComment:product,review,review_comment,store',
  'src/features/user/repositories/review-report.repository.ts|raw|lockReportableTarget:product,review,store',
  'src/features/user/repositories/review.repository.ts|nested|OrderItem.product->Product',
  'src/features/user/repositories/review.repository.ts|nested|OrderItem.product.images->ProductImage',
  'src/features/user/repositories/review.repository.ts|nested|OrderItem.review->Review',
  'src/features/user/repositories/review.repository.ts|nested|OrderItem.store->Store',
  'src/features/user/repositories/review.repository.ts|nested|Review.order_item->OrderItem',
  'src/features/user/repositories/review.repository.ts|nested|Review.order_item.product->Product',
  'src/features/user/repositories/review.repository.ts|nested|Review.order_item.product.images->ProductImage',
  'src/features/user/repositories/review.repository.ts|nested|Review.order_item.store->Store',
  'src/features/user/repositories/user.repository.ts|nested|Notification.order->Order',
  'src/features/user/repositories/user.repository.ts|nested|Notification.order.items->OrderItem',
  'src/features/user/repositories/user.repository.ts|nested|Notification.order.items.store->Store',
  'src/features/user/repositories/user.repository.ts|nested|Notification.product->Product',
  'src/features/user/repositories/user.repository.ts|nested|Notification.store->Store',
  'src/features/user/repositories/user.repository.ts|nested|WishlistItem.product->Product',
  'src/features/user/repositories/user.repository.ts|nested|WishlistItem.product.images->ProductImage',
  'src/features/user/repositories/user.repository.ts|nested|WishlistItem.product.store->Store',
  'src/features/user/repositories/user.repository.ts|nested|WishlistItem.product.store.region->Region',
  'src/features/user/repositories/user.repository.ts|raw|createReviewComment:product,review,store',
];

function keysOf(dir?: string): string[] {
  return collectCrossReadsInFeatures(schema, dir)
    .map((r) => `${r.file}|${r.kind}|${r.key}`)
    .sort();
}

describe('서비스 경계를 넘는 read', () => {
  it('허용 목록과 정확히 일치한다', () => {
    expect(keysOf()).toEqual([...CROSS_READ_ALLOWLIST].sort());
  });

  describe('검사기 반증', () => {
    let dir: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'read-boundary-'));
      mkdirSync(join(dir, 'review'), { recursive: true });
      writeFileSync(
        join(dir, 'review', 'probe.repository.ts'),
        [
          'const authorInclude = { account: { select: { user_profile: true } } } as const;',
          'export class R {',
          '  constructor(private readonly prisma: any) {}',
          '  async a() {',
          '    const where = { product: { is_active: true, store: { deleted_at: null } } };',
          '    return this.prisma.review.findMany({ where, include: { ...authorInclude, order_item: { select: { product: true } } } });',
          '  }',
          '  async b(tx: any) {',
          '    return tx.$queryRaw`SELECT r.id FROM review r JOIN product p ON p.id = r.product_id WHERE p.is_active = 1`;',
          '  }',
          '  async c() {',
          '    return this.prisma.review.count({ where: { media: { some: { deleted_at: null } } } });',
          '  }',
          '}',
        ].join('\n'),
      );
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('상수 include·relation 필터·raw JOIN을 잡고, 같은 서비스 안의 relation은 무시한다', () => {
      expect(keysOf(dir)).toEqual([
        'review/probe.repository.ts|filter|Review.product->Product',
        'review/probe.repository.ts|filter|Review.product.store->Store',
        'review/probe.repository.ts|nested|Review.account->Account',
        'review/probe.repository.ts|nested|Review.account.user_profile->UserProfile',
        'review/probe.repository.ts|nested|Review.order_item->OrderItem',
        'review/probe.repository.ts|nested|Review.order_item.product->Product',
        'review/probe.repository.ts|raw|b:product,review',
      ]);
    });
  });
});
