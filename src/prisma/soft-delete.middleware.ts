import { Prisma } from '@prisma/client';

import { isRecord } from '@/common/utils/type-guards';

// deleted_at 컬럼을 가진 모든 모델이 등록되어야 한다 — 스키마와의 일치는
// soft-delete.middleware.spec.ts의 dmmf 대조 테스트가 강제한다.
// (Region은 모델 추가 시 이 목록 갱신이 누락됐던 사례 — 이슈 #207에서 보강)
const SOFT_DELETE_MODELS = new Set<Prisma.ModelName>([
  'Account',
  'UserProfile',
  'SellerProfile',
  'SellerCredential',
  'AccountIdentity',
  'AuthRefreshSession',
  'Store',
  'StoreBusinessHour',
  'StoreSpecialClosure',
  'StoreImage',
  'Category',
  'Tag',
  'Product',
  'ProductImage',
  'ProductCategory',
  'ProductTag',
  'ProductOptionGroup',
  'ProductOptionItem',
  'ProductCustomTemplate',
  'ProductCustomTextToken',
  'WishlistItem',
  'Cart',
  'CartItem',
  'CartItemOptionItem',
  'CustomDraft',
  'CustomDraftTextValue',
  'CustomDraftFreeEdit',
  'CustomDraftFreeEditAttachment',
  'Order',
  'OrderStatusHistory',
  'OrderItem',
  'OrderItemOptionItem',
  'OrderItemCustomText',
  'OrderItemCustomFreeEdit',
  'OrderItemCustomFreeEditAttachment',
  'Review',
  'ReviewMedia',
  'ReviewComment',
  'Notification',
  'SearchHistory',
  'SearchEvent',
  'Banner',
  'StoreWishlistItem',
  'ReviewLike',
  'StoreConversation',
  'StoreConversationMessage',
  'StoreFaqTopic',
  'StoreDailyCapacity',
  'RecentProductView',
  'Region',
]);

/** dmmf 대조 테스트 전용 — 런타임 소비 금지. */
export const SOFT_DELETE_MODEL_NAMES: ReadonlySet<Prisma.ModelName> =
  SOFT_DELETE_MODELS;

const READ_ACTIONS = new Set<Prisma.PrismaAction>([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

type MiddlewareArgs = Record<string, unknown> & {
  where?: Record<string, unknown>;
};

type SoftDeleteQueryContext = {
  model?: Prisma.ModelName;
  operation: Prisma.PrismaAction;
  args?: unknown;
  query: (args: unknown) => Promise<unknown>;
};

function hasOwnKey(target: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(target, key);
}

function getWhere(args: Record<string, unknown>): Record<string, unknown> {
  return isRecord(args.where) ? args.where : {};
}

export function applySoftDeleteArgs(input: {
  model?: Prisma.ModelName;
  operation: Prisma.PrismaAction;
  args?: unknown;
}): unknown {
  if (!input.model || !SOFT_DELETE_MODELS.has(input.model)) {
    return input.args;
  }
  if (!READ_ACTIONS.has(input.operation)) {
    return input.args;
  }

  const rawArgs: MiddlewareArgs = isRecord(input.args) ? input.args : {};
  const where = getWhere(rawArgs);
  if (hasOwnKey(where, 'deleted_at')) {
    return rawArgs;
  }

  return {
    ...rawArgs,
    where: {
      ...where,
      deleted_at: null,
    },
  };
}

export const softDeleteExtension = Prisma.defineExtension({
  name: 'softDelete',
  query: {
    $allModels: {
      $allOperations({
        model,
        operation,
        args,
        query,
      }: SoftDeleteQueryContext) {
        return query(
          applySoftDeleteArgs({
            model,
            operation,
            args,
          }),
        );
      },
    },
  },
});
