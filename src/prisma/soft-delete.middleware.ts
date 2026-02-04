import { Prisma } from '@prisma/client';

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
  'ReviewImage',
  'Notification',
  'SearchHistory',
  'SearchEvent',
  'Banner',
]);

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

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
