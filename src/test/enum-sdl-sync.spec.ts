import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Kind, parse, print, visit } from 'graphql';

import { CANCEL_REFUND_RULES } from '@/features/order/policies/order-cancel.policy';
import { THREE_D_OPTION_CATEGORIES } from '@/features/product/constants/custom-3d-catalog.constants';
import {
  ConversationBodyFormat,
  CustomImageKind,
  CustomMode,
  CustomTextAlign,
  NotificationEvent,
  OrderActor,
  OrderCancelFault,
  OrderCancelReason,
  OrderCustomUploadPurpose,
  OrderStatus,
  RefundKind,
  RefundStatus,
} from '@/generated/prisma/client';

/**
 * 응답에 그대로 실리는 Prisma enum·TS 상수 union은 SDL enum이 그 값을 모두 가져야 한다. 하나라도 빠지면
 * 그 값이 든 응답 전체가 직렬화 오류로 실패한다(예: 새 NotificationEvent가 든 myNotifications). tsc는 둘을 묶지 못한다.
 */
const PAIRS: Array<
  [label: string, prisma: string[], file: string, sdl: string]
> = [
  [
    'NotificationEvent',
    Object.values(NotificationEvent),
    'src/features/notification/notification.types.graphql',
    'NotificationEvent',
  ],
  [
    'ConversationBodyFormat',
    Object.values(ConversationBodyFormat),
    'src/features/conversation/conversation.types.graphql',
    'ConversationBodyFormat',
  ],
  [
    'OrderStatus',
    Object.values(OrderStatus),
    'src/features/order/order.types.graphql',
    'OrderStatusType',
  ],
  [
    'OrderActor',
    Object.values(OrderActor),
    'src/features/order/order.types.graphql',
    'OrderActorType',
  ],
  [
    'OrderCancelReason',
    Object.values(OrderCancelReason),
    'src/features/order/order.types.graphql',
    'OrderCancelReasonType',
  ],
  [
    'OrderCancelFault',
    Object.values(OrderCancelFault),
    'src/features/order/order.types.graphql',
    'OrderCancelFaultType',
  ],
  [
    'CancelRefundRule',
    [...CANCEL_REFUND_RULES],
    'src/features/order/order.types.graphql',
    'CancelRefundRuleType',
  ],
  [
    'RefundKind',
    Object.values(RefundKind),
    'src/features/order/order.types.graphql',
    'RefundKindType',
  ],
  [
    'RefundStatus',
    Object.values(RefundStatus),
    'src/features/order/order.types.graphql',
    'RefundStatusType',
  ],
  [
    'CustomMode',
    Object.values(CustomMode),
    'src/features/product/product.types.graphql',
    'CustomModeType',
  ],
  [
    'CustomTextAlign',
    Object.values(CustomTextAlign),
    'src/features/product/product.types.graphql',
    'CustomTextAlignType',
  ],
  [
    'CustomImageKind',
    Object.values(CustomImageKind),
    'src/features/order/order.types.graphql',
    'CustomImageKindType',
  ],
  [
    'ThreeDOptionCategory',
    [...THREE_D_OPTION_CATEGORIES],
    'src/features/product/product.types.graphql',
    'ThreeDOptionCategoryType',
  ],
];

function sdlEnumValues(source: string, enumName: string): string[] {
  for (const def of parse(source).definitions) {
    if (def.kind === Kind.ENUM_TYPE_DEFINITION && def.name.value === enumName) {
      return (def.values ?? []).map((v) => v.name.value);
    }
  }
  throw new Error(`enum ${enumName}이 SDL에 없습니다`);
}

/**
 * 입력 SDL enum은 방향이 반대다 — SDL 값이 서버 enum에 모두 있어야 한다. SDL에만 값이 늘면 그 값을 받은
 * 요청이 서버 매핑(예: 업로드 용도 → 정책)을 찾지 못해 500으로 떨어진다.
 */
const INPUT_PAIRS: Array<
  [label: string, prisma: string[], file: string, sdl: string]
> = [
  [
    'OrderCustomUploadPurpose',
    Object.values(OrderCustomUploadPurpose),
    'src/features/order/order-checkout.graphql',
    'OrderCustomUploadPurpose',
  ],
];

function missingFrom(values: string[], target: string[]): string[] {
  return values.filter((v) => !target.includes(v));
}

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

describe('Prisma enum·TS 상수 ⊆ SDL enum', () => {
  describe('검사기 반증', () => {
    it.each(PAIRS)(
      '%s: SDL에서 값 하나를 지우면 그 값이 빠졌다고 잡는다',
      (_label, prisma, file, sdl) => {
        const removed = prisma[prisma.length - 1];
        const broken = print(
          visit(parse(read(file)), {
            EnumValueDefinition: (node) =>
              node.name.value === removed ? null : undefined,
          }),
        );
        expect(missingFrom(prisma, sdlEnumValues(broken, sdl))).toEqual([
          removed,
        ]);
      },
    );

    it('SDL에만 있는 값은 허용한다(부분집합 판정)', () => {
      expect(missingFrom(['A'], ['A', 'B'])).toEqual([]);
    });

    it('SDL에 enum이 없으면 실패한다', () => {
      expect(() => sdlEnumValues('enum Other { A }', 'NoSuchEnum')).toThrow(
        'NoSuchEnum',
      );
    });
  });

  it.each(PAIRS)(
    '%s: 서버 값이 SDL에 모두 있다',
    (_label, prisma, file, sdl) => {
      expect(prisma.length).toBeGreaterThan(0);
      expect(missingFrom(prisma, sdlEnumValues(read(file), sdl))).toEqual([]);
    },
  );
});

describe('입력 SDL enum ⊆ Prisma enum', () => {
  it.each(INPUT_PAIRS)(
    '%s: 검사기 반증 — SDL에 값을 하나 더하면 서버에 없다고 잡는다',
    (_label, prisma, file, sdl) => {
      const added = print(
        visit(parse(read(file)), {
          EnumTypeDefinition: (node) =>
            node.name.value === sdl
              ? {
                  ...node,
                  values: [
                    ...(node.values ?? []),
                    {
                      kind: Kind.ENUM_VALUE_DEFINITION,
                      name: { kind: Kind.NAME, value: 'ADDED_IN_SDL' },
                    },
                  ],
                }
              : undefined,
        }),
      );
      expect(missingFrom(sdlEnumValues(added, sdl), prisma)).toEqual([
        'ADDED_IN_SDL',
      ]);
    },
  );

  it.each(INPUT_PAIRS)(
    '%s: SDL 값이 서버에 모두 있다',
    (_label, prisma, file, sdl) => {
      const values = sdlEnumValues(read(file), sdl);
      expect(values.length).toBeGreaterThan(0);
      expect(missingFrom(values, prisma)).toEqual([]);
    },
  );
});
