// 모델 소유권 정본(D1 서비스 경계). 모델 1개 = 소유 서비스 1개 = write가 허용되는 feature 목록.
// 허용 목록이 빈 모델은 앱 코드 writer가 없어야 한다(시드 전용). 새 모델을 추가하면 여기와 스키마 대조 spec이 함께 실패한다.

export type OwnerService =
  | 'identity'
  | 'catalog'
  | 'order'
  | 'review'
  | 'conversation'
  | 'notification'
  | 'audit'
  | 'outbox';

export interface ModelOwnership {
  service: OwnerService;
  /** write 호출이 물리적으로 놓일 수 있는 feature 디렉터리. */
  writers: readonly string[];
}

/** feature 디렉터리 → 서비스. 행위자(admin·seller·user)·집계(mypage·dashboard)·core·system은 소유 서비스가 없다. */
export const FEATURE_SERVICE: Readonly<Record<string, OwnerService>> = {
  auth: 'identity',
  store: 'catalog',
  product: 'catalog',
  region: 'catalog',
  search: 'catalog',
  order: 'order',
  review: 'review',
  conversation: 'conversation',
  notification: 'notification',
  'audit-log': 'audit',
  outbox: 'outbox',
};

const identity = (writers: string[] = ['auth']): ModelOwnership => ({
  service: 'identity',
  writers,
});
const catalog = (writers: string[]): ModelOwnership => ({
  service: 'catalog',
  writers,
});
const order = (writers: string[] = ['order']): ModelOwnership => ({
  service: 'order',
  writers,
});
const review = (writers: string[] = ['review']): ModelOwnership => ({
  service: 'review',
  writers,
});

export const MODEL_OWNERSHIP: Readonly<Record<string, ModelOwnership>> = {
  Account: identity(),
  UserProfile: identity(),
  SellerProfile: identity(),
  AccountCredential: identity(),
  AccountIdentity: identity(),
  AuthRefreshSession: identity(),

  Region: catalog(['region']),
  Store: catalog(['store']),
  StoreBusinessHour: catalog(['store']),
  StoreSpecialClosure: catalog(['store']),
  StoreImage: catalog([]),
  StoreFaqTopic: catalog(['store']),
  StoreDailyCapacity: catalog(['store']),
  Category: catalog(['product']),
  Tag: catalog(['product']),
  Banner: catalog(['product']),
  Product: catalog(['product']),
  ProductImage: catalog(['product']),
  ProductCategory: catalog(['product']),
  ProductTag: catalog(['product']),
  ProductOptionGroup: catalog(['product']),
  ProductOptionItem: catalog(['product']),
  ProductCustomTemplate: catalog(['product']),
  ProductCustomTextToken: catalog(['product']),
  SearchHistory: catalog(['search']),
  SearchEvent: catalog(['search']),
  SearchKeywordRankSnapshot: catalog(['search']),

  Order: order(),
  OrderStatusHistory: order(),
  OrderItem: order(),
  OrderItemOptionItem: order(),
  OrderItemCustomText: order([]),
  OrderItemCustomFreeEdit: order([]),
  OrderItemCustomFreeEditAttachment: order([]),

  Review: review(),
  ReviewMedia: review(),
  ReviewComment: review(),
  ReviewLike: review(),
  ReviewReport: review(),
  WishlistItem: review(),
  StoreWishlistItem: review(),
  RecentProductView: review(),

  StoreConversation: { service: 'conversation', writers: ['conversation'] },
  StoreConversationMessage: {
    service: 'conversation',
    writers: ['conversation'],
  },

  Notification: { service: 'notification', writers: ['notification'] },

  AuditLog: { service: 'audit', writers: ['audit-log'] },
  // 발행 feature는 OutboxPublisher(같은 tx 적재)로만 쓴다 — 직접 write는 게이트가 막는다
  Outbox: { service: 'outbox', writers: ['outbox'] },
};
