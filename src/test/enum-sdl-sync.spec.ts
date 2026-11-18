import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Kind, parse, print, visit } from 'graphql';

import {
  ConversationBodyFormat,
  NotificationEvent,
  OrderActor,
  OrderStatus,
} from '@/generated/prisma/client';

/**
 * 응답에 그대로 실리는 Prisma enum은 SDL enum이 그 값을 모두 가져야 한다. 하나라도 빠지면 그 값이 든
 * 응답 전체가 직렬화 오류로 실패한다(예: 새 NotificationEvent가 든 myNotifications). tsc는 둘을 묶지 못한다.
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
];

function sdlEnumValues(source: string, enumName: string): string[] {
  for (const def of parse(source).definitions) {
    if (def.kind === Kind.ENUM_TYPE_DEFINITION && def.name.value === enumName) {
      return (def.values ?? []).map((v) => v.name.value);
    }
  }
  throw new Error(`enum ${enumName}이 SDL에 없습니다`);
}

function missingInSdl(prisma: string[], sdl: string[]): string[] {
  return prisma.filter((v) => !sdl.includes(v));
}

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

describe('Prisma enum ⊆ SDL enum', () => {
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
        expect(missingInSdl(prisma, sdlEnumValues(broken, sdl))).toEqual([
          removed,
        ]);
      },
    );

    it('SDL에만 있는 값은 허용한다(부분집합 판정)', () => {
      expect(missingInSdl(['A'], ['A', 'B'])).toEqual([]);
    });

    it('SDL에 enum이 없으면 실패한다', () => {
      expect(() => sdlEnumValues('enum Other { A }', 'NoSuchEnum')).toThrow(
        'NoSuchEnum',
      );
    });
  });

  it.each(PAIRS)(
    '%s: Prisma 값이 SDL에 모두 있다',
    (_label, prisma, file, sdl) => {
      expect(prisma.length).toBeGreaterThan(0);
      expect(missingInSdl(prisma, sdlEnumValues(read(file), sdl))).toEqual([]);
    },
  );
});
